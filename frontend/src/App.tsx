import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AppBar } from './components/layout/AppBar';
import type { StageId } from './components/layout/stages';
import { LeftStagePanel } from './components/layout/LeftStagePanel';
import { CadWorkbench2D } from './components/cad/CadWorkbench2D';
import { TransientPlaybackControls } from './components/viewport/TransientPlaybackControls';
import { RightContextInspector } from './components/layout/RightContextInspector';
import { BottomSolverDrawer } from './components/layout/BottomSolverDrawer';
import { SolverMonitorRail } from './components/solver/SolverMonitorRail';
import { RunHistoryRail } from './components/results/RunHistoryRail';
import { ResultsRightRail } from './components/results/ResultsRightRail';
import { CreatePlotModal } from './components/results/CreatePlotModal';
import { PlotViewDialog } from './components/results/PlotViewDialog';
import {
  Crosshair,
  PenTool,
  SlidersHorizontal,
  Grid3x3,
  Play,
  Square,
  BarChart3,
  Plus,
  RefreshCw,
  FileCode,
  Settings,
  LayoutGrid,
  Layers,
  Wand2,
  Ruler,
  FileDown,
  SunMoon,
  PanelLeft,
  Monitor,
} from 'lucide-react';
import { setThemePreference, toggleTheme } from './utils/theme';
import { CaseFilesModal } from './components/solver/CaseFilesModal';
import { CaseSetupPanel } from './components/caseSetup/CaseSetupPanel';
import { wallResolution } from './caseSetup/flowCalc';
import { defaultPatchBC } from './caseSetup/bcCatalog';
import { directionsForAoA } from './solver/solverConfig';
import {
  CFDProjectState,
  GeometryConfig,
  PhysicsConfig,
  BoundaryConditions,
  YPlusCalculation,
  SolverControls,
  PostProcessConfig,
  SolverRunRecord,
  PlotDefinition,
} from './types/cfd';
import {
  fetchYPlus,
  fetchTurbulenceInflow,
  generateMesh,
  generateStructuredMesh,
  generateCaseFiles,
  uploadAndParseAirfoil,
  fetchAndParseAirfoilFromUrl,
  fetchRunStream,
  deleteSolverRun,
} from './utils/api';
import { saveProjectSession, saveProjectBlob, renameProject } from './utils/projectsApi';
import { buildInitialCFDState } from './hooks/appInitialState';
import { useHistoricalRunField } from './hooks/useHistoricalRunField';
import { useResultsPlayback } from './hooks/useResultsPlayback';
import { useSolverRun } from './hooks/useSolverRun';
import { toast } from './components/ui/Toast';
import { CommandPalette, Command } from './components/ui/CommandPalette';
import { ShortcutsDialog } from './components/ui/ShortcutsDialog';
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys';
import { MOD_LABEL } from './utils/platform';
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
import {
  Blocking,
  autoBlockingFromOutline,
  initializeBlocking,
  propagateNodeCounts,
  toStructuredRequest,
  wrapBodyOgrid,
  bodiesForOgrid,
  entityRing,
  cGridFromAirfoil,
  wrapAirfoilOgrid,
  airfoilsForCGrid,
  outlineRing,
  applyTargetCellSize,
  autoCellSize,
} from './types/blocking';

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
  ogridParams?: { offsetFactor: number; radialNodes: number; radialRatio: number };
  meshTopology?: 'unstructured' | 'structured';
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

