import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TopHeader } from './components/layout/TopHeader';
import { WorkflowStrip, StageId } from './components/layout/WorkflowStrip';
import { LeftStagePanel } from './components/layout/LeftStagePanel';
import { CadWorkbench2D } from './components/cad/CadWorkbench2D';
import { RightContextInspector } from './components/layout/RightContextInspector';
import { BottomSolverDrawer } from './components/layout/BottomSolverDrawer';
import { StatusBar } from './components/layout/StatusBar';
import { CaseSetupDrawer } from './components/layout/CaseSetupDrawer';
import {
  CFDProjectState,
  GeometryConfig,
  PhysicsConfig,
  BoundaryConditions,
  YPlusCalculation,
  SolverControls,
  PostProcessConfig,
  ResidualDataPoint,
} from './types/cfd';
import {
  fetchYPlus,
  fetchTurbulenceInflow,
  generateMesh,
  generateCaseFiles,
  fetchFieldSolution,
  uploadAndParseAirfoil,
  fetchAndParseAirfoilFromUrl,
} from './utils/api';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  DomainPreset,
  BoundaryTag,
  Point2D,
  CadEntity,
  getGeometryBBox,
  validateDomainContainment,
  extractBoundaryEdges,
  validateBoundaryTags,
} from './types/cadWorkflow';

const SESSION_STORAGE_KEY = 'opencfd_studio_session_v1';

interface StudioSession {
  state: CFDProjectState;
  cadEntities: CadEntity[];
  edgeTagMap: Record<string, BoundaryTag>;
  cadWorkflowStep: CadWorkflowStep;
  flowType: FlowType;
  domainShape: DomainShapeType;
  domainPreset: DomainPreset;
  upstreamChordFactor: number;
  downstreamChordFactor: number;
  lateralHeightFactor: number;
  angleOfAttackDeg: number;
  freestreamVelocity: number;
  activeTagTool: BoundaryTag;
}

