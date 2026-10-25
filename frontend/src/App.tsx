import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AppBar } from './components/layout/AppBar';
import type { StageId } from './components/layout/stages';
import { LeftStagePanel } from './components/layout/LeftStagePanel';
import { CadWorkbench2D } from './components/cad/CadWorkbench2D';
import { BottomSolverDrawer } from './components/layout/BottomSolverDrawer';
import { SolverMonitorRail } from './components/solver/SolverMonitorRail';
import { ResultsRightRail } from './components/results/ResultsRightRail';
import { CreatePlotModal } from './components/results/CreatePlotModal';
import { PlotViewDialog } from './components/results/PlotViewDialog';
import { Crosshair } from 'lucide-react';
import { CaseFilesModal } from './components/solver/CaseFilesModal';
import { CaseSetupPanel } from './components/caseSetup/CaseSetupPanel';
import { defaultPatchBC } from './caseSetup/bcCatalog';
import { directionsForAoA } from './solver/solverConfig';
import { CFDProjectState, SolverRunRecord, PlotDefinition, TrackSeed } from './types/cfd';
import {
  generateCaseFiles,
  uploadAndParseAirfoil,
  fetchAndParseAirfoilFromUrl,
  deleteSolverRun,
  fetchRunField,
} from './utils/api';
import { saveProjectSession, saveProjectBlob, renameProject } from './utils/projectsApi';
import { buildInitialCFDState } from './hooks/appInitialState';
import { useHistoricalRunField } from './hooks/useHistoricalRunField';
import { useResultsPlayback } from './hooks/useResultsPlayback';
import { useResultsView, type DiffSource } from './hooks/useResultsView';
import { fieldDef, fieldValues, valueRange, type ResultFieldId } from './utils/resultFields';
import { patchSamples, snapshotBoundaries } from './utils/boundaryData';
import { exportViewImage } from './utils/exportView';
import { exportAnimation, type AnimationOptions } from './utils/exportAnimation';
import { AnimationExportDialog } from './components/results/AnimationExportDialog';
import { useSolverRun } from './hooks/useSolverRun';
import { toast } from './components/ui/Toast';
import { CommandPalette, Command } from './components/ui/CommandPalette';
import { ShortcutsDialog } from './components/ui/ShortcutsDialog';
import { useGlobalHotkeys } from './hooks/useGlobalHotkeys';
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
import { Blocking, initializeBlocking } from './types/blocking';
import { restoreRememberedTags } from './app/boundaryTagMemory';
import { computePatchRoles } from './app/boundaryTagMemory';
import { scheduleAutosave } from './app/autosave';
import { updateCaseCalculations } from './app/caseCalculations';
import { syncFirstCellToMesh } from './app/caseCalculations';
import { runGenerateMesh } from './app/meshingActions';
import { runGenerateStructuredMesh } from './app/meshingActions';
import { buildCommands } from './app/commands';

/** A copy of the geometry, domain and patch tags taken when blocking or
 *  meshing starts. The Mesh, Solver and Results tabs keep showing it after
 *  the geometry is edited, until the user chooses to update. */
export interface MeshGeometry {
  entities: CadEntity[];
  tags: Record<string, BoundaryTag>;
}