export function App({
  projectId,
  projectName,
  initialSession,
  onExitHome,
  onProjectRenamed,
}: AppProps) {
  const savedSession = initialSession;

  // Active workflow stage
  const [activeStage, setActiveStage] = useState<StageId>(() => {
    if (typeof window !== 'undefined') {
      const st = new URLSearchParams(window.location.search).get('stage') as StageId;
      if (st && ['geometry', 'mesh', 'caseSetup', 'solver', 'results'].includes(st)) return st;
    }
    return 'geometry';
  });
  const [selectedBoundary, setSelectedBoundary] = useState<string>('inlet');
  const [pendingImportFile, setPendingImportFile] = useState<
    | { type: 'parsed'; name: string; points: Point2D[] }
    | { type: 'airfoil' | 'dxf' | 'url'; file?: File; url?: string }
    | null
  >(null);

  // ── 6-Step CFD Pre-Processing Workflow State (Left Sidebar Controlled) ──
  const [cadWorkflowStep, setCadWorkflowStep] = useState<CadWorkflowStep>(
    () => savedSession?.cadWorkflowStep || 1,
  );
  const [flowType, setFlowType] = useState<FlowType>(() => savedSession?.flowType || 'external');
  const [domainShape, setDomainShape] = useState<DomainShapeType>(
    () => savedSession?.domainShape || 'rectangle',
  );
  const [domainPreset, setDomainPreset] = useState<DomainPreset>(
    () => savedSession?.domainPreset || 'standard',
  );
  const [upstreamChordFactor, setUpstreamChordFactor] = useState(
    () => savedSession?.upstreamChordFactor ?? 10,
  );
  const [downstreamChordFactor, setDownstreamChordFactor] = useState(
    () => savedSession?.downstreamChordFactor ?? 20,
  );
  const [lateralHeightFactor, setLateralHeightFactor] = useState(
    () => savedSession?.lateralHeightFactor ?? 10,
  );
  const [angleOfAttackDeg, setAngleOfAttackDeg] = useState(
    () => savedSession?.angleOfAttackDeg ?? 0.0,
  );
  const [freestreamVelocity, setFreestreamVelocity] = useState(
    () => savedSession?.freestreamVelocity ?? 35.0,
  );
  const [activeTagTool, setActiveTagTool] = useState<BoundaryTag | null>(
    () => savedSession?.activeTagTool ?? null,
  );
  const [edgeTagMap, setEdgeTagMap] = useState<Record<string, BoundaryTag>>(
    () => savedSession?.edgeTagMap || {},
  );
  const [cadEntities, setCadEntities] = useState<CadEntity[]>(
    () => savedSession?.cadEntities || [],
  );
  const [blocking, setBlocking] = useState<Blocking | null>(() => savedSession?.blocking ?? null);
  const [directionColors, setDirectionColors] = useState<Record<string, string> | null>(null);
  const [blockMode, setBlockMode] = useState<'auto' | 'manual'>('auto');
  const [ogridParams, setOgridParams] = useState<{
    offsetFactor: number;
    radialNodes: number;
    radialRatio: number;
  }>(() => savedSession?.ogridParams ?? { offsetFactor: 0.25, radialNodes: 26, radialRatio: 10 });
  const [structuredSmooth, setStructuredSmooth] = useState<boolean>(true);
  const [meshTopology, setMeshTopology] = useState<'unstructured' | 'structured'>(
    () => savedSession?.meshTopology ?? 'unstructured',
  );
  // Blocks belong to structured meshing only - drop them the moment we leave it.
  const changeMeshTopology = (t: 'unstructured' | 'structured') => {
    setMeshTopology(t);
    if (t !== 'structured') setBlocking(null);
  };
  // Bumped whenever blocks are (re)built - the canvas switches to the Blocks view.
  const [blocksBuiltTick, setBlocksBuiltTick] = useState(0);
  // Drag-resizable left panel, shared across every stage.
  const [sidebarW, setSidebarW] = useState<number>(() => {
    const s = Number(
      typeof localStorage !== 'undefined' && localStorage.getItem('opencfd_sidebar_w'),
    );
    return s >= 220 && s <= 620 ? s : 280;
  });

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
    () =>
      cadEntities.filter((e) => e.layer !== 'construction' && e.role !== 'domain_boundary').length,
    [cadEntities],
  );

  const geometryBBox = useMemo(() => getGeometryBBox(cadEntities), [cadEntities]);

  // ── Fluid domain: an explicit object (the entities the user marked as the
  // outer boundary). Ansys-style: define it once; if an edit breaks the loop the
  // app asks you to redefine it, boundary tags are untouched.
  const domainEntities = useMemo(
    () => cadEntities.filter((e) => e.role === 'domain_boundary'),
    [cadEntities],
  );
  const autoDomainEntity = useMemo(
    () => domainEntities.find((e) => e.autoDomain) || null,
    [domainEntities],
  );
  const domainSegs = useMemo(() => domainEntities.filter((e) => !e.autoDomain), [domainEntities]);
  const closedDomainEntity = useMemo(
    () =>
      domainEntities.find((e) => (e.isClosed || e.type === 'rectangle') && e.pts.length >= 3) ||
      null,
    [domainEntities],
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
      return {
        valid: false,
        reason:
          'Domain boundary is broken - an edge was deleted or replaced. Reselect the whole outline and redefine it.',
      };
    if (domainState === 'none')
      return {
        valid: false,
        reason:
          'Define the fluid domain: select your closed outline, then click"Define selected loop as the domain".',
      };
    if (closedDomainEntity) return validateDomainContainment(closedDomainEntity, cadEntities);
    return { valid: true };
  }, [flowType, domainState, closedDomainEntity, cadEntities]);

  const boundaryEdges = useMemo(
    () => extractBoundaryEdges(cadEntities, flowType, edgeTagMap),
    [cadEntities, flowType, edgeTagMap],
  );

  // Self-healing edge tags (Ansys"Named Selection" behaviour): every tag's
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
      setEdgeTagMap((prev) => ({ ...prev, ...remap }));
      for (const [k, tag] of Object.entries(remap)) {
        const e = edges.find((x) => x.key === k)!;
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
    [boundaryEdges, flowType],
  );

  // Signature of everything that would change the mesh - used to tell when the
  // last-generated mesh is stale (geometry / tags / flow changed since).
  // Core = geometry/tags/flow. A change here is a real "your mesh is out of date"
  // event worth telling the user about.
  const geomSigCore = useMemo(
    () =>
      JSON.stringify(
        cadEntities.map((e) => ({ t: e.type, p: e.pts, c: e.isClosed, r: e.role, rad: e.radius })),
      ) +
      '|' +
      JSON.stringify(edgeTagMap) +
      '|' +
      flowType,
    [cadEntities, edgeTagMap, flowType],
  );
  // Full signature also folds in the blocking - block edits mark the mesh stale
  // (badge on the toggle) but do NOT raise a toast (that is just normal editing).
  const geomSignature = useMemo(
    () =>
      geomSigCore +
      '|' +
      JSON.stringify(blocking?.vertices?.map((v) => v.pt) ?? null) +
      '|' +
      JSON.stringify(blocking?.edges?.map((e) => [e.nodes, e.law, e.ratio]) ?? null),
    [geomSigCore, blocking],
  );
  const meshSigRef = useRef<string | null>(savedSession?.meshSig ?? null);
  const meshCoreSigRef = useRef<string | null>(null);

  // Master CFD Project State
  const [state, setState] = useState<CFDProjectState>(() =>
    buildInitialCFDState(savedSession?.state),
  );

  const [meshData, setMeshData] = useState<any>(() => savedSession?.meshData ?? null);
  const [meshError, setMeshError] = useState<string | null>(null);
  const [fieldData, setFieldData] = useState<any>(() => savedSession?.fieldData ?? null);
  const [caseFiles, setCaseFiles] = useState<Record<string, string>>(
    () => savedSession?.caseFiles ?? {},
  );
  const [isMeshing, setIsMeshing] = useState<boolean>(false);

  // Historical solver run visualization state and cache
  const {
    selectedRunId,
    setSelectedRunId,
    historicalFieldData,
    setHistoricalFieldData,
    historicalFieldStatus,
    setHistoricalFieldStatus,
    historicalCacheRef,
    handleSelectRun,
  } = useHistoricalRunField(projectId);

  // Derive axisymmetric directly from the boundary patches: when any edge is tagged
  // 'axis', the case is assumed axisymmetric.
  useEffect(() => {
    const hasAxis = boundaryEdges.some((e) => e.explicit && e.tag === 'axis');
    if (state.physics.axisymmetric !== hasAxis) {
      setState((prev) => ({
        ...prev,
        physics: { ...prev.physics, axisymmetric: hasAxis },
      }));
    }
  }, [boundaryEdges, state.physics.axisymmetric]);

  // Distinct solver patches + their roles, for the Case Setup boundary table and
  // the case generator. Once a mesh exists its boundary names are the ground
  // truth for which patches the solver will see: the backend auto-classifies any
  // domain edge the user left untagged (inlet / outlet / symmetry), so a patch
  // can appear here with no explicit tag - infer its role from the name so it
  // still gets a real BC and the solver never hits a missing-patchField error.
  const patchRoles = useMemo(() => {
    const order: BoundaryTag[] = [
      'inlet',
      'outlet',
      'wall',
      'farfield',
      'symmetry',
      'periodic',
      'axis',
    ];
    const roleFromName = (n: string): BoundaryTag => {
      const k = n.toLowerCase();
      return (order.find((t) => k === t || k.startsWith(t)) as BoundaryTag) || 'wall';
    };
    // Supersonic external flow: a `symmetry` plane mirrors the shock straight
    // back into the domain, so treat any lateral symmetry patch as a
    // non-reflecting far-field instead (unless the flow is genuinely a half-model
    // on the centreline, which the box domains never are).
    const ss =
      state.physics.compressibility === 'compressible' &&
      (state.physics.speedRegime === 'supersonic' || state.physics.speedRegime === 'hypersonic') &&
      flowType === 'external';
    const fix = (r: BoundaryTag): BoundaryTag => (ss && r === 'symmetry' ? 'farfield' : r);

    const meshNames = Object.keys(meshData?.boundaries || {}).filter(
      (n) => n !== 'frontAndBack' && n !== 'defaultFaces',
    );
    if (meshNames.length) {
      const explicit = new Map<string, BoundaryTag>();
      for (const e of boundaryEdges) if (e.explicit) explicit.set(e.tag, e.tag);
      return meshNames
        .map((name) => ({
          name,
          role: fix(explicit.get(name as BoundaryTag) || roleFromName(name)) as any,
        }))
        .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
    }
    const seen = new Map<BoundaryTag, BoundaryTag>();
    for (const e of boundaryEdges) if (e.explicit) seen.set(e.tag, e.tag);
    return [...seen.keys()]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((t) => ({ name: t, role: fix(t) as any }));
  }, [
    boundaryEdges,
    meshData?.boundaries,
    state.physics.compressibility,
    state.physics.speedRegime,
    flowType,
  ]);

  // Full patch BC spec (roles + per-patch overrides) sent to the case generator.
  const patchSpec = useMemo(
    () =>
      patchRoles.map(({ name, role }) => ({
        name,
        role,
        bc:
          state.caseSetup.patches[name] ?? defaultPatchBC(role as any, state.physics.inletVelocity),
      })),
    [patchRoles, state.caseSetup.patches, state.physics.inletVelocity],
  );
  const caseRefLength = useMemo(() => {
    const cs = state.caseSetup;
    if (cs.refLengthOverride && cs.refLengthOverride > 0) return cs.refLengthOverride;
    return (flowType === 'internal' ? state.geometry.domainHeight : state.geometry.chord) || 1;
  }, [
    state.caseSetup.refLengthOverride,
    flowType,
    state.geometry.domainHeight,
    state.geometry.chord,
  ]);
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
    return generateCaseFiles(
      state.physics,
      state.boundaries,
      state.solver,
      patchSpec,
      caseRefLength,
      sol,
      projectId,
    );
  };

  // ── Auto-save session to the project folder on disk (~/.OpenCFD/projects) ──
  const buildSession = (): StudioSession => ({
    // keep the persisted copy bounded - a long run can produce thousands of
    // residual points / log lines
    state: {
      ...state,
      residuals: state.residuals.length > 4000 ? state.residuals.slice(-4000) : state.residuals,
      terminalLogs:
        state.terminalLogs.length > 800 ? state.terminalLogs.slice(-800) : state.terminalLogs,
      solverRuns: (state.solverRuns ?? []).slice(-20).map((r) => ({
        ...r,
        residuals: r.residuals.length > 4000 ? r.residuals.slice(-4000) : r.residuals,
        logs: r.logs.length > 500 ? r.logs.slice(-500) : r.logs,
      })),
      plots: (state.plots ?? []).slice(-50),
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
    ogridParams,
    meshTopology,
    // meshData / fieldData are saved separately by the blob effect below.
    meshSig: meshSigRef.current,
    hasMesh: !!meshData?.num_elements,
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
        .then(() => {
          saveWarned.current = false;
        })
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
    meshTopology,
    meshData,
    caseFiles,
  ]);

  // The mesh and result field can be tens of MB, so they are not part of the
  // session autosave above (serialising them on every edit froze the UI).
  // Each is written to its own file only when its identity changes. The refs
  // start at the loaded values, so opening a project writes nothing.
  const savedBlobsRef = useRef<{ meshData: unknown; fieldData: unknown }>({ meshData, fieldData });
  const flushBlobs = useCallback(async () => {
    const pending = (['meshData', 'fieldData'] as const).filter(
      (k) => savedBlobsRef.current[k] !== (k === 'meshData' ? meshData : fieldData),
    );
    for (const key of pending) {
      const value = key === 'meshData' ? meshData : fieldData;
      await saveProjectBlob(projectId, key, value);
      savedBlobsRef.current[key] = value;
    }
  }, [projectId, meshData, fieldData]);
  useEffect(() => {
    // Transient playback swaps fieldData every frame; the debounce means it
    // is written once playback pauses.
    const timer = setTimeout(() => {
      flushBlobs().catch((err) => {
        console.warn('Project autosave note:', err);
        if (!saveWarned.current) {
          saveWarned.current = true;
          toast('Could not autosave - check the backend connection.', 'error', 6000);
        }
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [flushBlobs]);

  const handleExitHome = async () => {
    try {
      await flushBlobs();
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
    const drawn = cadEntities.filter((e) => e.layer !== 'construction');
    if (drawn.length === 0) missing.push('Draw or import a geometry');
    if (flowType === 'external' && !domainValidation.valid)
      missing.push(domainValidation.reason || 'Define the fluid domain');
    if (!boundaryValidation.valid)
      missing.push(boundaryValidation.reason || 'Tag at least one inlet and one outlet');
    return { ready: missing.length === 0, missing };
  }, [cadEntities, flowType, domainValidation, boundaryValidation]);

  const meshReady = !!meshData?.num_elements;
  // The mesh no longer matches the geometry if anything mesh-relevant changed.
  const meshStale =
    !!meshData && meshSigRef.current !== null && meshSigRef.current !== geomSignature;

  // One combined notice for"you edited the geometry": if the edit also broke
  // the domain, say so in the same toast instead of firing two.
  const lastEditNoticeRef = useRef<string>('');
  useEffect(() => {
    const broken = domainState === 'broken';
    // only the geometry going stale (not block edits) is worth a toast
    const geomStale =
      !!meshData && meshCoreSigRef.current !== null && meshCoreSigRef.current !== geomSigCore;
    const notice = broken && geomStale ? 'both' : broken ? 'domain' : geomStale ? 'mesh' : '';
    if (notice && notice !== lastEditNoticeRef.current) {
      lastEditNoticeRef.current = notice;
      if (notice === 'both')
        toast(
          'Domain boundary broke and the mesh is now out of date. Reselect the outline in the Domain step, then regenerate the mesh.',
          'error',
          8000,
        );
      else if (notice === 'domain')
        toast(
          'Domain boundary broke - an edge changed. Reselect the outline in the Domain step and redefine it.',
          'error',
          8000,
        );
      else
        toast('Geometry changed since the mesh was made - regenerate to update it.', 'info', 5000);
    }
    if (!notice) lastEditNoticeRef.current = '';
  }, [domainState, meshData, geomSigCore]);

  const stageStatus: Partial<
    Record<StageId, { locked: boolean; reason?: string; missing?: string[] }>
  > = {
    geometry: { locked: false },
    caseSetup: { locked: false },
    mesh: {
      locked: !meshGate.ready,
      reason: 'Finish geometry, domain and boundary tagging first',
      missing: meshGate.missing,
    },
    solver: { locked: !meshReady, reason: 'Generate a mesh first' },
    results: {
      locked: !meshReady && !state.solverRuns?.length,
      reason: 'Generate a mesh or select a previous run first',
    },
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
    clearResultsCache();
    setState((prev) => ({
      ...prev,
      executionStatus: 'meshing',
      terminalLogs: [...prev.terminalLogs, `[Gmsh] Meshing geometry ${state.geometry.name}...`],
    }));

    try {
      const mesh = await generateMesh(state.geometry.type, {
        chord: state.geometry.chord,
        // Angle of attack has no meaning for a body of revolution - it would
        // break the axisymmetry assumption itself.
        angleOfAttackDeg: state.physics.axisymmetric ? 0 : state.geometry.angleOfAttackDeg,
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
        // Supersonic: an untagged lateral boundary must become a non-reflecting
        // far-field, not a `symmetry` plane (a symmetry plane mirrors the shock
        // straight back into the domain).
        speedRegime: state.physics.speedRegime,
        compressibility: state.physics.compressibility,
        axisymmetric: state.physics.axisymmetric,
      });

      setMeshData(mesh);
      meshSigRef.current = geomSignature;
      meshCoreSigRef.current = geomSigCore;

      toast(`Mesh ready: ${mesh.num_nodes} nodes, ${mesh.num_elements} cells.`, 'success');
      // Only surface warnings the user can act on. Routine internal fallbacks
      // (boundary layer dropped, MeshAdapt fallback, prism-to-graded) are noise.
      (mesh.warnings || [])
        .filter((w: string) =>
          /coarsen|too aggressive|cell sizes|closed loop|inlet|outlet/i.test(w),
        )
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
    const ent = cadEntities.find((e) => e.id === entId);
    if (ent && ent.role !== 'domain_boundary') {
      const keys = Object.keys(edgeTagMap).filter((k) => k.startsWith(`${entId}_`));
      const explicit = keys.map((k) => edgeTagMap[k]).find(Boolean);
      return explicit || 'wall';
    }
    const keys = Object.keys(edgeTagMap).filter((k) => k.startsWith(`${entId}_`));
    return (keys.map((k) => edgeTagMap[k]).find(Boolean) as any) || 'wall';
  };

  const structuredHint = useMemo<'hgrid' | 'ogrid' | 'cgrid' | 'cgrid_closed'>(() => {
    const af = airfoilsForCGrid(cadEntities);
    if (af.some((a) => a.aspect >= 2.2)) return 'cgrid_closed';
    const body = cadEntities.some(
      (e) =>
        e.layer !== 'construction' &&
        e.role !== 'domain_boundary' &&
        (e.isClosed || e.type === 'circle' || e.type === 'rectangle'),
    );
    return body ? 'ogrid' : 'hgrid';
  }, [cadEntities]);

  const handleBuildBlocks = (kind: 'hgrid' | 'ogrid' | 'cgrid' | 'cgrid_closed') => {
    setBlocksBuiltTick((t) => t + 1); // reveal the Blocks view
    if (kind === 'cgrid') {
      const af = airfoilsForCGrid(cadEntities)[0];
      const domEnts = cadEntities.filter((e) => e.role === 'domain_boundary');
      const domain = outlineRing(domEnts);
      if (!af || domain.length < 3) {
        toast('C-grid needs an elongated body (airfoil) inside a closed domain.', 'error', 7000);
        return;
      }
      const ent = cadEntities[af.index];
      const domEnt =
        domEnts.length === 1
          ? domEnts[0]
          : domEnts.find(
              (e) =>
                e.isClosed || e.type === 'rectangle' || e.type === 'circle' || e.type === 'ellipse',
            );
      const raw = cGridFromAirfoil(
        entityRing(ent),
        domain,
        bodyPatchFor(ent.id),
        ent.id,
        domEnt?.id,
      );
      if (!raw) {
        toast(
          'Could not build a C-grid. Give the airfoil more room downstream of the trailing edge.',
          'error',
          7000,
        );
        return;
      }
      const bk = applyTargetCellSize(raw, autoCellSize(raw));
      setBlocking(bk);
      toast(`Built a ${bk.blocks.length}-block C-grid around the airfoil.`, 'success');
      return;
    }
    if (kind === 'cgrid_closed') {
      const af = airfoilsForCGrid(cadEntities)[0];
      if (!af) {
        toast('Closed O-grid needs an elongated body (airfoil) in the domain.', 'error', 7000);
        return;
      }
      const ent = cadEntities[af.index];
      const base = autoBlockingFromOutline(cadEntities, edgeTagMap);
      if (!base) {
        toast('Could not auto-block this outline. Define a closed domain first.', 'error', 7000);
        return;
      }
      const raw = wrapAirfoilOgrid(base, entityRing(ent), bodyPatchFor(ent.id), {
        airfoilEntityId: ent.id,
      });
      if (!raw) {
        toast(
          'Could not wrap a closed O-grid around this airfoil - it may need more clearance from the domain edges.',
          'error',
          7000,
        );
        return;
      }
      const bk = applyTargetCellSize(propagateNodeCounts(raw), autoCellSize(raw));
      setBlocking(bk);
      toast(`Built a ${bk.blocks.length}-block closed O-grid around the airfoil.`, 'success');
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
        const next = wrapBodyOgrid(bk, entityRing(ent), bodyPatchFor(ent.id), {
          bodyEntityId: ent.id,
          ...ogridParams,
        });
        if (next) {
          bk = next;
          wrapped += 1;
        }
      }
    }
    bk = applyTargetCellSize(propagateNodeCounts(bk), autoCellSize(bk));
    setBlocking(bk);
    if (kind === 'ogrid' && wrapped === 0) {
      toast(
        'Built blocks, but no body could be wrapped - it must sit clear of the domain edges.',
        'info',
        7000,
      );
    } else if (wrapped > 0) {
      toast(
        `Built ${bk.blocks.length} blocks with an O-grid around ${wrapped} bod${wrapped > 1 ? 'ies' : 'y'}.`,
        'success',
      );
    } else {
      toast(`Built ${bk.blocks.length} block${bk.blocks.length > 1 ? 's' : ''}.`, 'success');
    }
  };

  // Manual (ICEM-style) blocking: one block around all the geometry, which the
  // user then splits, deletes, associates and O-grids on the canvas.
  const handleInitializeBlocking = () => {
    const bk = initializeBlocking(cadEntities);
    if (!bk) {
      toast('No geometry to block.', 'error');
      return;
    }
    setBlocksBuiltTick((t) => t + 1); // reveal the Blocks view
    setBlocking(bk);
    toast('Initialized 1 block.', 'success');
  };

  const ogridBodies = useMemo(
    () => (blocking ? bodiesForOgrid(cadEntities, blocking) : []),
    [cadEntities, blocking],
  );

  const handleWrapBody = (bodyIndex: number) => {
    if (!blocking) return;
    const ent = cadEntities[bodyIndex];
    if (!ent) return;
    const next = wrapBodyOgrid(blocking, entityRing(ent), bodyPatchFor(ent.id), {
      bodyEntityId: ent.id,
      ...ogridParams,
    });
    if (!next) {
      toast(
        'Could not wrap that body. Make sure it sits well inside the domain, clear of the edges.',
        'error',
        7000,
      );
      return;
    }
    setBlocking(propagateNodeCounts(next));
    toast(
      'O-grid ring built around the body. Set the ring and wall-normal counts below.',
      'success',
    );
  };

  const handleUpdateOgridParams = (p: Partial<typeof ogridParams>) => {
    const nextParams = { ...ogridParams, ...p };
    setOgridParams(nextParams);

    // Only rebuild if a body is actually wrapped. A bare `curveId` is not enough -
    // Phase 1 puts curveId on plain domain-outline edges too.
    const hasOgrid =
      blocking &&
      (bodiesForOgrid(cadEntities, blocking).some((b) => b.wrapped) ||
        blocking.edges.some((e) => {
          if (!e.curveId) return false;
          return cadEntities.find((x) => x.id === e.curveId)?.role !== 'domain_boundary';
        }));
    if (!hasOgrid) return;

    let bk = autoBlockingFromOutline(cadEntities, edgeTagMap);
    if (!bk) return;
    for (const b of bodiesForOgrid(cadEntities, bk)) {
      const ent = cadEntities[b.index];
      const next = wrapBodyOgrid(bk, entityRing(ent), bodyPatchFor(ent.id), {
        bodyEntityId: ent.id,
        ...nextParams,
      });
      if (next) {
        bk = next;
      }
    }
    bk = applyTargetCellSize(propagateNodeCounts(bk), autoCellSize(bk));
    setBlocking(bk);
    toast('Rebuilt the O-grid ring.', 'info');
  };

  const handleGenerateStructuredMesh = async () => {
    if (!blocking) {
      toast('Build the block topology first.', 'info');
      return;
    }
    setIsMeshing(true);
    setMeshData(null);
    setMeshError(null);
    clearResultsCache();
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
      meshCoreSigRef.current = geomSigCore;
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
          `[2D CAD] Converted sketch"${name}" to CFD mesh: ${mesh.num_nodes} nodes, ${mesh.num_elements} elements.`,
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
    const refLen =
      cs.refLengthOverride && cs.refLengthOverride > 0
        ? cs.refLengthOverride
        : (flowType === 'internal' ? state.geometry.domainHeight : state.geometry.chord) || 1;
    const wr = wallResolution(
      {
        velocity: state.physics.inletVelocity,
        density: state.physics.density,
        kinematicViscosity: state.physics.kinematicViscosity,
        refLength: refLen,
      },
      cs.targetYPlus,
      cs.growthRate,
    );
    const mm = Number(wr.firstCellHeightMm.toPrecision(4));
    setState((prev) => {
      if (
        Math.abs(prev.geometry.firstLayerHeightMm - mm) < mm * 1e-3 &&
        prev.geometry.numPrismLayers === wr.layerCount
      )
        return prev;
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
    state.caseSetup.linkFirstCellToMesh,
    state.caseSetup.targetYPlus,
    state.caseSetup.growthRate,
    state.caseSetup.refLengthOverride,
    state.physics.inletVelocity,
    state.physics.density,
    state.physics.kinematicViscosity,
    flowType,
    state.geometry.chord,
    state.geometry.domainHeight,
  ]);

  const handleSetSolution = (
    patch: (
      c: import('./solver/solverConfig').SolverConfig,
    ) => import('./solver/solverConfig').SolverConfig,
  ) => setState((prev) => ({ ...prev, solution: patch(prev.solution) }));

  const solverConvergence = useMemo(() => {
    const r = state.residuals[state.residuals.length - 1];
    if (!r) return null;
    const maxResidual = Math.max(r.p, r.Ux, r.Uy, r.k ?? 0, r.omega ?? 0, r.epsilon ?? 0);
    return { iteration: r.iteration, maxResidual, cd: (r as any).cd, cl: (r as any).cl };
  }, [state.residuals]);

  const [monitorOpen, setMonitorOpen] = useState(false); // right-hand residuals/forces rail
  const [runsRailOpen, setRunsRailOpen] = useState(true); // right-hand plots & runs rail on Results tab
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [activeDialogPlot, setActiveDialogPlot] = useState<PlotDefinition | null>(null);
  const [createPlotModalOpen, setCreatePlotModalOpen] = useState(false);
  const [pickingPointsState, setPickingPointsState] = useState<{
    step: 1 | 2;
    p1?: [number, number];
  } | null>(null);
  const [pickedP1, setPickedP1] = useState<[number, number] | null>(null);
  const [pickedP2, setPickedP2] = useState<[number, number] | null>(null);
  const [caseFilesOpen, setCaseFilesOpen] = useState(false); // OpenFOAM dicts modal
  const [paletteOpen, setPaletteOpen] = useState(false); // ⌘K command palette
  const [shortcutsOpen, setShortcutsOpen] = useState(false); // ? shortcut sheet
  const [leftPanelHidden, setLeftPanelHidden] = useState(false); // mod+B gives the canvas the full width
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    if (activeDialogPlot) {
      const updated = (state.plots ?? []).find((p) => p.id === activeDialogPlot.id);
      if (updated && updated !== activeDialogPlot) {
        setActiveDialogPlot(updated);
      }
    }
  }, [state.plots, activeDialogPlot]);
  const {
    resultsLoading,
    livePreview,
    setLivePreview,
    transientFrameIndex,
    transientPlaying,
    transientSpeed,
    setTransientSpeed,
    transientTimes,
    clearResultsCache,
    loadResults,
    selectTransientFrame,
    handleToggleTransientPlay,
  } = useResultsPlayback({ fieldData, setFieldData, meshData, projectId, setState });

  const handleDeleteRun = useCallback(
    async (id: string) => {
      const wasSelected = selectedRunId === id;
      let remaining: SolverRunRecord[] = [];
      setState((prev) => {
        remaining = (prev.solverRuns ?? []).filter((r) => r.id !== id);
        return { ...prev, solverRuns: remaining };
      });

      if (wasSelected) {
        const finishedRemaining = remaining.filter((r) => r.status !== 'running');
        const latest = finishedRemaining.length
          ? [...finishedRemaining].sort((a, b) => b.startedAt - a.startedAt)[0]
          : null;
        if (latest) {
          handleSelectRun(latest.id);
        } else {
          setSelectedRunId(null);
          setHistoricalFieldData(null);
          setHistoricalFieldStatus({ loading: false, error: null, runId: null });
        }
      }
      historicalCacheRef.current.delete(id);

      if (projectId) {
        const res = await deleteSolverRun(projectId, id);
        if (!res.success) {
          toast(`Failed to delete run on server: ${res.detail || 'unknown error'}`, 'error');
        }
      }
    },
    [projectId, selectedRunId, handleSelectRun],
  );

  useEffect(() => {
    if (activeStage !== 'results' || selectedRunId !== null) return;
    const finished = (state.solverRuns ?? []).filter((r) => r.status !== 'running');
    if (finished.length === 0) return;
    const latest = [...finished].sort((a, b) => b.startedAt - a.startedAt)[0];
    handleSelectRun(latest.id);
  }, [activeStage, selectedRunId, state.solverRuns, handleSelectRun]);

  const selectLatestFinishedRun = useCallback(() => {
    const finished = (state.solverRuns ?? []).filter((r) => r.status !== 'running');
    if (finished.length === 0) {
      handleSelectRun(null);
      return;
    }
    const latest = [...finished].sort((a, b) => b.startedAt - a.startedAt)[0];
    handleSelectRun(latest.id);
  }, [state.solverRuns, handleSelectRun]);

  const handleClearPendingImport = useCallback(() => setPendingImportFile(null), []);
  const handleCadNameChange = useCallback(
    (name: string) => setState((prev) => ({ ...prev, geometry: { ...prev.geometry, name } })),
    [],
  );
  const isViewingHistorical = activeStage === 'results' && selectedRunId !== null;
  const selectedRunRecord = isViewingHistorical
    ? (state.solverRuns ?? []).find((r) => r.id === selectedRunId)
    : null;

  const effectiveMesh = isViewingHistorical
    ? historicalFieldData?.mesh
      ? {
          nodes: historicalFieldData.mesh.nodes,
          elements: historicalFieldData.mesh.elements,
          num_nodes: historicalFieldData.mesh.nodes.length,
          num_elements: historicalFieldData.mesh.elements.length,
          boundaries: historicalFieldData.mesh.boundaries || {},
        }
      : null
    : meshData;

  const effectiveFieldData = isViewingHistorical
    ? historicalFieldData
      ? {
          ...historicalFieldData,
          source: 'openfoam',
          streamlines: historicalFieldData.streamlines || [],
        }
      : null
    : fieldData;

  const targetRunForPlot = useMemo(() => {
    if (selectedRunId) {
      const rec = (state.solverRuns ?? []).find((r) => r.id === selectedRunId);
      return { id: selectedRunId, label: rec?.label || `Run ${selectedRunId.slice(0, 6)}` };
    }
    const finished = (state.solverRuns ?? []).filter((r) => r.status !== 'running');
    if (finished.length > 0) {
      const latest = [...finished].sort((a, b) => b.startedAt - a.startedAt)[0];
      return { id: latest.id, label: latest.label || `Run ${latest.id.slice(0, 6)}` };
    }
    return { id: null, label: undefined };
  }, [selectedRunId, state.solverRuns]);

  const handleStartPickPoints = useCallback(() => {
    setCreatePlotModalOpen(false);
    setPickingPointsState({ step: 1 });
  }, []);

  const handlePickPlotPoint = useCallback((pt: [number, number]) => {
    setPickingPointsState((prev) => {
      if (!prev || prev.step === 1) {
        return { step: 2, p1: pt };
      }
      const p1 = prev.p1!;
      const p2 = pt;
      setPickedP1(p1);
      setPickedP2(p2);
      setCreatePlotModalOpen(true);
      return null;
    });
  }, []);

  const handleCreatePlot = useCallback((newPlot: PlotDefinition) => {
    setState((prev) => ({
      ...prev,
      plots: [newPlot, ...(prev.plots ?? [])],
    }));
    setSelectedPlotId(newPlot.id);
    setActiveDialogPlot(newPlot);
  }, []);

  const handleSelectPlot = useCallback((plot: PlotDefinition) => {
    setSelectedPlotId(plot.id);
    setActiveDialogPlot(plot);
  }, []);

  const handleUpdatePlot = useCallback((updated: PlotDefinition) => {
    setState((prev) => ({
      ...prev,
      plots: (prev.plots ?? []).map((p) => (p.id === updated.id ? updated : p)),
    }));
    setActiveDialogPlot(updated);
  }, []);

  const handleDeletePlot = useCallback(
    (id: string) => {
      setState((prev) => ({
        ...prev,
        plots: (prev.plots ?? []).filter((p) => p.id !== id),
      }));
      if (selectedPlotId === id) setSelectedPlotId(null);
      if (activeDialogPlot?.id === id) setActiveDialogPlot(null);
    },
    [selectedPlotId, activeDialogPlot],
  );

  const activePlotLineForCanvas = useMemo(() => {
    if (activeStage !== 'results') return null;
    if (activeDialogPlot?.line) {
      return {
        p1: activeDialogPlot.line.p1,
        p2: activeDialogPlot.line.p2,
        label: activeDialogPlot.name,
      };
    }
    if (selectedPlotId) {
      const sp = (state.plots ?? []).find((p) => p.id === selectedPlotId);
      if (sp?.line) return { p1: sp.line.p1, p2: sp.line.p2, label: sp.name };
    }
    return null;
  }, [activeStage, activeDialogPlot, selectedPlotId, state.plots]);

  const { handleRunSolver, handleStopSolver } = useSolverRun({
    state,
    setState,
    meshData,
    projectId,
    caseRefLength,
    patchSpec,
    patchRoles,
    makeCaseFiles,
    setCaseFiles,
    setMonitorOpen,
    setLivePreview,
    clearResultsCache,
    setSelectedRunId,
    setHistoricalFieldData,
    setHistoricalFieldStatus,
    loadResults,
  });

  // ── Command palette registry ──────────────────────────────────────────────
  // One flat list of everything worth reaching without hunting through panels.
  // The palette groups by `group` and fuzzy-filters the whole list.
  const solverRunning = state.executionStatus === 'running';
  const solverBusy = solverRunning || isMeshing;
  const modalOpen =
    paletteOpen ||
    shortcutsOpen ||
    caseFilesOpen ||
    createPlotModalOpen ||
    preferencesOpen ||
    !!activeDialogPlot;

  const commands = useMemo<Command[]>(
    () => [
      // Navigate
      {
        id: 'go-geometry',
        group: 'Navigate',
        title: 'Go to Geometry',
        icon: <PenTool className="w-4 h-4" />,
        shortcut: ['1'],
        run: () => setActiveStage('geometry'),
      },
      {
        id: 'go-case-setup',
        group: 'Navigate',
        title: 'Go to Case Setup',
        icon: <SlidersHorizontal className="w-4 h-4" />,
        shortcut: ['2'],
        run: () => setActiveStage('caseSetup'),
      },
      {
        id: 'go-mesh',
        group: 'Navigate',
        title: 'Go to Mesh',
        icon: <Grid3x3 className="w-4 h-4" />,
        shortcut: ['3'],
        run: () => setActiveStage('mesh'),
      },
      {
        id: 'go-solver',
        group: 'Navigate',
        title: 'Go to Solver',
        icon: <Play className="w-4 h-4" />,
        shortcut: ['4'],
        run: () => setActiveStage('solver'),
      },
      {
        id: 'go-results',
        group: 'Navigate',
        title: 'Go to Results',
        icon: <BarChart3 className="w-4 h-4" />,
        shortcut: ['5'],
        run: () => setActiveStage('results'),
      },

      // Mesh
      {
        id: 'mesh-generate',
        group: 'Mesh',
        title: 'Generate Mesh (Gmsh)',
        keywords: 'unstructured triangulate remesh',
        icon: <Grid3x3 className="w-4 h-4" />,
        disabled: !meshGate.ready || isMeshing,
        disabledReason: !meshGate.ready
          ? meshGate.missing.join('; ')
          : 'A mesh is already being generated',
        run: handleGenerateMesh,
      },
      {
        id: 'mesh-blocks-h',
        group: 'Mesh',
        title: 'Build Structured Blocks · H-grid',
        keywords: 'blocking hexa structured',
        icon: <Layers className="w-4 h-4" />,
        run: () => handleBuildBlocks('hgrid'),
      },
      {
        id: 'mesh-blocks-o',
        group: 'Mesh',
        title: 'Build Structured Blocks · O-grid',
        keywords: 'blocking ring body',
        icon: <Layers className="w-4 h-4" />,
        run: () => handleBuildBlocks('ogrid'),
      },
      {
        id: 'mesh-blocks-c',
        group: 'Mesh',
        title: 'Build Structured Blocks · C-grid',
        keywords: 'blocking airfoil wake',
        icon: <Layers className="w-4 h-4" />,
        run: () => handleBuildBlocks('cgrid'),
      },
      {
        id: 'mesh-structured-generate',
        group: 'Mesh',
        title: 'Generate Structured Mesh',
        keywords: 'transfinite quad',
        icon: <Wand2 className="w-4 h-4" />,
        disabled: !blocking || isMeshing,
        disabledReason: 'Build the block topology first',
        run: handleGenerateStructuredMesh,
      },
      {
        id: 'mesh-apply-yplus',
        group: 'Mesh',
        title: 'Apply y⁺ Sizing to Mesh',
        keywords: 'first layer prism boundary layer',
        icon: <Ruler className="w-4 h-4" />,
        run: handleApplyYPlusToMesh,
      },
      {
        id: 'mesh-blockmeshdict',
        group: 'Mesh',
        title: 'Download blockMeshDict',
        keywords: 'export native openfoam',
        icon: <FileDown className="w-4 h-4" />,
        run: () => requestDownloadBlockMeshDictRef.current?.(),
      },

      // Solver
      solverRunning
        ? {
            id: 'solver-stop',
            group: 'Solver',
            title: 'Stop Solver',
            icon: <Square className="w-4 h-4" />,
            shortcut: [MOD_LABEL, '↵'],
            run: handleStopSolver,
          }
        : {
            id: 'solver-run',
            group: 'Solver',
            title: 'Run Solver',
            icon: <Play className="w-4 h-4" />,
            shortcut: [MOD_LABEL, '↵'],
            disabled: !meshReady || solverBusy,
            disabledReason: !meshReady ? 'Generate a mesh first' : 'A run is already in progress',
            run: handleRunSolver,
          },
      {
        id: 'solver-reload',
        group: 'Solver',
        title: 'Reload Results',
        keywords: 'refresh refetch field',
        icon: <RefreshCw className="w-4 h-4" />,
        run: () => {
          clearResultsCache();
          void loadResults(true);
        },
      },

      // Results
      {
        id: 'results-new-plot',
        group: 'Results',
        title: 'New Plot',
        keywords: 'chart line probe compare',
        icon: <Plus className="w-4 h-4" />,
        run: () => setCreatePlotModalOpen(true),
      },
      {
        id: 'results-view-latest',
        group: 'Results',
        title: 'View Latest Run',
        keywords: 'open field viewport',
        icon: <BarChart3 className="w-4 h-4" />,
        run: selectLatestFinishedRun,
      },

      // Project
      {
        id: 'project-case-files',
        group: 'Project',
        title: 'Open OpenFOAM Case Files',
        keywords: 'dicts browse system constant',
        icon: <FileCode className="w-4 h-4" />,
        run: () => setCaseFilesOpen(true),
      },
      {
        id: 'project-preferences',
        group: 'Project',
        title: 'Open Preferences',
        keywords: 'settings options',
        icon: <Settings className="w-4 h-4" />,
        run: () => setPreferencesOpen(true),
      },
      {
        id: 'view-toggle-left-panel',
        group: 'View',
        title: 'Toggle Stage Panel',
        keywords: 'sidebar left hide show collapse focus',
        icon: <PanelLeft className="w-4 h-4" />,
        shortcut: [MOD_LABEL, 'B'],
        run: () => setLeftPanelHidden((h) => !h),
      },
      {
        id: 'view-theme-toggle',
        group: 'View',
        title: 'Toggle Light / Dark Theme',
        keywords: 'appearance dark mode light mode colour',
        icon: <SunMoon className="w-4 h-4" />,
        run: toggleTheme,
      },
      {
        id: 'view-theme-system',
        group: 'View',
        title: 'Use System Theme',
        keywords: 'appearance auto os',
        icon: <Monitor className="w-4 h-4" />,
        run: () => setThemePreference('system'),
      },
      {
        id: 'project-home',
        group: 'Project',
        title: 'Back to Projects',
        keywords: 'close home exit',
        icon: <LayoutGrid className="w-4 h-4" />,
        run: handleExitHome,
      },
    ],
    [
      meshGate,
      isMeshing,
      blocking,
      meshReady,
      solverRunning,
      solverBusy,
      handleGenerateMesh,
      handleBuildBlocks,
      handleGenerateStructuredMesh,
      handleApplyYPlusToMesh,
      handleRunSolver,
      handleStopSolver,
      selectLatestFinishedRun,
      clearResultsCache,
      loadResults,
      handleExitHome,
    ],
  );

  useGlobalHotkeys([
    {
      combo: 'mod+k',
      allowInInput: true,
      handler: (e) => {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      },
    },
    {
      combo: 'shift+?',
      handler: (e) => {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      },
    },
    {
      combo: '1',
      handler: () => {
        if (!modalOpen) setActiveStage('geometry');
      },
    },
    {
      combo: '2',
      handler: () => {
        if (!modalOpen) setActiveStage('caseSetup');
      },
    },
    {
      combo: '3',
      handler: () => {
        if (!modalOpen) setActiveStage('mesh');
      },
    },
    {
      combo: '4',
      handler: () => {
        if (!modalOpen) setActiveStage('solver');
      },
    },
    {
      combo: '5',
      handler: () => {
        if (!modalOpen) setActiveStage('results');
      },
    },
    {
      combo: 'mod+enter',
      handler: (e) => {
        e.preventDefault();
        if (modalOpen) return;
        if (solverRunning) handleStopSolver();
        else if (meshReady && !solverBusy) handleRunSolver();
      },
    },
    {
      combo: 'mod+b',
      handler: (e) => {
        e.preventDefault();
        setLeftPanelHidden((h) => !h);
      },
    },
    { combo: 'escape', handler: () => setShortcutsOpen(false) },
  ]);

  return (
    <div className="flex flex-col h-screen w-screen bg-app overflow-hidden font-sans text-fg">
      {/* Top bar: project, workflow stages, global actions (44px) */}
      <AppBar
        projectName={projectName}
        onProjectNameChange={handleRenameProject}
        onExitHome={handleExitHome}
        activeStage={activeStage}
        onSelectStage={setActiveStage}
        stageStatus={stageStatus}
        onOpenCaseFiles={() => setCaseFilesOpen(true)}
        caseFilesCount={Object.keys(caseFiles).length}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        preferencesOpen={preferencesOpen}
        onPreferencesOpenChange={setPreferencesOpen}
      />

      {/* Workspace: stage panel, viewport, right rails */}
      <div className="flex-1 flex min-h-0 relative">
        {activeStage === 'caseSetup' && (
          <div className="absolute inset-0 z-30 bg-app overflow-hidden flex">
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
        {/* Left Column: Stage Controls (280px). Hidden with display:none rather
            than unmounted so section open/closed state survives mod+B. */}
        <div className={leftPanelHidden ? 'hidden' : 'contents'}>
          <LeftStagePanel
            activeStage={activeStage}
            onSelectStage={setActiveStage}
            stageStatus={stageStatus}
            state={state}
            updateGeometry={(p) =>
              setState((prev) => ({ ...prev, geometry: { ...prev.geometry, ...p } }))
            }
            updatePhysics={(p) =>
              setState((prev) => ({
                ...prev,
                physics: { ...prev.physics, ...p },
                boundaries: {
                  ...prev.boundaries,
                  ...(p.inletVelocity !== undefined ? { inletVelocity: p.inletVelocity } : {}),
                },
              }))
            }
            updateBoundaries={(p) =>
              setState((prev) => ({ ...prev, boundaries: { ...prev.boundaries, ...p } }))
            }
            updateYPlus={(p) => setState((prev) => ({ ...prev, yplus: { ...prev.yplus, ...p } }))}
            updateSolver={(p) =>
              setState((prev) => ({ ...prev, solver: { ...prev.solver, ...p } }))
            }
            updatePostProcess={(p) =>
              setState((prev) => ({ ...prev, postprocess: { ...prev.postprocess, ...p } }))
            }
            onGenerateMesh={handleGenerateMesh}
            blocking={blocking}
            onBuildBlocks={handleBuildBlocks}
            onInitializeBlocking={handleInitializeBlocking}
            onUpdateBlocking={handleUpdateBlocking}
            onGenerateStructuredMesh={handleGenerateStructuredMesh}
            ogridBodies={ogridBodies}
            onWrapBody={handleWrapBody}
            ogridParams={ogridParams}
            onUpdateOgridParams={handleUpdateOgridParams}
            structuredHint={structuredHint}
            structuredSmooth={structuredSmooth}
            setStructuredSmooth={setStructuredSmooth}
            meshTopology={meshTopology}
            onMeshTopologyChange={changeMeshTopology}
            width={sidebarW}
            onWidthChange={(w) => {
              setSidebarW(w);
              try {
                localStorage.setItem('opencfd_sidebar_w', String(Math.round(w)));
              } catch {
                /* ignore */
              }
            }}
            onApplyYPlusToMesh={handleApplyYPlusToMesh}
            onDirectionColors={setDirectionColors}
            onBlockModeChange={setBlockMode}
            meshData={meshData}
            meshError={meshError}
            meshStale={meshStale}
            onRunSolver={handleRunSolver}
            onStopSolver={handleStopSolver}
            projectId={projectId}
            onReloadResults={() => {
              clearResultsCache();
              void loadResults(true);
            }}
            resultsLoading={resultsLoading}
            fieldSource={fieldData?.source}
            fieldTime={fieldData?.time}
            onSetSolution={handleSetSolution}
            onSetTimeFormulation={(t) =>
              setState((prev) => ({ ...prev, physics: { ...prev.physics, timeFormulation: t } }))
            }
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
                setState((prev) => ({
                  ...prev,
                  geometry: { ...prev.geometry, name: res.name || file.name },
                }));
                setPendingImportFile({ type: 'parsed', name: res.name || file.name, points: pts });
              } catch {
                setPendingImportFile({ type: 'airfoil', file });
              }
            }}
            onUploadAirfoilUrl={async (url) => {
              setActiveStage('geometry');
              const res = await fetchAndParseAirfoilFromUrl(url);
              const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
              setState((prev) => ({
                ...prev,
                geometry: { ...prev.geometry, name: res.name || 'Airfoil' },
              }));
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
            onCreatePlot={() => setCreatePlotModalOpen(true)}
          />
        </div>

        {/* Center Canvas + Floating Bottom Console Area */}
        <div className="flex-1 min-w-0 h-full relative overflow-hidden bg-surface">
          {/* Center: one shared CAD canvas; fills entire workspace without getting squished */}
          <main className="absolute inset-0 w-full h-full bg-surface overflow-hidden">
            <div className="w-full h-full">
              <CadWorkbench2D
                displayOnly={activeStage !== 'geometry'}
                meshData={effectiveMesh}
                meshStale={meshStale}
                blocking={blocking}
                blocksBuiltTick={blocksBuiltTick}
                onUpdateBlocking={handleUpdateBlocking}
                showBlocking={activeStage === 'mesh' && meshTopology === 'structured'}
                directionColors={directionColors}
                blockMode={blockMode}
                domainBroken={domainState === 'broken'}
                isMeshing={isMeshing}
                showMesh={
                  activeStage === 'mesh' || activeStage === 'solver' || activeStage === 'results'
                }
                meshOnly={activeStage === 'solver' || activeStage === 'results'}
                showField={activeStage === 'results'}
                livePreview={activeStage === 'solver' ? livePreview : null}
                fieldData={effectiveFieldData}
                activeField={state.postprocess.activeField}
                colormap={state.postprocess.colormap}
                initialEntities={cadEntities}
                onApplySketchMesh={handleApplySketchMesh}
                domainLength={state.geometry.domainLength}
                domainHeight={state.geometry.domainHeight}
                resolution={state.geometry.meshResolution}
                firstLayerMm={state.geometry.firstLayerHeightMm}
                pendingImportFile={pendingImportFile}
                onClearPendingImport={handleClearPendingImport}
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
                onCadNameChange={handleCadNameChange}
                isTransient={state.physics.timeFormulation === 'transient'}
                transientTimes={transientTimes}
                transientFrameIndex={transientFrameIndex}
                transientPlaying={transientPlaying}
                transientSpeed={transientSpeed}
                onSelectTransientFrame={selectTransientFrame}
                onToggleTransientPlay={handleToggleTransientPlay}
                onSelectTransientSpeed={setTransientSpeed}
                historicalStatus={
                  isViewingHistorical
                    ? {
                        runLabel: selectedRunRecord?.label || 'Past Run',
                        loading: historicalFieldStatus.loading,
                        error: historicalFieldStatus.error,
                      }
                    : undefined
                }
                onRestoreLive={selectLatestFinishedRun}
                activePlotLine={activePlotLineForCanvas}
                isPickingPlotPoints={!!pickingPointsState}
                onPickPlotPoint={handlePickPlotPoint}
                plotPickPreviewP1={pickingPointsState?.p1 ?? null}
              />
              {pickingPointsState && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-inverse text-on-inverse px-4 py-2 rounded flex items-center gap-3 text-xs font-medium border border-white/20">
                  <Crosshair className="w-4 h-4 text-accent animate-pulse" />
                  <span>
                    {pickingPointsState.step === 1
                      ? 'Click Point 1 on the geometry canvas'
                      : `Point 1 set (${pickingPointsState.p1![0].toFixed(3)}m, ${pickingPointsState.p1![1].toFixed(3)}m). Click Point 2...`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPickingPointsState(null);
                      setCreatePlotModalOpen(true);
                    }}
                    className="px-2.5 py-0.5 rounded-sm bg-surface/20 hover:bg-surface/30 text-white font-semibold text-[11px] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </main>

          {/* 4. COLLAPSIBLE BOTTOM DRAWER - console only (Slides over canvas as overlay) */}
          <div
            className={`absolute bottom-0 left-0 right-0 z-30 pointer-events-auto${activeStage === 'caseSetup' ? ' hidden' : ''}`}
          >
            <BottomSolverDrawer
              terminalLogs={state.terminalLogs}
              executionStatus={state.executionStatus}
              onClearLogs={() => setState((prev) => ({ ...prev, terminalLogs: [] }))}
            />
          </div>
        </div>

        {/* Right rail: live residuals + force coefficients. A real flex child, so
            expanding/collapsing it pushes the canvas instead of covering it. */}
        {activeStage === 'solver' && (
          <SolverMonitorRail
            residuals={state.residuals}
            executionStatus={state.executionStatus}
            open={monitorOpen}
            onOpenChange={setMonitorOpen}
          />
        )}

        {/* Right rail: solver run history and plots stacked on the Results tab. */}
        {activeStage === 'results' && (
          <ResultsRightRail
            plots={state.plots ?? []}
            selectedPlotId={selectedPlotId}
            onSelectPlot={handleSelectPlot}
            runs={state.solverRuns ?? []}
            executionStatus={state.executionStatus}
            open={runsRailOpen}
            onOpenChange={setRunsRailOpen}
            selectedRunId={selectedRunId}
            onSelectRun={handleSelectRun}
            historicalFieldStatus={historicalFieldStatus}
            onRelabelRun={(id, label) =>
              setState((prev) => ({
                ...prev,
                solverRuns: (prev.solverRuns ?? []).map((r) => (r.id === id ? { ...r, label } : r)),
              }))
            }
            onDeleteRun={handleDeleteRun}
          />
        )}
      </div>

      {/* 5. BOTTOM STATUS BAR (24px) */}

      <CaseFilesModal
        open={caseFilesOpen}
        onClose={() => setCaseFilesOpen(false)}
        caseFiles={caseFiles}
        projectId={projectId}
        projectName={projectName}
      />

      <CreatePlotModal
        open={createPlotModalOpen}
        onClose={() => setCreatePlotModalOpen(false)}
        projectId={projectId}
        targetRunId={targetRunForPlot.id}
        targetRunLabel={targetRunForPlot.label}
        targetRunResiduals={
          (state.solverRuns ?? []).find((r) => r.id === targetRunForPlot.id)?.residuals ?? []
        }
        defaultName={`Plot ${(state.plots?.length ?? 0) + 1}`}
        pickedP1={pickedP1}
        pickedP2={pickedP2}
        onStartPickPoints={handleStartPickPoints}
        onCreatePlot={handleCreatePlot}
      />

      <PlotViewDialog
        plot={activeDialogPlot}
        open={!!activeDialogPlot}
        onClose={() => setActiveDialogPlot(null)}
        onUpdatePlot={handleUpdatePlot}
        onDeletePlot={handleDeletePlot}
        projectId={projectId}
        solverRuns={state.solverRuns ?? []}
      />

      {paletteOpen && (
        <CommandPalette open onClose={() => setPaletteOpen(false)} commands={commands} />
      )}

      {shortcutsOpen && <ShortcutsDialog open onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

export default App;
