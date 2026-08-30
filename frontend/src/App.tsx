import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TopHeader } from './components/layout/TopHeader';
import { WorkflowStrip, StageId } from './components/layout/WorkflowStrip';
import { LeftStagePanel } from './components/layout/LeftStagePanel';
import { CadWorkbench2D } from './components/cad/CadWorkbench2D';
import { TransientPlaybackControls } from './components/viewport/TransientPlaybackControls';
import { RightContextInspector } from './components/layout/RightContextInspector';
import { BottomSolverDrawer } from './components/layout/BottomSolverDrawer';
import { StatusBar } from './components/layout/StatusBar';
import { CaseSetupPanel } from './components/caseSetup/CaseSetupPanel';
import { wallResolution } from './caseSetup/flowCalc';
import { defaultPatchBC } from './caseSetup/bcCatalog';
import { defaultSolverConfig, directionsForAoA } from './solver/solverConfig';
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
  generateStructuredMesh,
  generateCaseFiles,
  fetchSolverResults,
  uploadAndParseAirfoil,
  fetchAndParseAirfoilFromUrl,
  WS_BASE,
} from './utils/api';
import { saveProjectSession, renameProject } from './utils/projectsApi';
import { toast } from './components/ui/Toast';
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
  geometryFormsLoop,
} from './types/cadWorkflow';
import { Blocking, autoBlockingFromOutline, propagateNodeCounts, toStructuredRequest, wrapBodyOgrid, bodiesForOgrid, entityRing, cGridFromAirfoil, airfoilsForCGrid, outlineRing, applyTargetCellSize, autoCellSize } from './types/blocking';

export const SESSION_STORAGE_KEY = 'opencfd_studio_session_v1';

export interface StudioSession {
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
  activeTagTool: BoundaryTag | null;
  blocking?: Blocking | null;
  meshData?: any;
  meshSig?: string | null;
  hasMesh?: boolean;
  fieldData?: any;
  caseFiles?: Record<string, string>;
}

interface AppProps {
  projectId: string;
  projectName: string;
  initialSession: Partial<StudioSession> | null;
  onExitHome: () => void;
  onProjectRenamed: (name: string) => void;
}