/** What makes two geometries different for meshing. */
const geometryKey = (entities: CadEntity[], tags: Record<string, BoundaryTag>) =>
  JSON.stringify(
    entities.map((e) => ({ t: e.type, p: e.pts, c: e.isClosed, r: e.role, rad: e.radius })),
  ) +
  '|' +
  JSON.stringify(tags);

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
  /** The geometry the blocks and mesh were made from (see meshGeom). */
  meshGeom?: MeshGeometry | null;
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
  // Which structured-meshing section is open: it picks what the canvas shows.
  const [structuredStep, setStructuredStep] = useState<'blocking' | 'sizing'>('blocking');
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
  useEffect(
    () => restoreRememberedTags({ cadEntities, flowType, edgeTagMap, tagMemoryRef, setEdgeTagMap }),
    [cadEntities],
  );

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
  // The Mesh tab works on a copy of the geometry taken when the blocks or the
  // mesh were first made, so editing the geometry never mixes old blocks and
  // mesh with the new outline. The copy follows the live geometry while there
  // is nothing to lose, and is replaced only when the user chooses Update.
  const [meshGeom, setMeshGeom] = useState<MeshGeometry | null>(
    () => savedSession?.meshGeom ?? null,
  );
  const liveGeomKey = useMemo(
    () => geometryKey(cadEntities, edgeTagMap),
    [cadEntities, edgeTagMap],
  );
  const meshGeomKey = useMemo(
    () => (meshGeom ? geometryKey(meshGeom.entities, meshGeom.tags) : null),
    [meshGeom],
  );
  const geometryChanged = meshGeomKey !== null && meshGeomKey !== liveGeomKey;
  const meshEntities = geometryChanged && meshGeom ? meshGeom.entities : cadEntities;
  const meshTags = geometryChanged && meshGeom ? meshGeom.tags : edgeTagMap;

  const geomSigCore = useMemo(
    () => geometryKey(meshEntities, meshTags) + '|' + flowType,
    [meshEntities, meshTags, flowType],
  );
  // Full signature also folds in the blocking - block edits mark the mesh stale
  // (badge on the toggle) but do NOT raise a toast (that is just normal editing).
  const geomSignature = useMemo(
    () =>
      geomSigCore +
      '|' +
      JSON.stringify(blocking?.vertices?.map((v) => v.pt) ?? null) +
      '|' +
      JSON.stringify(
        // Spacings only when set, so meshes saved before they existed stay fresh.
        blocking?.edges?.map((e) =>
          e.spacing1 || e.spacing2
            ? [e.nodes, e.law, e.ratio, e.spacing1, e.spacing2]
            : [e.nodes, e.law, e.ratio],
        ) ?? null,
      ),
    [geomSigCore, blocking],
  );
  const meshSigRef = useRef<string | null>(savedSession?.meshSig ?? null);
  const meshCoreSigRef = useRef<string | null>(null);

  // Master CFD Project State
  const [state, setState] = useState<CFDProjectState>(() =>
    buildInitialCFDState(savedSession?.state),
  );

  const [meshData, setMeshData] = useState<any>(() => savedSession?.meshData ?? null);
  // Take the Mesh tab's copy of the geometry when the first blocks or mesh
  // appear; drop it once both are gone, so it follows the live geometry again.
  const hasMeshWork = !!meshData?.num_elements || !!blocking?.blocks?.length;
  useEffect(() => {
    if (!hasMeshWork) {
      if (meshGeom) setMeshGeom(null);
    } else if (!meshGeom)
      setMeshGeom({
        entities: cadEntities.map((e) => ({ ...e, selected: false })),
        tags: edgeTagMap,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMeshWork, meshGeom]);
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
  const patchRoles = useMemo(
    () => computePatchRoles({ state, flowType, meshData, boundaryEdges }),
    [
      boundaryEdges,
      meshData?.boundaries,
      state.physics.compressibility,
      state.physics.speedRegime,
      flowType,
    ],
  );

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
    meshTopology,
    // meshData / fieldData are saved separately by the blob effect below.
    meshSig: meshSigRef.current,
    meshGeom,
    hasMesh: !!meshData?.num_elements,
    caseFiles,
  });
  const sessionRef = useRef<StudioSession>(buildSession());
  sessionRef.current = buildSession();

  const saveWarned = useRef(false);
  useEffect(
    () => scheduleAutosave({ state, projectId, sessionRef, saveWarned }),
    [
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
      meshGeom,
      caseFiles,
    ],
  );

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
          toast.error('Autosave failed', {
            id: 'autosave',
            description: 'Check the backend connection. Your work is kept in this window.',
          });
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
  useEffect(
    () => updateCaseCalculations({ state, setState }),
    [
      state.boundaries.inletVelocity,
      state.geometry.chord,
      state.physics.density,
      state.physics.kinematicViscosity,
      state.physics.regime,
      state.yplus.target_yplus,
      state.yplus.expansion_ratio,
      state.boundaries.turbulenceIntensityPercent,
    ],
  );

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

  // One combined notice for "you edited the geometry": if the edit also broke
  // the domain, say so in the same toast instead of firing two.
  const lastEditNoticeRef = useRef<string>('');
  useEffect(() => {
    const broken = domainState === 'broken';
    const notice =
      broken && geometryChanged ? 'both' : broken ? 'domain' : geometryChanged ? 'mesh' : '';
    if (notice && notice !== lastEditNoticeRef.current) {
      lastEditNoticeRef.current = notice;
      if (notice === 'both')
        toast.error('Domain boundary broke', {
          id: 'edit-notice',
          description:
            'An edge changed. Reselect the outline in the Domain step. The Mesh tab keeps the previous geometry until you update it there.',
        });
      else if (notice === 'domain')
        toast.error('Domain boundary broke', {
          id: 'edit-notice',
          description: 'An edge changed. Reselect the outline in the Domain step and redefine it.',
        });
      else
        toast.info('Geometry changed', {
          id: 'edit-notice',
          description:
            'The Mesh tab keeps the previous geometry, blocks and mesh until you update it there.',
        });
    }
    if (!notice) lastEditNoticeRef.current = '';
  }, [domainState, geometryChanged]);

  /** Mesh tab "Update": take the latest geometry and domain. The blocks and
   *  the mesh were made for the old one, so they go. */
  const takeLatestGeometry = () => {
    setBlocking(null);
    setMeshData(null);
    setMeshError(null);
    meshSigRef.current = null;
    meshCoreSigRef.current = null;
    clearResultsCache();
    setMeshGeom(null);
    toast.success('Latest geometry loaded', {
      id: 'edit-notice',
      description:
        meshTopology === 'structured'
          ? 'Build the blocks again, then generate the mesh.'
          : 'Generate the mesh again.',
    });
  };

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

  const handleGenerateMesh = async () =>
    runGenerateMesh({
      meshGate,
      setState,
      setIsMeshing,
      setMeshData,
      setMeshError,
      clearResultsCache,
      state,
      cadEntities: meshEntities,
      edgeTagMap: meshTags,
      flowType,
      meshSigRef,
      geomSignature,
      meshCoreSigRef,
      geomSigCore,
      makeCaseFiles,
      setCaseFiles,
    });

  // ── Structured meshing (H-block transfinite) ──────────────────────────────
  // Manual (ICEM-style) blocking: one block around all the geometry, which the
  // user then splits, deletes, associates and O-grids on the canvas.
  const handleInitializeBlocking = () => {
    const bk = initializeBlocking(meshEntities);
    if (!bk) {
      toast.error('Nothing to block', { description: 'Draw or import geometry first.' });
      return;
    }
    setBlocksBuiltTick((t) => t + 1); // reveal the Blocks view
    setBlocking(bk);
    toast.success('Created 1 block');
  };

  const handleGenerateStructuredMesh = async () =>
    runGenerateStructuredMesh({
      blocking,
      setIsMeshing,
      setMeshData,
      setMeshError,
      clearResultsCache,
      setState,
      structuredSmooth,
      meshSigRef,
      geomSignature,
      meshCoreSigRef,
      geomSigCore,
      makeCaseFiles,
      setCaseFiles,
    });

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
  useEffect(
    () => syncFirstCellToMesh({ state, flowType, setState }),
    [
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
    ],
  );

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
    fetchFrameData,
    showFrameData,
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
          toast.error('Could not delete the run', {
            description: res.detail || 'The server did not say why.',
          });
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
          boundaries: snapshotBoundaries(historicalFieldData.mesh, meshData),
        }
      : null
    : meshData;

  // The latest run's time steps are still in the case, so a transient run
  // viewed there plays its frames (loaded live) instead of its one snapshot.
  const latestRunId = useMemo(() => {
    const finished = (state.solverRuns ?? []).filter((r) => r.status !== 'running');
    return finished.length ? [...finished].sort((a, b) => b.startedAt - a.startedAt)[0].id : null;
  }, [state.solverRuns]);
  const viewingLatestRun = !isViewingHistorical || selectedRunId === latestRunId;
  const isTransientRun = state.physics.timeFormulation === 'transient';
  const liveFrame =
    isViewingHistorical &&
    isTransientRun &&
    viewingLatestRun &&
    fieldData?.fields?.U_mag?.length &&
    fieldData.fields.U_mag.length === historicalFieldData?.mesh?.nodes?.length
      ? fieldData
      : null;
  const framesRequested = useRef<string | null>(null);
  useEffect(() => {
    if (activeStage !== 'results' || !isTransientRun || !viewingLatestRun || fieldData) return;
    if (!latestRunId || framesRequested.current === latestRunId) return;
    framesRequested.current = latestRunId;
    void loadResults(true, undefined, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage, isTransientRun, viewingLatestRun, fieldData, latestRunId]);

  const effectiveFieldData = isViewingHistorical
    ? liveFrame
      ? { ...liveFrame, mesh: historicalFieldData.mesh }
      : historicalFieldData
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

  // A card click picks the plot (its line shows on the canvas); the expand
  // button opens it full size.
  const handleSelectPlot = useCallback((plot: PlotDefinition) => {
    setSelectedPlotId(plot.id);
  }, []);
  const handleOpenPlot = useCallback((plot: PlotDefinition) => {
    setSelectedPlotId(plot.id);
    setActiveDialogPlot(plot);
  }, []);
  // The viewer's arrows step through the open plot's run, in rail order.
  const dialogSiblings = useMemo(
    () =>
      activeDialogPlot ? (state.plots ?? []).filter((p) => p.runId === activeDialogPlot.runId) : [],
    [state.plots, activeDialogPlot],
  );

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

  // ── Results post-processing (contours, overlays, probes, reports) ────────
  // Difference view: the other run's field, fetched when picked.
  const diffRunId =
    activeStage === 'results' && state.postprocess.diffRunId !== targetRunForPlot.id
      ? state.postprocess.diffRunId
      : null;
  const [diffSource, setDiffSource] = useState<DiffSource | null>(null);
  const [diffStatus, setDiffStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });
  useEffect(() => {
    setDiffSource(null);
    if (!diffRunId) {
      setDiffStatus({ loading: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    setDiffStatus({ loading: true, error: null });
    fetchRunField(projectId, diffRunId, ctrl.signal).then((res) => {
      if (ctrl.signal.aborted) return;
      if (res.data?.mesh?.nodes?.length) {
        const label = (state.solverRuns ?? []).find((r) => r.id === diffRunId)?.label ?? 'run';
        setDiffSource({ label, fields: res.data.fields, mesh: res.data.mesh });
        setDiffStatus({ loading: false, error: null });
      } else {
        setDiffStatus({ loading: false, error: res.detail || 'No stored field for that run' });
      }
    });
    return () => ctrl.abort();
    // The label is looked up once; relabelling a run need not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffRunId, projectId]);

  // A colour range held while an animation is exported.
  const [heldRange, setHeldRange] = useState<[number, number] | null>(null);
  const [animDialog, setAnimDialog] = useState(false);
  const animCancel = useRef(false);
  const resultsView = useResultsView(
    effectiveFieldData,
    effectiveMesh,
    state.postprocess,
    state.physics,
    diffSource,
    heldRange,
  );
  const [probePicking, setProbePicking] = useState(false);
  // Clip box picking: null when off, then the first corner once clicked.
  const [clipPicking, setClipPicking] = useState<{ p1: [number, number] | null } | null>(null);
  // Particle track seeding: points (until Done) or a line (two clicks).
  const [trackPicking, setTrackPicking] = useState<{
    kind: 'point' | 'line';
    p1: [number, number] | null;
  } | null>(null);
  useEffect(() => {
    if (activeStage !== 'results') {
      setProbePicking(false);
      setClipPicking(null);
      setTrackPicking(null);
    }
  }, [activeStage]);
  useEffect(() => {
    if (!probePicking && !clipPicking && !trackPicking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setProbePicking(false);
      setClipPicking(null);
      setTrackPicking(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [probePicking, clipPicking, trackPicking]);
  const pickTrackSeed = useCallback(
    (pt: [number, number]) => {
      if (!trackPicking) return;
      const r = (v: number) => Number(v.toPrecision(5));
      let seed: TrackSeed;
      const id = `tr_${Date.now().toString(36)}`;
      if (trackPicking.kind === 'point') {
        seed = {
          id,
          kind: 'point',
          x0: r(pt[0]),
          y0: r(pt[1]),
          x1: r(pt[0]),
          y1: r(pt[1]),
          count: 1,
        };
      } else if (!trackPicking.p1) {
        setTrackPicking({ kind: 'line', p1: pt });
        return;
      } else {
        const p1 = trackPicking.p1;
        setTrackPicking(null);
        if (Math.hypot(pt[0] - p1[0], pt[1] - p1[1]) < 1e-12) return;
        seed = {
          id,
          kind: 'line',
          x0: r(p1[0]),
          y0: r(p1[1]),
          x1: r(pt[0]),
          y1: r(pt[1]),
          count: 12,
        };
      }
      setState((prev) => ({
        ...prev,
        postprocess: {
          ...prev.postprocess,
          tracks: [...(prev.postprocess.tracks ?? []), seed],
        },
      }));
    },
    [trackPicking],
  );
  const pickClipCorner = useCallback(
    (pt: [number, number]) => {
      const p1 = clipPicking?.p1;
      if (!p1) {
        setClipPicking({ p1: pt });
        return;
      }
      setClipPicking(null);
      if (Math.abs(pt[0] - p1[0]) < 1e-9 || Math.abs(pt[1] - p1[1]) < 1e-9) return;
      // Clicked corners, to a readable number of digits.
      const r = (v: number) => Number(v.toPrecision(4));
      setState((prev) => ({
        ...prev,
        postprocess: {
          ...prev.postprocess,
          clipBox: [
            r(Math.min(p1[0], pt[0])),
            r(Math.min(p1[1], pt[1])),
            r(Math.max(p1[0], pt[0])),
            r(Math.max(p1[1], pt[1])),
          ],
        },
      }));
    },
    [clipPicking],
  );
  const addProbe = useCallback((pt: [number, number]) => {
    setState((prev) => ({
      ...prev,
      postprocess: {
        ...prev.postprocess,
        probes: [
          ...prev.postprocess.probes,
          { id: `pr_${Date.now().toString(36)}`, x: pt[0], y: pt[1] },
        ],
      },
    }));
  }, []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewedRun = (state.solverRuns ?? []).find((r) => r.id === targetRunForPlot.id) ?? null;

  const handleAddBoundaryPlot = useCallback(
    (patch: string, variable: ResultFieldId, axis: 'x' | 'y' | 's') => {
      const mesh = effectiveMesh;
      const fd = effectiveFieldData;
      if (!mesh?.nodes?.length || !fd?.fields) return false;
      const s = patchSamples(mesh, resultsView.allFields ?? fd.fields, patch, axis);
      if (!s || s.distance.length < 2) return false;
      const plot: PlotDefinition = {
        id: `plot_${Date.now().toString(36)}`,
        name: `${fieldDef(variable).short} on ${patch}`,
        kind: 'boundary',
        boundary: { patch, axis },
        runId: targetRunForPlot.id,
        variable,
        xAxis: 'distance',
        colormap: 'viridis',
        rangeMin: null,
        rangeMax: null,
        data: {
          distance: s.distance,
          values: Array.from(fieldValues(s.fields, variable, resultsView.ref) ?? []),
          fields: s.fields,
        },
        createdAt: Date.now(),
      };
      handleCreatePlot(plot);
      return true;
    },
    [
      effectiveMesh,
      effectiveFieldData,
      targetRunForPlot.id,
      resultsView.ref,
      resultsView.allFields,
      handleCreatePlot,
    ],
  );

  const handleExportAnimation = useCallback(
    async (o: AnimationOptions) => {
      const root = viewportRef.current;
      if (!root) return;
      setAnimDialog(false);
      animCancel.current = false;
      const def = fieldDef(state.postprocess.activeField);
      const pp = state.postprocess;
      const ref = resultsView.ref;
      const nodes = effectiveMesh?.nodes ?? [];
      const legendFor = (r: [number, number] | null) =>
        r
          ? {
              title: resultsView.overlay.legend.title,
              unit: def.unit,
              lo: r[0],
              hi: r[1],
              colormap: pp.colormap,
              levels: pp.levels,
            }
          : null;
      const t = toast.loading('Exporting animation', {
        duration: Infinity,
        progress: 2,
        action: { label: 'Cancel', onClick: () => (animCancel.current = true) },
      });
      const err = await exportAnimation(o, {
        root,
        times: transientTimes,
        fetchFrame: fetchFrameData,
        showFrame: showFrameData,
        frameRange: (d) => {
          const f = { ...d.fields, x: nodes.map((n) => n[0]), y: nodes.map((n) => n[1]) };
          const v = fieldValues(f, pp.activeField, ref);
          return v ? valueRange(v, pp.rangeMode === 'full' ? 'full' : 'auto', def.symmetric) : null;
        },
        holdRange: setHeldRange,
        legend: legendFor,
        currentRange: () => resultsView.range,
        name: `${projectName || 'results'}-${def.short.replace(/[^\w.-]+/g, '_')}`,
        onProgress: (fraction, text) =>
          toast.update(t, { description: text, progress: Math.round(fraction * 100) }),
        cancelled: () => animCancel.current,
      });
      if (err) toast.error('Could not export', { id: t, description: err });
      else if (animCancel.current) toast.dismiss(t);
      else toast.success('Animation saved', { id: t });
    },
    [
      state.postprocess,
      resultsView,
      effectiveMesh,
      transientTimes,
      fetchFrameData,
      showFrameData,
      projectName,
    ],
  );

  const handleSaveImage = useCallback(() => {
    const root = viewportRef.current;
    if (!root) return;
    const def = fieldDef(state.postprocess.activeField);
    const r = resultsView.range;
    exportViewImage(
      root,
      r
        ? {
            title: resultsView.overlay.legend.title,
            unit: def.unit,
            lo: r[0],
            hi: r[1],
            colormap: state.postprocess.colormap,
            levels: state.postprocess.levels,
          }
        : null,
      `${projectName || 'results'}-${def.short.replace(/[^\w.-]+/g, '_')}`,
    );
  }, [projectName, state.postprocess, resultsView.range, resultsView.overlay.legend.title]);

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
    flushBlobs,
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
    () =>
      buildCommands({
        setActiveStage,
        meshGate,
        isMeshing,
        handleGenerateMesh,
        blocking,
        handleInitializeBlocking,
        handleGenerateStructuredMesh,
        handleApplyYPlusToMesh,
        requestDownloadBlockMeshDictRef,
        solverRunning,
        handleStopSolver,
        meshReady,
        solverBusy,
        handleRunSolver,
        clearResultsCache,
        loadResults,
        setCreatePlotModalOpen,
        selectLatestFinishedRun,
        setCaseFilesOpen,
        setPreferencesOpen,
        setLeftPanelHidden,
        handleExitHome,
      }),
    [
      meshGate,
      isMeshing,
      blocking,
      meshReady,
      solverRunning,
      solverBusy,
      handleGenerateMesh,
      handleInitializeBlocking,
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
            onInitializeBlocking={handleInitializeBlocking}
            onUpdateBlocking={handleUpdateBlocking}
            onGenerateStructuredMesh={handleGenerateStructuredMesh}
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
            onStructuredStep={setStructuredStep}
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
            resultsPanel={
              activeStage === 'results'
                ? {
                    hasField: !!effectiveFieldData?.fields,
                    view: resultsView,
                    patches: Object.keys(effectiveMesh?.boundaries ?? {}).filter(
                      (b) => b !== 'frontAndBack',
                    ),
                    probePicking,
                    onToggleProbePicking: () => {
                      setPickingPointsState(null);
                      setClipPicking(null);
                      setTrackPicking(null);
                      setProbePicking((v) => !v);
                    },
                    clipPicking: !!clipPicking,
                    diffRuns: (state.solverRuns ?? [])
                      .filter((r) => r.status !== 'running' && r.status !== 'error')
                      .filter((r) => r.id !== targetRunForPlot.id)
                      .map((r) => ({ id: r.id, label: r.label })),
                    viewedRunLabel: targetRunForPlot.label ?? 'this run',
                    diffStatus,
                    onToggleClipPicking: () => {
                      setPickingPointsState(null);
                      setProbePicking(false);
                      setTrackPicking(null);
                      setClipPicking((v) => (v ? null : { p1: null }));
                    },
                    trackPicking: trackPicking?.kind ?? null,
                    onTrackPicking: (kind: 'point' | 'line') => {
                      setPickingPointsState(null);
                      setProbePicking(false);
                      setClipPicking(null);
                      setTrackPicking((v) => (v?.kind === kind ? null : { kind, p1: null }));
                    },
                    onAddBoundaryPlot: handleAddBoundaryPlot,
                    runForces: viewedRun
                      ? { label: viewedRun.label, cd: viewedRun.finalCd, cl: viewedRun.finalCl }
                      : null,
                    onSaveImage: handleSaveImage,
                  }
                : undefined
            }
          />
        </div>

        {/* Center Canvas + Floating Bottom Console Area */}
        <div className="flex-1 min-w-0 h-full relative overflow-hidden bg-surface">
          {/* Center: one shared CAD canvas; fills entire workspace without getting squished */}
          <main className="absolute inset-0 w-full h-full bg-surface overflow-hidden">
            <div ref={viewportRef} className="w-full h-full">
              <CadWorkbench2D
                displayOnly={activeStage !== 'geometry'}
                meshData={effectiveMesh}
                meshStale={meshStale}
                frozenEntities={
                  activeStage !== 'geometry' && geometryChanged && meshGeom
                    ? meshGeom.entities
                    : undefined
                }
                onTakeLatestGeometry={activeStage === 'mesh' ? takeLatestGeometry : undefined}
                blocking={blocking}
                blocksBuiltTick={blocksBuiltTick}
                onUpdateBlocking={handleUpdateBlocking}
                showBlocking={activeStage === 'mesh' && meshTopology === 'structured'}
                directionColors={directionColors}
                structuredStep={structuredStep}
                domainBroken={domainState === 'broken'}
                isMeshing={isMeshing}
                showMesh={
                  activeStage === 'mesh' || activeStage === 'solver' || activeStage === 'results'
                }
                meshOnly={activeStage === 'solver' || activeStage === 'results'}
                showField={activeStage === 'results'}
                livePreview={activeStage === 'solver' ? livePreview : null}
                fieldData={
                  activeStage === 'results' ? resultsView.displayFieldData : effectiveFieldData
                }
                resultsOverlay={activeStage === 'results' ? resultsView.overlay : null}
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
                edgeTagMap={activeStage === 'geometry' ? edgeTagMap : meshTags}
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
                isTransient={isTransientRun && viewingLatestRun}
                transientTimes={transientTimes}
                transientFrameIndex={transientFrameIndex}
                transientPlaying={transientPlaying}
                transientSpeed={transientSpeed}
                onSelectTransientFrame={selectTransientFrame}
                onToggleTransientPlay={handleToggleTransientPlay}
                onExportAnimation={() => setAnimDialog(true)}
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
                isPickingPlotPoints={
                  !!pickingPointsState || probePicking || !!clipPicking || !!trackPicking
                }
                onPickPlotPoint={
                  trackPicking
                    ? pickTrackSeed
                    : clipPicking
                      ? pickClipCorner
                      : probePicking
                        ? addProbe
                        : handlePickPlotPoint
                }
                plotPickPreviewP1={
                  trackPicking?.p1 ?? clipPicking?.p1 ?? pickingPointsState?.p1 ?? null
                }
              />
              {clipPicking && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-inverse text-on-inverse px-4 py-2 rounded flex items-center gap-3 text-xs font-medium border border-white/20">
                  <Crosshair className="w-4 h-4 text-accent" />
                  <span>
                    {clipPicking.p1
                      ? 'Click the opposite corner of the box'
                      : 'Click one corner of the box to show'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setClipPicking(null)}
                    className="px-2.5 py-0.5 rounded-sm bg-on-inverse/15 hover:bg-on-inverse/25 text-on-inverse font-semibold text-[11px] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {trackPicking && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-inverse text-on-inverse px-4 py-2 rounded flex items-center gap-3 text-xs font-medium border border-white/20">
                  <Crosshair className="w-4 h-4 text-accent" />
                  <span>
                    {trackPicking.kind === 'point'
                      ? 'Click on the field to release particles'
                      : trackPicking.p1
                        ? 'Click the other end of the line'
                        : 'Click one end of the release line'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTrackPicking(null)}
                    className="px-2.5 py-0.5 rounded-sm bg-on-inverse/15 hover:bg-on-inverse/25 text-on-inverse font-semibold text-[11px] transition-colors cursor-pointer"
                  >
                    {trackPicking.kind === 'point' ? 'Done' : 'Cancel'}
                  </button>
                </div>
              )}
              {probePicking && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-inverse text-on-inverse px-4 py-2 rounded flex items-center gap-3 text-xs font-medium border border-white/20">
                  <Crosshair className="w-4 h-4 text-accent" />
                  <span>Click on the field to add probe points</span>
                  <button
                    type="button"
                    onClick={() => setProbePicking(false)}
                    className="px-2.5 py-0.5 rounded-sm bg-on-inverse/15 hover:bg-on-inverse/25 text-on-inverse font-semibold text-[11px] transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              )}
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
            onOpenPlot={handleOpenPlot}
            flowRef={resultsView.ref}
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
        siblings={dialogSiblings}
        onNavigate={handleOpenPlot}
        flowRef={resultsView.ref}
        currentMesh={meshData}
      />

      {paletteOpen && (
        <CommandPalette open onClose={() => setPaletteOpen(false)} commands={commands} />
      )}

      {shortcutsOpen && <ShortcutsDialog open onClose={() => setShortcutsOpen(false)} />}
      <AnimationExportDialog
        open={animDialog}
        times={transientTimes}
        frame={transientFrameIndex}
        onExport={(o) => void handleExportAnimation(o)}
        onClose={() => setAnimDialog(false)}
      />
    </div>
  );
}

export default App;