function loadSavedSession(): Partial<StudioSession> | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function App() {
  const savedSession = useMemo(() => loadSavedSession(), []);

  // Active workflow stage
  const [activeStage, setActiveStage] = useState<StageId>('geometry');
  const [selectedBoundary, setSelectedBoundary] = useState<string>('inlet');
  const [pendingImportFile, setPendingImportFile] = useState<
    | { type: 'parsed'; name: string; points: Point2D[] }
    | { type: 'airfoil' | 'dxf' | 'url'; file?: File; url?: string }
    | null
  >(null);

  // ── 6-Step CFD Pre-Processing Workflow State (Left Sidebar Controlled) ──
  const [cadWorkflowStep, setCadWorkflowStep] = useState<CadWorkflowStep>(() => savedSession?.cadWorkflowStep || 1);
  const [flowType, setFlowType] = useState<FlowType>(() => savedSession?.flowType || 'external');
  const [domainShape, setDomainShape] = useState<DomainShapeType>(() => savedSession?.domainShape || 'rectangle');
  const [domainPreset, setDomainPreset] = useState<DomainPreset>(() => savedSession?.domainPreset || 'standard');
  const [upstreamChordFactor, setUpstreamChordFactor] = useState(() => savedSession?.upstreamChordFactor ?? 10);
  const [downstreamChordFactor, setDownstreamChordFactor] = useState(() => savedSession?.downstreamChordFactor ?? 20);
  const [lateralHeightFactor, setLateralHeightFactor] = useState(() => savedSession?.lateralHeightFactor ?? 10);
  const [angleOfAttackDeg, setAngleOfAttackDeg] = useState(() => savedSession?.angleOfAttackDeg ?? 0.0);
  const [freestreamVelocity, setFreestreamVelocity] = useState(() => savedSession?.freestreamVelocity ?? 35.0);
  const [activeTagTool, setActiveTagTool] = useState<BoundaryTag>(() => savedSession?.activeTagTool || 'inlet');
  const [edgeTagMap, setEdgeTagMap] = useState<Record<string, BoundaryTag>>(() => savedSession?.edgeTagMap || {});
  const [cadEntities, setCadEntities] = useState<CadEntity[]>(() => savedSession?.cadEntities || []);

  // Action refs triggered from LeftStagePanel to CadWorkbench2D
  const requestGenerateDomainRef = useRef<(() => void) | null>(null);
  const requestSetSelectedAsDomainRef = useRef<(() => void) | null>(null);
  const requestSetSelectedAsGeometryRef = useRef<(() => void) | null>(null);
  const requestSelectAllGeometryRef = useRef<(() => void) | null>(null);
  const requestClearGeometryRef = useRef<(() => void) | null>(null);
  const requestAutoSuggestTagsRef = useRef<(() => void) | null>(null);
  const requestMeshHandoffRef = useRef<(() => void) | null>(null);
  const requestDownloadBlockMeshDictRef = useRef<(() => void) | null>(null);

  const geometryEntitiesCount = useMemo(
    () => cadEntities.filter(e => e.layer !== 'construction' && e.role !== 'domain_boundary').length,
    [cadEntities]
  );

  const geometryBBox = useMemo(() => getGeometryBBox(cadEntities), [cadEntities]);

  const domainEntity = useMemo(
    () => cadEntities.find(e => e.role === 'domain_boundary') || null,
    [cadEntities]
  );


  const domainValidation = useMemo(
    () =>
      flowType === 'external'
        ? validateDomainContainment(domainEntity, cadEntities)
        : { valid: true, reason: 'Internal flow' },
    [domainEntity, cadEntities, flowType]
  );

  const boundaryEdges = useMemo(
    () => extractBoundaryEdges(cadEntities, flowType, edgeTagMap),
    [cadEntities, flowType, edgeTagMap]
  );

  const boundaryValidation = useMemo(
    () => validateBoundaryTags(boundaryEdges, flowType),
    [boundaryEdges, flowType]
  );

  // Master CFD Project State

  const [state, setState] = useState<CFDProjectState>(() => ({
    geometry: {
      type: 'custom',
      name: '',
      chord: 1.0,
      angleOfAttackDeg: 5.0,
      cylinderDiameter: 1.0,
      domainLength: 10.0,
      domainHeight: 5.0,
      stepHeight: 0.5,
      meshResolution: 'medium',
      usePrismLayers: true,
      firstLayerHeightMm: 0.05,
      numPrismLayers: 12,
      prismExpansionRatio: 1.2,
      meshAlgorithm: 'frontal_delaunay',
      elementType: 'hybrid',
      growthRate: 1.2,
      elementsPerCurve: 12,
      useProximityRefinement: true,
      minElementSize: 0,
      maxElementSize: 0,
      localRefinementSize: 0,
      optimizeMesh: true,
      ...(savedSession?.state?.geometry || {}),
    },
    physics: {
      compressibility: 'incompressible',
      regime: 'turbulent',
      timeFormulation: 'steady',
      solver: 'simpleFoam',
      inletVelocity: 35.0,
      inletPressure: 101325,
      inletTemperature: 288.15,
      density: 1.225,
      kinematicViscosity: 1.5e-5,
      equationOfState: 'constantDensity',
      specificHeatRatio: 1.4,
      gasConstant: 287.05,
      specificHeat: 1005,
      thermalConductivity: 0.0262,
      prandtlNumber: 0.71,
      energyModel: 'disabled',
      transportModel: 'constant',
      turbulenceModel: 'kOmegaSST',
      kOmegaConstants: {
        alpha1: 0.55,
        beta1: 0.075,
        betaStar: 0.09,
        sigmaK1: 0.85,
        sigmaOmega1: 0.5,
      },
      kEpsilonConstants: {
        cMu: 0.09,
        c1Eps: 1.44,
        c2Eps: 1.92,
        sigmaK: 1.0,
        sigmaEps: 1.3,
      },
      saConstants: {
        cb1: 0.1355,
        cb2: 0.622,
        sigma: 0.6667,
        kappa: 0.41,
      },
      wallTreatment: 'low_re_resolved',
      ...(savedSession?.state?.physics || {}),
    },
    boundaries: {
      inletVelocity: 35.0,
      inletAngleDeg: 0.0,
      turbulenceIntensityPercent: 5.0,
      turbulentLengthScaleM: 0.01,
      inletK: 2.34,
      inletOmega: 60.5,
      inletEpsilon: 18.2,
      inletNut: 0.038,
      outletPressure: 0.0,
      wallType: 'noSlip',
      ...(savedSession?.state?.boundaries || {}),
    },
    yplus: {
      velocity: 35.0,
      length: 1.0,
      density: 1.225,
      viscosity: 1.789e-5,
      target_yplus: 30.0,
      expansion_ratio: 1.2,
      reynolds_number: 2398634.0,
      skin_friction_coefficient: 0.0031,
      wall_shear_stress: 2.31,
      friction_velocity: 1.37,
      first_layer_height_m: 0.00032,
      first_layer_height_mm: 0.32,
      boundary_layer_thickness_mm: 8.42,
      recommended_layers: 12,
      total_layer_thickness_mm: 8.42,
      ...(savedSession?.state?.yplus || {}),
    },
    solver: {
      iterations: 200,
      writeInterval: 25,
      timeStep: 1.0,
      relaxationFactors: {
        p: 0.3,
        U: 0.7,
        k: 0.7,
        omega: 0.7,
      },
      convergenceTolerances: {
        p: 1e-5,
        U: 1e-5,
        k: 1e-5,
        omega: 1e-5,
      },
      ...(savedSession?.state?.solver || {}),
    },
    postprocess: {
      activeField: 'U_mag',
      colormap: 'viridis',
      showMeshWireframe: false,
      showStreamlines: true,
      showSlicePlane: false,
      sliceAxis: 'z',
      slicePosition: 0.0,
      numStreamlines: 10,
      glyphScale: 1.0,
      showVectors: false,
      ...(savedSession?.state?.postprocess || {}),
    },
    executionStatus: 'idle',
    residuals: [],
    terminalLogs: [
      'AEROFLOW CFD Studio ready.',
      'Case initialized: cases/nozzle (simpleFoam RAS kOmegaSST).',
    ],
  }));

  // ── Auto-save Session State to Persistent Storage ──────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const sessionData: StudioSession = {
          state,
          cadEntities,
          edgeTagMap,
          cadWorkflowStep,
          flowType,
          domainShape,
          domainPreset,
          upstreamChordFactor,
          downstreamChordFactor,
          lateralHeightFactor,
          angleOfAttackDeg,
          freestreamVelocity,
          activeTagTool,
        };
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
      } catch {
        // ignore quota limits
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [
    state,
    cadEntities,
    edgeTagMap,
    cadWorkflowStep,
    flowType,
    domainShape,
    domainPreset,
    upstreamChordFactor,
    downstreamChordFactor,
    lateralHeightFactor,
    angleOfAttackDeg,
    freestreamVelocity,
    activeTagTool,
  ]);

  const [meshData, setMeshData] = useState<any>(null);
  const [fieldData, setFieldData] = useState<any>(null);
  const [caseFiles, setCaseFiles] = useState<Record<string, string>>({});
  const [isMeshing, setIsMeshing] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Auto calculate Y+ on parameter changes
  useEffect(() => {
    const updateCalculations = async () => {
      try {
        const yplusRes = await fetchYPlus({
          velocity: state.boundaries.inletVelocity,
          length: state.geometry.chord || state.geometry.domainLength,
          density: state.physics.density,
          viscosity: state.physics.density * state.physics.kinematicViscosity,
          target_yplus: state.yplus.target_yplus,
          expansion_ratio: state.yplus.expansion_ratio,
          flow_regime: state.physics.regime,
        });
        // Keep the user's latest target while an older async calculation finishes.
        // The target is an input; the API response should only replace derived values.
        setState((prev) => ({
          ...prev,
          yplus: { ...yplusRes, target_yplus: prev.yplus.target_yplus },
        }));

        const turbRes = await fetchTurbulenceInflow({
          velocity: state.boundaries.inletVelocity,
          length_scale: state.boundaries.turbulentLengthScaleM || 0.01,
          intensity_percent: state.boundaries.turbulenceIntensityPercent,
        });
        setState((prev) => ({
          ...prev,
          boundaries: {
            ...prev.boundaries,
            inletK: turbRes.k,
            inletOmega: turbRes.omega,
            inletEpsilon: turbRes.epsilon,
            inletNut: turbRes.nut,
          },
        }));
      } catch (err) {
        console.warn('Calculation update note:', err);
      }
    };
    updateCalculations();
  }, [
    state.boundaries.inletVelocity,
    state.geometry.chord,
    state.physics.density,
    state.physics.kinematicViscosity,
    state.physics.regime,
    state.yplus.target_yplus,
    state.yplus.expansion_ratio,
    state.boundaries.turbulenceIntensityPercent,
  ]);

  // Initial Mesh Generation on Mount
  useEffect(() => {
    if (geometryEntitiesCount > 0) handleGenerateMesh();
  }, []);

  const handleGenerateMesh = async () => {
    if (geometryEntitiesCount === 0) {
      setState((prev) => ({
        ...prev,
        terminalLogs: [...prev.terminalLogs, '[Gmsh] Add 2D geometry before generating a mesh.'],
      }));
      return;
    }
    setIsMeshing(true);
    // A failed regeneration must not leave an old or placeholder mesh visible.
    setMeshData(null);
    setFieldData(null);
    setState((prev) => ({
      ...prev,
      executionStatus: 'meshing',
      terminalLogs: [...prev.terminalLogs, `[Gmsh] Meshing geometry ${state.geometry.name}...`],
    }));

    try {
      const mesh = await generateMesh(state.geometry.type, {
        chord: state.geometry.chord,
        angleOfAttackDeg: state.geometry.angleOfAttackDeg,
        cylinderDiameter: state.geometry.cylinderDiameter,
        domainLength: state.geometry.domainLength,
        domainHeight: state.geometry.domainHeight,
        meshResolution: state.geometry.meshResolution,
        firstLayerHeightMm: state.geometry.firstLayerHeightMm,
        usePrismLayers: state.geometry.usePrismLayers,
        numPrismLayers: state.geometry.numPrismLayers,
        prismExpansionRatio: state.geometry.prismExpansionRatio,
        meshAlgorithm: state.geometry.meshAlgorithm,
        elementType: state.geometry.elementType,
        growthRate: state.geometry.growthRate,
        elementsPerCurve: state.geometry.elementsPerCurve,
        useProximityRefinement: state.geometry.useProximityRefinement,
        minElementSize: state.geometry.minElementSize,
        maxElementSize: state.geometry.maxElementSize,
        localRefinementSize: state.geometry.localRefinementSize,
        optimizeMesh: state.geometry.optimizeMesh,
        cadEntities,
        edgeTagMap,
        flowType,
      });

      setMeshData(mesh);

      // Mesh generation succeeded independently of optional post-processing.
      setState((prev) => ({
        ...prev,
        executionStatus: 'idle',
        terminalLogs: [
          ...prev.terminalLogs,
          `[Gmsh] Complete: ${mesh.num_nodes} nodes, ${mesh.num_elements} elements.`,
        ],
      }));

      try {
        const fields = await fetchFieldSolution(
          mesh,
          state.geometry.type,
          state.boundaries.inletVelocity,
          state.physics.regime
        );
        setFieldData(fields);
        const dicts = await generateCaseFiles(state.physics, state.boundaries, state.solver);
        setCaseFiles(dicts);
      } catch (postProcessError: any) {
        setState((prev) => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs, `[Postprocess] ${postProcessError.message}`],
        }));
      }
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        executionStatus: 'error',
        terminalLogs: [...prev.terminalLogs, `[Error] ${err.message}`],
      }));
    } finally {
      setIsMeshing(false);
    }
  };

  const handleApplySketchMesh = async (mesh: any, name: string) => {
    setMeshData(mesh);
    setActiveStage('mesh'); // Advance to mesh/flow view

    try {
      const fields = await fetchFieldSolution(
        mesh,
        'custom_cad',
        state.boundaries.inletVelocity,
        state.physics.regime
      );
      setFieldData(fields);

      const dicts = await generateCaseFiles(state.physics, state.boundaries, state.solver);
      setCaseFiles(dicts);

      setState((prev) => ({
        ...prev,
        geometry: { ...prev.geometry, name },
        terminalLogs: [
          ...prev.terminalLogs,
          `[2D CAD] Converted sketch "${name}" to CFD mesh: ${mesh.num_nodes} nodes, ${mesh.num_elements} elements.`,
        ],
      }));
    } catch (err: any) {
      console.warn('Field extraction note:', err);
    }
  };

  const handleApplyYPlusToMesh = () => {
    setState((prev) => ({
      ...prev,
      geometry: {
        ...prev.geometry,
        firstLayerHeightMm: prev.yplus.first_layer_height_mm,
        numPrismLayers: prev.yplus.recommended_layers,
        prismExpansionRatio: prev.yplus.expansion_ratio,
        usePrismLayers: true,
      },
      terminalLogs: [
        ...prev.terminalLogs,
        `[y⁺ Sizing] Applied Δy = ${prev.yplus.first_layer_height_mm.toFixed(4)} mm (${prev.yplus.recommended_layers} layers).`,
      ],
    }));
  };

  const handleRunSolver = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setState((prev) => ({
      ...prev,
      executionStatus: 'running',
      residuals: [],
      terminalLogs: [
        ...prev.terminalLogs,
        `[OpenFOAM] Executing ${state.physics.solver} (RANS ${state.physics.turbulenceModel})...`,
      ],
    }));

    const ws = new WebSocket('ws://localhost:8000/ws/solver');
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          iterations: state.solver.iterations,
          regime: state.physics.regime,
          velocity: state.boundaries.inletVelocity,
        })
      );
    };

    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'log') {
        setState((prev) => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs, msg.line],
        }));
      } else if (msg.type === 'residual') {
        setState((prev) => ({
          ...prev,
          residuals: [...prev.residuals, msg.data],
        }));
      } else if (msg.type === 'status' && msg.status === 'completed') {
        setState((prev) => ({
          ...prev,
          executionStatus: 'completed',
          terminalLogs: [...prev.terminalLogs, '[OpenFOAM] Solution converged successfully.'],
        }));
      }
    };

    ws.onerror = () => {
      setState((prev) => ({
        ...prev,
        executionStatus: 'error',
        terminalLogs: [...prev.terminalLogs, '[Error] Solver stream communication error.'],
      }));
    };
  };

  const handleStopSolver = () => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    setState((prev) => ({
      ...prev,
      executionStatus: 'idle',
      terminalLogs: [...prev.terminalLogs, '[Solver] Execution aborted.'],
    }));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#F5F6F8] overflow-hidden font-sans text-[#171A1F]">
      {/* 1. TOP BAR (52px) */}
      <TopHeader
        projectName={state.geometry.name}
        onProjectNameChange={(name) => setState(prev => ({ ...prev, geometry: { ...prev.geometry, name } }))}
      />

      {/* 2. WORKFLOW NAVIGATION STRIP (36px) */}
      <WorkflowStrip activeStage={activeStage} onSelectStage={setActiveStage} />

      {/* 3. THREE-COLUMN HERO WORKSPACE */}
      <div className="flex-1 flex min-h-0 relative">
        {activeStage === 'caseSetup' ? (
          <div className="flex-1 min-w-0 h-full">
            <CaseSetupDrawer
              state={state}
              flowType={flowType}
              onFlowTypeChange={setFlowType}
              updatePhysics={(p) => setState((prev) => ({
                ...prev,
                physics: { ...prev.physics, ...p },
                boundaries: {
                  ...prev.boundaries,
                  ...(p.inletVelocity !== undefined ? { inletVelocity: p.inletVelocity } : {}),
                },
              }))}
              updateBoundaries={(p) => setState((prev) => ({ ...prev, boundaries: { ...prev.boundaries, ...p } }))}
            />
          </div>
        ) : (
          <>
        {/* Left Column: Stage Controls (280px) */}
        <LeftStagePanel
          activeStage={activeStage}
          state={state}
          updateGeometry={(p) => setState((prev) => ({ ...prev, geometry: { ...prev.geometry, ...p } }))}
          updatePhysics={(p) => setState((prev) => ({
            ...prev,
            physics: { ...prev.physics, ...p },
            boundaries: {
              ...prev.boundaries,
              ...(p.inletVelocity !== undefined ? { inletVelocity: p.inletVelocity } : {}),
            },
          }))}
          updateBoundaries={(p) => setState((prev) => ({ ...prev, boundaries: { ...prev.boundaries, ...p } }))}
          updateYPlus={(p) => setState((prev) => ({ ...prev, yplus: { ...prev.yplus, ...p } }))}
          updateSolver={(p) => setState((prev) => ({ ...prev, solver: { ...prev.solver, ...p } }))}
          updatePostProcess={(p) => setState((prev) => ({ ...prev, postprocess: { ...prev.postprocess, ...p } }))}
          onGenerateMesh={handleGenerateMesh}
          onApplyYPlusToMesh={handleApplyYPlusToMesh}
          meshData={meshData}
          onRunSolver={handleRunSolver}
          isMeshing={isMeshing}
          onSelectBoundary={setSelectedBoundary}
          selectedBoundary={selectedBoundary}
          onUploadAirfoilFile={async (file) => {
            setActiveStage('geometry');
            try {
              const res = await uploadAndParseAirfoil(file);
              const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
              setState((prev) => ({ ...prev, geometry: { ...prev.geometry, name: res.name || file.name } }));
              setPendingImportFile({ type: 'parsed', name: res.name || file.name, points: pts });
            } catch {
              setPendingImportFile({ type: 'airfoil', file });
            }
          }}
          onUploadAirfoilUrl={async (url) => {
            setActiveStage('geometry');
            const res = await fetchAndParseAirfoilFromUrl(url);
            const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
            setState((prev) => ({ ...prev, geometry: { ...prev.geometry, name: res.name || 'Airfoil' } }));
            setPendingImportFile({ type: 'parsed', name: res.name || 'Airfoil', points: pts });
          }}
          onUploadDxfFile={(file) => {
            setPendingImportFile({ type: 'dxf', file });
            setActiveStage('geometry');
          }}
          // ── 6-Step Workflow Sidebar Props ──
          cadWorkflowStep={cadWorkflowStep}
          setCadWorkflowStep={setCadWorkflowStep}
          flowType={flowType}
          domainShape={domainShape}
          setDomainShape={setDomainShape}
          domainPreset={domainPreset}
          setDomainPreset={setDomainPreset}
          upstreamChordFactor={upstreamChordFactor}
          setUpstreamChordFactor={setUpstreamChordFactor}
          downstreamChordFactor={downstreamChordFactor}
          setDownstreamChordFactor={setDownstreamChordFactor}
          lateralHeightFactor={lateralHeightFactor}
          setLateralHeightFactor={setLateralHeightFactor}
          geometryBBox={geometryBBox}
          angleOfAttackDeg={angleOfAttackDeg}
          setAngleOfAttackDeg={setAngleOfAttackDeg}
          freestreamVelocity={freestreamVelocity}
          setFreestreamVelocity={setFreestreamVelocity}
          activeTagTool={activeTagTool}
          setActiveTagTool={setActiveTagTool}
          edgeTagMap={edgeTagMap}
          onGenerateDomain={() => requestGenerateDomainRef.current?.()}
          onSetSelectedAsDomain={() => requestSetSelectedAsDomainRef.current?.()}
          onSetSelectedAsGeometry={() => requestSetSelectedAsGeometryRef.current?.()}
          onSelectAllGeometry={() => requestSelectAllGeometryRef.current?.()}
          onClearGeometry={() => requestClearGeometryRef.current?.()}
          onAutoSuggestTags={() => requestAutoSuggestTagsRef.current?.()}
          onMeshHandoff={() => requestMeshHandoffRef.current?.()}
          onDownloadBlockMeshDict={() => requestDownloadBlockMeshDictRef.current?.()}
          domainValidation={domainValidation}
          boundaryValidation={boundaryValidation}
          boundaryEdgesCount={boundaryEdges.length}
          geometryEntitiesCount={geometryEntitiesCount}
        />

        {/* Center: one shared CAD canvas; mesh mode reuses its camera and viewport */}
        <main className="flex-1 h-full min-w-0 relative bg-white overflow-hidden">
          <div className="w-full h-full">
              <CadWorkbench2D
              displayOnly={activeStage !== 'geometry'}
              meshData={meshData}
              isMeshing={isMeshing}
              showMesh={activeStage === 'mesh'}
              initialEntities={cadEntities}
              onApplySketchMesh={handleApplySketchMesh}
              domainLength={state.geometry.domainLength}
              domainHeight={state.geometry.domainHeight}
              resolution={state.geometry.meshResolution}
              firstLayerMm={state.geometry.firstLayerHeightMm}
              pendingImportFile={pendingImportFile}
              onClearPendingImport={() => setPendingImportFile(null)}
              // ── 6-Step Workflow Props (Canvas Visuals & Edge Tagging) ──
              currentStep={cadWorkflowStep}
              flowType={flowType}
              domainShape={domainShape}
              upstreamChordFactor={upstreamChordFactor}
              setUpstreamChordFactor={setUpstreamChordFactor}
              downstreamChordFactor={downstreamChordFactor}
              setDownstreamChordFactor={setDownstreamChordFactor}
              lateralHeightFactor={lateralHeightFactor}
              setLateralHeightFactor={setLateralHeightFactor}
              geometryBBox={geometryBBox}
              angleOfAttackDeg={angleOfAttackDeg}
              setAngleOfAttackDeg={setAngleOfAttackDeg}
              freestreamVelocity={freestreamVelocity}
              activeTagTool={activeTagTool}
              edgeTagMap={edgeTagMap}
              onSetEdgeTagMap={setEdgeTagMap}
              onEntitiesChange={setCadEntities}
              onRequestGenerateDomainRef={requestGenerateDomainRef}
              onRequestSetSelectedAsDomainRef={requestSetSelectedAsDomainRef}
              onRequestSetSelectedAsGeometryRef={requestSetSelectedAsGeometryRef}
              onRequestSelectAllGeometryRef={requestSelectAllGeometryRef}
              onRequestClearGeometryRef={requestClearGeometryRef}
              onRequestAutoSuggestTagsRef={requestAutoSuggestTagsRef}
              onRequestMeshHandoffRef={requestMeshHandoffRef}
              onRequestDownloadBlockMeshDictRef={requestDownloadBlockMeshDictRef}
              cadName={state.geometry.name}
              onCadNameChange={(name) => setState((prev) => ({ ...prev, geometry: { ...prev.geometry, name } }))}
            />
          </div>
        </main>

          </>
        )}

        {/* Right Column: Contextual Inspector (250px) */}
        {activeStage !== 'caseSetup' && (
        <RightContextInspector
          selectedBoundary={selectedBoundary}
          state={state}
          updateBoundaries={(p) => setState((prev) => ({ ...prev, boundaries: { ...prev.boundaries, ...p } }))}
          meshData={meshData}
        />
        )}
      </div>

      {/* 4. COLLAPSIBLE BOTTOM DRAWER */}
      <BottomSolverDrawer
        residuals={state.residuals}
        terminalLogs={state.terminalLogs}
        caseFiles={caseFiles}
        executionStatus={state.executionStatus}
        onClearLogs={() => setState((prev) => ({ ...prev, terminalLogs: [] }))}
      />

      {/* 5. BOTTOM STATUS BAR (24px) */}
      <StatusBar state={state} meshData={meshData} />
    </div>
  );
}

export default App;