export function App({ projectId, projectName, initialSession, onExitHome, onProjectRenamed }: AppProps) {
  const savedSession = initialSession;

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
  const [activeTagTool, setActiveTagTool] = useState<BoundaryTag | null>(() => savedSession?.activeTagTool ?? null);
  const [edgeTagMap, setEdgeTagMap] = useState<Record<string, BoundaryTag>>(() => savedSession?.edgeTagMap || {});
  const [cadEntities, setCadEntities] = useState<CadEntity[]>(() => savedSession?.cadEntities || []);
  const [blocking, setBlocking] = useState<Blocking | null>(() => savedSession?.blocking ?? null);
  const [structuredSmooth, setStructuredSmooth] = useState<boolean>(true);

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

  // ── Fluid domain: an explicit object (the entities the user marked as the
  // outer boundary). Ansys-style: define it once; if an edit breaks the loop the
  // app asks you to redefine it, boundary tags are untouched.
  const domainEntities = useMemo(
    () => cadEntities.filter(e => e.role === 'domain_boundary'),
    [cadEntities]
  );
  const autoDomainEntity = useMemo(() => domainEntities.find(e => e.autoDomain) || null, [domainEntities]);
  const domainSegs = useMemo(() => domainEntities.filter(e => !e.autoDomain), [domainEntities]);
  const closedDomainEntity = useMemo(
    () => domainEntities.find(e => (e.isClosed || e.type === 'rectangle') && e.pts.length >= 3) || null,
    [domainEntities]
  );

  // 'auto' = generated far-field box | 'ok' = user loop still closes |
  // 'broken' = user marked a domain but it no longer forms a closed loop |
  // 'none' = nothing defined yet
  const domainState: 'none' | 'auto' | 'ok' | 'broken' = useMemo(() => {
    if (autoDomainEntity) return 'auto';
    if (domainSegs.length === 0) return 'none';
    return geometryFormsLoop(domainSegs) ? 'ok' : 'broken';
  }, [autoDomainEntity, domainSegs]);
  const domainKind: 'none' | 'auto' | 'custom' =
    domainState === 'auto' ? 'auto' : domainState === 'ok' ? 'custom' : 'none';


  const domainValidation = useMemo(() => {
    if (flowType !== 'external') return { valid: true, reason: 'Internal flow' };
    if (domainState === 'broken')
      return { valid: false, reason: 'Domain boundary is broken - an edge was deleted or replaced. Reselect the whole outline and redefine it.' };
    if (domainState === 'none')
      return { valid: false, reason: 'Define the fluid domain: select your closed outline, then click "Define selected loop as the domain".' };
    if (closedDomainEntity) return validateDomainContainment(closedDomainEntity, cadEntities);
    return { valid: true };
  }, [flowType, domainState, closedDomainEntity, cadEntities]);

  const boundaryEdges = useMemo(
    () => extractBoundaryEdges(cadEntities, flowType, edgeTagMap),
    [cadEntities, flowType, edgeTagMap]
  );

  // Distinct tagged patches (name == tag), for the Case Setup boundary table.
  const patchRoles = useMemo(() => {
    const seen = new Map<string, BoundaryTag>();
    for (const e of boundaryEdges) if (e.explicit) seen.set(e.tag, e.tag);
    const order: BoundaryTag[] = ['inlet', 'outlet', 'wall', 'farfield', 'symmetry', 'periodic'];
    return [...seen.keys()]
      .sort((a, b) => order.indexOf(a as BoundaryTag) - order.indexOf(b as BoundaryTag))
      .map((t) => ({ name: t, role: t as any }));
  }, [boundaryEdges]);

  // Self-healing edge tags (Ansys "Named Selection" behaviour): every tag's
  // location is remembered for the whole session. When an edge is redrawn (new
  // entity id) close to where a tag used to be, it gets that tag back - even if
  // you deleted it and redrew it several edits later.
  const tagMemoryRef = useRef<Map<string, { mx: number; my: number; tag: BoundaryTag }>>(new Map());
  useEffect(() => {
    const edges = extractBoundaryEdges(cadEntities, flowType, edgeTagMap);
    const bbox = getGeometryBBox(cadEntities);
    const tol = Math.max(bbox.chord, bbox.height, 1) * 0.04;

    // Record where each currently-explicit tag lives.
    for (const e of edges) {
      if (e.explicit) {
        tagMemoryRef.current.set(e.key, { mx: e.midpoint.x, my: e.midpoint.y, tag: e.tag });
      }
    }

    // Re-associate untagged edges to a remembered tag position.
    const remap: Record<string, BoundaryTag> = {};
    for (const e of edges) {
      if (e.explicit) continue;
      let best: { d: number; tag: BoundaryTag } | null = null;
      for (const p of tagMemoryRef.current.values()) {
        const d = Math.hypot(p.mx - e.midpoint.x, p.my - e.midpoint.y);
        if (d < tol && (!best || d < best.d)) best = { d, tag: p.tag };
      }
      if (best) remap[e.key] = best.tag;
    }

    if (Object.keys(remap).length) {
      setEdgeTagMap(prev => ({ ...prev, ...remap }));
      for (const [k, tag] of Object.entries(remap)) {
        const e = edges.find(x => x.key === k)!;
        tagMemoryRef.current.set(k, { mx: e.midpoint.x, my: e.midpoint.y, tag });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadEntities]);

  // Flow-type change never destroys anything the user drew. The canvas handles
  // the domain: an auto far-field box is regenerable so it is dropped on
  // internal; a hand-drawn loop is demoted to plain geometry and kept.
  const handleFlowTypeChange = (next: FlowType) => {
    setFlowType(next);
  };

  const boundaryValidation = useMemo(
    () => validateBoundaryTags(boundaryEdges, flowType),
    [boundaryEdges, flowType]
  );

  // Signature of everything that would change the mesh - used to tell when the
  // last-generated mesh is stale (geometry / tags / flow changed since).
  const geomSignature = useMemo(
    () =>
      JSON.stringify(
        cadEntities.map(e => ({ t: e.type, p: e.pts, c: e.isClosed, r: e.role, rad: e.radius }))
      ) + '|' + JSON.stringify(edgeTagMap) + '|' + flowType +
      '|' + JSON.stringify(blocking?.vertices?.map(v => v.pt) ?? null) +
      '|' + JSON.stringify(blocking?.edges?.map(e => [e.nodes, e.law, e.ratio]) ?? null),
    [cadEntities, edgeTagMap, flowType, blocking]
  );
  const meshSigRef = useRef<string | null>(savedSession?.meshSig ?? null);

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
      turbulenceModelId: 'kOmegaSST',
      wallModel: 'auto',
      speedRegime: 'incompressible',
      ...(savedSession?.state?.physics || {}),
    },
    caseSetup: {
      targetYPlus: 1.0,
      growthRate: 1.2,
      refLengthOverride: null,
      linkFirstCellToMesh: true,
      patches: {},
      ...(savedSession?.state?.caseSetup || {}),
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
    solution: {
      ...defaultSolverConfig(),
      ...(savedSession?.state?.solution || {}),
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
    executionStatus: savedSession?.state?.executionStatus === 'completed' ? 'completed' : 'idle',
    residuals: savedSession?.state?.residuals ?? [],
    terminalLogs: savedSession?.state?.terminalLogs ?? [
      'OpenCFD ready.',
    ],
  }));

  const [meshData, setMeshData] = useState<any>(() => savedSession?.meshData ?? null);
  const [meshError, setMeshError] = useState<string | null>(null);
  const [fieldData, setFieldData] = useState<any>(() => savedSession?.fieldData ?? null);
  const [caseFiles, setCaseFiles] = useState<Record<string, string>>(() => savedSession?.caseFiles ?? {});
  const [isMeshing, setIsMeshing] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Full patch BC spec (roles + per-patch overrides) sent to the case generator.
  const patchSpec = useMemo(
    () =>
      patchRoles.map(({ name, role }) => ({
        name,
        role,
        bc: state.caseSetup.patches[name] ?? defaultPatchBC(role as any, state.physics.inletVelocity),
      })),
    [patchRoles, state.caseSetup.patches, state.physics.inletVelocity],
  );
  const caseRefLength = useMemo(() => {
    const cs = state.caseSetup;
    if (cs.refLengthOverride && cs.refLengthOverride > 0) return cs.refLengthOverride;
    return (flowType === 'internal' ? state.geometry.domainHeight : state.geometry.chord) || 1;
  }, [state.caseSetup.refLengthOverride, flowType, state.geometry.domainHeight, state.geometry.chord]);
  const makeCaseFiles = () => {
    // fold the angle-of-attack into the force directions before sending
    const dirs = directionsForAoA(state.geometry.angleOfAttackDeg || 0);
    const sol = {
      ...state.solution,
      monitors: {
        ...state.solution.monitors,
        forces: { ...state.solution.monitors.forces, ...dirs },
      },
    };
    return generateCaseFiles(state.physics, state.boundaries, state.solver, patchSpec, caseRefLength, sol, projectId);
  };

  // ── Auto-save session to the project folder on disk (~/.OpenCFD/projects) ──
  const buildSession = (): StudioSession => ({
    // keep the persisted copy bounded - a long run can produce thousands of
    // residual points / log lines
    state: {
      ...state,
      residuals: state.residuals.length > 4000 ? state.residuals.slice(-4000) : state.residuals,
      terminalLogs: state.terminalLogs.length > 800 ? state.terminalLogs.slice(-800) : state.terminalLogs,
    },
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
    blocking,
    meshData,
    meshSig: meshSigRef.current,
    hasMesh: !!meshData?.num_elements,
    fieldData,
    caseFiles,
  });
  const sessionRef = useRef<StudioSession>(buildSession());
  sessionRef.current = buildSession();

  const saveWarned = useRef(false);
  useEffect(() => {
    // during a solve the residual stream fires constantly - back the autosave
    // off; the final state is saved when executionStatus leaves 'running'
    const delay = state.executionStatus === 'running' ? 8000 : 400;
    const timer = setTimeout(() => {
      saveProjectSession(projectId, sessionRef.current)
        .then(() => { saveWarned.current = false; })
        .catch((err) => {
          console.warn('Project autosave note:', err);
          if (!saveWarned.current) {
            saveWarned.current = true;
            toast('Could not autosave - check the backend connection.', 'error', 6000);
          }
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [
    projectId,
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
    blocking,
    meshData,
    fieldData,
    caseFiles,
  ]);

  const handleExitHome = async () => {
    try {
      await saveProjectSession(projectId, sessionRef.current);
    } catch (err) {
      console.warn('Project save-on-exit note:', err);
    }
    onExitHome();
  };

  const handleRenameProject = async (name: string) => {
    onProjectRenamed(name);
    try {
      await renameProject(projectId, name);
    } catch (err) {
      console.warn('Project rename note:', err);
    }
  };

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

  // ── Mesh gate ────────────────────────────────────────────────────────────
  // Requirements: geometry drawn, a valid fluid domain (defined or auto), and
  // an inlet + an outlet tag.
  const meshGate = useMemo(() => {
    const missing: string[] = [];
    const drawn = cadEntities.filter(e => e.layer !== 'construction');
    if (drawn.length === 0) missing.push('Draw or import a geometry');
    if (flowType === 'external' && !domainValidation.valid)
      missing.push(domainValidation.reason || 'Define the fluid domain');
    if (!boundaryValidation.valid)
      missing.push(boundaryValidation.reason || 'Tag at least one inlet and one outlet');
    return { ready: missing.length === 0, missing };
  }, [cadEntities, flowType, domainValidation, boundaryValidation]);

  const meshReady = !!meshData?.num_elements;
  // The mesh no longer matches the geometry if anything mesh-relevant changed.
  const meshStale = !!meshData && meshSigRef.current !== null && meshSigRef.current !== geomSignature;

  // One combined notice for "you edited the geometry": if the edit also broke
  // the domain, say so in the same toast instead of firing two.
  const lastEditNoticeRef = useRef<string>('');
  useEffect(() => {
    const broken = domainState === 'broken';
    const notice = broken && meshStale ? 'both' : broken ? 'domain' : meshStale ? 'mesh' : '';
    if (notice && notice !== lastEditNoticeRef.current) {
      lastEditNoticeRef.current = notice;
      if (notice === 'both')
        toast('Domain boundary broke and the mesh is now out of date. Reselect the outline in the Domain step, then regenerate the mesh.', 'error', 8000);
      else if (notice === 'domain')
        toast('Domain boundary broke - an edge changed. Reselect the outline in the Domain step and redefine it.', 'error', 8000);
      else
        toast('Geometry changed since the mesh was made - regenerate to update it.', 'info', 5000);
    }
    if (!notice) lastEditNoticeRef.current = '';
  }, [domainState, meshStale]);

  const stageStatus: Partial<Record<StageId, { locked: boolean; reason?: string; missing?: string[] }>> = {
    geometry: { locked: false },
    caseSetup: { locked: false },
    mesh: {
      locked: !meshGate.ready,
      reason: 'Finish geometry, domain and boundary tagging first',
      missing: meshGate.missing,
    },
    solver: { locked: !meshReady, reason: 'Generate a mesh first' },
    results: { locked: !meshReady, reason: 'Generate a mesh first' },
  };

  const handleGenerateMesh = async () => {
    if (!meshGate.ready) {
      setState((prev) => ({
        ...prev,
        terminalLogs: [
          ...prev.terminalLogs,
          `[Gmsh] Cannot mesh yet - ${meshGate.missing.join('; ')}.`,
        ],
      }));
      return;
    }
    setIsMeshing(true);
    // A failed regeneration must not leave an old or placeholder mesh visible.
    setMeshData(null);
    setMeshError(null);
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
      meshSigRef.current = geomSignature;

      toast(`Mesh ready: ${mesh.num_nodes} nodes, ${mesh.num_elements} cells.`, 'success');
      // Only surface warnings the user can act on. Routine internal fallbacks
      // (boundary layer dropped, MeshAdapt fallback, prism-to-graded) are noise.
      (mesh.warnings || [])
        .filter((w: string) => /coarsen|too aggressive|cell sizes|closed loop|inlet|outlet/i.test(w))
        .forEach((w: string) => toast(w, 'info', 7000));

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
        const dicts = await makeCaseFiles();
        setCaseFiles(dicts);
      } catch (caseErr: any) {
        setState((prev) => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs, `[Case] ${caseErr.message}`],
        }));
      }
    } catch (err: any) {
      const msg = err?.message || 'Mesh generation failed.';
      setMeshError(msg);
      toast(msg, 'error', 8000);
      setState((prev) => ({
        ...prev,
        executionStatus: 'error',
        terminalLogs: [...prev.terminalLogs, `[Error] ${msg}`],
      }));
    } finally {
      setIsMeshing(false);
    }
  };

  // ── Structured meshing (H-block transfinite) ──────────────────────────────
  const bodyPatchFor = (entId: string): any => {
    const keys = Object.keys(edgeTagMap).filter((k) => k.startsWith(`${entId}_`));
    return (keys.map((k) => edgeTagMap[k]).find(Boolean) as any) || 'wall';
  };

  const structuredHint = useMemo<'hgrid' | 'ogrid' | 'cgrid'>(() => {
    const af = airfoilsForCGrid(cadEntities);
    if (af.some((a) => a.aspect >= 2.2)) return 'cgrid';
    const body = cadEntities.some(
      (e) => e.layer !== 'construction' && e.role !== 'domain_boundary'
        && (e.isClosed || e.type === 'circle' || e.type === 'rectangle'),
    );
    return body ? 'ogrid' : 'hgrid';
  }, [cadEntities]);

  const handleBuildBlocks = (kind: 'hgrid' | 'ogrid' | 'cgrid') => {
    if (kind === 'cgrid') {
      const af = airfoilsForCGrid(cadEntities)[0];
      const domain = outlineRing(cadEntities.filter((e) => e.role === 'domain_boundary'));
      if (!af || domain.length < 3) {
        toast('C-grid needs an elongated body (airfoil) inside a closed domain.', 'error', 7000);
        return;
      }
      const ent = cadEntities[af.index];
      const raw = cGridFromAirfoil(entityRing(ent), domain, bodyPatchFor(ent.id));
      if (!raw) {
        toast('Could not build a C-grid. Give the airfoil more room downstream of the trailing edge.', 'error', 7000);
        return;
      }
      const bk = applyTargetCellSize(raw, autoCellSize(raw));
      setBlocking(bk);
      toast(`Built a ${bk.blocks.length}-block C-grid around the airfoil.`, 'success');
      return;
    }

    let bk = autoBlockingFromOutline(cadEntities, edgeTagMap);
    if (!bk) {
      toast('Could not auto-block this outline. Define a closed domain first.', 'error', 7000);
      return;
    }
    let wrapped = 0;
    if (kind === 'ogrid') {
      for (const b of bodiesForOgrid(cadEntities, bk)) {
        const ent = cadEntities[b.index];
        const next = wrapBodyOgrid(bk, entityRing(ent), bodyPatchFor(ent.id));
        if (next) { bk = next; wrapped += 1; }
      }
    }
    bk = applyTargetCellSize(propagateNodeCounts(bk), autoCellSize(bk));
    setBlocking(bk);
    if (kind === 'ogrid' && wrapped === 0) {
      toast('Built blocks, but no body could be wrapped - it must sit clear of the domain edges.', 'info', 7000);
    } else if (wrapped > 0) {
      toast(`Built ${bk.blocks.length} blocks with an O-grid around ${wrapped} bod${wrapped > 1 ? 'ies' : 'y'}.`, 'success');
    } else {
      toast(`Built ${bk.blocks.length} block${bk.blocks.length > 1 ? 's' : ''}.`, 'success');
    }
  };

  const ogridBodies = useMemo(
    () => (blocking ? bodiesForOgrid(cadEntities, blocking) : []),
    [cadEntities, blocking],
  );

  const handleWrapBody = (bodyIndex: number) => {
    if (!blocking) return;
    const ent = cadEntities[bodyIndex];
    if (!ent) return;
    const next = wrapBodyOgrid(blocking, entityRing(ent), bodyPatchFor(ent.id));
    if (!next) {
      toast('Could not wrap that body. Make sure it sits well inside the domain, clear of the edges.', 'error', 7000);
      return;
    }
    setBlocking(propagateNodeCounts(next));
    toast('O-grid ring built around the body. Set the ring and wall-normal counts below.', 'success');
  };

  const handleGenerateStructuredMesh = async () => {
    if (!blocking) {
      toast('Build the block topology first.', 'info');
      return;
    }
    setIsMeshing(true);
    setMeshData(null);
    setMeshError(null);
    setFieldData(null);
    setState((prev) => ({
      ...prev,
      executionStatus: 'meshing',
      terminalLogs: [...prev.terminalLogs, '[Gmsh] Generating structured (transfinite) mesh...'],
    }));
    try {
      const req = toStructuredRequest(propagateNodeCounts(blocking));
      const mesh = await generateStructuredMesh(req, { smooth: structuredSmooth });
      setMeshData(mesh);
      meshSigRef.current = geomSignature;
      toast(`Structured mesh: ${mesh.num_nodes} nodes, ${mesh.num_elements} quads.`, 'success');
      (mesh.warnings || [])
        .filter((w: string) => /coarsen|too aggressive|cell sizes|tris|non-quad/i.test(w))
        .forEach((w: string) => toast(w, 'info', 7000));
      setState((prev) => ({
        ...prev,
        executionStatus: 'idle',
        terminalLogs: [
          ...prev.terminalLogs,
          `[Gmsh] Structured mesh complete: ${mesh.num_nodes} nodes, ${mesh.num_elements} quads.`,
        ],
      }));
      try {
        const dicts = await makeCaseFiles();
        setCaseFiles(dicts);
      } catch (caseErr: any) {
        setState((prev) => ({
          ...prev,
          terminalLogs: [...prev.terminalLogs, `[Case] ${caseErr.message}`],
        }));
      }
    } catch (err: any) {
      const msg = err?.message || 'Structured meshing failed.';
      setMeshError(msg);
      toast(msg, 'error', 8000);
      setState((prev) => ({
        ...prev,
        executionStatus: 'error',
        terminalLogs: [...prev.terminalLogs, `[Error] ${msg}`],
      }));
    } finally {
      setIsMeshing(false);
    }
  };

  const handleUpdateBlocking = (bk: Blocking | null) => setBlocking(bk);

  const handleApplySketchMesh = async (mesh: any, name: string) => {
    setMeshData(mesh);
    setActiveStage('mesh'); // Advance to mesh/flow view

    try {
      const dicts = await makeCaseFiles();
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

  // Case Setup drives the mesh first-cell height when the link is on.
  useEffect(() => {
    const cs = state.caseSetup;
    if (!cs.linkFirstCellToMesh) return;
    const refLen = cs.refLengthOverride && cs.refLengthOverride > 0
      ? cs.refLengthOverride
      : (flowType === 'internal' ? state.geometry.domainHeight : state.geometry.chord) || 1;
    const wr = wallResolution(
      { velocity: state.physics.inletVelocity, density: state.physics.density,
        kinematicViscosity: state.physics.kinematicViscosity, refLength: refLen },
      cs.targetYPlus, cs.growthRate,
    );
    const mm = Number(wr.firstCellHeightMm.toPrecision(4));
    setState((prev) => {
      if (Math.abs(prev.geometry.firstLayerHeightMm - mm) < mm * 1e-3
          && prev.geometry.numPrismLayers === wr.layerCount) return prev;
      return {
        ...prev,
        geometry: {
          ...prev.geometry,
          firstLayerHeightMm: mm,
          numPrismLayers: wr.layerCount,
          prismExpansionRatio: cs.growthRate,
          usePrismLayers: true,
        },
      };
    });
  }, [
    state.caseSetup.linkFirstCellToMesh, state.caseSetup.targetYPlus, state.caseSetup.growthRate,
    state.caseSetup.refLengthOverride, state.physics.inletVelocity, state.physics.density,
    state.physics.kinematicViscosity, flowType, state.geometry.chord, state.geometry.domainHeight,
  ]);

  const handleSetSolution = (patch: (c: import('./solver/solverConfig').SolverConfig) => import('./solver/solverConfig').SolverConfig) =>
    setState((prev) => ({ ...prev, solution: patch(prev.solution) }));

  const solverConvergence = useMemo(() => {
    const r = state.residuals[state.residuals.length - 1];
    if (!r) return null;
    const maxResidual = Math.max(r.p, r.Ux, r.Uy, r.k ?? 0, r.omega ?? 0, r.epsilon ?? 0);
    return { iteration: r.iteration, maxResidual, cd: (r as any).cd, cl: (r as any).cl };
  }, [state.residuals]);

  const [resultsLoading, setResultsLoading] = useState(false);
  const [transientFrameIndex, setTransientFrameIndex] = useState(0);
  const [transientPlaying, setTransientPlaying] = useState(false);
  const [transientSpeed, setTransientSpeed] = useState<number>(1.0);

  // Keep stable refs so interval callbacks never go stale
  const transientTimesRef = useRef<number[]>([]);
  const transientFrameIndexRef = useRef(0);
  const transientPlayingRef = useRef(false);
  const transientSpeedRef = useRef(1.0);
  const meshDataRef = useRef<any>(null);
  const projectIdRef = useRef<string | undefined>(undefined);

  // Frame cache: key = frame index, value = fieldData object. LRU-limited to 50 frames.
  const frameCacheRef = useRef<Map<number, any>>(new Map());
  const CACHE_MAX = 50;

  // In-flight AbortController for the current fetch (cancelled when a newer request starts)
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Scrub debounce timer — delays actual fetch by 80ms so rapid slider movement
  // doesn't fire multiple overlapping requests
  const scrubDebounceRef = useRef<number | null>(null);

  const transientTimes = useMemo(
    () => (Array.isArray(fieldData?.availableTimes) ? fieldData.availableTimes.map(Number).filter(Number.isFinite).sort((a: number, b: number) => a - b) : []),
    [fieldData?.availableTimes],
  );

  // Sync refs whenever state changes
  useEffect(() => { transientTimesRef.current = transientTimes; }, [transientTimes]);
  useEffect(() => { transientFrameIndexRef.current = transientFrameIndex; }, [transientFrameIndex]);
  useEffect(() => { transientPlayingRef.current = transientPlaying; }, [transientPlaying]);
  useEffect(() => { transientSpeedRef.current = transientSpeed; }, [transientSpeed]);
  useEffect(() => { meshDataRef.current = meshData; }, [meshData]);
  useEffect(() => { projectIdRef.current = projectId; }, [projectId]);

  // Core fetch — always cancels any previous in-flight request first.
  // Returns true if data was loaded (not aborted/errored).
  const fetchFrame = async (time: number, frameIdx: number, signal: AbortSignal): Promise<boolean> => {
    const mesh = meshDataRef.current;
    if (!mesh?.nodes?.length) return false;

    // Cache hit — apply immediately, no network call
    if (frameCacheRef.current.has(frameIdx)) {
      const cached = frameCacheRef.current.get(frameIdx)!;
      setFieldData(cached);
      setTransientFrameIndex(frameIdx);
      transientFrameIndexRef.current = frameIdx;
      return true;
    }

    const { data, detail } = await fetchSolverResults(
      { nodes: mesh.nodes, elements: mesh.elements },
      projectIdRef.current,
      time,
      signal,
    );

    if (signal.aborted || detail === '__aborted__') return false;
    if (!data) return false;

    // Store in cache; evict oldest if over limit
    frameCacheRef.current.set(frameIdx, data);
    if (frameCacheRef.current.size > CACHE_MAX) {
      const oldestKey = frameCacheRef.current.keys().next().value;
      if (oldestKey !== undefined) frameCacheRef.current.delete(oldestKey);
    }

    // Update available times in ref from this response
    const times = Array.isArray(data.availableTimes)
      ? data.availableTimes.map(Number).filter(Number.isFinite).sort((a: number, b: number) => a - b)
      : [];
    if (times.length) transientTimesRef.current = times;

    setFieldData(data);
    setTransientFrameIndex(frameIdx);
    transientFrameIndexRef.current = frameIdx;
    return true;
  };

  const loadResults = async (fromRun = false, time?: number, silent = false, frameIdx?: number) => {
    const mesh = meshDataRef.current;
    if (!mesh?.nodes?.length) {
      if (!silent) toast('Generate a mesh first.', 'error');
      return;
    }

    // Cancel any in-flight request
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const aborter = new AbortController();
    fetchAbortRef.current = aborter;

    setResultsLoading(true);
    const { data, detail } = await fetchSolverResults(
      { nodes: mesh.nodes, elements: mesh.elements },
      projectIdRef.current,
      time,
      aborter.signal,
    );
    setResultsLoading(false);

    if (aborter.signal.aborted || detail === '__aborted__') return;

    if (data) {
      const times = Array.isArray(data.availableTimes)
        ? data.availableTimes.map(Number).filter(Number.isFinite).sort((a: number, b: number) => a - b)
        : [];
      transientTimesRef.current = times;

      const frame = frameIdx !== undefined ? frameIdx : (time !== undefined ? times.indexOf(Number(data.time)) : -1);
      if (frame >= 0) {
        frameCacheRef.current.set(frame, data);
        setTransientFrameIndex(frame);
        transientFrameIndexRef.current = frame;
      }

      setFieldData(data);
      setState((prev) => ({
        ...prev,
        terminalLogs: [...prev.terminalLogs, `[Results] Loaded fields from time ${data.time}.`],
      }));
      if (!silent) toast('Results loaded - open the Results tab.', 'success');
    } else {
      const msg = detail || 'no solver output found';
      setState((prev) => ({ ...prev, terminalLogs: [...prev.terminalLogs, `[Results] ${msg}`] }));
      if (!fromRun && !silent) toast(`Could not load results: ${msg}`, 'error', 6000);
    }
  };

  // Prefetch adjacent frames in the background (non-blocking, won't abort active fetch)
  const prefetchAdjacent = useCallback((frameIdx: number) => {
    const times = transientTimesRef.current;
    const mesh = meshDataRef.current;
    if (!mesh?.nodes?.length || times.length < 2) return;
    [-1, 1, -2, 2].forEach((delta) => {
      const idx = frameIdx + delta;
      if (idx < 0 || idx >= times.length) return;
      if (frameCacheRef.current.has(idx)) return;
      // Fire-and-forget background prefetch with its own abort controller
      const pAborter = new AbortController();
      void fetchSolverResults(
        { nodes: mesh.nodes, elements: mesh.elements },
        projectIdRef.current,
        times[idx],
        pAborter.signal,
      ).then(({ data }) => {
        if (!data || pAborter.signal.aborted) return;
        frameCacheRef.current.set(idx, data);
        if (frameCacheRef.current.size > CACHE_MAX) {
          const oldest = frameCacheRef.current.keys().next().value;
          if (oldest !== undefined) frameCacheRef.current.delete(oldest);
        }
      });
    });
  }, []);

  const selectTransientFrame = useCallback((index: number) => {
    const times = transientTimesRef.current;
    const clamped = Math.max(0, Math.min(times.length - 1, index));
    if (times[clamped] === undefined) return;

    // Optimistic UI update — move slider immediately
    setTransientFrameIndex(clamped);
    transientFrameIndexRef.current = clamped;

    // Cache hit → instant, no debounce needed
    if (frameCacheRef.current.has(clamped)) {
      const cached = frameCacheRef.current.get(clamped)!;
      setFieldData(cached);
      prefetchAdjacent(clamped);
      return;
    }

    // Debounce actual network fetch by 80ms to absorb rapid slider drags
    if (scrubDebounceRef.current !== null) window.clearTimeout(scrubDebounceRef.current);
    scrubDebounceRef.current = window.setTimeout(() => {
      scrubDebounceRef.current = null;
      // Cancel previous request and start new one
      if (fetchAbortRef.current) fetchAbortRef.current.abort();
      const aborter = new AbortController();
      fetchAbortRef.current = aborter;
      setResultsLoading(true);
      void fetchFrame(times[clamped], clamped, aborter.signal).then((ok) => {
        setResultsLoading(false);
        if (ok) prefetchAdjacent(clamped);
      });
    }, 80);
  }, [prefetchAdjacent]);

  // Single stable interval — reads everything from refs, never stale
  const playIntervalRef = useRef<number | null>(null);
  const stopPlayback = useCallback(() => {
    if (playIntervalRef.current !== null) {
      window.clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setTransientPlaying(false);
    transientPlayingRef.current = false;
  }, []);

  const startPlayback = useCallback(() => {
    if (playIntervalRef.current !== null) window.clearInterval(playIntervalRef.current);
    setTransientPlaying(true);
    transientPlayingRef.current = true;

    const tick = () => {
      if (!transientPlayingRef.current) { stopPlayback(); return; }
      const times = transientTimesRef.current;
      const current = transientFrameIndexRef.current;
      if (times.length < 2 || current >= times.length - 1) { stopPlayback(); return; }

      const next = current + 1;
      transientFrameIndexRef.current = next;
      setTransientFrameIndex(next);

      // Cancel any user-initiated scrub fetch that may be in-flight
      if (fetchAbortRef.current) fetchAbortRef.current.abort();
      const aborter = new AbortController();
      fetchAbortRef.current = aborter;
      void fetchFrame(times[next], next, aborter.signal);
    };

    const intervalMs = Math.max(50, Math.round(500 / (transientSpeedRef.current || 1.0)));
    playIntervalRef.current = window.setInterval(tick, intervalMs);
  }, [stopPlayback]);

  // When speed changes mid-playback, restart to apply new interval
  useEffect(() => {
    transientSpeedRef.current = transientSpeed;
    if (transientPlayingRef.current) startPlayback();
  }, [transientSpeed]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (playIntervalRef.current) window.clearInterval(playIntervalRef.current);
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    if (scrubDebounceRef.current !== null) window.clearTimeout(scrubDebounceRef.current);
  }, []);

  const handleRunSolver = async () => {
    if (wsRef.current) wsRef.current.close();

    setState((prev) => ({
      ...prev,
      executionStatus: 'running',
      residuals: [],
      terminalLogs: [
        ...prev.terminalLogs,
        `[OpenFOAM] Writing case (${patchSpec.length} patches), solver ${state.solution.methods.coupling}...`,
      ],
    }));

    // regenerate the case dictionaries with the current solution config
    try {
      const dicts = await makeCaseFiles();
      if (dicts && Object.keys(dicts).length > 0) {
        setCaseFiles(dicts);
      }
    } catch (e: any) {
      toast(`Could not write the case files: ${e?.message ?? e}`, 'error');
    }

    const ws = new WebSocket(`${WS_BASE}/ws/solver`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          mode: 'auto',
          project_id: projectId,
          physics: state.physics,
          mesh: meshData
            ? { nodes: meshData.nodes, elements: meshData.elements, boundaries: meshData.boundaries }
            : null,
          wallPatches: patchRoles.filter((p) => p.role === 'wall').map((p) => p.name),
          patchTypes: Object.fromEntries(
            patchRoles.map((p) => [
              p.name,
              p.role === 'wall' ? 'wall' : p.role === 'symmetry' ? 'symmetry' : 'patch',
            ]),
          ),
          iterations: state.solution.run.iterations,
          regime: state.physics.regime,
          velocity: state.physics.inletVelocity,
          reynolds: (state.physics.inletVelocity * caseRefLength) / Math.max(state.physics.kinematicViscosity, 1e-12),
          cells: meshData?.num_elements ?? 20000,
          relax: state.solution.controls.relax,
          momentumOrder: state.solution.methods.momentum,
          turbulenceModel: state.physics.turbulenceModelId,
          forces: state.solution.monitors.forces.enabled,
          init: state.solution.run.init,
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
          terminalLogs: [...prev.terminalLogs, `[OpenFOAM] Run finished (${msg.iterations ?? '-'} iterations).`],
        }));
        toast('Solver run finished.', 'success');
        void loadResults(true);
      } else if (msg.type === 'error') {
        setState((prev) => ({
          ...prev,
          executionStatus: 'error',
          terminalLogs: [...prev.terminalLogs, `[Error] ${msg.message}`],
        }));
        toast(msg.message, 'error');
      }
    };

    ws.onerror = () => {
      setState((prev) => ({
        ...prev,
        executionStatus: 'error',
        terminalLogs: [...prev.terminalLogs, '[Error] Could not reach the solver stream (backend down?).'],
      }));
      toast('Could not reach the solver stream.', 'error');
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
        projectName={projectName}
        onProjectNameChange={handleRenameProject}
        onExitHome={handleExitHome}
      />

      {/* 2. WORKFLOW NAVIGATION STRIP (36px) */}
      <WorkflowStrip activeStage={activeStage} onSelectStage={setActiveStage} stageStatus={stageStatus} />

      {/* 3. THREE-COLUMN HERO WORKSPACE */}
      <div className="flex-1 flex min-h-0 relative">
        {activeStage === 'caseSetup' && (
          <div className="absolute inset-0 z-30 bg-[#F5F6F8] overflow-hidden flex">
            <CaseSetupPanel
              state={state}
              setState={setState}
              flowType={flowType}
              onFlowTypeChange={setFlowType}
              patchRoles={patchRoles}
            />
          </div>
        )}
        {/* Workbench stays mounted under the Case Setup overlay so CAD state is
            never lost when switching stages. */}
        {/* Left Column: Stage Controls (280px) */}
        <LeftStagePanel
          activeStage={activeStage}
          onSelectStage={setActiveStage}
          stageStatus={stageStatus}
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
          blocking={blocking}
          onBuildBlocks={handleBuildBlocks}
          onUpdateBlocking={handleUpdateBlocking}
          onGenerateStructuredMesh={handleGenerateStructuredMesh}
          ogridBodies={ogridBodies}
          onWrapBody={handleWrapBody}
          structuredHint={structuredHint}
          structuredSmooth={structuredSmooth}
          setStructuredSmooth={setStructuredSmooth}
          onApplyYPlusToMesh={handleApplyYPlusToMesh}
          meshData={meshData}
          meshError={meshError}
          meshStale={meshStale}
          onRunSolver={handleRunSolver}
          onStopSolver={handleStopSolver}
          projectId={projectId}
          onReloadResults={() => loadResults(false)}
          resultsLoading={resultsLoading}
          fieldSource={fieldData?.source}
          fieldTime={fieldData?.time}
          onSetSolution={handleSetSolution}
          onSetTimeFormulation={(t) =>
            setState((prev) => ({ ...prev, physics: { ...prev.physics, timeFormulation: t } }))}
          solverPatchNames={patchRoles.map((p) => p.name)}
          solverWallPatches={patchRoles.filter((p) => p.role === 'wall').map((p) => p.name)}
          solverConvergence={solverConvergence}
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
          setFlowType={handleFlowTypeChange}
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
          domainKind={domainKind}
          domainState={domainState}
          boundaryValidation={boundaryValidation}
          boundaryEdgesCount={boundaryEdges.length}
          geometryEntitiesCount={geometryEntitiesCount}
        />

        {/* Center Canvas + Floating Bottom Console Area */}
        <div className="flex-1 min-w-0 h-full relative overflow-hidden bg-white">
          {/* Center: one shared CAD canvas; fills entire workspace without getting squished */}
          <main className="absolute inset-0 w-full h-full bg-white overflow-hidden">
            <div className="w-full h-full">
              <CadWorkbench2D
                displayOnly={activeStage !== 'geometry'}
                meshData={meshData}
                meshStale={meshStale}
                blocking={blocking}
                onUpdateBlocking={handleUpdateBlocking}
                showBlocking={activeStage === 'mesh'}
                domainBroken={domainState === 'broken'}
                isMeshing={isMeshing}
                showMesh={activeStage === 'mesh' || activeStage === 'solver' || activeStage === 'results'}
                meshOnly={activeStage === 'solver' || activeStage === 'results'}
                showField={activeStage === 'results'}
                fieldData={fieldData}
                activeField={state.postprocess.activeField}
                colormap={state.postprocess.colormap}
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
                isTransient={state.physics.timeFormulation === 'transient'}
                transientTimes={transientTimes}
                transientFrameIndex={transientFrameIndex}
                transientPlaying={transientPlaying}
                transientSpeed={transientSpeed}
                onSelectTransientFrame={selectTransientFrame}
                onToggleTransientPlay={() => transientPlaying ? stopPlayback() : startPlayback()}
                onSelectTransientSpeed={setTransientSpeed}
              />
            </div>
          </main>

          {/* 4. COLLAPSIBLE BOTTOM DRAWER (Slides over canvas as overlay; never resizes/squishes canvas) */}
          <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-auto shadow-lg">
            <BottomSolverDrawer
              residuals={state.residuals}
              terminalLogs={state.terminalLogs}
              caseFiles={caseFiles}
              executionStatus={state.executionStatus}
              onClearLogs={() => setState((prev) => ({ ...prev, terminalLogs: [] }))}
            />
          </div>
        </div>
      </div>

      {/* 5. BOTTOM STATUS BAR (24px) */}
      <StatusBar state={state} meshData={meshData} />
    </div>
  );
}

export default App;
