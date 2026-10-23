import React, { useState, useRef, useEffect, useCallback, useReducer, useMemo } from 'react';
import {
  MousePointer2,
  Minus,
  Circle,
  CircleDot,
  Square,
  CornerUpRight,
  Maximize2,
  Trash2,
  Layers,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Scissors,
  Spline,
  Move,
  Copy,
  RotateCcw,
  ChevronDown,
  Ruler,
  Grid3x3,
  Crosshair,
  Magnet,
  TriangleRight,
  ScanLine,
  Eraser,
  ArrowUpRight,
  Globe,
  Compass,
  Tag,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  Wind,
  Shield,
  Box,
  Sliders,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronFirst,
  ChevronLast,
  RotateCw,
  Download,
  FileCode,
  Check,
  HelpCircle,
  Loader2,
} from 'lucide-react';
import {
  requestOffset,
  requestFillet,
  requestMeshFromSketch,
  uploadAndParseAirfoil,
  uploadAndParseDxf,
  fetchAndParseAirfoilFromUrl,
} from '../../utils/api';
import { toast } from '../ui/Toast';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  BoundaryTag,
  BoundaryEdge,
  BOUNDARY_COLORS,
  Point2D,
  CadEntity,
  GeometryBBox,
  getGeometryBBox,
  validateDomainContainment,
  createDomainEntity,
  extractBoundaryEdges,
  getContiguousEdgeChains,
  ContiguousEdgeChain,
  autoSuggestBoundaryTags,
  validateBoundaryTags,
  generateDefaultAirfoilPoints,
} from '../../types/cadWorkflow';
import {
  Blocking,
  blockPolygon,
  entityRing,
  applyVertexMove,
  cleanBlocking,
  propagateNodeCounts,
  emptyBlocking,
  outlinesFor,
  snapToOutline,
  pickEdge,
  blockAt,
  blocksOverBodies,
  addBlockFromCorners,
  makeTagLookup,
  deleteBlock,
  splitSheet,
  currentCellSize,
  autoCellSize,
  checkBlocking,
  curveOf,
  projectOnCurve,
  constrainToCurves,
  initializeBlocking,
  associateEdges,
  disassociateEdges,
  snapProjectVertices,
  mergeVertices,
  mergeBlocks,
  ogridBlock,
  setEdgeParams,
} from '../../types/blocking';
import { useMeshGL, type MeshGLScene } from './useMeshGL';
import { arrayRange } from '../../utils/numeric';

import type {
  CadTool,
  GuideLine,
  Snap,
  DynamicDimPrompt,
  CadState,
  CadWorkbenchProps,
} from './workbenchCore';
import {
  SNAP_RADIUS_PX,
  INITIAL_ZOOM,
  DEFAULT_SNAP_SETTINGS,
  POLAR_STEP_CHOICES,
  SNAP_LABELS,
  loadSnapSettings,
  saveSnapSettings,
  computeSnapPoint,
  cadReducer,
  meshEdgeSets,
  meshSkewness,
  colormapRGB,
  uid,
  moveEntityVertex,
  translateEntity,
  dist,
  pointInPolygon,
  distToSegment,
  getMapScaleInfo,
  pointsToLineSegments,
  getTrimTarget,
} from './workbenchCore';
import type { SnapSettings } from './workbenchCore';

// Fill colors cycled by block index for the Mesh-view direction-coloring
// overlay (one color per block, so the block layout reads at a glance on the
// real generated mesh, not just the block diagram).
const EMPTY_EDGES = new Uint32Array(0);

const BLOCK_FILL_CYCLE = [
  '#2563EB',
  '#DC2626',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#0891B2',
  '#65A30D',
];

function nodesBBox(nodes: number[][]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n[0] < minX) minX = n[0];
    if (n[0] > maxX) maxX = n[0];
    if (n[1] < minY) minY = n[1];
    if (n[1] > maxY) maxY = n[1];
  }
  return { minX, maxX, minY, maxY };
}

/** Boolean snap modes - everything in SnapSettings except the polar step. */
type SnapBoolKey = Exclude<keyof SnapSettings, 'polarStepDeg'>;

const CadWorkbench2DComponent: React.FC<CadWorkbenchProps> = ({
  onApplySketchMesh,
  domainLength,
  domainHeight,
  resolution,
  firstLayerMm,
  pendingImportFile,
  onClearPendingImport,
  currentStep = 1,
  flowType = 'external',
  domainShape = 'rectangle',
  upstreamChordFactor = 10,
  setUpstreamChordFactor,
  downstreamChordFactor = 20,
  setDownstreamChordFactor,
  lateralHeightFactor = 10,
  setLateralHeightFactor,
  geometryBBox: propGeometryBBox,
  angleOfAttackDeg = 0.0,
  setAngleOfAttackDeg,
  freestreamVelocity = 35.0,
  activeTagTool = null,
  edgeTagMap: propEdgeTagMap,
  onSetEdgeTagMap,
  onEntitiesChange,
  onRequestGenerateDomainRef,
  onRequestSetSelectedAsDomainRef,
  onRequestSetSelectedAsGeometryRef,
  onRequestSelectAllGeometryRef,
  onRequestClearGeometryRef,
  onRequestAutoSuggestTagsRef,
  onRequestMeshHandoffRef,
  onRequestDownloadBlockMeshDictRef,
  cadName: propCadName,
  onCadNameChange,
  initialEntities,
  displayOnly = false,
  meshData,
  showMesh = false,
  meshOnly = false,
  showField = false,
  fieldData,
  livePreview = null,
  activeField = 'U_mag',
  colormap = 'coolwarm',
  meshStale = false,
  domainBroken = false,
  isMeshing = false,
  blocking = null,
  onUpdateBlocking,
  showBlocking = false,
  blocksBuiltTick = 0,
  directionColors = null,
  blockMode = 'auto',
  isTransient = false,
  transientTimes = [],
  transientFrameIndex = 0,
  transientPlaying = false,
  transientSpeed = 1.0,
  onSelectTransientFrame,
  onToggleTransientPlay,
  onSelectTransientSpeed,
  historicalStatus,
  onRestoreLive,
  activePlotLine = null,
  isPickingPlotPoints = false,
  onPickPlotPoint,
  plotPickPreviewP1 = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── GPU mesh rendering ────────────────────────────────────────────────────
  // A second canvas under the main one draws every mesh view (plain, block
  // colours, quality, live preview, Results field) on the GPU. The Canvas 2D
  // per-cell loop only runs as a fallback when WebGL2 is unavailable.
  const {
    canvasRef: glCanvasRef,
    updateGeometry: glUpdateGeometry,
    render: glRender,
  } = useMeshGL();

  // ── Domain Handle Dragging State ──
  const [hoveredDomainHandle, setHoveredDomainHandle] = useState<
    'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null
  >(null);
  const draggingDomainHandleRef = useRef<
    'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null
  >(null);
  const [draggingDomainHandle, setDraggingDomainHandle] = useState<
    'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null
  >(null);
  const [domainAnimScale, setDomainAnimScale] = useState<number>(1.0);

  // ── Flow Vector AoA Dial Handle State ──
  const [hoveredAoAHandle, setHoveredAoAHandle] = useState<boolean>(false);
  const [draggingAoAHandle, setDraggingAoAHandle] = useState<boolean>(false);

  // ── Undo/Redo stack ─────────────────────────────────────────────────────────
  const historyRef = useRef<CadState[]>([]);
  const historyIdxRef = useRef<number>(-1);
  // Structured block-vertex drag state + blocking undo history (declared here so
  // the fit logic and the CAD-history effect can both see them).
  const blockDrag = useRef<{ vid: string; origin: Point2D; recorded?: boolean } | null>(null);
  const blockSnapGuides = useRef<{ a: Point2D; b: Point2D }[]>([]);
  const blockUndoRef = useRef<(Blocking | null)[]>([]);
  const blockRedoRef = useRef<(Blocking | null)[]>([]);
  const prevBlockingRef = useRef<Blocking | null>(blocking);
  const lastEditRef = useRef<'cad' | 'blocks'>('cad');

  const [cadState, dispatch] = useReducer(cadReducer, {
    entities: initialEntities && initialEntities.length > 0 ? initialEntities : [],
  });

  // Sync initial entities if provided when local state is empty
  useEffect(() => {
    if (initialEntities && initialEntities.length > 0 && cadState.entities.length === 0) {
      dispatch({ type: 'REPLACE_ENTITIES', entities: initialEntities });
    }
  }, [initialEntities]);

  // Whenever cadState changes, push to history & notify parent
  useEffect(() => {
    const h = historyRef.current;
    const idx = historyIdxRef.current;
    if (draggingDomainHandleRef.current && idx >= 0) {
      // Overwrite current history frame during continuous drag to prevent undo stack bloating
      h[idx] = { entities: cadState.entities.map((e) => ({ ...e })) };
    } else {
      // Truncate forward history on new action
      h.splice(idx + 1);
      h.push({ entities: cadState.entities.map((e) => ({ ...e })) });
      historyIdxRef.current = h.length - 1;
      if (h.length > 1) lastEditRef.current = 'cad'; // a real CAD edit (not the first seed)
    }
    onEntitiesChange?.(cadState.entities);
  }, [cadState.entities, onEntitiesChange]);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    dispatch({
      type: 'REPLACE_ENTITIES',
      entities: historyRef.current[historyIdxRef.current].entities,
    });
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    dispatch({
      type: 'REPLACE_ENTITIES',
      entities: historyRef.current[historyIdxRef.current].entities,
    });
  }, []);

  // ── Tool state ──────────────────────────────────────────────────────────────
  const [tool, setTool] = useState<CadTool>('select');
  const [tempPts, setTempPts] = useState<Point2D[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // ── Camera ──────────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  // Live canvas size - watched so a layout change (the solver monitor rail
  // pushing the canvas, a window resize) re-renders and re-frames the view.
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  // 'cad' shows CAD entities / structured blocks, 'mesh' shows the generated mesh.
  // Declared early - the fit / render logic reads it.
  const [canvasMode, setCanvasMode] = useState<'cad' | 'mesh'>('cad');
  const panning = useRef(false);
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef<Point2D | null>(null);

  useEffect(
    () => () => {
      if (panRafRef.current) cancelAnimationFrame(panRafRef.current);
    },
    [],
  );

  // ── Undo/redo: routed to whichever - CAD entities or the blocking - was last edited.
  //    Refs are declared up by the CAD history stack; the recording effect lives here
  //    (after blockDrag) so it can coalesce a drag into one undo entry. ─────────────
  useEffect(() => {
    const prev = prevBlockingRef.current;
    prevBlockingRef.current = blocking;
    if (prev === blocking) return;
    lastEditRef.current = 'blocks';
    if (blockDrag.current) {
      if (!blockDrag.current.recorded) {
        blockDrag.current.recorded = true;
        blockUndoRef.current.push(prev);
        blockRedoRef.current = [];
      }
      return;
    }
    blockUndoRef.current.push(prev);
    blockRedoRef.current = [];
    if (blockUndoRef.current.length > 80) blockUndoRef.current.shift();
  }, [blocking]);
  const undoBlocking = useCallback((): boolean => {
    if (!blockUndoRef.current.length || !onUpdateBlocking) return false;
    const target = blockUndoRef.current.pop()!;
    blockRedoRef.current.push(prevBlockingRef.current);
    prevBlockingRef.current = target; // pre-set so the effect above no-ops
    onUpdateBlocking(target);
    return true;
  }, [onUpdateBlocking]);
  const redoBlocking = useCallback((): boolean => {
    if (!blockRedoRef.current.length || !onUpdateBlocking) return false;
    const target = blockRedoRef.current.pop()!;
    blockUndoRef.current.push(prevBlockingRef.current);
    prevBlockingRef.current = target;
    onUpdateBlocking(target);
    return true;
  }, [onUpdateBlocking]);
  const panStart = useRef<Point2D>({ x: 0, y: 0 });
  const panOrigin = useRef<Point2D>({ x: 0, y: 0 });
  const lastMiddleClickRef = useRef(0);


  // ── Camera Framing Helper ───────────────────────────────────────────────────
  const fitBoundingBox = useCallback(
    (
      box: { minX: number; maxX: number; minY: number; maxY: number },
      marginRatio = 0.7,
    ): boolean => {
      const canvas = canvasRef.current;
      const cw =
        (canvas && canvas.clientWidth > 0 ? canvas.clientWidth : 0) ||
        (containerRef.current && containerRef.current.clientWidth > 0
          ? containerRef.current.clientWidth
          : 0) ||
        viewport.w ||
        0;
      const ch =
        (canvas && canvas.clientHeight > 0 ? canvas.clientHeight : 0) ||
        (containerRef.current && containerRef.current.clientHeight > 0
          ? containerRef.current.clientHeight
          : 0) ||
        viewport.h ||
        0;

      if (!cw || !ch || cw < 50 || ch < 50) return false;

      if (
        !isFinite(box.minX) ||
        !isFinite(box.maxX) ||
        !isFinite(box.minY) ||
        !isFinite(box.maxY) ||
        box.maxX < box.minX ||
        box.maxY < box.minY
      ) {
        return false;
      }

      // Get bottom drawer overlay height if present
      const bottomBarPx =
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--app-bottom-bar'),
        ) || 32;
      // Visible canvas height above the bottom console drawer
      const visibleH = Math.max(100, ch - bottomBarPx);

      const w = Math.max(0.01, box.maxX - box.minX);
      const h = Math.max(0.01, box.maxY - box.minY);
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;

      const availW = cw * marginRatio;
      const availH = visibleH * marginRatio;
      const newZoom = Math.max(0.5, Math.min(25000, Math.min(availW / w, availH / h)));

      const newPan = {
        x: -cx * newZoom,
        y: cy * newZoom,
      };

      setZoom(newZoom);
      setPan(newPan);
      return true;
    },
    [viewport.w, viewport.h],
  );

  // Watch the canvas box; re-render + re-frame when the layout changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0].contentRect;
      setViewport((prev) =>
        Math.abs(prev.w - cr.width) > 1 || Math.abs(prev.h - cr.height) > 1
          ? { w: cr.width, h: cr.height }
          : prev,
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitCurrentContent = useCallback(() => {
    if (blockDrag.current || panning.current) return;
    const useMesh = (canvasMode === 'mesh' || meshOnly) && meshData?.nodes?.length;
    const ents = cadState.entities.filter((e) => e.layer !== 'construction');
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    if (useMesh) {
      for (const n of meshData.nodes as number[][]) {
        minX = Math.min(minX, n[0]);
        maxX = Math.max(maxX, n[0]);
        minY = Math.min(minY, n[1]);
        maxY = Math.max(maxY, n[1]);
      }
    } else {
      for (const e of ents)
        for (const p of e.pts) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
    }
    if (minX !== Infinity) fitBoundingBox({ minX, maxX, minY, maxY }, 0.75);
  }, [cadState.entities, meshData, canvasMode, meshOnly, fitBoundingBox]);

  // Keep the latest fit fn in a ref so the framing effects can call it without
  // taking it as a dependency (which would re-fire on every entity edit).
  const fitRef = useRef(fitCurrentContent);
  fitRef.current = fitCurrentContent;

  // Re-frame ONLY when landing on the Results view - never just from switching
  // stage tabs (Geometry/Mesh/Solver) or from a mesh finishing generation,
  // and never on an entity edit or a domain-slider drag. The user finds an
  // automatic recentre while iterating on geometry/mesh disorienting; Results
  // is the one view where showing the whole field is the point of arriving
  // there. Explicit reframes ("Generate domain", double middle-click, the fit
  // button) still work regardless.
  const fitKey = useMemo(() => {
    return meshOnly ? (showField ? 'results' : 'solver') : canvasMode;
  }, [meshOnly, showField, canvasMode]);
  useEffect(() => {
    if (isDrawing || draggingDomainHandleRef.current) return;
    if (fitKey !== 'results') return;
    const id = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // When opening a project from the projects window with geometry already in the session,
  // frame that geometry once so it is comfortably visible instead of centering on (0, 0).
  const hasAutoCenteredInitialRef = useRef(false);
  const userInteractedRef = useRef(false);
  useEffect(() => {
    if (hasAutoCenteredInitialRef.current || userInteractedRef.current) return;

    const canvas = canvasRef.current;
    const cw =
      (canvas && canvas.clientWidth > 0 ? canvas.clientWidth : 0) ||
      (containerRef.current && containerRef.current.clientWidth > 0
        ? containerRef.current.clientWidth
        : 0) ||
      viewport.w ||
      0;
    const ch =
      (canvas && canvas.clientHeight > 0 ? canvas.clientHeight : 0) ||
      (containerRef.current && containerRef.current.clientHeight > 0
        ? containerRef.current.clientHeight
        : 0) ||
      viewport.h ||
      0;

    // Wait until layout has completed and canvas has non-trivial dimensions
    if (cw < 50 || ch < 50) return;

    const entities =
      cadState.entities.length > 0
        ? cadState.entities
        : initialEntities && initialEntities.length > 0
          ? initialEntities
          : [];

    const geomEnts = entities.filter(
      (e) => e.layer !== 'construction' && e.pts && e.pts.length > 0,
    );
    if (geomEnts.length === 0) return;

    // We prefer framing actual geometry entities (e.g. airfoil, obstacle, body) if present,
    // falling back to whatever non-construction geometry is loaded (which may include domain).
    const actualGeom = geomEnts.filter((e) => e.role !== 'domain_boundary');
    const targetEnts = actualGeom.length > 0 ? actualGeom : geomEnts;

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const ent of targetEnts) {
      if (ent.type === 'circle' && typeof ent.radius === 'number' && ent.pts[0]) {
        const c = ent.pts[0];
        const r = ent.radius;
        minX = Math.min(minX, c.x - r);
        maxX = Math.max(maxX, c.x + r);
        minY = Math.min(minY, c.y - r);
        maxY = Math.max(maxY, c.y + r);
      } else if (
        ent.type === 'ellipse' &&
        typeof ent.rx === 'number' &&
        typeof ent.ry === 'number' &&
        ent.pts[0]
      ) {
        const c = ent.pts[0];
        const rx = ent.rx;
        const ry = ent.ry;
        const rot = ent.rotation || 0;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const hw = Math.sqrt((rx * cosR) ** 2 + (ry * sinR) ** 2);
        const hh = Math.sqrt((rx * sinR) ** 2 + (ry * cosR) ** 2);
        minX = Math.min(minX, c.x - hw);
        maxX = Math.max(maxX, c.x + hw);
        minY = Math.min(minY, c.y - hh);
        maxY = Math.max(maxY, c.y + hh);
      } else {
        for (const p of ent.pts) {
          if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
          if (!isFinite(p.x) || !isFinite(p.y)) continue;
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
    }

    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      return;
    }

    if (maxX === minX) {
      minX -= 0.5;
      maxX += 0.5;
    }
    if (maxY === minY) {
      minY -= 0.5;
      maxY += 0.5;
    }

    const applied = fitBoundingBox({ minX, maxX, minY, maxY }, 0.72);
    if (applied) {
      hasAutoCenteredInitialRef.current = true;
    }
  }, [cadState.entities, initialEntities, viewport.w, viewport.h, fitBoundingBox]);

  // A layout change (e.g. the residuals rail opening when Run is clicked)
  // used to auto-refit here, which is exactly the kind of unwanted recentre
  // the user does not want outside of explicitly landing on Results - removed.

  // When switching between steps (e.g. to Step 2, Step 3), reset to 'select' tool by default
  useEffect(() => {
    setTool('select');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setManualDim(false);
    setCmdText('Switched to Select mode. Drag or click domain / boundary controls.');
  }, [currentStep]);

  // ── Snap ────────────────────────────────────────────────────────────────────
  const [snap, setSnap] = useState<Snap>({ pt: { x: 0, y: 0 }, type: 'grid' });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [ortho, setOrtho] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  // Per-browser drafting preferences (which inferences are armed, polar step,
  // grid snap). Persisted so a user's habits survive a reload. This is the
  // single source of truth for "grid snap" as well - the toolbar and the
  // drafting popover both edit it.
  const [snapSettings, setSnapSettings] = useState<SnapSettings>(() => loadSnapSettings());
  const [draftingOpen, setDraftingOpen] = useState(false);
  const draftingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    saveSnapSettings(snapSettings);
  }, [snapSettings]);
  // Dismiss the drafting popover on an outside click or Escape (keyboard users).
  useEffect(() => {
    if (!draftingOpen) return;
    const onDown = (e: MouseEvent) => {
      if (draftingRef.current && !draftingRef.current.contains(e.target as Node)) {
        setDraftingOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDraftingOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [draftingOpen]);

  // Pick a sensible canvas mode when the STAGE changes; after that the user
  // drives it with the Blocks / Mesh / Quality toggle (a stale mesh no longer
  // yanks the view around while you edit blocks).
  const lastViewStageRef = useRef('');
  useEffect(() => {
    const st = meshOnly ? 'meshOnly' : !showMesh ? 'cad' : showBlocking ? 'blocks' : 'unstructured';
    if (st === lastViewStageRef.current) return;
    lastViewStageRef.current = st;
    if (st === 'meshOnly' || st === 'unstructured') setCanvasMode('mesh');
    else if (st === 'cad') setCanvasMode('cad');
    else setCanvasMode(meshData?.nodes?.length && meshData?.elements?.length ? 'mesh' : 'cad');
  }, [meshOnly, showMesh, showBlocking, meshData]);

  // Building / rebuilding blocks jumps to the Blocks view.
  useEffect(() => {
    if (blocksBuiltTick > 0 && showBlocking && !meshOnly) setCanvasMode('cad');
  }, [blocksBuiltTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a mesh is freshly generated, jump to the mesh view to show it.
  const prevMeshCountRef = useRef(0);
  useEffect(() => {
    const c = meshData?.nodes?.length ?? 0;
    const wasEmpty = prevMeshCountRef.current === 0;
    prevMeshCountRef.current = c;
    if (c > 0 && wasEmpty && !meshOnly && showMesh) setCanvasMode('mesh');
  }, [meshData, meshOnly, showMesh]);

  const [showMeshWireframe, setShowMeshWireframe] = useState(false); // toggle mesh overlay in Results

  // The GL scene is described here and rendered by the effect below, which
  // sits after the mesh-derived memos it reads (skewness, block colours).

  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      userInteractedRef.current = true;
      if (e.button !== 1) return;
      e.preventDefault();
      const now = Date.now();
      const isDoubleMiddleClick = now - lastMiddleClickRef.current < 350;
      lastMiddleClickRef.current = now;
      if (!isDoubleMiddleClick) return;

      if (showMesh && canvasMode === 'mesh' && meshData?.nodes?.length) {
        fitBoundingBox(nodesBBox(meshData.nodes), 0.72);
        return;
      }

      const entities = cadState.entities.filter((entity) => entity.layer !== 'construction');
      const points = entities.flatMap((entity) => entity.pts);
      if (points.length) {
        fitBoundingBox(
          {
            minX: Math.min(...points.map((point) => point.x)),
            maxX: Math.max(...points.map((point) => point.x)),
            minY: Math.min(...points.map((point) => point.y)),
            maxY: Math.max(...points.map((point) => point.y)),
          },
          0.72,
        );
      } else {
        setZoom(INITIAL_ZOOM);
        setPan({ x: 0, y: 0 });
      }
    },
    [cadState.entities, canvasMode, fitBoundingBox, meshData, showMesh],
  );
  const [showConstruction, setShowConstruction] = useState(true);
  const [constructionMode, setConstructionMode] = useState(false); // draw to construction layer
  const [showResultsStreamlines, setShowResultsStreamlines] = useState(true); // toggle streamlines overlay in Results
  const [showMeshQuality, setShowMeshQuality] = useState(false); // colour cells by skewness in the Mesh tab
  const [liveField, setLiveField] = useState<'U_mag' | 'p' | 'k' | null>('U_mag'); // solver live preview - null means no field colouring
  const [liveMeshOn, setLiveMeshOn] = useState(true); // solver live preview - independent mesh wireframe toggle

  const liveContext = meshOnly && !showField && !!livePreview;
  const liveVals =
    liveContext && liveField !== null && Array.isArray(livePreview!.fields[liveField])
      ? livePreview!.fields[liveField]
      : null;
  const liveRange = livePreview?.ranges?.[liveField as string] ?? [0, 1];
  // In the live-preview context, nothing is drawn at all once both the mesh
  // wireframe and the field colouring are switched off.
  const liveHasContent = !liveContext || liveMeshOn || liveField !== null;

  // Per-cell skewness (parallel to meshData.elements). Only computed while
  // the Mesh-stage Quality view needs it, then cached for that mesh.
  const qualityWanted = showMeshQuality && !meshOnly;
  const meshSkew = useMemo<Float32Array | null>(() => {
    const nodes: number[][] | undefined = meshData?.nodes;
    const els: number[][] | undefined = meshData?.elements;
    if (!qualityWanted || !Array.isArray(nodes) || !Array.isArray(els) || els.length === 0) {
      return null;
    }
    return meshSkewness(nodes, els);
  }, [meshData?.nodes, meshData?.elements, qualityWanted]);

  // Per-element block-fill color for the direction-coloring overlay: which
  // block's color each generated cell should fill with, found from the
  // element's own centroid against the block polygons. Deliberately recolors
  // the REAL mesh cells (exact, by construction) rather than overlaying a
  // separate translucent block-shaped polygon on top of them - the latter
  // was built from the idealized blocking edge path, which can disagree with
  // where the backend actually put the real mesh nodes by a cell's width at
  // a wall kink too shallow for the mesh's own corner-preservation to snap
  // onto exactly, leaving a sliver of the overlay sitting outside the real
  // mesh (looked like a stray "bevel" at the kink).
  // Only built while direction colouring is on.
  const elementBlockColor = useMemo<(string | null)[] | null>(() => {
    const nodes: number[][] | undefined = meshData?.nodes;
    const elements: number[][] | undefined = meshData?.elements;
    if (!directionColors) return null;
    if (!Array.isArray(nodes) || !Array.isArray(elements) || elements.length === 0) return null;
    if (!blocking || blocking.blocks.length === 0) return null;
    const polys = blocking.blocks
      .map((blk, i) => {
        const poly = blockPolygon(blocking, blk);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const q of poly) {
          if (q.x < x0) x0 = q.x;
          if (q.x > x1) x1 = q.x;
          if (q.y < y0) y0 = q.y;
          if (q.y > y1) y1 = q.y;
        }
        return { poly, x0, x1, y0, y1, color: BLOCK_FILL_CYCLE[i % BLOCK_FILL_CYCLE.length] };
      })
      .filter((p) => p.poly.length >= 3);
    if (!polys.length) return null;
    const out: (string | null)[] = new Array(elements.length).fill(null);
    const c = { x: 0, y: 0 };
    for (let e = 0; e < elements.length; e++) {
      const el = elements[e];
      let sx = 0;
      let sy = 0;
      let ok = true;
      for (let i = 0; i < el.length; i++) {
        const nd = nodes[el[i]];
        if (!nd) {
          ok = false;
          break;
        }
        sx += nd[0];
        sy += nd[1];
      }
      if (!ok) continue;
      c.x = sx / el.length;
      c.y = sy / el.length;
      for (const p of polys) {
        if (c.x < p.x0 || c.x > p.x1 || c.y < p.y0 || c.y > p.y1) continue;
        if (pointInPolygon(c, p.poly)) {
          out[e] = p.color;
          break;
        }
      }
    }
    return out;
  }, [meshData?.nodes, meshData?.elements, blocking, directionColors]);

  // Unique + exterior edges, once per mesh. The GPU wireframe draws `all`;
  // the 2D overlay strokes `boundary` (domain outline and holes).
  const meshEdges = useMemo(() => {
    const nodes: number[][] | undefined = meshData?.nodes;
    const elements: number[][] | undefined = meshData?.elements;
    if (!Array.isArray(nodes) || !Array.isArray(elements) || elements.length === 0) return null;
    return meshEdgeSets(elements, nodes.length);
  }, [meshData?.nodes, meshData?.elements]);
  const meshBoundaryEdges = meshEdges?.boundary ?? EMPTY_EDGES;

  // ── WebGL geometry upload: fires once per mesh change ────────────────────────
  const [glReady, setGlReady] = useState(false);
  useEffect(() => {
    if (!meshData?.nodes?.length || !meshData?.elements?.length || !glCanvasRef.current) {
      setGlReady(false);
      return;
    }
    const ok = glUpdateGeometry(meshData.nodes, meshData.elements, meshEdges?.all);
    setGlReady(ok);
  }, [meshData?.nodes, meshData?.elements, meshEdges, glCanvasRef.current, glUpdateGeometry]);

  // What the GPU should draw for the current mesh view. Mirrors the Canvas 2D
  // fallback branches below (live preview, quality, Results field, plain /
  // block-coloured mesh) so both paths look the same.
  const glScene = useMemo<MeshGLScene>(() => {
    const nodes: number[][] | undefined = meshData?.nodes;
    const elements: number[][] | undefined = meshData?.elements;
    const hidden: MeshGLScene = { visible: false, fill: { kind: 'solid', color: [1, 1, 1, 1] }, wire: null };
    if (
      !displayOnly ||
      !showMesh ||
      !liveHasContent ||
      canvasMode !== 'mesh' ||
      !nodes?.length ||
      !elements?.length
    ) {
      return hidden;
    }
    const vals: number[] | undefined = showField ? fieldData?.fields?.[activeField] : undefined;
    const haveField = Array.isArray(vals) && vals.length === nodes.length;
    const qualityMode = !showField && !meshOnly && showMeshQuality && !!meshSkew;
    const liveMode = !!liveVals && liveVals.length === elements.length && !qualityMode;

    if (liveMode) {
      const lo = Number(liveRange[0]);
      return {
        visible: true,
        fill: { kind: 'cell', vals: liveVals!, lo, hi: Number(liveRange[1]), colormap },
        wire: liveMeshOn ? [1, 1, 1, 0.28] : null,
      };
    }
    if (qualityMode) {
      return {
        visible: true,
        fill: { kind: 'cell', vals: meshSkew!, lo: 0, hi: 1, colormap: 'quality' },
        wire: [1, 1, 1, 0.35],
      };
    }
    if (haveField) {
      let lo = 0;
      let hi = 1;
      const r = fieldData?.ranges?.[activeField];
      if (Array.isArray(r) && r.length === 2 && r[0] !== r[1]) {
        [lo, hi] = r;
      } else {
        [lo, hi] = arrayRange(vals!);
      }
      return {
        visible: true,
        fill: { kind: 'node', vals: vals!, lo, hi, colormap },
        wire: showMeshWireframe ? [1, 1, 1, 0.3] : null,
      };
    }
    // #CBD5E1 lines over white (or block-tinted) cells. Slightly translucent:
    // GL lines are a full pixel wide where the 2D path drew 0.65px.
    const wire: [number, number, number, number] = [203 / 255, 213 / 255, 225 / 255, 0.8];
    if (directionColors && elementBlockColor) {
      return {
        visible: true,
        fill: { kind: 'cellRGBA', colors: elementBlockColor, alpha: 0x26 / 255, base: [1, 1, 1, 1] },
        wire,
      };
    }
    return { visible: true, fill: { kind: 'solid', color: [1, 1, 1, 1] }, wire };
  }, [
    meshData?.nodes,
    meshData?.elements,
    displayOnly,
    showMesh,
    liveHasContent,
    canvasMode,
    showField,
    fieldData,
    activeField,
    meshOnly,
    showMeshQuality,
    meshSkew,
    liveVals,
    liveRange,
    liveMeshOn,
    colormap,
    showMeshWireframe,
    directionColors,
    elementBlockColor,
  ]);
  const glMeshActive = glReady && glScene.visible;

  useEffect(() => {
    if (!glReady) return;
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    glRender(glScene, {
      pan,
      zoom,
      width: canvas.clientWidth || (containerRef.current?.clientWidth ?? 800),
      height: canvas.clientHeight || (containerRef.current?.clientHeight ?? 600),
    });
  }, [glReady, glScene, pan, zoom, viewport.w, viewport.h, glRender, glCanvasRef]);

  // Triangle / quad counts for the mesh stats badge. Memoised: counting on
  // every render walked the whole element list on each pan and hover.
  const meshCellCounts = useMemo(() => {
    const elements: number[][] = Array.isArray(meshData?.elements) ? meshData.elements : [];
    let triangles = 0;
    let quads = 0;
    for (const el of elements) {
      if (el.length === 3) triangles++;
      else if (el.length === 4) quads++;
    }
    return { triangles, quads };
  }, [meshData?.elements]);

  const meshSkewStats = useMemo(() => {
    if (!meshSkew || meshSkew.length === 0) return null;
    const sorted = meshSkew.slice().sort();
    let poor = 0;
    for (let i = 0; i < meshSkew.length; i++) if (meshSkew[i] > 0.8) poor++;
    return {
      max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length * 0.5)],
      poor,
      poorPct: (100 * poor) / meshSkew.length,
    };
  }, [meshSkew]);

  // ── Op parameters ───────────────────────────────────────────────────────────
  const [filletR, setFilletR] = useState(0.05);
  const [offsetD, setOffsetD] = useState(0.05);
  const [localCadName, setLocalCadName] = useState('2D Profile');
  const cadName = propCadName ?? localCadName;
  const setCadName = onCadNameChange ?? setLocalCadName;

  const [isLoading, setIsLoading] = useState(false);
  const [cmdText, setCmdText] = useState('Pick a tool or press L / P / R / C to start drawing.');
  const [meshToastVisible, setMeshToastVisible] = useState(false);
  const [meshProgress, setMeshProgress] = useState(0);
  const meshWasActiveRef = useRef(false);

  useEffect(() => {
    if (isMeshing) {
      meshWasActiveRef.current = true;
      setMeshToastVisible(true);
      setMeshProgress((value) => Math.max(value, 8));
      const progressTimer = window.setInterval(() => {
        setMeshProgress((value) => Math.min(94, value + Math.max(0.5, (94 - value) * 0.06)));
      }, 140);
      return () => window.clearInterval(progressTimer);
    }

    if (meshWasActiveRef.current) {
      setMeshProgress(100);
      const fadeTimer = window.setTimeout(() => {
        setMeshToastVisible(false);
        setMeshProgress(0);
        meshWasActiveRef.current = false;
      }, 2000);
      return () => window.clearTimeout(fadeTimer);
    }
  }, [isMeshing]);

  // ── HUD ─────────────────────────────────────────────────────────────────────
  const [hud, setHud] = useState({ length: '0.000', angle: '0.0', x: '0.0000', y: '0.0000' });

  // ── Drag-to-select (marquee) ─────────────────────────────────────────────────
  const dragSelecting = useRef(false);
  const dragStart = useRef<Point2D>({ x: 0, y: 0 }); // screen pixels
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );

  // ── Direct manipulation with the Select tool: drag a vertex / move a selection
  const editDrag = useRef<
    | null
    | {
        mode: 'vertex';
        targets: { id: string; idx: number }[];
        startWorld: Point2D;
        snapshot: CadEntity[];
      }
    | { mode: 'move'; startWorld: Point2D; snapshot: CadEntity[] }
  >(null);
  const [editDragActive, setEditDragActive] = useState(false);

  // ── Structured block-vertex dragging (mesh stage, showBlocking) ────────────
  // blockDrag / blockSnapGuides are declared earlier (fit logic reads them).
  const [hoveredBlockVtx, setHoveredBlockVtx] = useState<string | null>(null);
  const [hoveredBlockIdx, setHoveredBlockIdx] = useState<number | null>(null);

  // ── Block editor (Blocks view): select / draw / split / delete tools ───────
  const [blockTool, setBlockTool] = useState<
    'select' | 'draw' | 'split' | 'delete' | 'ogrid' | 'mergeV' | 'mergeB' | 'assoc'
  >('select');
  // Leaving Manual mode must drop any mid-edit tool - otherwise a leftover
  // 'draw'/'split'/... tool keeps intercepting clicks on the Automatic canvas
  // even with its own toolbar hidden.
  useEffect(() => {
    if (blockMode !== 'manual') setBlockTool('select');
  }, [blockMode]);
  // ICEM-style tools: the first pick of a two-pick tool (merge vertices /
  // blocks), the edge selection + stage of Associate, the curve under the
  // cursor, the edge whose params are being edited, and the O-grid size.
  const [blockPick, setBlockPick] = useState<string | null>(null);
  const [assocEdges, setAssocEdges] = useState<string[]>([]);
  const [assocStage, setAssocStage] = useState<'edges' | 'curve'>('edges');
  const [hoverCurveId, setHoverCurveId] = useState<string | null>(null);
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [ogridScale, setOgridScale] = useState(0.5);
  const [blockDrawPts, setBlockDrawPts] = useState<Point2D[]>([]);
  const [blockCursor, setBlockCursor] = useState<Point2D | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [splitHover, setSplitHover] = useState<{
    edgeId: string;
    pt: Point2D;
    cut: Point2D[][];
  } | null>(null);
  const [blockMsg, setBlockMsg] = useState<{ text: string; error: boolean } | null>(null);
  const blockOutlines = useMemo(() => outlinesFor(cadState.entities), [cadState.entities]);
  const badBlockIds = useMemo(
    () => new Set(blocking ? blocksOverBodies(blocking, blockOutlines) : []),
    [blocking, blockOutlines],
  );
  // ICEM-style check: blocks reaching outside the fluid, boundary edges with no patch.
  const blockCheck = useMemo(
    () =>
      blocking?.blocks.length
        ? checkBlocking(blocking, blockOutlines)
        : { outside: [], unpatched: [] },
    [blocking, blockOutlines],
  );
  const outsideBlockIds = useMemo(() => new Set(blockCheck.outside), [blockCheck]);
  const unpatchedEdgeIds = useMemo(() => new Set(blockCheck.unpatched), [blockCheck]);
  /** Nearest geometry curve (CAD entity) within `radius`, for Associate. */
  const pickCurve = useCallback(
    (p: Point2D, radius: number): string | null => {
      let best: string | null = null;
      let bd = radius;
      for (const e of cadState.entities) {
        if (e.layer === 'construction') continue;
        const c = curveOf(e);
        if (!c) continue;
        const d = projectOnCurve(c, p).d;
        if (d < bd) {
          bd = d;
          best = e.id;
        }
      }
      return best;
    },
    [cadState.entities],
  );
  // How much of the fluid (domain minus bodies) the blocks cover: only blocked
  // area gets meshed, so a partly drawn blocking must say so.
  const blockCoverage = useMemo(() => {
    if (!blocking?.blocks.length) return null;
    const area = (q: Point2D[]) => {
      let a = 0;
      for (let i = 0; i < q.length; i++)
        a += q[i].x * q[(i + 1) % q.length].y - q[(i + 1) % q.length].x * q[i].y;
      return Math.abs(a) / 2;
    };
    const fluid = blockOutlines.reduce((acc, o) => acc + (o.body ? -area(o.pts) : area(o.pts)), 0);
    if (fluid <= 0) return null;
    const covered = blocking.blocks.reduce((acc, b) => acc + area(blockPolygon(blocking, b)), 0);
    return Math.min(1, covered / fluid);
  }, [blocking, blockOutlines]);
  // Leaving the Blocks view (or structured meshing) drops any half-drawn block.
  useEffect(() => {
    if (!showBlocking) {
      setBlockTool('select');
      setBlockDrawPts([]);
      setSelectedBlockId(null);
      setSplitHover(null);
      setBlockPick(null);
      setAssocEdges([]);
      setAssocStage('edges');
      setSelectedEdgeId(null);
    }
  }, [showBlocking]);
  useEffect(() => {
    if (selectedBlockId && !blocking?.blocks.some((b) => b.id === selectedBlockId))
      setSelectedBlockId(null);
    if (selectedEdgeId && !blocking?.edges.some((e) => e.id === selectedEdgeId))
      setSelectedEdgeId(null);
    if (assocEdges.length && blocking) {
      const live = assocEdges.filter((id) => blocking.edges.some((e) => e.id === id));
      if (live.length !== assocEdges.length) setAssocEdges(live);
    }
  }, [blocking, selectedBlockId, selectedEdgeId, assocEdges]);
  // Switching tools drops any half-finished pick.
  useEffect(() => {
    setBlockPick(null);
    setHoverCurveId(null);
    setHoverEdgeId(null);
    if (blockTool !== 'assoc') {
      setAssocEdges([]);
      setAssocStage('edges');
    }
    if (blockTool !== 'select') setSelectedEdgeId(null);
  }, [blockTool]);

  const domainRing = useMemo<Point2D[]>(() => {
    const dom = cadState.entities.find((e) => e.role === 'domain_boundary');
    if (!dom) return [];
    return dom.type === 'circle' || dom.type === 'ellipse'
      ? entityRing(dom)
      : dom.pts.map((p) => ({ ...p }));
  }, [cadState.entities]);

  /** Snap a dragged block vertex: exact snap to a geometry/domain corner or a
   *  sibling block vertex, else axis-align with a sibling (with a guide line),
   *  else grid; finally clamp inside the fluid domain so a vertex can never be
   *  dragged out of the mesh region. */
  const snapBlockVertex = useCallback(
    (raw: Point2D, draggedVid: string): { pt: Point2D; guides: { a: Point2D; b: Point2D }[] } => {
      const R = SNAP_RADIUS_PX / zoom;
      const guides: { a: Point2D; b: Point2D }[] = [];
      // An associated vertex (ICEM) is constrained to its curves.
      const dragged = draggedVid ? blocking?.vertices.find((v) => v.id === draggedVid) : undefined;
      const onAssoc = constrainToCurves(raw, dragged?.curves, cadState.entities);
      if (onAssoc) return { pt: onAssoc, guides: [] };
      const siblings = blocking?.vertices.filter((v) => v.id !== draggedVid).map((v) => v.pt) ?? [];
      const corners: Point2D[] = [];
      for (const e of cadState.entities) {
        if (e.layer === 'construction') continue;
        for (const q of e.type === 'circle' || e.type === 'ellipse' ? entityRing(e) : e.pts)
          corners.push(q);
      }

      // 1. exact snap to a corner or sibling vertex
      let hit: Point2D | null = null;
      let hd = R;
      for (const c of [...siblings, ...corners]) {
        const d = Math.hypot(c.x - raw.x, c.y - raw.y);
        if (d < hd) {
          hd = d;
          hit = c;
        }
      }
      if (hit) return { pt: { x: hit.x, y: hit.y }, guides: [] };

      // 1b. slide along the domain outline or a body, so a boundary corner
      // stays on the geometry instead of drifting off it
      const onCurve = snapToOutline(raw, blockOutlines, R * 0.8);
      if (onCurve) return { pt: onCurve.pt, guides: [] };

      // 2. axis alignment with a sibling vertex
      const pt = { x: raw.x, y: raw.y };
      let ax: number | null = null;
      let ay: number | null = null;
      let axd = R;
      let ayd = R;
      for (const c of siblings) {
        if (Math.abs(c.x - raw.x) < axd) {
          axd = Math.abs(c.x - raw.x);
          ax = c.x;
        }
        if (Math.abs(c.y - raw.y) < ayd) {
          ayd = Math.abs(c.y - raw.y);
          ay = c.y;
        }
      }
      if (ax !== null) pt.x = ax;
      if (ay !== null) pt.y = ay;

      // 3. grid snap when not otherwise constrained
      if (snapSettings.grid && ax === null && ay === null) {
        const raw40 = 40 / Math.max(zoom, 1e-6);
        const mag = Math.pow(10, Math.floor(Math.log10(raw40)));
        const n = raw40 / mag;
        let g = n >= 5 ? 5 * mag : n >= 2 ? 2 * mag : mag;
        g = Math.max(0.0002, g);
        pt.x = Math.round(pt.x / g) * g;
        pt.y = Math.round(pt.y / g) * g;
      }

      // 4. clamp inside the fluid domain
      if (domainRing.length >= 3 && !pointInPolygon(pt, domainRing)) {
        let best = domainRing[0];
        let bd = Infinity;
        for (let i = 0; i < domainRing.length; i += 1) {
          const a = domainRing[i];
          const b = domainRing[(i + 1) % domainRing.length];
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const len2 = abx * abx + aby * aby || 1;
          const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2));
          const q = { x: a.x + t * abx, y: a.y + t * aby };
          const d = Math.hypot(pt.x - q.x, pt.y - q.y);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        pt.x = best.x;
        pt.y = best.y;
        ax = ay = null;
      }

      const BIG = 1e6;
      if (ax !== null) guides.push({ a: { x: ax, y: pt.y - BIG }, b: { x: ax, y: pt.y + BIG } });
      if (ay !== null) guides.push({ a: { x: pt.x - BIG, y: ay }, b: { x: pt.x + BIG, y: ay } });
      return { pt, guides };
    },
    [zoom, cadState.entities, blocking, snapSettings.grid, domainRing, blockOutlines],
  );

  // ── Dynamic Dimension Input (Onshape / Fusion 360 style) ───────────────────
  const [dimPrompt, setDimPrompt] = useState<DynamicDimPrompt | null>(null);
  const [inputVal1, setInputVal1] = useState('');
  const [inputVal2, setInputVal2] = useState('');
  // True once the user has typed into the live (still-drawing) dimension box -
  // from then on the typed values drive the preview, not the mouse.
  const [manualDim, setManualDim] = useState(false);
  const input1Ref = useRef<HTMLInputElement>(null);
  const input2Ref = useRef<HTMLInputElement>(null);

  // ── Trim Tool Preview ───────────────────────────────────────────────────────
  const [hoveredTrim, setHoveredTrim] = useState<{
    p0: Point2D;
    p1: Point2D;
    polyline?: Point2D[];
  } | null>(null);

  // ── Fallback edgeTagMap if not controlled ──────────────────────────────────
  const [localEdgeTagMap, setLocalEdgeTagMap] = useState<Record<string, BoundaryTag>>({});
  const edgeTagMap = propEdgeTagMap ?? localEdgeTagMap;
  const setEdgeTagMap = onSetEdgeTagMap ?? setLocalEdgeTagMap;

  // ── Block editor actions ───────────────────────────────────────────────────
  const blockTag = useMemo(
    () => makeTagLookup(cadState.entities, edgeTagMap),
    [cadState.entities, edgeTagMap],
  );

  /** One click of the Draw tool: collect corners, build the block on the 4th. */
  const addBlockCorner = useCallback(
    (pt: Point2D) => {
      if (!onUpdateBlocking) return;
      const pts = [...blockDrawPts, pt];
      if (pts.length < 4) {
        setBlockDrawPts(pts);
        setBlockMsg({ text: `Corner ${pts.length} of 4 placed.`, error: false });
        return;
      }
      const base = blocking ?? emptyBlocking();
      const cellSize = base.edges.length
        ? currentCellSize(base)
        : autoCellSize({ ...base, vertices: pts.map((p, i) => ({ id: String(i), pt: p })) });
      const res = addBlockFromCorners(base, pts, {
        outlines: blockOutlines,
        tag: blockTag,
        cellSize,
      });
      setBlockDrawPts([]);
      if ('error' in res) {
        setBlockMsg({ text: res.error, error: true });
        return;
      }
      onUpdateBlocking(res.blocking);
      setSelectedBlockId(res.blocking.blocks[res.blocking.blocks.length - 1].id);
      setBlockMsg({ text: `Block ${res.blocking.blocks.length} added.`, error: false });
    },
    [blockDrawPts, blocking, onUpdateBlocking, blockOutlines, blockTag],
  );

  const splitAtHover = useCallback(() => {
    if (!blocking || !onUpdateBlocking || !splitHover) return;
    const next = splitSheet(blocking, splitHover.edgeId, splitHover.pt);
    if (!next) {
      setBlockMsg({ text: 'Cannot split there.', error: true });
      return;
    }
    onUpdateBlocking(propagateNodeCounts(next));
    setSplitHover(null);
    setBlockMsg({ text: `Split. ${next.blocks.length} blocks.`, error: false });
  }, [blocking, onUpdateBlocking, splitHover]);

  /** Apply an ICEM-style operation result, or show its error. */
  const applyBlockOp = useCallback(
    (res: Blocking | { error: string } | null, okText: string) => {
      if (!res) {
        setBlockMsg({ text: 'That operation did not apply here.', error: true });
        return false;
      }
      if ('error' in res) {
        setBlockMsg({ text: res.error, error: true });
        return false;
      }
      onUpdateBlocking?.(res);
      setBlockMsg({ text: okText, error: false });
      return true;
    },
    [onUpdateBlocking],
  );

  // Patch for an associated curve when its segments carry none (circles):
  // any tag set on that entity, else "wall" for a body.
  const curvePatch = useCallback(
    (ids: string[]): BoundaryTag | undefined => {
      for (const id of ids) {
        const key = Object.keys(edgeTagMap).find((k) => k.startsWith(`${id}_`) && edgeTagMap[k]);
        if (key) return edgeTagMap[key];
      }
      const ent = cadState.entities.find((e) => ids.includes(e.id));
      if (
        ent &&
        ent.role !== 'domain_boundary' &&
        (ent.isClosed || ent.type === 'circle' || ent.type === 'ellipse')
      )
        return 'wall' as BoundaryTag;
      return undefined;
    },
    [edgeTagMap, cadState.entities],
  );

  const associateTo = useCallback(
    (curveId: string) => {
      if (!blocking || !assocEdges.length) return;
      const res = associateEdges(
        blocking,
        assocEdges,
        [curveId],
        cadState.entities,
        blockTag,
        curvePatch,
      );
      if (
        applyBlockOp(
          res,
          `${assocEdges.length} edge${assocEdges.length > 1 ? 's' : ''} associated.`,
        )
      ) {
        setAssocEdges([]);
        setAssocStage('edges');
      }
    },
    [blocking, assocEdges, cadState.entities, blockTag, curvePatch, applyBlockOp],
  );

  const initializeBlocks = useCallback(() => {
    const bk = initializeBlocking(cadState.entities);
    if (!bk) {
      setBlockMsg({ text: 'No geometry to block.', error: true });
      return;
    }
    onUpdateBlocking?.(bk);
    setBlockTool('split');
    setBlockMsg({ text: 'Initialized 1 block.', error: false });
  }, [cadState.entities, onUpdateBlocking]);

  const snapProject = useCallback(() => {
    if (!blocking) return;
    const n = blocking.vertices.filter((v) => v.curves?.length).length;
    if (!n) {
      setBlockMsg({ text: 'No associated vertices.', error: true });
      return;
    }
    onUpdateBlocking?.(snapProjectVertices(blocking, cadState.entities));
    setBlockMsg({ text: `${n} vertices projected.`, error: false });
  }, [blocking, cadState.entities, onUpdateBlocking]);

  const deleteBlockById = useCallback(
    (id: string) => {
      if (!blocking || !onUpdateBlocking) return;
      const next = propagateNodeCounts(deleteBlock(blocking, id));
      onUpdateBlocking(next);
      setSelectedBlockId(null);
      setBlockMsg({ text: `Block deleted. ${next.blocks.length} left.`, error: false });
    },
    [blocking, onUpdateBlocking],
  );

  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [hoveredVertex, setHoveredVertex] = useState<Point2D | null>(null);

  // ── Computed Bounding Box & Domain / Boundary Validations ──────────────────
  const geometryBBox = useMemo(() => getGeometryBBox(cadState.entities), [cadState.entities]);

  const domainEntity = useMemo(
    () => cadState.entities.find((e) => e.role === 'domain_boundary') || null,
    [cadState.entities],
  );

  const domainValidation = useMemo(
    () =>
      flowType === 'external'
        ? validateDomainContainment(domainEntity, cadState.entities)
        : { valid: true, reason: 'Internal flow - duct walls serve as the domain boundary.' },
    [domainEntity, cadState.entities, flowType],
  );

  const boundaryEdges = useMemo(
    () => extractBoundaryEdges(cadState.entities, flowType, edgeTagMap),
    [cadState.entities, flowType, edgeTagMap],
  );

  const boundaryValidation = useMemo(
    () => validateBoundaryTags(boundaryEdges, flowType),
    [boundaryEdges, flowType],
  );

  // ── Dynamic Google Maps Style Scale Bar Info ──
  const scaleInfo = useMemo(() => getMapScaleInfo(zoom, 75), [zoom]);

  // ── Live Real-time Domain Synchronization ─────────────────────────────────
  // Whenever domain factors, shape, or geometry bounding box change, update the domain entity points in real time
  useEffect(() => {
    if (flowType !== 'external') return;
    const existingDomain = cadState.entities.find((e) => e.role === 'domain_boundary');
    // Only a "Generate domain" far-field loop tracks the sliders. A hand-drawn
    // loop pinned as the domain must be left exactly as the user drew it.
    if (!existingDomain || !existingDomain.autoDomain) return;

    const updatedDomain = createDomainEntity(
      domainShape,
      geometryBBox,
      upstreamChordFactor,
      downstreamChordFactor,
      lateralHeightFactor,
      existingDomain.id,
    );

    const ptsChanged =
      existingDomain.pts.length !== updatedDomain.pts.length ||
      existingDomain.type !== updatedDomain.type ||
      existingDomain.pts.some(
        (p, i) =>
          Math.abs(p.x - updatedDomain.pts[i].x) > 1e-5 ||
          Math.abs(p.y - updatedDomain.pts[i].y) > 1e-5,
      );

    if (ptsChanged) {
      dispatch({
        type: 'REPLACE_ENTITIES',
        entities: cadState.entities.map((e) =>
          e.id === existingDomain.id ? { ...updatedDomain, selected: e.selected } : e,
        ),
      });
    }
  }, [
    domainShape,
    upstreamChordFactor,
    downstreamChordFactor,
    lateralHeightFactor,
    flowType,
    geometryBBox,
    cadState.entities,
  ]);

  // ── Internal flow has no outer domain ───────────────────────────────────────
  // An auto-generated far-field box is regenerable, so drop it. A loop the user
  // DREW and pinned as the domain must never be deleted - demote it to plain
  // geometry (for internal flow the drawn walls ARE the boundary).
  useEffect(() => {
    if (flowType !== 'internal') return;
    if (!cadState.entities.some((e) => e.role === 'domain_boundary')) return;
    const next: CadEntity[] = [];
    for (const e of cadState.entities) {
      if (e.role !== 'domain_boundary') {
        next.push(e);
        continue;
      }
      if (e.autoDomain) continue; // regenerable - safe to drop
      const { role, autoDomain, ...rest } = e; // keep the drawing, clear its role
      void role;
      void autoDomain;
      next.push(rest);
    }
    dispatch({ type: 'REPLACE_ENTITIES', entities: next });
  }, [flowType, cadState.entities]);

  // Clear a stale domain-handle hover once the domain is gone.
  useEffect(() => {
    if (!domainEntity && hoveredDomainHandle) setHoveredDomainHandle(null);
  }, [domainEntity, hoveredDomainHandle]);

  // ── Global domain-handle drag (document listeners so cursor can leave canvas) ──
  useEffect(() => {
    const getBBoxAndChord = () => {
      const bbox = getGeometryBBox(cadState.entities) ?? {
        chord: 1,
        height: 0.5,
        minX: -0.5,
        maxX: 0.5,
        centerX: 0,
        centerY: 0,
      };
      return bbox;
    };

    const onMove = (e: MouseEvent) => {
      const handle = draggingDomainHandleRef.current;
      if (!handle) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const o = { x: canvas.clientWidth / 2 + pan.x, y: canvas.clientHeight / 2 + pan.y };
      const rawX = (e.clientX - rect.left - o.x) / zoom;
      const rawY = -(e.clientY - rect.top - o.y) / zoom;
      const bbox = getBBoxAndChord();
      const c = bbox.chord;
      const effH = Math.max(0.5 * c, bbox.height);
      // Snap the chord factor to 0.5c steps only while OSNAP is on; free-flow otherwise.
      const q = (f: number) =>
        Math.max(1, Math.min(100, snapEnabled ? Math.round(f * 2) / 2 : Math.round(f * 100) / 100));

      if (handle === 'upstream') {
        setUpstreamChordFactor?.(q((bbox.minX - rawX) / c));
      } else if (handle === 'downstream') {
        setDownstreamChordFactor?.(q((rawX - bbox.maxX) / c));
      } else if (handle === 'top') {
        setLateralHeightFactor?.(q((rawY - bbox.centerY) / effH));
      } else if (handle === 'bottom') {
        setLateralHeightFactor?.(q((bbox.centerY - rawY) / effH));
      } else if (handle === 'radial') {
        const factor = q(Math.hypot(rawX - bbox.centerX, rawY - bbox.centerY) / c);
        setUpstreamChordFactor?.(factor);
        setDownstreamChordFactor?.(factor);
        setLateralHeightFactor?.(factor);
      }
    };

    const onUp = () => {
      if (blockDrag.current) blockDrag.current = null;
      if (editDrag.current) {
        editDrag.current = null;
        setEditDragActive(false);
      }
      if (!draggingDomainHandleRef.current) return;
      draggingDomainHandleRef.current = null;
      setDraggingDomainHandle(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    zoom,
    pan,
    cadState.entities,
    snapEnabled,
    setUpstreamChordFactor,
    setDownstreamChordFactor,
    setLateralHeightFactor,
  ]);

  // ── World ↔ Screen ───────────────────────────────────────────────────────────
  const origin = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    return { x: c.clientWidth / 2 + pan.x, y: c.clientHeight / 2 + pan.y };
  }, [pan]);

  const toScreen = useCallback(
    (wx: number, wy: number): Point2D => {
      const o = origin();
      return { x: o.x + wx * zoom, y: o.y - wy * zoom };
    },
    [origin, zoom],
  );

  const toWorld = useCallback(
    (sx: number, sy: number): Point2D => {
      const c = canvasRef.current;
      if (!c) return { x: 0, y: 0 };
      const rect = c.getBoundingClientRect();
      const o = origin();
      return { x: (sx - rect.left - o.x) / zoom, y: -(sy - rect.top - o.y) / zoom };
    },
    [origin, zoom],
  );

  // ── Snap / inferencing ─────────────────────────────────────────────────────
  // All the Onshape/Fusion-style logic (vertex, midpoint, centre, quadrant,
  // edge-intersection, perpendicular/parallel, polar angle tracking, same-axis
  // alignment guides and grid) lives in workbenchCore/snap.ts. Here we only
  // supply the current view/state plus the viewport extent so guide lines can
  // reach across the canvas.
  const computeSnap = useCallback(
    (raw: Point2D): Snap => {
      const cw = containerRef.current?.clientWidth || 800;
      const ch = containerRef.current?.clientHeight || 600;
      return computeSnapPoint(raw, {
        entities: cadState.entities,
        tempPts,
        zoom,
        ortho,
        settings: snapSettings,
        guideExtent: (Math.max(cw, ch) / Math.max(zoom, 1e-6)) * 0.6,
        enabled: snapEnabled,
      });
    },
    [cadState.entities, snapEnabled, snapSettings, tempPts, zoom, ortho],
  );

  // ── Canvas render ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    // Reassigning width/height reallocates the backing store, so only do it
    // on an actual size change; otherwise just reset the transform.
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const o = { x: cw / 2 + pan.x, y: ch / 2 + pan.y };
    const ws = (wx: number, wy: number) => ({ x: o.x + wx * zoom, y: o.y - wy * zoom });
    const SCALE = zoom;

    // Background (the GPU canvas underneath paints the mesh when active)
    if (glMeshActive) {
      ctx.clearRect(0, 0, cw, ch);
    } else {
      ctx.fillStyle = '#FAFAFA';
      ctx.fillRect(0, 0, cw, ch);
    }

    // ─── Adaptive Dynamic Grid (down to 0.2 mm) ──────────────────────────────
    // Mesh workflow views are intended for inspecting element topology; keep
    // the CAD grid out of both the CAD and mesh render modes there.
    if (showGrid && !showMesh) {
      const rawStep = 40 / Math.max(SCALE, 1e-6);
      const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const norm = rawStep / mag;
      let minorStep = mag;
      if (norm >= 5) minorStep = 5 * mag;
      else if (norm >= 2) minorStep = 2 * mag;
      else minorStep = mag;
      minorStep = Math.max(0.0002, minorStep); // Min grid step: 0.2 mm
      const majorStep = minorStep * 5;

      const drawGridLines = (step: number, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        const screenStep = step * SCALE;
        if (screenStep < 4) return;
        const ox = ((o.x % screenStep) + screenStep) % screenStep;
        const oy = ((o.y % screenStep) + screenStep) % screenStep;
        ctx.beginPath();
        for (let x = ox; x < cw; x += screenStep) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, ch);
        }
        for (let y = oy; y < ch; y += screenStep) {
          ctx.moveTo(0, y);
          ctx.lineTo(cw, y);
        }
        ctx.stroke();
      };
      drawGridLines(minorStep, '#EBEBEB', 1);
      drawGridLines(majorStep, '#D8D8D8', 1.2);

      // Axes: X-axis in light red, Y-axis in light green
      // X-axis (y = 0 line)
      ctx.strokeStyle = '#F87171'; // Light red (tailwind red-400)
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, o.y);
      ctx.lineTo(cw, o.y);
      ctx.stroke();

      // Y-axis (x = 0 line)
      ctx.strokeStyle = '#4ADE80'; // Light green (tailwind green-400)
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(o.x, 0);
      ctx.lineTo(o.x, ch);
      ctx.stroke();

      // Axis labels
      ctx.font = '10px JetBrains Mono';
      ctx.fillStyle = '#EF4444'; // Red label for X
      ctx.fillText('X', cw - 16, o.y - 6);
      ctx.fillStyle = '#22C55E'; // Green label for Y
      ctx.fillText('Y', o.x + 6, 14);
    }

    // Mesh mode reuses this CAD canvas, including its camera, pan and zoom.
    // Only the backend mesh is drawn; fields and streamlines are intentionally absent.
    if (
      displayOnly &&
      showMesh &&
      liveHasContent &&
      canvasMode === 'mesh' &&
      meshData?.nodes?.length &&
      meshData?.elements?.length
    ) {
      const nodes = meshData.nodes;
      const elements = meshData.elements;

      // Field overlay (Results): colour each element by the mean of its nodes'
      // scalar values, normalised to the field range.
      const vals: number[] | undefined = showField ? fieldData?.fields?.[activeField] : undefined;
      const haveField = Array.isArray(vals) && vals.length === nodes.length;
      let lo = 0;
      let hi = 1;
      if (haveField) {
        const r = fieldData?.ranges?.[activeField];
        if (Array.isArray(r) && r.length === 2 && r[0] !== r[1]) {
          [lo, hi] = r;
        } else {
          [lo, hi] = arrayRange(vals as number[]);
        }
      }

      // In Results mode (showField is true), only stroke internal mesh cell edges if showMeshWireframe is enabled.
      const shouldDrawWireframe = !showField || showMeshWireframe;
      // Mesh-quality colouring is a Mesh-stage tool only - never on the solver
      // or results canvas (meshOnly), where the plain mesh / live field belongs.
      const qualityMode = !showField && !meshOnly && showMeshQuality && !!meshSkew;
      const liveMode = !!liveVals && liveVals.length === elements.length && !qualityMode;
      const liveLo = Number(liveRange[0]);
      const liveSpan = Number(liveRange[1]) - liveLo || 1;
      ctx.strokeStyle = haveField ? 'rgba(255,255,255,0.18)' : '#CBD5E1';
      ctx.lineWidth = haveField ? 0.45 : 0.65;

      // When the GPU canvas is drawing the mesh, skip the per-element loop.
      if (!glMeshActive) {
        elements.forEach((element: number[], elIdx: number) => {
          if (element.length < 3) return;
          if (element.some((ni: number) => !nodes[ni])) return; // guard: out-of-range node refs
          const points = element.map((nodeIndex: number) =>
            ws(nodes[nodeIndex][0], nodes[nodeIndex][1]),
          );

          if (liveMode) {
            // flat per-cell fill; mesh wireframe stroke is independently toggled
            const t = (liveVals![elIdx] - liveLo) / liveSpan;
            ctx.fillStyle = colormapRGB(t, colormap);
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index += 1) {
              ctx.lineTo(points[index].x, points[index].y);
            }
            ctx.closePath();
            ctx.fill();
            if (liveMeshOn) {
              ctx.strokeStyle = 'rgba(255,255,255,0.28)';
              ctx.lineWidth = 0.35;
              ctx.stroke();
            }
          } else if (qualityMode) {
            const sk = meshSkew![elIdx] ?? 0;
            ctx.fillStyle = colormapRGB(sk, 'quality');
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 0.4;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index += 1) {
              ctx.lineTo(points[index].x, points[index].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else if (haveField) {
            let s = 0;
            for (const ni of element) s += (vals as number[])[ni] ?? 0;
            const t = (s / element.length - lo) / (hi - lo);
            const col = colormapRGB(t, colormap);
            ctx.fillStyle = col;
            ctx.strokeStyle = shouldDrawWireframe ? 'rgba(255,255,255,0.30)' : col;
            ctx.lineWidth = shouldDrawWireframe ? 0.5 : 0.6;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index += 1) {
              ctx.lineTo(points[index].x, points[index].y);
            }
            ctx.closePath();
            ctx.fill();
            if (shouldDrawWireframe) ctx.stroke();
          } else {
            const blockCol = directionColors ? elementBlockColor?.[elIdx] : null;
            ctx.fillStyle = blockCol ? blockCol + '26' : '#FFFFFF';
            ctx.strokeStyle = '#CBD5E1';
            ctx.lineWidth = 0.65;
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index += 1) {
              ctx.lineTo(points[index].x, points[index].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        });
      }

      // Exterior edges explicitly show both the airfoil hole and domain edge.
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      for (let i = 0; i < meshBoundaryEdges.length; i += 2) {
        const a = meshBoundaryEdges[i];
        const b = meshBoundaryEdges[i + 1];
        if (!nodes[a] || !nodes[b]) continue; // guard: out-of-range node refs
        const p0 = ws(nodes[a][0], nodes[a][1]);
        const p1 = ws(nodes[b][0], nodes[b][1]);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      }
      ctx.stroke();

      // Streamlines overlay (Results) - only when showResultsStreamlines is toggled on
      if (
        showField &&
        showResultsStreamlines &&
        Array.isArray(fieldData?.streamlines) &&
        fieldData.streamlines.length > 0
      ) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        for (const line of fieldData.streamlines) {
          if (!Array.isArray(line) || line.length < 2) continue;
          ctx.beginPath();
          const p0 = ws(line[0][0], line[0][1]);
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < line.length; i++) {
            const pi = ws(line[i][0], line[i][1]);
            ctx.lineTo(pi.x, pi.y);
          }
          ctx.stroke();
        }
      }

      // Direction-group overlay: while the mesh-sizing step is open, trace
      // the block edges in the same colors as the Direction A/B/C cards over
      // the generated mesh (the per-cell block fill itself is painted in the
      // main element loop above, directly on the real cells, not here).
      if (directionColors && blocking && blocking.edges.length > 0) {
        for (const edge of blocking.edges) {
          // Boundary (patched) edges are already traced by the exterior-edge
          // pass above, following the mesh's own node-by-node polyline. This
          // overlay's edge.path is the coarser blocking representation of the
          // same curve - stroking both independently at a kink in the wall
          // left two not-quite-aligned lines fighting each other there. Only
          // the interior (unpatched) block seams have no other outline, so
          // only those need drawing here.
          if (edge.patch) continue;
          const v0 = blocking.vertices.find((v) => v.id === edge.v0);
          const v1 = blocking.vertices.find((v) => v.id === edge.v1);
          const col = directionColors[edge.id];
          if (!v0 || !v1 || !col) continue;
          const chain = [v0.pt, ...edge.path, v1.pt];
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.setLineDash([]);
          ctx.beginPath();
          chain.forEach((p, i) => {
            const s = ws(p.x, p.y);
            if (i === 0) ctx.moveTo(s.x, s.y);
            else ctx.lineTo(s.x, s.y);
          });
          ctx.stroke();
        }
      }

      return;
    }

    // Solver / Results: mesh only. If the mesh is not shown above, draw nothing
    // else (no CAD geometry, no domain handles, no blocking).
    if (meshOnly) {
      if (!meshData?.nodes?.length) {
        ctx.fillStyle = '#8B95A1';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No mesh yet - generate one in the Mesh tab', cw / 2, ch / 2);
      }
      return;
    }

    // ─── Entities ─────────────────────────────────────────────────────────────
    for (const e of cadState.entities) {
      const isConst = e.layer === 'construction';
      const isSel = !!e.selected;
      // A pinned domain loop draws dashed (far-field convention) from the Domain
      // step onward. In the Geometry step everything you drew is plain solid
      // geometry - no dashes.
      const isDomain = e.role === 'domain_boundary' && currentStep >= 2;

      if (isDomain) {
        ctx.strokeStyle = domainBroken ? '#DC2626' : isSel ? '#E05A00' : '#2563EB';
        ctx.lineWidth = isSel ? 2.5 : 1.8;
        ctx.setLineDash([8, 4]);
        ctx.fillStyle = domainBroken ? 'rgba(220, 38, 38, 0.04)' : 'rgba(37, 99, 235, 0.03)';
      } else {
        ctx.strokeStyle = isConst ? '#4A90D9' : isSel ? '#E05A00' : '#1A1D21';
        ctx.lineWidth = isSel ? 2.5 : isConst ? 1.2 : 1.8;
        if (isConst) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);

        if (!isConst && isSel) {
          ctx.fillStyle = 'rgba(224, 90, 0, 0.07)';
        } else if (!isConst) {
          ctx.fillStyle = 'rgba(37, 99, 235, 0.04)';
        } else {
          ctx.fillStyle = 'transparent';
        }
      }

      // Draw entity geometry
      if (e.type === 'construction' && e.pts.length === 2) {
        // Infinite reference line: extend far past the viewport in both directions.
        const a = e.pts[0],
          b = e.pts[1];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ext = 1e6;
        const ux = (dx / len) * ext,
          uy = (dy / len) * ext;
        const s0 = ws(a.x - ux, a.y - uy);
        const s1 = ws(b.x + ux, b.y + uy);
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      } else if (
        (e.type === 'line' ||
          e.type === 'polyline' ||
          e.type === 'rectangle' ||
          e.type === 'spline' ||
          e.type === 'construction') &&
        e.pts.length >= 2
      ) {
        ctx.beginPath();
        const p0 = ws(e.pts[0].x, e.pts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < e.pts.length; i++) {
          const p = ws(e.pts[i].x, e.pts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        if (e.isClosed) {
          ctx.closePath();
          ctx.fill();
        }
        ctx.stroke();

        // Endpoint grips: a small bold dot, a little fatter than the line - never
        // a big white box. On a selected entity each grip also gets a hollow
        // square so it is obvious which vertex a drag will grab.
        if (!isConst || showConstruction) {
          const editable =
            tool === 'select' && !displayOnly && !isConst && e.role !== 'domain_boundary';
          for (const pt of e.pts) {
            const ps = ws(pt.x, pt.y);
            if (isSel && editable) {
              ctx.beginPath();
              ctx.arc(ps.x, ps.y, 3.2, 0, Math.PI * 2);
              ctx.fillStyle = '#E05A00';
              ctx.fill();
              ctx.strokeStyle = '#E05A00';
              ctx.lineWidth = 1.25;
              ctx.strokeRect(ps.x - 6.5, ps.y - 6.5, 13, 13);
            } else if (editable) {
              ctx.beginPath();
              ctx.arc(ps.x, ps.y, 2.6, 0, Math.PI * 2);
              ctx.fillStyle = '#5B6472';
              ctx.fill();
            } else {
              ctx.fillStyle = isConst ? '#4A90D9' : '#888';
              ctx.beginPath();
              ctx.arc(ps.x, ps.y, 2.2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      } else if (e.type === 'circle' && e.pts.length >= 2) {
        const center = ws(e.pts[0].x, e.pts[0].y);
        const r = (e.radius ?? dist(e.pts[0], e.pts[1])) * SCALE;
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Center mark
        ctx.strokeStyle = ctx.strokeStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center.x - 5, center.y);
        ctx.lineTo(center.x + 5, center.y);
        ctx.moveTo(center.x, center.y - 5);
        ctx.lineTo(center.x, center.y + 5);
        ctx.stroke();
      } else if (e.type === 'ellipse' && e.pts.length >= 2) {
        const center = ws(e.pts[0].x, e.pts[0].y);
        const rx = (e.rx ?? dist(e.pts[0], e.pts[1])) * SCALE;
        const ry = (e.ry ?? (rx / SCALE) * 0.5) * SCALE;
        const rot = e.rotation ?? Math.atan2(e.pts[1].y - e.pts[0].y, e.pts[1].x - e.pts[0].x);
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, Math.max(0.5, rx), Math.max(0.5, ry), -rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Center mark
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center.x - 5, center.y);
        ctx.lineTo(center.x + 5, center.y);
        ctx.moveTo(center.x, center.y - 5);
        ctx.lineTo(center.x, center.y + 5);
        ctx.stroke();
      } else if (e.type === 'arc' && e.pts.length >= 3) {
        const center = ws(e.pts[0].x, e.pts[0].y);
        const r = dist(e.pts[0], e.pts[1]) * SCALE;
        const sa = e.startAngle ?? Math.atan2(-(e.pts[1].y - e.pts[0].y), e.pts[1].x - e.pts[0].x);
        const ea = e.endAngle ?? Math.atan2(-(e.pts[2].y - e.pts[0].y), e.pts[2].x - e.pts[0].x);
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, -ea, -sa); // Canvas Y-flipped
        ctx.stroke();
      }

      ctx.setLineDash([]);
    }

    // Hover: a small solid square around the SINGLE nearest vertex a click would
    // grab (Select tool). One point, not a box over the whole entity.
    if (hoveredVertex) {
      const p = ws(hoveredVertex.x, hoveredVertex.y);
      ctx.save();
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([]);
      ctx.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9);
      ctx.restore();
    }

    // ─── Temp geometry (in-progress entity) ──────────────────────────────────
    if (isDrawing && tempPts.length > 0) {
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);

      if (tool === 'circle_center_radius' && tempPts.length === 1) {
        const center = ws(tempPts[0].x, tempPts[0].y);
        const r = dist(tempPts[0], snap.pt) * SCALE;
        if (r > 0) {
          ctx.beginPath();
          ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (tool === 'ellipse_center' && tempPts.length === 1) {
        const c = ws(tempPts[0].x, tempPts[0].y);
        const cur = ws(snap.pt.x, snap.pt.y);
        const rx = dist(tempPts[0], snap.pt) * SCALE;
        const rot = Math.atan2(snap.pt.y - tempPts[0].y, snap.pt.x - tempPts[0].x);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
        if (rx > 0) {
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, rx, rx * 0.5, -rot, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (tool === 'ellipse_center' && tempPts.length === 2) {
        const c = ws(tempPts[0].x, tempPts[0].y);
        const m = ws(tempPts[1].x, tempPts[1].y);
        const rxWorld = dist(tempPts[0], tempPts[1]);
        const rot = Math.atan2(tempPts[1].y - tempPts[0].y, tempPts[1].x - tempPts[0].x);
        const ryWorld = Math.abs(
          -(snap.pt.x - tempPts[0].x) * Math.sin(rot) + (snap.pt.y - tempPts[0].y) * Math.cos(rot),
        );
        const rx = rxWorld * SCALE;
        const ry = Math.max(0.5, ryWorld * SCALE);
        ctx.beginPath();
        ctx.moveTo(c.x - (m.x - c.x), c.y - (m.y - c.y));
        ctx.lineTo(m.x, m.y);
        ctx.stroke();
        if (rx > 0) {
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, rx, ry, -rot, 0, Math.PI * 2);
          ctx.stroke();
        }
        const cur = ws(snap.pt.x, snap.pt.y);
        ctx.save();
        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
        ctx.restore();
      } else if (tool === 'rectangle' && tempPts.length === 1) {
        const a = ws(tempPts[0].x, tempPts[0].y);
        const b = ws(snap.pt.x, snap.pt.y);
        ctx.strokeRect(
          Math.min(a.x, b.x),
          Math.min(a.y, b.y),
          Math.abs(b.x - a.x),
          Math.abs(b.y - a.y),
        );
      } else {
        const p0 = ws(tempPts[0].x, tempPts[0].y);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < tempPts.length; i++) {
          const p = ws(tempPts[i].x, tempPts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        const cur = ws(snap.pt.x, snap.pt.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ─── Trim Tool Hover Preview ─────────────────────────────────────────────
    if (tool === 'trim' && hoveredTrim) {
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 3.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      if (hoveredTrim.polyline && hoveredTrim.polyline.length >= 2) {
        const pStart = ws(hoveredTrim.polyline[0].x, hoveredTrim.polyline[0].y);
        ctx.moveTo(pStart.x, pStart.y);
        for (let i = 1; i < hoveredTrim.polyline.length; i++) {
          const pt = ws(hoveredTrim.polyline[i].x, hoveredTrim.polyline[i].y);
          ctx.lineTo(pt.x, pt.y);
        }
      } else {
        const p0 = ws(hoveredTrim.p0.x, hoveredTrim.p0.y);
        const p1 = ws(hoveredTrim.p1.x, hoveredTrim.p1.y);
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Red 'X' icon at trim cut center
      let mid: Point2D;
      if (hoveredTrim.polyline && hoveredTrim.polyline.length >= 2) {
        const midPt = hoveredTrim.polyline[Math.floor(hoveredTrim.polyline.length / 2)];
        mid = ws(midPt.x, midPt.y);
      } else {
        const p0 = ws(hoveredTrim.p0.x, hoveredTrim.p0.y);
        const p1 = ws(hoveredTrim.p1.x, hoveredTrim.p1.y);
        mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      }
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mid.x - 5, mid.y - 5);
      ctx.lineTo(mid.x + 5, mid.y + 5);
      ctx.moveTo(mid.x + 5, mid.y - 5);
      ctx.lineTo(mid.x - 5, mid.y + 5);
      ctx.stroke();
    }

    // ─── Assist / Alignment / Tracking Guide Lines ───────────────────────────
    if (tool !== 'select' && snap.guides && snap.guides.length > 0) {
      for (const g of snap.guides) {
        if (g.type === 'origin') continue;
        const p1 = ws(g.from.x, g.from.y);
        const p2 = ws(g.to.x, g.to.y);
        const isAxis = g.type === 'xaxis' || g.type === 'yaxis';
        const isPolar = g.type === 'polar';
        const isExt = g.type === 'extension';

        // Amber for the sketch axes, violet for angle tracking, sky blue for
        // every other inference (vertex alignment, perpendicular, ...), and a
        // faint slate for the tracking lines through a hovered point.
        ctx.strokeStyle = isAxis
          ? '#F59E0B'
          : isPolar
            ? '#7C3AED'
            : isExt
              ? '#94A3B8'
              : '#0284C7';
        ctx.lineWidth = isExt ? 1 : 1.2;
        ctx.setLineDash(isExt ? [2, 4] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!isAxis && !isExt && g.type !== 'perpendicular') {
          // Small origin square at the tracking reference point
          ctx.fillStyle = ctx.strokeStyle;
          ctx.fillRect(p1.x - 2.5, p1.y - 2.5, 5, 5);
        }

        if (g.label) {
          ctx.font = '10px JetBrains Mono';
          ctx.fillStyle = isPolar ? '#7C3AED' : '#0284C7';
          ctx.fillText(g.label, p2.x + 6, p2.y - 4);
        }

        // For 90° perpendicular snap, draw the right-angle corner square at intersection
        if (g.type === 'perpendicular') {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy);
          if (len > 1e-3) {
            const vx = dx / len;
            const vy = dy / len;
            const ux = -vy;
            const uy = vx;
            const s = 8;
            ctx.strokeStyle = '#0284C7';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(p1.x + vx * s, p1.y + vy * s);
            ctx.lineTo(p1.x + vx * s + ux * s, p1.y + vy * s + uy * s);
            ctx.lineTo(p1.x + ux * s, p1.y + uy * s);
            ctx.stroke();
          }
        }
      }
    }

    // ─── Snap marker + label ──────────────────────────────────────────────────
    if (tool !== 'select' && snap.type !== 'grid') {
      const sp = ws(snap.pt.x, snap.pt.y);
      ctx.setLineDash([]);
      const GREEN = '#16A34A';
      const BLUE = '#0284C7';

      if (snap.type === 'origin') {
        // Amber Origin Snap Double Circle with Crosshair
        ctx.strokeStyle = '#D97706';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sp.x - 8, sp.y);
        ctx.lineTo(sp.x + 8, sp.y);
        ctx.moveTo(sp.x, sp.y - 8);
        ctx.lineTo(sp.x, sp.y + 8);
        ctx.stroke();
      } else if (snap.type === 'endpoint') {
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 1.8;
        ctx.strokeRect(sp.x - 5, sp.y - 5, 10, 10);
      } else if (snap.type === 'midpoint') {
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - 6);
        ctx.lineTo(sp.x + 6, sp.y + 5);
        ctx.lineTo(sp.x - 6, sp.y + 5);
        ctx.closePath();
        ctx.stroke();
      } else if (snap.type === 'center') {
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = GREEN;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (snap.type === 'quadrant') {
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - 6);
        ctx.lineTo(sp.x + 6, sp.y);
        ctx.lineTo(sp.x, sp.y + 6);
        ctx.lineTo(sp.x - 6, sp.y);
        ctx.closePath();
        ctx.stroke();
      } else if (snap.type === 'intersection') {
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sp.x - 5, sp.y - 5);
        ctx.lineTo(sp.x + 5, sp.y + 5);
        ctx.moveTo(sp.x + 5, sp.y - 5);
        ctx.lineTo(sp.x - 5, sp.y + 5);
        ctx.stroke();
      } else if (snap.type === 'nearest') {
        ctx.strokeStyle = BLUE;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(sp.x - 4, sp.y - 4, 8, 8);
        ctx.setLineDash([]);
      } else {
        // perpendicular / parallel / alignment / polar / tangent
        ctx.strokeStyle = snap.type === 'polar' ? '#7C3AED' : BLUE;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Name the active inference, the way Onshape/Fusion tag the cursor.
      const label = SNAP_LABELS[snap.type];
      if (label) {
        ctx.font = '10px JetBrains Mono';
        const tw = ctx.measureText(label).width;
        const lx = sp.x + 11;
        const ly = sp.y - 11;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillRect(lx - 3, ly - 10, tw + 7, 14);
        ctx.strokeStyle = '#E1E4E8';
        ctx.lineWidth = 1;
        ctx.strokeRect(lx - 3, ly - 10, tw + 7, 14);
        ctx.fillStyle = '#171A1F';
        ctx.fillText(label, lx, ly + 1);
      }
    }

    // ─── Cursor crosshair ─────────────────────────────────────────────────────
    if (tool !== 'select') {
      const sp = ws(snap.pt.x, snap.pt.y);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sp.x - 12, sp.y);
      ctx.lineTo(sp.x + 12, sp.y);
      ctx.moveTo(sp.x, sp.y - 12);
      ctx.lineTo(sp.x, sp.y + 12);
      ctx.stroke();
    }

    // ─── Marquee selection box ────────────────────────────────────────────────
    if (marquee) {
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      // left-to-right drag: solid blue fill; right-to-left: crossing selection (lighter)
      const crossingSelect = marquee.w < 0;
      ctx.fillStyle = crossingSelect ? 'rgba(37,99,235,0.05)' : 'rgba(37,99,235,0.08)';
      const rx = marquee.w >= 0 ? marquee.x : marquee.x + marquee.w;
      const ry = marquee.h >= 0 ? marquee.y : marquee.y + marquee.h;
      const rw = Math.abs(marquee.w);
      const rh = Math.abs(marquee.h);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    // ─── Step 2: Domain Definition Dimensions & Interactive Handles ───────────
    if (flowType === 'external') {
      const c = geometryBBox.chord;
      const h = geometryBBox.height;
      const effH = Math.max(0.5 * c, h);
      const lUp = upstreamChordFactor * c * domainAnimScale;
      const lDown = downstreamChordFactor * c * domainAnimScale;
      const lLat = lateralHeightFactor * effH * domainAnimScale;

      const domainLeftX = geometryBBox.minX - lUp;
      const domainRightX = geometryBBox.maxX + lDown;
      const domainTopY = geometryBBox.centerY + lLat;
      const domainBottomY = geometryBBox.centerY - lLat;

      // Interactive Handles in Step 2 - only for an auto-generated far-field domain
      // (a hand-drawn domain loop has no clearance sliders to resize).
      if (currentStep === 2 && domainEntity?.autoDomain) {
        const drawHandle = (
          pt: Point2D,
          key: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial',
          tooltip: string,
        ) => {
          const s = ws(pt.x, pt.y);
          const isHov = hoveredDomainHandle === key;
          const isDrag = draggingDomainHandle === key;

          ctx.save();
          if (isHov || isDrag) {
            ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.fillStyle = isDrag ? '#1D4ED8' : '#2563EB';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, isHov || isDrag ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          if (isHov || isDrag) {
            ctx.font = 'bold 9px Inter, sans-serif';
            const tw = ctx.measureText(tooltip).width;
            ctx.fillStyle = '#171A1F';
            ctx.fillRect(s.x - tw / 2 - 4, s.y - 20, tw + 8, 14);
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tooltip, s.x, s.y - 13);
          }
          ctx.restore();
        };

        if (domainShape === 'circle') {
          drawHandle(
            { x: geometryBBox.centerX + Math.max(lUp, lDown, lLat), y: geometryBBox.centerY },
            'radial',
            `Radius: ${upstreamChordFactor}c`,
          );
        } else {
          drawHandle(
            { x: domainLeftX, y: geometryBBox.centerY },
            'upstream',
            `← ${upstreamChordFactor.toFixed(1)}c`,
          );
          drawHandle(
            { x: domainRightX, y: geometryBBox.centerY },
            'downstream',
            `→ ${downstreamChordFactor.toFixed(1)}c`,
          );
          drawHandle(
            { x: geometryBBox.centerX, y: domainTopY },
            'top',
            `↑ ${lateralHeightFactor.toFixed(1)}c`,
          );
          drawHandle(
            { x: geometryBBox.centerX, y: domainBottomY },
            'bottom',
            `↓ ${lateralHeightFactor.toFixed(1)}c`,
          );
        }
      }
    }

    // ─── Boundary Patches step only: edge tag highlights & badges ────────────
    if (currentStep === 3) {
      // Faint outline on taggable edges ONLY while a tag tool is armed, so the
      // user can see what to click. Nothing implies any edge is a wall.
      if (activeTagTool) {
        ctx.save();
        ctx.strokeStyle = 'rgba(37,99,235,0.28)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.4;
        for (const edge of boundaryEdges) {
          if (edge.explicit) continue;
          const a = ws(edge.p0.x, edge.p0.y);
          const b = ws(edge.p1.x, edge.p1.y);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Colour only edges the user has explicitly tagged. Untagged edges stay
      // the normal geometry colour - nothing is a "wall" until you say so.
      for (const edge of boundaryEdges) {
        if (!edge.explicit) continue;
        const isHovered = hoveredEdgeKey === edge.key;
        const p0 = ws(edge.p0.x, edge.p0.y);
        const p1 = ws(edge.p1.x, edge.p1.y);
        const colorConfig = BOUNDARY_COLORS[edge.tag] || BOUNDARY_COLORS.wall;
        // A circle is drawn as many short arc segments; only show a normal arrow
        // every so often so the outline does not turn into a sunburst.
        const edgeEntType = cadState.entities.find((en) => en.id === edge.entityId)?.type;
        const isCircleSeg = edgeEntType === 'circle' || edgeEntType === 'ellipse';
        const showArrow = !isCircleSeg || edge.edgeIndex % 8 === 0;

        ctx.save();
        // Thick highlight along the edge
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = isHovered ? 5.5 : 3.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        // Normal indicator arrow at midpoint
        const mid = ws(edge.midpoint.x, edge.midpoint.y);
        if (showArrow) {
          const normLen = 12;
          const normEnd = {
            x: mid.x + edge.normal.x * normLen,
            y: mid.y - edge.normal.y * normLen,
          };
          ctx.strokeStyle = colorConfig.hex;
          ctx.lineWidth = 1.2;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.moveTo(mid.x, mid.y);
          ctx.lineTo(normEnd.x, normEnd.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }

      // 2nd pass: draw ONE badge label per contiguous chain, positioned strictly OUTSIDE the domain
      const chains = getContiguousEdgeChains(boundaryEdges);

      for (const chain of chains) {
        const colorConfig = BOUNDARY_COLORS[chain.tag] || BOUNDARY_COLORS.wall;
        const mid = ws(chain.midpoint.x, chain.midpoint.y);
        const isChainHovered = chain.edges.some((e) => e.key === hoveredEdgeKey);
        const badgeText = chain.tag.toUpperCase();

        ctx.save();
        ctx.font = 'bold 9px JetBrains Mono';
        const textWidth = ctx.measureText(badgeText).width;
        const bw = textWidth + 14;
        const bh = 18;

        // Position badge strictly OUTSIDE domain with a clean 18px gap from the line
        // Project the badge box half-dimensions along the normal direction
        const boxExtentAlongNormal =
          Math.abs(chain.outwardNormal.x) * (bw / 2) + Math.abs(chain.outwardNormal.y) * (bh / 2);
        const totalOffset = boxExtentAlongNormal + 18;

        const badgeCenter = {
          x: mid.x + chain.outwardNormal.x * totalOffset,
          y: mid.y - chain.outwardNormal.y * totalOffset,
        };

        // Draw connecting leader line from edge midpoint to badge if offset is significant
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(badgeCenter.x, badgeCenter.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Badge pill
        ctx.fillStyle = isChainHovered ? '#FFFFFF' : 'rgba(255, 255, 255, 0.96)';
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = isChainHovered ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.roundRect(badgeCenter.x - bw / 2, badgeCenter.y - bh / 2, bw, bh, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = colorConfig.hex;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeCenter.x, badgeCenter.y);
        ctx.restore();
      }
    }

    // ─── Structured block topology overlay (mesh stage) ──────────────────────
    if (
      showBlocking &&
      blocking &&
      blocking.edges.length > 0 &&
      !(showMesh && canvasMode === 'mesh')
    ) {
      ctx.save();

      // faint per-block fill so the multi-block layout reads at a glance
      blocking.blocks.forEach((blk, bi) => {
        const poly = blockPolygon(blocking, blk);
        if (poly.length < 3) return;
        const hot = hoveredBlockIdx === bi;
        const picked =
          canvasMode === 'cad' &&
          (selectedBlockId === blk.id || (blockTool === 'mergeB' && blockPick === blk.id));
        const bad = badBlockIds.has(blk.id) || outsideBlockIds.has(blk.id);
        const doomed = hot && blockTool === 'delete' && canvasMode === 'cad';
        const target =
          hot && canvasMode === 'cad' && (blockTool === 'ogrid' || blockTool === 'mergeB');
        ctx.beginPath();
        poly.forEach((p, i) => {
          const s = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.fillStyle =
          bad || doomed
            ? 'rgba(220, 38, 38, 0.18)'
            : picked || target
              ? 'rgba(224, 90, 0, 0.16)'
              : hot
                ? 'rgba(124, 58, 237, 0.14)'
                : 'rgba(124, 58, 237, 0.05)';
        ctx.fill();
        if (picked) {
          ctx.strokeStyle = '#E05A00';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // block number at the centroid
        const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
        const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
        const sc = ws(cx, cy);
        ctx.fillStyle = 'rgba(124, 58, 237, 0.75)';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(bi + 1), sc.x, sc.y);
      });

      for (const edge of blocking.edges) {
        const v0 = blocking.vertices.find((v) => v.id === edge.v0);
        const v1 = blocking.vertices.find((v) => v.id === edge.v1);
        if (!v0 || !v1) continue;
        const chain = [v0.pt, ...edge.path, v1.pt];
        const col =
          directionColors?.[edge.id] ??
          (edge.patch ? (BOUNDARY_COLORS[edge.patch]?.hex ?? '#7C3AED') : '#7C3AED');
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        chain.forEach((p, i) => {
          const s = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();

        // node ticks give a read on the cell count - walk the chain by arc length.
        // Capped by on-screen length too: a short edge zoomed in tight (e.g. a
        // narrow throat block) would otherwise cram dozens of ticks into a few
        // pixels and smear into a solid black scribble instead of readable dots.
        let screenLen = 0;
        for (let i = 0; i + 1 < chain.length; i++) {
          const sa = ws(chain[i].x, chain[i].y);
          const sb = ws(chain[i + 1].x, chain[i + 1].y);
          screenLen += Math.hypot(sb.x - sa.x, sb.y - sa.y);
        }
        const n = Math.max(2, Math.min(edge.nodes, 120, Math.floor(screenLen / 5) || 2));
        const segLen: number[] = [];
        let total = 0;
        for (let i = 0; i + 1 < chain.length; i++) {
          const d = Math.hypot(chain[i + 1].x - chain[i].x, chain[i + 1].y - chain[i].y);
          segLen.push(d);
          total += d;
        }
        ctx.fillStyle = col;
        for (let k = 0; k < n; k++) {
          let target = (k / (n - 1)) * total;
          let si = 0;
          while (si < segLen.length && target > segLen[si]) {
            target -= segLen[si];
            si += 1;
          }
          const a = chain[Math.min(si, chain.length - 1)];
          const b = chain[Math.min(si + 1, chain.length - 1)];
          const f = segLen[si] ? target / segLen[si] : 0;
          const s = ws(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Editor highlights on top of the edges: picked / selected / hovered edges,
      // and (dashed red) boundary edges with no patch - they need associating.
      if (canvasMode === 'cad') {
        const vmap = new Map(blocking.vertices.map((v) => [v.id, v.pt] as const));
        const strokeEdge = (id: string, color: string, width: number, dash: number[] = []) => {
          const ed = blocking.edges.find((x) => x.id === id);
          if (!ed) return;
          const chain = [vmap.get(ed.v0)!, ...ed.path, vmap.get(ed.v1)!];
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.setLineDash(dash);
          ctx.beginPath();
          chain.forEach((p, i) => {
            const q = ws(p.x, p.y);
            if (i === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          });
          ctx.stroke();
          ctx.setLineDash([]);
        };
        unpatchedEdgeIds.forEach((id) => strokeEdge(id, '#DC2626', 2, [5, 4]));
        if (hoverEdgeId && !assocEdges.includes(hoverEdgeId) && hoverEdgeId !== selectedEdgeId)
          strokeEdge(hoverEdgeId, 'rgba(224, 90, 0, 0.55)', 4);
        assocEdges.forEach((id) => strokeEdge(id, '#E05A00', 4));
        if (selectedEdgeId) strokeEdge(selectedEdgeId, '#E05A00', 4);
      }
      // corner handles: a small dot per vertex. Hovering the one you are about to
      // grab draws a small solid-border square (no fill) tight around that dot.
      for (const v of blocking.vertices) {
        const s = ws(v.pt.x, v.pt.y);
        const hot = hoveredBlockVtx === v.id || (blockTool === 'mergeV' && blockPick === v.id);
        ctx.beginPath();
        ctx.arc(s.x, s.y, hot ? 2.6 : 2.0, 0, Math.PI * 2);
        // associated (ICEM) vertices are green: they slide along their curve
        ctx.fillStyle = hot ? '#E05A00' : v.curves?.length ? '#059669' : '#7C3AED';
        ctx.fill();
        if (hot) {
          ctx.strokeStyle = '#E05A00';
          ctx.lineWidth = 1;
          ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
        }
      }

      // alignment guides while dragging a block corner (or placing one)
      if ((blockDrag.current || blockCursor) && blockSnapGuides.current.length) {
        ctx.strokeStyle = 'rgba(224, 90, 0, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        for (const g of blockSnapGuides.current) {
          const a = ws(g.a.x, g.a.y);
          const b = ws(g.b.x, g.b.y);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ─── Block editor previews (Blocks view) ───────────────────────────────────
    if (showBlocking && canvasMode === 'cad') {
      ctx.save();
      if (blockTool === 'draw' && (blockDrawPts.length || blockCursor)) {
        const pts = [...blockDrawPts, ...(blockCursor ? [blockCursor] : [])];
        ctx.beginPath();
        pts.forEach((p, i) => {
          const q = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        if (pts.length === 4) ctx.closePath();
        ctx.strokeStyle = '#E05A00';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (pts.length === 4) {
          ctx.fillStyle = 'rgba(224, 90, 0, 0.08)';
          ctx.fill();
        }
        pts.forEach((p, i) => {
          const q = ws(p.x, p.y);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = i < blockDrawPts.length ? '#E05A00' : '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = '#E05A00';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        });
      }
      if (blockTool === 'assoc' && hoverCurveId) {
        const ent = cadState.entities.find((x) => x.id === hoverCurveId);
        const c = ent ? curveOf(ent) : null;
        if (c) {
          ctx.strokeStyle = '#059669';
          ctx.lineWidth = 4;
          ctx.beginPath();
          c.pts.forEach((p, i) => {
            const q = ws(p.x, p.y);
            if (i === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          });
          if (c.closed) ctx.closePath();
          ctx.stroke();
        }
      }
      if (blockTool === 'split' && splitHover) {
        ctx.strokeStyle = '#E05A00';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        for (const chain of splitHover.cut) {
          ctx.beginPath();
          chain.forEach((p, i) => {
            const q = ws(p.x, p.y);
            if (i === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          });
          ctx.stroke();
        }
        ctx.setLineDash([]);
        const q = ws(splitHover.pt.x, splitHover.pt.y);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#E05A00';
        ctx.fill();
      }
      ctx.restore();
    }

    // ─── Plots probe line overlay (Results stage) ─────────────────────────
    if (activePlotLine || plotPickPreviewP1) {
      ctx.save();
      const p1 = activePlotLine ? activePlotLine.p1 : plotPickPreviewP1!;
      const p2 = activePlotLine ? activePlotLine.p2 : null;

      const s1 = ws(p1[0], p1[1]);

      if (p2) {
        const s2 = ws(p2[0], p2[1]);
        // Draw probe line
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(s2.x, s2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Point 2 marker
        ctx.fillStyle = '#16A34A';
        ctx.beginPath();
        ctx.arc(s2.x, s2.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillStyle = '#16A34A';
        ctx.fillText('P2', s2.x + 8, s2.y - 4);
      }

      // Point 1 marker
      ctx.fillStyle = '#2563EB';
      ctx.beginPath();
      ctx.arc(s1.x, s1.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = '#2563EB';
      ctx.fillText('P1', s1.x + 8, s1.y - 4);

      if (activePlotLine?.label) {
        const midX = p2 ? (s1.x + ws(p2[0], p2[1]).x) / 2 : s1.x;
        const midY = p2 ? (s1.y + ws(p2[0], p2[1]).y) / 2 : s1.y;
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillStyle = '#1E293B';
        ctx.fillText(activePlotLine.label, midX + 8, midY - 8);
      }
      ctx.restore();
    }
  }, [
    cadState.entities,
    tempPts,
    snap,
    isDrawing,
    pan,
    zoom,
    showGrid,
    showConstruction,
    tool,
    domainLength,
    domainHeight,
    marquee,
    currentStep,
    flowType,
    angleOfAttackDeg,
    freestreamVelocity,
    boundaryEdges,
    hoveredEdgeKey,
    geometryBBox,
    displayOnly,
    showMesh,
    canvasMode,
    meshData,
    domainBroken,
    editDragActive,
    showBlocking,
    blocking,
    directionColors,
    hoveredBlockVtx,
    hoveredBlockIdx,
    hoveredVertex,
    meshOnly,
    blockTool,
    blockDrawPts,
    blockCursor,
    splitHover,
    selectedBlockId,
    badBlockIds,
    outsideBlockIds,
    unpatchedEdgeIds,
    hoverEdgeId,
    assocEdges,
    selectedEdgeId,
    blockPick,
    hoverCurveId,
    showField,
    fieldData,
    activeField,
    colormap,
    showMeshWireframe,
    showResultsStreamlines,
    showMeshQuality,
    meshSkew,
    viewport.w,
    viewport.h,
    livePreview,
    liveField,
    liveMeshOn,
    activePlotLine,
    plotPickPreviewP1,
    glMeshActive,
  ]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const findEntityAt = useCallback(
    (rawPt: Point2D): string | null => {
      const hitR = 14 / zoom;
      let bestId: string | null = null;
      let bestD = Infinity;
      for (const ent of cadState.entities) {
        if (ent.pts.length === 0) continue;
        for (let i = 0; i < ent.pts.length - 1; i++) {
          const d = distToSegment(rawPt, ent.pts[i], ent.pts[i + 1]);
          if (d < hitR && d < bestD) {
            bestD = d;
            bestId = ent.id;
          }
        }
        if (ent.isClosed && ent.pts.length >= 3) {
          const d = distToSegment(rawPt, ent.pts[ent.pts.length - 1], ent.pts[0]);
          if (d < hitR && d < bestD) {
            bestD = d;
            bestId = ent.id;
          }
        }
        if (ent.type === 'circle' && ent.pts.length >= 2) {
          const r = ent.radius ?? dist(ent.pts[0], ent.pts[1]);
          const radialD = Math.abs(dist(rawPt, ent.pts[0]) - r);
          if (radialD < hitR && radialD < bestD) {
            bestD = radialD;
            bestId = ent.id;
          }
        }
        if (ent.type === 'ellipse' && ent.pts.length >= 2 && ent.rx != null && ent.ry != null) {
          const c = ent.pts[0];
          const rx = ent.rx;
          const ry = ent.ry;
          const rot = ent.rotation || 0;
          const cosR = Math.cos(rot);
          const sinR = Math.sin(rot);
          const N = 32;
          let minD = Infinity;
          let prevP = {
            x: c.x + rx * cosR,
            y: c.y + rx * sinR,
          };
          for (let j = 1; j <= N; j++) {
            const a = (2 * Math.PI * j) / N;
            const lx = rx * Math.cos(a);
            const ly = ry * Math.sin(a);
            const curP = {
              x: c.x + lx * cosR - ly * sinR,
              y: c.y + lx * sinR + ly * cosR,
            };
            const d = distToSegment(rawPt, prevP, curP);
            if (d < minD) minD = d;
            prevP = curP;
          }
          if (minD < hitR && minD < bestD) {
            bestD = minD;
            bestId = ent.id;
          }
        }
        for (const p of ent.pts) {
          const d = dist(rawPt, p);
          if (d < hitR && d < bestD) {
            bestD = d;
            bestId = ent.id;
          }
        }
      }
      return bestId;
    },
    [cadState.entities, zoom],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const raw = toWorld(e.clientX, e.clientY);

      // Block editor previews: the snapped corner the Draw tool would place, and
      // the edge point the Split tool would cut from.
      if (showBlocking && canvasMode === 'cad' && blockTool === 'draw') {
        const { pt, guides } = snapBlockVertex(raw, '');
        blockSnapGuides.current = guides;
        setBlockCursor(pt);
      } else if (blockCursor) {
        setBlockCursor(null);
      }
      if (showBlocking && canvasMode === 'cad' && blockTool === 'split' && blocking) {
        const hit = pickEdge(blocking, raw, 10 / zoom);
        if (
          hit?.edgeId !== splitHover?.edgeId ||
          (hit &&
            splitHover &&
            Math.hypot(hit.pt.x - splitHover.pt.x, hit.pt.y - splitHover.pt.y) > 1e-9)
        ) {
          let cut: Point2D[][] = [];
          if (hit) {
            // Preview the real split: its new cut edges join two new vertices.
            const next = splitSheet(blocking, hit.edgeId, hit.pt);
            if (next) {
              const oldV = new Set(blocking.vertices.map((v) => v.id));
              const vm = new Map(next.vertices.map((v) => [v.id, v.pt] as const));
              cut = next.edges
                .filter((ed) => !oldV.has(ed.v0) && !oldV.has(ed.v1))
                .map((ed) => [vm.get(ed.v0)!, ...ed.path, vm.get(ed.v1)!]);
            }
          }
          setSplitHover(hit ? { edgeId: hit.edgeId, pt: hit.pt, cut } : null);
        }
      } else if (splitHover) {
        setSplitHover(null);
      }
      // Associate: the curve (stage 2) or block edge (stage 1) under the cursor;
      // Select: the edge a click would pick for its params.
      if (showBlocking && canvasMode === 'cad' && blocking) {
        const curveStage = blockTool === 'assoc' && assocStage === 'curve';
        const hc = curveStage ? pickCurve(raw, 10 / zoom) : null;
        if (hc !== hoverCurveId) setHoverCurveId(hc);
        const edgeStage =
          (blockTool === 'assoc' && assocStage === 'edges') || blockTool === 'select';
        const he =
          edgeStage && !blockDrag.current
            ? (pickEdge(blocking, raw, 8 / zoom)?.edgeId ?? null)
            : null;
        if (he !== hoverEdgeId) setHoverEdgeId(he);
      }

      // Structured block-vertex drag / hover (mesh stage).
      if (showBlocking && blocking) {
        if (blockDrag.current && onUpdateBlocking) {
          const vid = blockDrag.current.vid;
          const { pt, guides } = snapBlockVertex(raw, vid);
          blockSnapGuides.current = guides;
          onUpdateBlocking(applyVertexMove(blocking, vid, pt, cadState.entities));
          return;
        }
        const vHit = 12 / zoom;
        let hov: string | null = null;
        let bd = blockTool === 'select' || blockTool === 'mergeV' ? vHit : 0;
        for (const v of blocking.vertices) {
          const d = Math.hypot(v.pt.x - raw.x, v.pt.y - raw.y);
          if (d < bd) {
            bd = d;
            hov = v.id;
          }
        }
        if (hov !== hoveredBlockVtx) setHoveredBlockVtx(hov);

        let hb: number | null = null;
        blocking.blocks.forEach((blk, bi) => {
          const poly = blockPolygon(blocking, blk);
          if (poly.length >= 3 && pointInPolygon(raw, poly)) hb = bi;
        });
        if (hb !== hoveredBlockIdx) setHoveredBlockIdx(hb);
      }

      const s = computeSnap(raw);
      // Once the user has typed into the live dimension box, the mouse no
      // longer drives the preview - the typed-value sync effect owns `snap`.
      const dimIsManual = isDrawing && dimPrompt?.live && manualDim;
      if (!dimIsManual) {
        setSnap(s);
      }

      // Live-update the dimension box (Onshape/Fusion-style dynamic input)
      // while a shape is being placed and the user hasn't started typing yet.
      if (isDrawing && dimPrompt?.live && !manualDim && tempPts.length > 0) {
        // The current segment's start: the last placed vertex (matters for
        // polyline, which chains many segments through the same 'line' prompt;
        // for line/rectangle/circle this is always tempPts[0] too).
        const p0 = dimPrompt.basePt;
        if (dimPrompt.type === 'line') {
          const len = dist(p0, s.pt);
          const angDeg = (Math.atan2(s.pt.y - p0.y, s.pt.x - p0.x) * 180) / Math.PI;
          setInputVal1(len.toFixed(4));
          setInputVal2(angDeg.toFixed(1));
          setDimPrompt((prev) =>
            prev && prev.live
              ? {
                  ...prev,
                  val1: len.toFixed(4),
                  val2: angDeg.toFixed(1),
                  worldPos: { x: (p0.x + s.pt.x) / 2, y: (p0.y + s.pt.y) / 2 },
                  endPt: s.pt,
                }
              : prev,
          );
        } else if (dimPrompt.type === 'rectangle') {
          const w = Math.abs(s.pt.x - p0.x);
          const h = Math.abs(s.pt.y - p0.y);
          setInputVal1(w.toFixed(4));
          setInputVal2(h.toFixed(4));
          setDimPrompt((prev) =>
            prev && prev.live
              ? {
                  ...prev,
                  val1: w.toFixed(4),
                  val2: h.toFixed(4),
                  worldPos: { x: (p0.x + s.pt.x) / 2, y: (p0.y + s.pt.y) / 2 },
                  endPt: s.pt,
                }
              : prev,
          );
        } else if (dimPrompt.type === 'circle') {
          const r = dist(p0, s.pt);
          setInputVal1(r.toFixed(4));
          setInputVal2((r * 2).toFixed(4));
          setDimPrompt((prev) =>
            prev && prev.live
              ? {
                  ...prev,
                  val1: r.toFixed(4),
                  val2: (r * 2).toFixed(4),
                  worldPos: { x: p0.x + r * 0.707, y: p0.y + r * 0.707 },
                  endPt: s.pt,
                }
              : prev,
          );
        } else if (dimPrompt.type === 'ellipse') {
          if (tempPts.length === 1) {
            const rx = dist(p0, s.pt);
            const ry = rx * 0.5;
            setInputVal1(rx.toFixed(4));
            setInputVal2(ry.toFixed(4));
            setDimPrompt((prev) =>
              prev && prev.live
                ? {
                    ...prev,
                    val1: rx.toFixed(4),
                    val2: ry.toFixed(4),
                    worldPos: { x: (p0.x + s.pt.x) / 2, y: (p0.y + s.pt.y) / 2 },
                    endPt: s.pt,
                  }
                : prev,
            );
          } else if (tempPts.length === 2 && tempPts[1]) {
            const rx = dist(p0, tempPts[1]);
            const rot = Math.atan2(tempPts[1].y - p0.y, tempPts[1].x - p0.x);
            const ry = Math.abs(-(s.pt.x - p0.x) * Math.sin(rot) + (s.pt.y - p0.y) * Math.cos(rot));
            setInputVal1(rx.toFixed(4));
            setInputVal2(ry.toFixed(4));
            const cosR = Math.cos(rot);
            const sinR = Math.sin(rot);
            const wpX = p0.x + rx * 0.707 * cosR - ry * 0.707 * sinR;
            const wpY = p0.y + rx * 0.707 * sinR + ry * 0.707 * cosR;
            setDimPrompt((prev) =>
              prev && prev.live
                ? {
                    ...prev,
                    val1: rx.toFixed(4),
                    val2: ry.toFixed(4),
                    worldPos: { x: wpX, y: wpY },
                    endPt: s.pt,
                  }
                : prev,
            );
          }
        } else if (dimPrompt.type === 'arc') {
          // R was fixed the moment the start point was placed (tempPts[1]) -
          // only the sweep angle tracks the mouse from here.
          const r = dist(p0, tempPts[1] ?? s.pt);
          const sa = Math.atan2((tempPts[1]?.y ?? s.pt.y) - p0.y, (tempPts[1]?.x ?? s.pt.x) - p0.x);
          const ea = Math.atan2(s.pt.y - p0.y, s.pt.x - p0.x);
          const sweepDeg = (((ea - sa) * 180) / Math.PI + 360) % 360;
          setInputVal2(sweepDeg.toFixed(1));
          setDimPrompt((prev) =>
            prev && prev.live
              ? {
                  ...prev,
                  val1: r.toFixed(4),
                  val2: sweepDeg.toFixed(1),
                  worldPos: { x: (p0.x + s.pt.x) / 2, y: (p0.y + s.pt.y) / 2 },
                  endPt: s.pt,
                }
              : prev,
          );
        }
      }

      const ang =
        tempPts.length > 0
          ? (
              (Math.atan2(
                s.pt.y - tempPts[tempPts.length - 1].y,
                s.pt.x - tempPts[tempPts.length - 1].x,
              ) *
                180) /
              Math.PI
            ).toFixed(1)
          : '-';
      const L = tempPts.length > 0 ? dist(tempPts[tempPts.length - 1], s.pt).toFixed(3) : '-';
      setHud({ length: L, angle: ang, x: s.pt.x.toFixed(4), y: s.pt.y.toFixed(4) });

      // Step 2 Domain Handle Hover
      if (
        !displayOnly &&
        currentStep === 2 &&
        flowType === 'external' &&
        domainEntity?.autoDomain &&
        !isDrawing
      ) {
        const c = geometryBBox.chord;
        const h = geometryBBox.height;
        const effH = Math.max(0.5 * c, h);
        const lUp = upstreamChordFactor * c;
        const lDown = downstreamChordFactor * c;
        const lLat = lateralHeightFactor * effH;

        const handlePts: Record<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial', Point2D> =
          {
            upstream: { x: geometryBBox.minX - lUp, y: geometryBBox.centerY },
            downstream: { x: geometryBBox.maxX + lDown, y: geometryBBox.centerY },
            top: { x: geometryBBox.centerX, y: geometryBBox.centerY + lLat },
            bottom: { x: geometryBBox.centerX, y: geometryBBox.centerY - lLat },
            radial: {
              x: geometryBBox.centerX + Math.max(lUp, lDown, lLat),
              y: geometryBBox.centerY,
            },
          };

        // Skip hover detection while actively dragging
        if (!draggingDomainHandle) {
          // Check handle hover
          const hitTolerance = 14 / zoom;
          let foundHandle: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null = null;
          if (domainShape === 'circle') {
            if (dist(raw, handlePts.radial) < hitTolerance) foundHandle = 'radial';
          } else {
            if (dist(raw, handlePts.upstream) < hitTolerance) foundHandle = 'upstream';
            else if (dist(raw, handlePts.downstream) < hitTolerance) foundHandle = 'downstream';
            else if (dist(raw, handlePts.top) < hitTolerance) foundHandle = 'top';
            else if (dist(raw, handlePts.bottom) < hitTolerance) foundHandle = 'bottom';
          }
          setHoveredDomainHandle(foundHandle);
        }
      } else {
        if (hoveredDomainHandle) setHoveredDomainHandle(null);
      }

      // Trim hover preview
      if (tool === 'trim') {
        const target = getTrimTarget(raw, cadState.entities, zoom);
        setHoveredTrim(
          target
            ? { p0: target.subSeg.p0, p1: target.subSeg.p1, polyline: target.subPolyline }
            : null,
        );
      } else if (hoveredTrim) {
        setHoveredTrim(null);
      }

      // Hover: mark the single nearest entity vertex (Select tool) so you can see
      // exactly which point a click / drag will grab.
      if (tool === 'select' && !displayOnly && !isDrawing && !editDrag.current) {
        const r = 11 / zoom;
        let best: Point2D | null = null;
        let bd = r;
        for (const en of cadState.entities) {
          if (en.layer === 'construction' && !showConstruction) continue;
          for (const p of en.pts) {
            const d = Math.hypot(p.x - raw.x, p.y - raw.y);
            if (d < bd) {
              bd = d;
              best = p;
            }
          }
        }
        const changed =
          !best !== !hoveredVertex ||
          (best && hoveredVertex && (best.x !== hoveredVertex.x || best.y !== hoveredVertex.y));
        if (changed) setHoveredVertex(best ? { x: best.x, y: best.y } : null);
      } else if (hoveredVertex) {
        setHoveredVertex(null);
      }

      // Pan (middle mouse or Alt+drag)
      if (panning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        pendingPanRef.current = { x: panOrigin.current.x + dx, y: panOrigin.current.y + dy };
        if (!panRafRef.current) {
          panRafRef.current = requestAnimationFrame(() => {
            panRafRef.current = null;
            if (pendingPanRef.current) {
              setPan(pendingPanRef.current);
            }
          });
        }
        return;
      }

      // Direct manipulation: vertex drag / move selection
      if (editDrag.current) {
        const d = editDrag.current;
        const target = s.pt; // snapped world point
        if (d.mode === 'vertex') {
          dispatch({
            type: 'REPLACE_ENTITIES',
            entities: d.snapshot.map((en) => {
              const hits = d.targets.filter((t) => t.id === en.id);
              let out = en;
              for (const t of hits) out = moveEntityVertex(out, t.idx, target);
              return out;
            }),
          });
          setCmdText(
            d.targets.length > 1
              ? `Dragging ${d.targets.length} joined vertices`
              : 'Drag vertex - release to place.',
          );
        } else {
          const dx = target.x - d.startWorld.x;
          const dy = target.y - d.startWorld.y;
          dispatch({
            type: 'REPLACE_ENTITIES',
            entities: d.snapshot.map((en) => (en.selected ? translateEntity(en, dx, dy) : en)),
          });
          setCmdText(`Move Δ(${dx.toFixed(3)}, ${dy.toFixed(3)}) - release to drop.`);
        }
        return;
      }

      // Marquee update (select tool + LMB held)
      if (dragSelecting.current && tool === 'select') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = dragStart.current.x - rect.left;
        const sy = dragStart.current.y - rect.top;
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        setMarquee({ x: sx, y: sy, w: cx - sx, h: cy - sy });
      }
    },
    [
      toWorld,
      computeSnap,
      tempPts,
      tool,
      cadState.entities,
      zoom,
      hoveredTrim,
      currentStep,
      flowType,
      isDrawing,
      geometryBBox,
      upstreamChordFactor,
      downstreamChordFactor,
      lateralHeightFactor,
      domainShape,
      draggingDomainHandle,
      setUpstreamChordFactor,
      setDownstreamChordFactor,
      setLateralHeightFactor,
      hoveredDomainHandle,
      showBlocking,
      blocking,
      onUpdateBlocking,
      hoveredBlockVtx,
      hoveredBlockIdx,
      dimPrompt,
      manualDim,
      canvasMode,
      blockTool,
      blockCursor,
      splitHover,
      snapBlockVertex,
      assocStage,
      pickCurve,
      hoverCurveId,
      hoverEdgeId,
    ],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      userInteractedRef.current = true;
      // Step 2: Domain Handle Drag start
      if (!displayOnly && currentStep === 2 && hoveredDomainHandle) {
        const hasDomain = cadState.entities.some((e) => e.role === 'domain_boundary');
        if (!hasDomain) {
          const newDomain = createDomainEntity(
            domainShape,
            geometryBBox,
            upstreamChordFactor,
            downstreamChordFactor,
            lateralHeightFactor,
          );
          const otherEnts = cadState.entities.filter((e) => e.role !== 'domain_boundary');
          dispatch({ type: 'REPLACE_ENTITIES', entities: [...otherEnts, newDomain] });
        }
        draggingDomainHandleRef.current = hoveredDomainHandle;
        setDraggingDomainHandle(hoveredDomainHandle);
        e.preventDefault();
        return;
      }

      // Middle mouse or Alt+LMB → pan
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        panning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY };
        panOrigin.current = { ...pan };
        e.preventDefault();
        return;
      }
      // Block editor tools (Blocks view). The geometry is never editable here.
      if (
        e.button === 0 &&
        showBlocking &&
        canvasMode === 'cad' &&
        onUpdateBlocking &&
        blockTool !== 'select'
      ) {
        const raw = toWorld(e.clientX, e.clientY);
        if (blockTool === 'draw') {
          addBlockCorner(snapBlockVertex(raw, '').pt);
        } else if (blockTool === 'split') {
          if (splitHover) splitAtHover();
        } else if (blockTool === 'delete' && blocking) {
          const id = blockAt(blocking, raw);
          if (id) deleteBlockById(id);
        } else if (blockTool === 'ogrid' && blocking) {
          const id = blockAt(blocking, raw);
          if (id) {
            applyBlockOp(
              ogridBlock(blocking, id, ogridScale, currentCellSize(blocking)),
              'O-grid added.',
            );
          }
        } else if (blockTool === 'mergeV' && blocking) {
          let vid: string | null = null;
          let bd = 12 / zoom;
          for (const v of blocking.vertices) {
            const d = Math.hypot(v.pt.x - raw.x, v.pt.y - raw.y);
            if (d < bd) {
              bd = d;
              vid = v.id;
            }
          }
          if (vid && !blockPick) {
            setBlockPick(vid);
          } else if (vid && blockPick) {
            applyBlockOp(mergeVertices(blocking, blockPick, vid), 'Vertices merged.');
            setBlockPick(null);
          }
        } else if (blockTool === 'mergeB' && blocking) {
          const id = blockAt(blocking, raw);
          if (id && !blockPick) {
            setBlockPick(id);
          } else if (id && blockPick) {
            applyBlockOp(mergeBlocks(blocking, blockPick, id), 'Blocks merged.');
            setBlockPick(null);
          }
        } else if (blockTool === 'assoc' && blocking) {
          if (assocStage === 'edges') {
            const hit = pickEdge(blocking, raw, 8 / zoom);
            if (hit) {
              const next = assocEdges.includes(hit.edgeId)
                ? assocEdges.filter((x) => x !== hit.edgeId)
                : [...assocEdges, hit.edgeId];
              setAssocEdges(next);
            }
          } else {
            const cid = pickCurve(raw, 10 / zoom);
            if (cid) associateTo(cid);
          }
        }
        e.preventDefault();
        return;
      }
      // Structured block vertices are editable even in display-only (mesh) mode.
      if (e.button === 0 && showBlocking && blocking && onUpdateBlocking) {
        const raw = toWorld(e.clientX, e.clientY);
        const vHit = 12 / zoom;
        let best: string | null = null;
        let bd = vHit;
        for (const v of blocking.vertices) {
          const d = Math.hypot(v.pt.x - raw.x, v.pt.y - raw.y);
          if (d < bd) {
            bd = d;
            best = v.id;
          }
        }
        if (best) {
          const bv = blocking.vertices.find((v) => v.id === best)!;
          blockDrag.current = { vid: best, origin: { ...bv.pt }, recorded: false };
          blockSnapGuides.current = [];
          e.preventDefault();
          return;
        }
        // Clicking an edge selects it (edge params); inside a block selects the
        // block (Delete key removes it).
        if (canvasMode === 'cad') {
          const hit = pickEdge(blocking, raw, 6 / zoom);
          setSelectedEdgeId(hit?.edgeId ?? null);
          setSelectedBlockId(hit ? null : blockAt(blocking, raw));
        }
      }

      // Point picking for Plot Line probe (active in Results stage)
      if (isPickingPlotPoints && onPickPlotPoint && e.button === 0) {
        const raw = toWorld(e.clientX, e.clientY);
        onPickPlotPoint([raw.x, raw.y]);
        e.preventDefault();
        return;
      }

      if (displayOnly) return;

      if (e.button === 0 && tool === 'select') {
        dragStart.current = { x: e.clientX, y: e.clientY };
        const raw = toWorld(e.clientX, e.clientY);
        const selected = cadState.entities.filter(
          (en) => en.selected && en.layer !== 'construction',
        );
        const vHit = 12 / zoom;

        // 1. Grab a vertex of ANY entity (not just selected) → resize / reshape.
        // Every other vertex on the same point moves with it, so joined segments
        // stay joined. The nearest vertex to the click wins.
        let grabbed: Point2D | null = null;
        let grabbedDist = Infinity;
        let grabbedId: string | null = null;
        for (const en of cadState.entities) {
          if (en.layer === 'construction' || en.type === 'circle' || en.type === 'ellipse')
            continue;
          for (let i = 0; i < en.pts.length; i++) {
            const d = Math.hypot(en.pts[i].x - raw.x, en.pts[i].y - raw.y);
            if (d < vHit && d < grabbedDist) {
              grabbedDist = d;
              grabbed = en.pts[i];
              grabbedId = en.id;
            }
          }
        }
        if (grabbed) {
          const glue = Math.max(1e-4, 3 / zoom); // vertices within ~3px count as joined
          const targets: { id: string; idx: number }[] = [];
          for (const en of cadState.entities) {
            if (en.layer === 'construction' || en.autoDomain) continue;
            en.pts.forEach((p, i) => {
              if (Math.hypot(p.x - grabbed!.x, p.y - grabbed!.y) <= glue)
                targets.push({ id: en.id, idx: i });
            });
          }
          if (grabbedId && !cadState.entities.find((en) => en.id === grabbedId)?.selected) {
            dispatch({ type: 'SELECT_ENTITY', id: grabbedId });
          }
          editDrag.current = {
            mode: 'vertex',
            targets,
            startWorld: raw,
            snapshot: cadState.entities.map((x) => ({ ...x, pts: x.pts.map((p) => ({ ...p })) })),
          };
          setEditDragActive(true);
          e.preventDefault();
          return;
        }

        // 2. Press on the body of a selected entity → move the whole selection
        if (selected.length > 0) {
          const onId = findEntityAt(raw);
          if (onId && selected.some((en) => en.id === onId)) {
            editDrag.current = {
              mode: 'move',
              startWorld: raw,
              snapshot: cadState.entities.map((x) => ({ ...x, pts: x.pts.map((p) => ({ ...p })) })),
            };
            setEditDragActive(true);
            e.preventDefault();
            return;
          }
        }

        // 3. Otherwise → marquee select
        dragSelecting.current = true;
        setMarquee(null);
      }
    },
    [
      pan,
      tool,
      currentStep,
      hoveredDomainHandle,
      displayOnly,
      toWorld,
      cadState.entities,
      zoom,
      findEntityAt,
      showBlocking,
      blocking,
      onUpdateBlocking,
      isPickingPlotPoints,
      onPickPlotPoint,
      canvasMode,
      blockTool,
      addBlockCorner,
      snapBlockVertex,
      splitHover,
      splitAtHover,
      deleteBlockById,
      applyBlockOp,
      ogridScale,
      blockPick,
      assocStage,
      assocEdges,
      pickCurve,
      associateTo,
    ],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      panning.current = false;
      if (panRafRef.current) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      if (pendingPanRef.current) {
        setPan(pendingPanRef.current);
        pendingPanRef.current = null;
      }

      if (blockDrag.current) {
        const moved = Boolean(blockDrag.current.recorded);
        blockDrag.current = null;
        blockSnapGuides.current = [];
        if (moved && blocking && onUpdateBlocking) {
          onUpdateBlocking(cleanBlocking(propagateNodeCounts(blocking)));
        }
        setCmdText('Block corner moved.');
        return;
      }

      // Finish a vertex drag / move (the entities are already updated live).
      if (editDrag.current) {
        const wasMove = editDrag.current.mode === 'move';
        editDrag.current = null;
        setEditDragActive(false);
        setCmdText(wasMove ? 'Moved.' : 'Vertex placed.');
        return;
      }

      // Domain handle drag is managed by document-level listeners (draggingDomainHandleRef)
      // so we only need to handle AoA here

      if (draggingAoAHandle) {
        setDraggingAoAHandle(false);
        return;
      }

      // Finish marquee selection
      if (dragSelecting.current && tool === 'select') {
        dragSelecting.current = false;
        if (!marquee) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const o = { x: canvas.clientWidth / 2 + pan.x, y: canvas.clientHeight / 2 + pan.y };

        const toW = (sx: number, sy: number): Point2D => ({
          x: (sx - o.x) / zoom,
          y: -(sy - o.y) / zoom,
        });

        const crossing = marquee.w < 0;
        const mx = marquee.w >= 0 ? marquee.x : marquee.x + marquee.w;
        const my = marquee.h >= 0 ? marquee.y : marquee.y + marquee.h;
        const mw = Math.abs(marquee.w);
        const mh = Math.abs(marquee.h);

        // Ignore tiny accidental drags (< 4px)
        if (mw < 4 && mh < 4) {
          setMarquee(null);
          return;
        }

        const worldMin = toW(mx, my + mh);
        const worldMax = toW(mx + mw, my);

        const updated = cadState.entities.map((ent) => {
          if (crossing) {
            // Crossing (right-to-left): select if ANY point is inside box
            const touches = ent.pts.some(
              (p) =>
                p.x >= worldMin.x && p.x <= worldMax.x && p.y >= worldMin.y && p.y <= worldMax.y,
            );
            return { ...ent, selected: e.shiftKey ? ent.selected || touches : touches };
          } else {
            // Window (left-to-right): select only if ALL points are inside box
            const inside = ent.pts.every(
              (p) =>
                p.x >= worldMin.x && p.x <= worldMax.x && p.y >= worldMin.y && p.y <= worldMax.y,
            );
            return { ...ent, selected: e.shiftKey ? ent.selected || inside : inside };
          }
        });

        dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
        const selCount = updated.filter((e) => e.selected).length;
        setCmdText(
          `Selected ${selCount} entit${selCount === 1 ? 'y' : 'ies'}.${crossing ? ' (crossing)' : ' (window)'}`,
        );
        setMarquee(null);
      }
    },
    [tool, marquee, cadState.entities, pan, zoom, blocking, onUpdateBlocking],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      userInteractedRef.current = true;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 0.87;
      const c = canvasRef.current;
      if (c) {
        const rect = c.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const originX = c.clientWidth / 2 + pan.x;
        const originY = c.clientHeight / 2 + pan.y;

        const newZoom = Math.max(0.5, Math.min(25000, zoom * factor));
        const zoomRatio = newZoom / zoom;

        // Pin mouse pointer in world coordinates during zoom
        const newPanX = mouseX - c.clientWidth / 2 - (mouseX - originX) * zoomRatio;
        const newPanY = mouseY - c.clientHeight / 2 - (mouseY - originY) * zoomRatio;

        setZoom(newZoom);
        setPan({ x: newPanX, y: newPanY });
      } else {
        setZoom((z) => Math.max(0.5, Math.min(25000, z * factor)));
      }
    },
    [pan, zoom],
  );

  /** Find entity closest to raw world point */
  const openDimPromptForEntity = useCallback((ent: CadEntity) => {
    if (ent.type === 'line' && ent.pts.length === 2) {
      const p0 = ent.pts[0],
        p1 = ent.pts[1];
      const len = dist(p0, p1);
      const ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
      setDimPrompt({
        entityId: ent.id,
        type: 'line',
        worldPos: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
        val1: len.toFixed(4),
        val2: ang.toFixed(1),
        label1: 'L',
        label2: '∠',
        basePt: p0,
        endPt: p1,
        layer: ent.layer,
      });
      setInputVal1(len.toFixed(4));
      setInputVal2(ang.toFixed(1));
    } else if (ent.type === 'circle' && ent.pts.length >= 1) {
      const c = ent.pts[0];
      const r = ent.radius ?? (ent.pts[1] ? dist(c, ent.pts[1]) : 1);
      setDimPrompt({
        entityId: ent.id,
        type: 'circle',
        worldPos: { x: c.x + r * 0.707, y: c.y + r * 0.707 },
        val1: r.toFixed(4),
        val2: (r * 2).toFixed(4),
        label1: 'R',
        label2: 'Ø',
        basePt: c,
        endPt: ent.pts[1] || { x: c.x + r, y: c.y },
        layer: ent.layer,
      });
      setInputVal1(r.toFixed(4));
      setInputVal2((r * 2).toFixed(4));
    } else if (ent.type === 'ellipse' && ent.pts.length >= 1) {
      const c = ent.pts[0];
      const rx = ent.rx ?? (ent.pts[1] ? dist(c, ent.pts[1]) : 1);
      const ry = ent.ry ?? rx * 0.5;
      const rot =
        ent.rotation ?? (ent.pts[1] ? Math.atan2(ent.pts[1].y - c.y, ent.pts[1].x - c.x) : 0);
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const wpX = c.x + rx * 0.707 * cosR - ry * 0.707 * sinR;
      const wpY = c.y + rx * 0.707 * sinR + ry * 0.707 * cosR;
      setDimPrompt({
        entityId: ent.id,
        type: 'ellipse',
        worldPos: { x: wpX, y: wpY },
        val1: rx.toFixed(4),
        val2: ry.toFixed(4),
        label1: 'Rx',
        label2: 'Ry',
        basePt: c,
        endPt: ent.pts[1] || { x: c.x + rx * cosR, y: c.y + rx * sinR },
        layer: ent.layer,
      });
      setInputVal1(rx.toFixed(4));
      setInputVal2(ry.toFixed(4));
    } else if (ent.type === 'rectangle' && ent.pts.length >= 3) {
      const p0 = ent.pts[0],
        p2 = ent.pts[2];
      const w = Math.abs(p2.x - p0.x);
      const h = Math.abs(p2.y - p0.y);
      setDimPrompt({
        entityId: ent.id,
        type: 'rectangle',
        worldPos: { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 },
        val1: w.toFixed(4),
        val2: h.toFixed(4),
        label1: 'W',
        label2: 'H',
        basePt: p0,
        endPt: p2,
        layer: ent.layer,
      });
      setInputVal1(w.toFixed(4));
      setInputVal2(h.toFixed(4));
    } else if (ent.type === 'arc' && ent.pts.length >= 3) {
      const [c, s, e] = ent.pts;
      const r = dist(c, s);
      const sa = ent.startAngle ?? Math.atan2(s.y - c.y, s.x - c.x);
      const ea = ent.endAngle ?? Math.atan2(e.y - c.y, e.x - c.x);
      const sweepDeg = (((ea - sa) * 180) / Math.PI + 360) % 360;
      setDimPrompt({
        entityId: ent.id,
        type: 'arc',
        worldPos: { x: (c.x + e.x) / 2, y: (c.y + e.y) / 2 },
        val1: r.toFixed(4),
        val2: sweepDeg.toFixed(1),
        label1: 'R',
        label2: '∠',
        basePt: c,
        endPt: e,
        layer: ent.layer,
      });
      setInputVal1(r.toFixed(4));
      setInputVal2(sweepDeg.toFixed(1));
    }
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (displayOnly) return;
      // Only the select tool reacts to double-click. While a draw/modify tool is
      // active, the two quick clicks that place a rectangle/arc corner must not
      // also be read as a double-click (which used to recenter the view / open a
      // dimension prompt and make it look like the tool "did nothing").
      if (tool !== 'select') return;
      const rawPt = toWorld(e.clientX, e.clientY);
      const clickedId = findEntityAt(rawPt);
      if (clickedId) {
        const ent = cadState.entities.find((el) => el.id === clickedId);
        if (ent) {
          dispatch({ type: 'SELECT_ENTITY', id: clickedId });
          openDimPromptForEntity(ent);
          setTool('select');
          setCmdText('Edit dimensions with Tab+Enter, or Esc to close.');
          return;
        }
      }
      // Double click on empty space -> center to origin
      setPan({ x: 0, y: 0 });
      setZoom(INITIAL_ZOOM);
      setCmdText('View centered to origin (0, 0).');
    },
    [tool, toWorld, findEntityAt, cadState.entities, openDimPromptForEntity],
  );

  const commitDimension = useCallback(
    (prompt: DynamicDimPrompt, val1Str: string, val2Str?: string) => {
      const v1 = parseFloat(val1Str);
      const v2 = val2Str !== undefined ? parseFloat(val2Str) : NaN;
      if (isNaN(v1) || v1 <= 0) {
        setDimPrompt(null);
        return;
      }

      const { entityId, type, basePt, endPt } = prompt;

      if (type === 'line' && endPt) {
        const currentAng = Math.atan2(endPt.y - basePt.y, endPt.x - basePt.x);
        const rad = !isNaN(v2) ? (v2 * Math.PI) / 180 : currentAng;
        const newEnd: Point2D = {
          x: +(basePt.x + v1 * Math.cos(rad)).toFixed(5),
          y: +(basePt.y + v1 * Math.sin(rad)).toFixed(5),
        };
        dispatch({
          type: 'REPLACE_ENTITIES',
          entities: cadState.entities.map((e) =>
            e.id === entityId ? { ...e, pts: [basePt, newEnd] } : e,
          ),
        });
        // Shift start point of next chained line to the updated endpoint
        setTempPts((prev) => {
          if (prev.length > 0 && dist(prev[prev.length - 1], endPt) < 1e-3) {
            return [newEnd];
          }
          return prev;
        });
        setCmdText(
          `Line dimensioned: L=${v1}m, ∠=${(!isNaN(v2) ? v2 : (currentAng * 180) / Math.PI).toFixed(1)}°`,
        );
      } else if (type === 'rectangle' && endPt) {
        const w = v1 * Math.sign(endPt.x - basePt.x || 1);
        const h =
          (!isNaN(v2) && v2 > 0 ? v2 : Math.abs(endPt.y - basePt.y)) *
          Math.sign(endPt.y - basePt.y || 1);
        const p0 = basePt;
        const p1 = { x: +(p0.x + w).toFixed(5), y: p0.y };
        const p2 = { x: +(p0.x + w).toFixed(5), y: +(p0.y + h).toFixed(5) };
        const p3 = { x: p0.x, y: +(p0.y + h).toFixed(5) };
        dispatch({
          type: 'REPLACE_ENTITIES',
          entities: cadState.entities.map((e) =>
            e.id === entityId ? { ...e, pts: [p0, p1, p2, p3] } : e,
          ),
        });
        setCmdText(`Rectangle dimensioned: W=${Math.abs(w)}m, H=${Math.abs(h)}m`);
      } else if (type === 'circle') {
        const r = v1;
        dispatch({
          type: 'REPLACE_ENTITIES',
          entities: cadState.entities.map((e) =>
            e.id === entityId
              ? { ...e, radius: r, pts: [basePt, { x: basePt.x + r, y: basePt.y }] }
              : e,
          ),
        });
        setCmdText(`Circle dimensioned: R=${r}m (Ø=${(r * 2).toFixed(3)}m)`);
      } else if (type === 'ellipse') {
        const rx = v1;
        const ry = !isNaN(v2) && v2 > 0 ? v2 : rx * 0.5;
        dispatch({
          type: 'REPLACE_ENTITIES',
          entities: cadState.entities.map((e) => {
            if (e.id !== entityId) return e;
            const rot = e.rotation || 0;
            const p1 = {
              x: +(basePt.x + rx * Math.cos(rot)).toFixed(5),
              y: +(basePt.y + rx * Math.sin(rot)).toFixed(5),
            };
            return {
              ...e,
              rx,
              ry,
              pts: [basePt, p1],
            };
          }),
        });
        setCmdText(`Ellipse dimensioned: Rx=${rx}m, Ry=${ry}m`);
      } else if (type === 'arc' && endPt) {
        const r = v1;
        const sa = Math.atan2(endPt.y - basePt.y, endPt.x - basePt.x);
        const sweepRad = !isNaN(v2) ? (v2 * Math.PI) / 180 : Math.PI / 2;
        const ea = sa + sweepRad;
        const p1 = {
          x: +(basePt.x + r * Math.cos(sa)).toFixed(5),
          y: +(basePt.y + r * Math.sin(sa)).toFixed(5),
        };
        const p2 = {
          x: +(basePt.x + r * Math.cos(ea)).toFixed(5),
          y: +(basePt.y + r * Math.sin(ea)).toFixed(5),
        };
        dispatch({
          type: 'REPLACE_ENTITIES',
          entities: cadState.entities.map((e) =>
            e.id === entityId ? { ...e, pts: [basePt, p1, p2], startAngle: sa, endAngle: ea } : e,
          ),
        });
        setCmdText(`Arc dimensioned: R=${r}m, ∠=${(!isNaN(v2) ? v2 : 90).toFixed(1)}°`);
      }

      setDimPrompt(null);
    },
    [cadState.entities],
  );

  // Autofocus the first dimension field whenever a dimension prompt opens
  useEffect(() => {
    if (dimPrompt) {
      const timer = setTimeout(() => {
        input1Ref.current?.focus();
        input1Ref.current?.select();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [dimPrompt?.entityId]);

  // While the live (still-drawing) box has typed values, drive the rubber-band
  // preview from them instead of the mouse - the canvas paint code already
  // reads `snap.pt` for that preview, so this is the only place that needs to
  // know about typed vs. mouse-driven input. Direction/angle for a rectangle
  // or circle still comes from wherever the mouse last pointed (`endPt`,
  // frozen the moment typing started), matching the typed magnitude to it.
  useEffect(() => {
    if (!manualDim || !dimPrompt?.live) return;
    const p0 = dimPrompt.basePt;
    const v1 = parseFloat(inputVal1);
    const v2 = parseFloat(inputVal2);
    const dir = dimPrompt.endPt ?? { x: p0.x + 1, y: p0.y };
    let pt: Point2D | null = null;
    if (dimPrompt.type === 'line' && !isNaN(v1)) {
      const rad = !isNaN(v2) ? (v2 * Math.PI) / 180 : Math.atan2(dir.y - p0.y, dir.x - p0.x);
      pt = { x: p0.x + v1 * Math.cos(rad), y: p0.y + v1 * Math.sin(rad) };
    } else if (dimPrompt.type === 'rectangle' && !isNaN(v1) && !isNaN(v2)) {
      const sx = Math.sign(dir.x - p0.x) || 1;
      const sy = Math.sign(dir.y - p0.y) || 1;
      pt = { x: p0.x + v1 * sx, y: p0.y + v2 * sy };
    } else if (dimPrompt.type === 'circle' && !isNaN(v1)) {
      const ang = Math.atan2(dir.y - p0.y, dir.x - p0.x);
      pt = { x: p0.x + v1 * Math.cos(ang), y: p0.y + v1 * Math.sin(ang) };
    } else if (dimPrompt.type === 'ellipse') {
      if (tempPts.length === 1 && !isNaN(v1)) {
        const ang = Math.atan2(dir.y - p0.y, dir.x - p0.x);
        pt = { x: p0.x + v1 * Math.cos(ang), y: p0.y + v1 * Math.sin(ang) };
      } else if (tempPts.length === 2 && !isNaN(v2) && tempPts[1]) {
        const rot = Math.atan2(tempPts[1].y - p0.y, tempPts[1].x - p0.x);
        const side =
          Math.sign(-(dir.x - p0.x) * Math.sin(rot) + (dir.y - p0.y) * Math.cos(rot)) || 1;
        pt = {
          x: p0.x + side * v2 * -Math.sin(rot),
          y: p0.y + side * v2 * Math.cos(rot),
        };
      }
    } else if (dimPrompt.type === 'arc' && !isNaN(v2) && tempPts[1]) {
      const r = !isNaN(v1) ? v1 : dist(p0, tempPts[1]);
      const sa = Math.atan2(tempPts[1].y - p0.y, tempPts[1].x - p0.x);
      const ea = sa + (v2 * Math.PI) / 180;
      pt = { x: p0.x + r * Math.cos(ea), y: p0.y + r * Math.sin(ea) };
    }
    if (pt) setSnap({ pt, type: 'origin', guides: [] });
  }, [inputVal1, inputVal2, manualDim, dimPrompt, tempPts]);

  const handleDimKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement === input1Ref.current && input2Ref.current) {
        input2Ref.current.focus();
        input2Ref.current.select();
      } else if (input1Ref.current) {
        input1Ref.current.focus();
        input1Ref.current.select();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (dimPrompt?.live) {
        commitPoint(snap.pt);
        setManualDim(false);
      } else if (dimPrompt) {
        commitDimension(dimPrompt, inputVal1, inputVal2);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (dimPrompt?.live) {
        setIsDrawing(false);
        setTempPts([]);
        setManualDim(false);
        setCmdText(`${tool.toUpperCase()}: Cancelled. Press Esc again to return to Select.`);
      }
      setDimPrompt(null);
    }
  };

  const commitPoint = useCallback(
    (pt: Point2D) => {
      const layer = constructionMode ? 'construction' : 'default';

      if (tool === 'line') {
        if (!isDrawing) {
          setTempPts([pt]);
          setIsDrawing(true);
          setManualDim(false);
          setDimPrompt({
            entityId: uid(),
            type: 'line',
            live: true,
            worldPos: pt,
            val1: '0.0000',
            val2: '0.0',
            label1: 'L',
            label2: '∠',
            basePt: pt,
            endPt: pt,
            layer,
          });
          setInputVal1('0.0000');
          setInputVal2('0.0');
          setCmdText(
            'LINE: Type Length, press Tab for Angle, Enter to commit - or click second point.',
          );
        } else {
          const newId = uid();
          const p0 = tempPts[0];
          dispatch({
            type: 'ADD_ENTITY',
            entity: { id: newId, type: 'line', layer, pts: [p0, pt] },
          });
          const len = dist(p0, pt);
          const ang = (Math.atan2(pt.y - p0.y, pt.x - p0.x) * 180) / Math.PI;
          setDimPrompt({
            entityId: newId,
            type: 'line',
            worldPos: { x: (p0.x + pt.x) / 2, y: (p0.y + pt.y) / 2 },
            val1: len.toFixed(4),
            val2: ang.toFixed(1),
            label1: 'L',
            label2: '∠',
            basePt: p0,
            endPt: pt,
            layer,
          });
          setInputVal1(len.toFixed(4));
          setInputVal2(ang.toFixed(1));
          setManualDim(false);
          setTempPts([pt]); // chain: start next line from here
          setCmdText('LINE: Type Length, press Tab for Angle, Enter to commit.');
        }
      } else if (tool === 'polyline') {
        if (!isDrawing) {
          setTempPts([pt]);
          setIsDrawing(true);
          setManualDim(false);
          setDimPrompt({
            entityId: uid(),
            type: 'line',
            live: true,
            worldPos: pt,
            val1: '0.0000',
            val2: '0.0',
            label1: 'L',
            label2: '∠',
            basePt: pt,
            endPt: pt,
            layer,
          });
          setInputVal1('0.0000');
          setInputVal2('0.0');
          setCmdText(
            'POLYLINE: Type Length, press Tab for Angle, Enter for next vertex - or click.',
          );
        } else {
          const s = tempPts[0];
          if (tempPts.length >= 2 && dist(pt, s) < 12 / zoom) {
            dispatch({
              type: 'ADD_ENTITY',
              entity: { id: uid(), type: 'polyline', layer, pts: tempPts, isClosed: true },
            });
            setIsDrawing(false);
            setTempPts([]);
            setDimPrompt(null);
            setManualDim(false);
            setCmdText('POLYLINE: Closed. Pick first point for next polyline.');
          } else {
            setTempPts((prev) => [...prev, pt]);
            setManualDim(false);
            setDimPrompt({
              entityId: uid(),
              type: 'line',
              live: true,
              worldPos: pt,
              val1: '0.0000',
              val2: '0.0',
              label1: 'L',
              label2: '∠',
              basePt: pt,
              endPt: pt,
              layer,
            });
            setInputVal1('0.0000');
            setInputVal2('0.0');
            setCmdText(
              'POLYLINE: Type Length, press Tab for Angle, Enter for next vertex - or click near start to close.',
            );
          }
        }
      } else if (tool === 'rectangle') {
        if (!isDrawing) {
          setTempPts([pt]);
          setIsDrawing(true);
          setManualDim(false);
          setDimPrompt({
            entityId: uid(),
            type: 'rectangle',
            live: true,
            worldPos: pt,
            val1: '0.0000',
            val2: '0.0000',
            label1: 'W',
            label2: 'H',
            basePt: pt,
            endPt: pt,
            layer,
          });
          setInputVal1('0.0000');
          setInputVal2('0.0000');
          setCmdText(
            'RECTANGLE: Type Width, press Tab for Height, Enter to commit - or pick opposite corner.',
          );
        } else {
          const p0 = tempPts[0];
          const newId = uid();
          const w = +(pt.x - p0.x).toFixed(5);
          const h = +(pt.y - p0.y).toFixed(5);
          dispatch({
            type: 'ADD_ENTITY',
            entity: {
              id: newId,
              type: 'rectangle',
              layer,
              pts: [p0, { x: pt.x, y: p0.y }, pt, { x: p0.x, y: pt.y }],
              isClosed: true,
            },
          });
          setDimPrompt({
            entityId: newId,
            type: 'rectangle',
            worldPos: { x: (p0.x + pt.x) / 2, y: (p0.y + pt.y) / 2 },
            val1: Math.abs(w).toFixed(4),
            val2: Math.abs(h).toFixed(4),
            label1: 'W',
            label2: 'H',
            basePt: p0,
            endPt: pt,
            layer,
          });
          setInputVal1(Math.abs(w).toFixed(4));
          setInputVal2(Math.abs(h).toFixed(4));
          setManualDim(false);
          setIsDrawing(false);
          setTempPts([]);
          setCmdText('RECTANGLE: Type Width, press Tab for Height, Enter to commit.');
        }
      } else if (tool === 'circle_center_radius') {
        if (!isDrawing) {
          setTempPts([pt]);
          setIsDrawing(true);
          setManualDim(false);
          setDimPrompt({
            entityId: uid(),
            type: 'circle',
            live: true,
            worldPos: pt,
            val1: '0.0000',
            val2: '0.0000',
            label1: 'R',
            label2: 'Ø',
            basePt: pt,
            endPt: pt,
            layer,
          });
          setInputVal1('0.0000');
          setInputVal2('0.0000');
          setCmdText('CIRCLE: Type Radius, Enter to commit - or pick point on circumference.');
        } else {
          const c = tempPts[0];
          const r = dist(c, pt);
          const newId = uid();
          dispatch({
            type: 'ADD_ENTITY',
            entity: { id: newId, type: 'circle', layer, pts: [c, pt], radius: r, isClosed: true },
          });
          setDimPrompt({
            entityId: newId,
            type: 'circle',
            worldPos: { x: c.x + r * 0.707, y: c.y + r * 0.707 },
            val1: r.toFixed(4),
            val2: (r * 2).toFixed(4),
            label1: 'R',
            label2: 'Ø',
            basePt: c,
            endPt: pt,
            layer,
          });
          setInputVal1(r.toFixed(4));
          setInputVal2((r * 2).toFixed(4));
          setManualDim(false);
          setIsDrawing(false);
          setTempPts([]);
          setCmdText('CIRCLE: Type Radius, press Enter to commit.');
        }
      } else if (tool === 'ellipse_center') {
        if (!isDrawing || tempPts.length === 0) {
          setTempPts([pt]);
          setIsDrawing(true);
          setManualDim(false);
          setDimPrompt({
            entityId: uid(),
            type: 'ellipse',
            live: true,
            worldPos: pt,
            val1: '0.0000',
            val2: '0.0000',
            label1: 'Rx',
            label2: 'Ry',
            basePt: pt,
            endPt: pt,
            layer,
          });
          setInputVal1('0.0000');
          setInputVal2('0.0000');
          setCmdText('ELLIPSE: Specify endpoint of major axis (or type Rx and press Tab/Enter).');
        } else if (tempPts.length === 1) {
          const c = tempPts[0];
          const v1Typed = parseFloat(inputVal1);
          let majorEnd = pt;
          if (manualDim && !isNaN(v1Typed) && v1Typed > 0) {
            const dir = dimPrompt?.endPt ?? pt;
            const ang = Math.atan2(dir.y - c.y, dir.x - c.x);
            majorEnd = { x: c.x + v1Typed * Math.cos(ang), y: c.y + v1Typed * Math.sin(ang) };
          }
          const rx = dist(c, majorEnd);
          if (rx < 1e-4) return;
          setTempPts([c, majorEnd]);
          const defaultRy = rx * 0.5;
          setDimPrompt({
            entityId: uid(),
            type: 'ellipse',
            live: true,
            worldPos: pt,
            val1: rx.toFixed(4),
            val2: defaultRy.toFixed(4),
            label1: 'Rx',
            label2: 'Ry',
            basePt: c,
            endPt: pt,
            layer,
          });
          setInputVal1(rx.toFixed(4));
          setInputVal2(defaultRy.toFixed(4));
          setManualDim(false);
          setCmdText('ELLIPSE: Specify distance for other axis (or type Ry and press Enter).');
        } else {
          const c = tempPts[0];
          const majorEnd = tempPts[1];
          const rx = dist(c, majorEnd);
          const rot = Math.atan2(majorEnd.y - c.y, majorEnd.x - c.x);
          const v2Typed = parseFloat(inputVal2);
          let ry: number;
          if (manualDim && !isNaN(v2Typed) && v2Typed > 0) {
            ry = v2Typed;
          } else {
            const ryCalc = Math.abs(-(pt.x - c.x) * Math.sin(rot) + (pt.y - c.y) * Math.cos(rot));
            ry = ryCalc < 1e-4 ? Math.max(1e-4, rx * 0.5) : ryCalc;
          }
          const newId = uid();
          dispatch({
            type: 'ADD_ENTITY',
            entity: {
              id: newId,
              type: 'ellipse',
              layer,
              pts: [c, majorEnd],
              rx,
              ry,
              rotation: rot,
              isClosed: true,
            },
          });
          setDimPrompt(null);
          setManualDim(false);
          setIsDrawing(false);
          setTempPts([]);
          setCmdText('ELLIPSE: Created.');
        }
      } else if (tool === 'arc_center') {
        if (tempPts.length === 0) {
          setTempPts([pt]);
          setIsDrawing(true);
          setDimPrompt(null);
          setCmdText('ARC: Pick start point on arc');
        } else if (tempPts.length === 1) {
          const c = tempPts[0];
          const r = dist(c, pt);
          setTempPts((prev) => [...prev, pt]);
          setManualDim(false);
          setDimPrompt({
            entityId: uid(),
            type: 'arc',
            live: true,
            worldPos: pt,
            val1: r.toFixed(4),
            val2: '90.0',
            label1: 'R',
            label2: '∠',
            basePt: c,
            endPt: pt,
            layer,
          });
          setInputVal1(r.toFixed(4));
          setInputVal2('90.0');
          setCmdText('ARC: Type Radius, press Tab for Sweep, Enter to commit - or pick end point.');
        } else {
          const [c, s, _] = tempPts;
          const sa = Math.atan2(s.y - c.y, s.x - c.x);
          const ea = Math.atan2(pt.y - c.y, pt.x - c.x);
          // A typed Radius during the live sweep-picking step overrides the
          // start point's own distance from the centre (it moves the start
          // point out/in along `sa` to match, same as the post-commit editor).
          const typedR =
            dimPrompt?.live && dimPrompt.type === 'arc' ? parseFloat(dimPrompt.val1) : NaN;
          const r = !isNaN(typedR) && typedR > 0 ? typedR : dist(c, s);
          const sNew =
            !isNaN(typedR) && typedR > 0
              ? { x: c.x + r * Math.cos(sa), y: c.y + r * Math.sin(sa) }
              : s;
          const sweepDeg = (((ea - sa) * 180) / Math.PI + 360) % 360;
          const newId = uid();
          dispatch({
            type: 'ADD_ENTITY',
            entity: {
              id: newId,
              type: 'arc',
              layer,
              pts: [c, sNew, pt],
              startAngle: sa,
              endAngle: ea,
            },
          });
          setManualDim(false);
          setDimPrompt({
            entityId: newId,
            type: 'arc',
            worldPos: { x: (c.x + pt.x) / 2, y: (c.y + pt.y) / 2 },
            val1: r.toFixed(4),
            val2: sweepDeg.toFixed(1),
            label1: 'R',
            label2: '∠',
            basePt: c,
            endPt: pt,
            layer,
          });
          setInputVal1(r.toFixed(4));
          setInputVal2(sweepDeg.toFixed(1));
          setIsDrawing(false);
          setTempPts([]);
          setCmdText('ARC: Type Radius, press Tab for Angle, Enter to commit.');
        }
      } else if (tool === 'construction_line') {
        if (!isDrawing) {
          setTempPts([pt]);
          setIsDrawing(true);
          setDimPrompt(null);
          setCmdText('XLINE: Pick second point to define infinite construction line direction');
        } else {
          dispatch({
            type: 'ADD_ENTITY',
            entity: {
              id: uid(),
              type: 'construction',
              layer: 'construction',
              pts: [tempPts[0], pt],
            },
          });
          setIsDrawing(false);
          setTempPts([]);
          setCmdText('XLINE: Pick first point');
        }
      }
    },
    [tool, isDrawing, tempPts, zoom, constructionMode, dimPrompt],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (displayOnly) return;
      if (panning.current) return;
      if (e.button !== 0) return;

      // If this click ended a marquee drag, don't also do a point-click action
      const dragDist = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y);
      if (tool === 'select' && dragDist > 4) return;

      const rawPt = toWorld(e.clientX, e.clientY);
      const snapPt = snap.pt;
      const hitR = 14 / zoom; // 14px pick tolerance in world coordinates

      // Tag a boundary edge ONLY when a tag tool is armed (a tag picked from the
      // palette) and the Select tool is active. Otherwise Select just selects and
      // drawing tools just draw - nothing is ever auto-tagged.
      if (activeTagTool && tool === 'select') {
        for (const edge of boundaryEdges) {
          const d = distToSegment(rawPt, edge.p0, edge.p1);
          if (d < 18 / zoom) {
            const ent = cadState.entities.find((en) => en.id === edge.entityId);
            const wholeEntity = ent?.type === 'circle' || ent?.type === 'ellipse';
            const targetKey = wholeEntity ? `${edge.entityId}_0` : edge.key;
            setEdgeTagMap((prev) => ({ ...prev, [targetKey]: activeTagTool }));
            setCmdText(
              `Tagged ${wholeEntity ? (ent?.type === 'ellipse' ? 'ellipse' : 'circle') : 'edge'} as ${activeTagTool.toUpperCase()}.`,
            );
            return;
          }
        }
      }

      if (tool === 'select') {
        const clickedId = findEntityAt(rawPt);
        dispatch({ type: 'SELECT_ENTITY', id: clickedId, multi: e.shiftKey });
        setDimPrompt(null);
        setCmdText(
          clickedId
            ? 'Entity selected. Double-click to edit dimensions, or Del to delete.'
            : 'SELECT: Click entity or drag box to select.',
        );
        return;
      }

      if (tool === 'trim') {
        const target = getTrimTarget(rawPt, cadState.entities, zoom);
        if (!target) {
          setCmdText('TRIM: click on a line to trim it.');
          return;
        }

        const { targetEnt, targetSegIdx, preservedSegs, preservedPolylines } = target;
        const otherEntities = cadState.entities.filter((e) => e.id !== targetEnt.id);
        const newSegments: CadEntity[] = [];

        if (preservedPolylines !== undefined) {
          for (const arc of preservedPolylines) {
            newSegments.push({
              id: uid(),
              type: 'polyline',
              layer: targetEnt.layer,
              pts: arc,
              isClosed: false,
              ...(targetEnt.role ? { role: targetEnt.role } : {}),
            });
          }
        } else {
          // If targetEnt was a multi-segment polyline/rectangle, preserve all other unmodified segments as individual lines
          if (targetEnt.pts.length > 2) {
            for (let i = 0; i < targetEnt.pts.length - 1; i++) {
              if (i !== targetSegIdx) {
                newSegments.push({
                  id: uid(),
                  type: 'line',
                  layer: targetEnt.layer,
                  pts: [targetEnt.pts[i], targetEnt.pts[i + 1]],
                });
              }
            }
            if (targetEnt.isClosed && targetSegIdx !== targetEnt.pts.length - 1) {
              newSegments.push({
                id: uid(),
                type: 'line',
                layer: targetEnt.layer,
                pts: [targetEnt.pts[targetEnt.pts.length - 1], targetEnt.pts[0]],
              });
            }
          }

          // Add the preserved sub-segments
          for (const seg of preservedSegs) {
            newSegments.push({
              id: uid(),
              type: 'line',
              layer: targetEnt.layer,
              pts: [seg.p0, seg.p1],
            });
          }
        }

        dispatch({ type: 'REPLACE_ENTITIES', entities: [...otherEntities, ...newSegments] });
        setHoveredTrim(null);
        setCmdText('TRIM: Portion trimmed at intersection.');
        return;
      }

      commitPoint(snapPt);
    },
    [snap, tool, cadState.entities, commitPoint, zoom, toWorld],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Never let canvas shortcuts (Delete, tool letters, Space/Enter, F-keys) fire
      // while the user is typing in a form field anywhere in the app. This is what
      // caused "backspace in a mesh input deleted my whole geometry".
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      // Outside the geometry stage the canvas is display-only: the CAD shortcuts
      // (Delete, tool letters) must not touch the geometry. In the Blocks view the
      // keys drive the block editor instead. Undo/redo still fall through.
      if (displayOnly && !e.ctrlKey && !e.metaKey) {
        if (showBlocking && canvasMode === 'cad') {
          const k = e.key.toLowerCase();
          if (e.key === 'Escape') {
            if (blockDrawPts.length) setBlockDrawPts([]);
            else if (blockPick) setBlockPick(null);
            else if (assocStage === 'curve') setAssocStage('edges');
            else if (assocEdges.length) setAssocEdges([]);
            else setBlockTool('select');
            setBlockMsg(null);
          } else if (
            e.key === 'Enter' &&
            blockTool === 'assoc' &&
            assocStage === 'edges' &&
            assocEdges.length
          ) {
            setAssocStage('curve');
          } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBlockId) {
            e.preventDefault();
            deleteBlockById(selectedBlockId);
          } else if (k === 'v') setBlockTool('select');
          else if (k === 'b') {
            setBlockTool('draw');
            setBlockDrawPts([]);
          } else if (k === 'k') setBlockTool('split');
          else if (k === 'x') setBlockTool('delete');
          else if (k === 'o') setBlockTool('ogrid');
          else if (k === 'm') setBlockTool('mergeV');
          else if (k === 'j') setBlockTool('mergeB');
          else if (k === 'a') setBlockTool('assoc');
        }
        return;
      }
      if (e.key === 'Escape') {
        if (isDrawing || tempPts.length > 0) {
          setIsDrawing(false);
          setTempPts([]);
          setCmdText(`${tool.toUpperCase()}: Cancelled. Press Esc again to return to Select.`);
        } else {
          // Nothing in progress -> return to select tool and clear any active selection
          dispatch({ type: 'SELECT_ENTITY', id: null });
          setTool('select');
          setCmdText('SELECT: Click entity/vertex or drag box to select.');
        }
      }

      if (e.key === 'Enter' || e.key === ' ') {
        // End polyline without closing, or confirm
        if (tool === 'polyline' && isDrawing && tempPts.length >= 2) {
          const layer = constructionMode ? 'construction' : 'default';
          dispatch({
            type: 'ADD_ENTITY',
            entity: { id: uid(), type: 'polyline', layer, pts: tempPts, isClosed: false },
          });
          setIsDrawing(false);
          setTempPts([]);
          setCmdText('POLYLINE: Done. Pick first point.');
        }
        if (tool === 'line' && isDrawing) {
          setIsDrawing(false);
          setTempPts([]);
          setCmdText('LINE: Done. Pick start point.');
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (lastEditRef.current === 'blocks' && blockUndoRef.current.length) {
          if (!undoBlocking()) undo();
        } else undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        if (lastEditRef.current === 'blocks' && blockRedoRef.current.length) {
          if (!redoBlocking()) redo();
        } else redo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        dispatch({ type: 'DELETE_SELECTED' });
      }
      if (e.key === 'F8') setOrtho((o) => !o);
      if (e.key === 'F3') setSnapEnabled((s) => !s);
      if (e.key === 'F7') setShowGrid((g) => !g);
      if (e.key === 'F9') setSnapSettings((s) => ({ ...s, grid: !s.grid }));
      if (e.key === 'l' || e.key === 'L') {
        setTool('line');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
      if (e.key === 'p' || e.key === 'P') {
        setTool('polyline');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
      if (e.key === 'r' || e.key === 'R') {
        setTool('rectangle');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
      if (e.key === 'c' || e.key === 'C') {
        setTool('circle_center_radius');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
      if (e.key === 'e' || e.key === 'E') {
        setTool('ellipse_center');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
      if (e.key === 'a' || e.key === 'A') {
        setTool('arc_center');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
      if (e.key === 's' || e.key === 'S') {
        setTool('select');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
      if (e.key === 't' || e.key === 'T') {
        setTool('trim');
        setIsDrawing(false);
        setTempPts([]);
        setDimPrompt(null);
        setManualDim(false);
      }
    },
    [
      tool,
      isDrawing,
      tempPts,
      constructionMode,
      undo,
      redo,
      undoBlocking,
      redoBlocking,
      displayOnly,
      showBlocking,
      canvasMode,
      blockDrawPts,
      selectedBlockId,
      deleteBlockById,
      blockPick,
      assocStage,
      assocEdges,
      blockTool,
    ],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Handle file import from Left Panel ───────────────────────────────────────
  useEffect(() => {
    if (!pendingImportFile) return;
    const load = async () => {
      setIsLoading(true);
      try {
        if (pendingImportFile.type === 'parsed') {
          const pts = pendingImportFile.points;
          const segments = pointsToLineSegments(pts, 'geometry');
          dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
          setCadName(pendingImportFile.name);
          setCmdText(`Imported: ${pendingImportFile.name} (closed airfoil profile)`);
          setPan({ x: -120, y: 0 });
          setZoom(240);
        } else if (pendingImportFile.type === 'airfoil' && pendingImportFile.file) {
          const res = await uploadAndParseAirfoil(pendingImportFile.file);
          const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
          const segments = pointsToLineSegments(pts, 'geometry');
          dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
          setCadName(res.name || pendingImportFile.file.name);
          setCmdText(`Imported: ${res.name} (closed airfoil profile)`);
          setPan({ x: -120, y: 0 });
          setZoom(240);
        } else if (pendingImportFile.type === 'url' && pendingImportFile.url) {
          const res = await fetchAndParseAirfoilFromUrl(pendingImportFile.url);
          const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
          const segments = pointsToLineSegments(pts, 'geometry');
          dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
          setCadName(res.name || 'Airfoil from Link');
          setCmdText(`Imported from Link: ${res.name} (closed airfoil profile)`);
          setPan({ x: -120, y: 0 });
          setZoom(240);
        } else if (pendingImportFile.type === 'dxf' && pendingImportFile.file) {
          const res = await uploadAndParseDxf(pendingImportFile.file);
          const newEnts: CadEntity[] = [];
          for (const p of res.polylines || []) {
            const pts: Point2D[] = p.points.map(([x, y]: number[]) => ({ x, y }));
            newEnts.push({
              id: uid(),
              type: 'polyline',
              layer: 'default',
              pts,
              isClosed: p.is_closed,
            });
          }
          for (const l of res.lines || []) {
            newEnts.push({
              id: uid(),
              type: 'line',
              layer: 'default',
              pts: [
                { x: l.x1, y: l.y1 },
                { x: l.x2, y: l.y2 },
              ],
            });
          }
          if (newEnts.length) {
            dispatch({ type: 'REPLACE_ENTITIES', entities: newEnts });
            setCadName(pendingImportFile.file.name);
            setCmdText(`Imported DXF: ${newEnts.length} entities`);
          }
        }
      } catch (err: any) {
        setCmdText(`Import error: ${err.message}`);
      }
      setIsLoading(false);
      onClearPendingImport?.();
    };
    load();
  }, [pendingImportFile, onClearPendingImport]);

  // ── Apply fillet ─────────────────────────────────────────────────────────────
  const applyFillet = async () => {
    setIsLoading(true);
    const updated = [...cadState.entities];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].pts.length >= 3) {
        try {
          const res = await requestFillet(
            updated[i].pts.map((p) => [p.x, p.y]),
            filletR,
          );
          updated[i] = { ...updated[i], pts: res.map(([x, y]: number[]) => ({ x, y })) };
        } catch {
          /* skip */
        }
      }
    }
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`Fillet R=${filletR}m applied.`);
    setIsLoading(false);
  };

  const applyOffset = async () => {
    setIsLoading(true);
    const updated = [...cadState.entities];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].pts.length >= 2) {
        try {
          const res = await requestOffset(
            updated[i].pts.map((p) => [p.x, p.y]),
            offsetD,
          );
          updated[i] = { ...updated[i], pts: res.map(([x, y]: number[]) => ({ x, y })) };
        } catch {
          /* skip */
        }
      }
    }
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`Offset ${offsetD}m applied.`);
    setIsLoading(false);
  };

  // ── 6-Step Workflow Actions ──────────────────────────────────────────────────

  const handleGenerateDomain = useCallback(() => {
    const existingDomain = cadState.entities.find((e) => e.role === 'domain_boundary');
    const newDomain = createDomainEntity(
      domainShape,
      geometryBBox,
      upstreamChordFactor,
      downstreamChordFactor,
      lateralHeightFactor,
      existingDomain?.id,
    );
    const otherEnts = cadState.entities.filter((e) => e.role !== 'domain_boundary');
    dispatch({ type: 'REPLACE_ENTITIES', entities: [...otherEnts, newDomain] });
    setCmdText(
      `DOMAIN: Generated ${domainShape.toUpperCase().replace('_', '-')} domain (←${upstreamChordFactor}c, →${downstreamChordFactor}c, ↕${lateralHeightFactor}c).`,
    );

    // Auto-fit camera so the generated domain completely comes into picture
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const p of newDomain.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX !== Infinity) {
      fitBoundingBox({ minX, maxX, minY, maxY }, 0.7);
    }

    // Subtle outward expansion animation
    setDomainAnimScale(0.85);
    const start = performance.now();
    const duration = 260;
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      // Cubic ease out
      const ease = 1 - Math.pow(1 - progress, 3);
      setDomainAnimScale(0.85 + 0.15 * ease);
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, [
    domainShape,
    geometryBBox,
    upstreamChordFactor,
    downstreamChordFactor,
    lateralHeightFactor,
    cadState.entities,
    fitBoundingBox,
  ]);

  const handleSetSelectedAsDomain = useCallback(() => {
    const selIds = new Set(cadState.entities.filter((e) => e.selected).map((e) => e.id));
    if (selIds.size === 0) {
      setCmdText(
        'DOMAIN: Select the loop (or all its segments) first, then click "Use selected loop as the domain".',
      );
      toast('Select the boundary loop on the canvas first.', 'info');
      return;
    }
    const updated = cadState.entities.map((e) => {
      if (selIds.has(e.id)) {
        // Manual domain: never gets autoDomain, so it is never regenerated.
        const { autoDomain, ...rest } = e;
        return { ...rest, role: 'domain_boundary' as const };
      }
      // Demote any previous auto far-field so it stops tracking the sliders.
      if (e.role === 'domain_boundary') {
        const { autoDomain, ...rest } = e;
        return { ...rest, role: 'geometry' as const };
      }
      return e;
    });
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(
      `DOMAIN: ${selIds.size} ${selIds.size === 1 ? 'edge' : 'edges'} set as the fluid domain boundary.`,
    );
    toast('Fluid domain defined.', 'success');
  }, [cadState.entities]);

  const handleSetSelectedAsGeometry = useCallback(() => {
    const selectedCount = cadState.entities.filter((e) => e.selected).length;
    if (selectedCount === 0) {
      setCmdText(
        'GEOMETRY: Select one or more curves/entities on canvas first, then click "Set Selected as Geometry".',
      );
      return;
    }
    const updated = cadState.entities.map((e) => {
      if (e.selected) {
        return { ...e, role: 'geometry' as const, layer: 'geometry' as const };
      }
      return e;
    });
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`GEOMETRY: ${selectedCount} entity/entities designated as CFD Obstacle Geometry.`);
  }, [cadState.entities]);

  const handleSelectAllGeometry = useCallback(() => {
    const geomCount = cadState.entities.filter(
      (e) => e.layer !== 'construction' && e.role !== 'domain_boundary',
    ).length;
    if (geomCount === 0) {
      setCmdText('GEOMETRY: No obstacle geometry found on canvas.');
      return;
    }
    const updated = cadState.entities.map((e) => ({
      ...e,
      selected: e.layer !== 'construction' && e.role !== 'domain_boundary',
    }));
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`GEOMETRY: Selected ${geomCount} obstacle entities on canvas.`);
  }, [cadState.entities]);

  const handleClearGeometry = useCallback(() => {
    const remaining = cadState.entities.filter((e) => e.role === 'domain_boundary');
    dispatch({ type: 'REPLACE_ENTITIES', entities: remaining });
    setCmdText('GEOMETRY: Cleared all obstacle geometry from canvas.');
  }, [cadState.entities]);

  const handleAutoSuggestTags = useCallback(() => {
    const suggested = autoSuggestBoundaryTags(boundaryEdges, angleOfAttackDeg, flowType);
    setEdgeTagMap((prev) => ({ ...prev, ...suggested }));
    setCmdText(
      `TAGGING: Auto-suggested boundary conditions for AoA = ${angleOfAttackDeg.toFixed(1)}°.`,
    );
  }, [boundaryEdges, angleOfAttackDeg, flowType]);

  const handleMeshHandoff = useCallback(async () => {
    const geomProfile = cadState.entities.find(
      (e) => e.layer !== 'construction' && e.role !== 'domain_boundary' && e.pts.length >= 2,
    );
    if (!geomProfile && flowType === 'external') {
      setCmdText('ERROR: No obstacle geometry profile found in canvas.');
      return;
    }
    setIsLoading(true);
    setCmdText('Extruding 2D sketch to OpenFOAM 2D mesh (1 cell in Z)...');
    try {
      const pts = geomProfile
        ? geomProfile.pts.map((p) => [p.x, p.y])
        : [
            [0, 0],
            [1, 0],
            [1, 0.2],
            [0, 0.2],
          ];
      const mesh = await requestMeshFromSketch({
        sketch_points: pts,
        domain_length: domainLength,
        domain_height: domainHeight,
        resolution,
        first_layer_mm: firstLayerMm,
      });
      onApplySketchMesh(mesh, cadName);
      setCmdText(`Mesh ready: ${mesh.num_nodes} nodes, ${mesh.num_elements} elements.`);
    } catch (err: any) {
      setCmdText(`Meshing error: ${err.message}`);
    }
    setIsLoading(false);
  }, [
    cadState.entities,
    flowType,
    domainLength,
    domainHeight,
    resolution,
    firstLayerMm,
    onApplySketchMesh,
    cadName,
  ]);

  const handleDownloadBlockMeshDict = useCallback(() => {
    const content = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2312                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}
// Flow Type: ${flowType.toUpperCase()}
// Angle of Attack: ${angleOfAttackDeg.toFixed(2)} deg
// Freestream Velocity: ${freestreamVelocity.toFixed(2)} m/s

convertToMeters 1.0;

vertices
(
    // 2D Extruded 1-cell in Z (-0.05 to +0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.minY.toFixed(4)} -0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.minY.toFixed(4)} -0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)} -0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)} -0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.minY.toFixed(4)}  0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.minY.toFixed(4)}  0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)}  0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)}  0.05)
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (100 50 1) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    inlet
    {
        type patch;
        faces
        (
            (0 4 7 3)
        );
    }
    outlet
    {
        type patch;
        faces
        (
            (1 2 6 5)
        );
    }
    walls
    {
        type wall;
        faces
        (
            (0 1 5 4)
            (3 7 6 2)
        );
    }
    frontAndBack
    {
        type empty;
        faces
        (
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);
`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blockMeshDict';
    a.click();
    URL.revokeObjectURL(url);
    setCmdText('EXPORT: Downloaded OpenFOAM blockMeshDict.');
  }, [flowType, angleOfAttackDeg, freestreamVelocity, geometryBBox]);

  // Synchronize actions to parent refs for LeftStagePanel triggers
  useEffect(() => {
    if (onRequestGenerateDomainRef) onRequestGenerateDomainRef.current = handleGenerateDomain;
    if (onRequestSetSelectedAsDomainRef)
      onRequestSetSelectedAsDomainRef.current = handleSetSelectedAsDomain;
    if (onRequestSetSelectedAsGeometryRef)
      onRequestSetSelectedAsGeometryRef.current = handleSetSelectedAsGeometry;
    if (onRequestSelectAllGeometryRef)
      onRequestSelectAllGeometryRef.current = handleSelectAllGeometry;
    if (onRequestClearGeometryRef) onRequestClearGeometryRef.current = handleClearGeometry;
    if (onRequestAutoSuggestTagsRef) onRequestAutoSuggestTagsRef.current = handleAutoSuggestTags;
    if (onRequestMeshHandoffRef) onRequestMeshHandoffRef.current = handleMeshHandoff;
    if (onRequestDownloadBlockMeshDictRef)
      onRequestDownloadBlockMeshDictRef.current = handleDownloadBlockMeshDict;
  });

  // ── Toolbar button helper ─────────────────────────────────────────────────────
  const Btn = ({
    t,
    icon,
    label,
    kbd,
  }: {
    t: CadTool;
    icon: React.ReactNode;
    label: string;
    kbd?: string;
  }) => (
    <button
      type="button"
      title={`${label}${kbd ? ` [${kbd}]` : ''}`}
      aria-label={`${label} tool${kbd ? ` (${kbd})` : ''}`}
      aria-pressed={tool === t}
      onClick={() => {
        setTool(t);
        setIsDrawing(false);
        setTempPts([]);
        setCmdText(`${label}: ${prompt_for(t)}`);
      }}
      className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-medium transition-colors min-w-[42px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563EB] ${
        tool === t
          ? 'bg-[#2563EB] text-white '
          : 'text-[#69717D] hover:bg-white hover:text-[#171A1F]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const prompt_for = (t: CadTool) => {
    const m: Partial<Record<CadTool, string>> = {
      select: 'click entity/vertex or drag box',
      line: 'pick first point',
      polyline: 'pick first vertex',
      rectangle: 'pick first corner',
      circle_center_radius: 'pick center',
      ellipse_center: 'pick center, then major axis endpoint, then minor axis',
      arc_center: 'pick center, then start point, then end point',
      construction_line: 'pick two points for an infinite reference line',
      trim: 'click a line to remove it (or the piece between two crossings)',
    };
    return m[t] ?? '';
  };

  const selectedCount = cadState.entities.filter((e) => e.selected).length;

  return (
    <div
      className="relative w-full h-full flex flex-col bg-white overflow-hidden"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      {/* ═══════════════════════════════ CAD TOOLBAR ═══════════════════════════════ */}
      <div
        className={`shrink-0 bg-[#F5F6F8] border-b border-[#E1E4E8] px-2 py-1 flex items-center gap-1 flex-wrap ${displayOnly ? 'hidden' : ''}`}
      >
        {/* ── File/Edit Group ────── */}
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <button
            title="Undo [Ctrl+Z]"
            onClick={undo}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            title="Redo [Ctrl+Y]"
            onClick={redo}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            title="Delete Selected [Del]"
            onClick={() => dispatch({ type: 'DELETE_SELECTED' })}
            disabled={selectedCount === 0}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#DC2626] disabled:opacity-30 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            title="Clear All"
            onClick={() => {
              dispatch({ type: 'CLEAR' });
              setCmdText('Canvas cleared.');
            }}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#DC2626] transition-colors"
          >
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        {/* ── Select Group ──────── */}
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <Btn t="select" icon={<MousePointer2 className="w-4 h-4" />} label="Select" kbd="S" />
        </div>

        {/* ── Create Group ─────── */}
        <span className="text-[9px] font-semibold text-[#A5ACB5] uppercase tracking-wider px-1">
          Draw
        </span>
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <Btn t="line" icon={<Minus className="w-4 h-4" />} label="Line" kbd="L" />
          <Btn t="polyline" icon={<ArrowUpRight className="w-4 h-4" />} label="Pline" kbd="P" />
          <Btn t="rectangle" icon={<Square className="w-4 h-4" />} label="Rect" kbd="R" />
          <Btn
            t="circle_center_radius"
            icon={<Circle className="w-4 h-4" />}
            label="Circle"
            kbd="C"
          />
          <Btn
            t="ellipse_center"
            icon={<CircleDot className="w-4 h-4" />}
            label="Ellipse"
            kbd="E"
          />
          <Btn t="arc_center" icon={<TriangleRight className="w-4 h-4" />} label="Arc" kbd="A" />
          <Btn t="construction_line" icon={<ScanLine className="w-4 h-4" />} label="XLine" />
        </div>

        {/* ── Modify Group ────── */}
        <span className="text-[9px] font-semibold text-[#A5ACB5] uppercase tracking-wider px-1">
          Modify
        </span>
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <button
            title="Fillet"
            onClick={applyFillet}
            disabled={isLoading}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${isLoading ? 'opacity-40' : 'text-[#69717D] hover:bg-white hover:text-[#171A1F]'}`}
          >
            <CornerUpRight className="w-4 h-4" />
            <span>Fillet</span>
          </button>
          <button
            title="Offset"
            onClick={applyOffset}
            disabled={isLoading}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${isLoading ? 'opacity-40' : 'text-[#69717D] hover:bg-white hover:text-[#171A1F]'}`}
          >
            <Maximize2 className="w-4 h-4" />
            <span>Offset</span>
          </button>
          <Btn t="trim" icon={<Scissors className="w-4 h-4" />} label="Trim" kbd="T" />
        </div>

        {/* ── Modify Params ──── */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-[#69717D] pr-2 border-r border-[#E1E4E8] mr-1">
          <label className="flex items-center gap-1">
            R:{' '}
            <input
              type="number"
              step="0.005"
              value={filletR}
              onChange={(e) => setFilletR(+e.target.value)}
              className="w-14 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-right text-[#171A1F] font-mono text-[10px]"
            />
          </label>
          <label className="flex items-center gap-1">
            Δd:{' '}
            <input
              type="number"
              step="0.005"
              value={offsetD}
              onChange={(e) => setOffsetD(+e.target.value)}
              className="w-14 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-right text-[#171A1F] font-mono text-[10px]"
            />
          </label>
        </div>

        {/* ── View Controls ──── */}
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <button
            title="Zoom In"
            onClick={() => setZoom((z) => Math.min(25000, z * 1.35))}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            title="Zoom Out"
            onClick={() => setZoom((z) => Math.max(0.5, z / 1.35))}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            title="Fit to Screen"
            onClick={() => {
              if (showMesh && meshData?.nodes?.length) {
                fitBoundingBox(
                  nodesBBox(meshData.nodes),
                  0.72,
                );
                return;
              }
              const allGeom = cadState.entities.filter((e) => e.layer !== 'construction');
              if (allGeom.length > 0) {
                let minX = Infinity,
                  maxX = -Infinity,
                  minY = Infinity,
                  maxY = -Infinity;
                for (const ent of allGeom) {
                  for (const p of ent.pts) {
                    if (p.x < minX) minX = p.x;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.y > maxY) maxY = p.y;
                  }
                }
                if (minX !== Infinity && maxX !== -Infinity) {
                  fitBoundingBox({ minX, maxX, minY, maxY }, 0.72);
                  return;
                }
              }
              const bottomBarPx =
                parseFloat(
                  getComputedStyle(document.documentElement).getPropertyValue('--app-bottom-bar'),
                ) || 32;
              setZoom(INITIAL_ZOOM);
              setPan({ x: 0, y: -(bottomBarPx / 2) });
            }}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>

        {/* ── Snap / Drafting Toggles ──── */}
        <div className="flex items-center gap-1">
          {[
            {
              label: 'GRID',
              title: 'Grid visible (F7)',
              state: showGrid,
              toggle: () => setShowGrid((g) => !g),
              icon: <Grid3x3 className="w-3 h-3" />,
            },
            {
              label: 'G-SNAP',
              title: 'Snap to grid (F9)',
              state: snapSettings.grid,
              toggle: () => setSnapSettings((s) => ({ ...s, grid: !s.grid })),
              icon: <Grid3x3 className="w-3 h-3" />,
            },
            {
              label: 'SNAP',
              title: 'Object snap / OSNAP, all inferences (F3)',
              state: snapEnabled,
              toggle: () => setSnapEnabled((s) => !s),
              icon: <Magnet className="w-3 h-3" />,
            },
            {
              label: 'ORTHO',
              title: 'Ortho lock - constrain to horizontal / vertical (F8)',
              state: ortho,
              toggle: () => setOrtho((o) => !o),
              icon: <Crosshair className="w-3 h-3" />,
            },
            {
              label: 'ANGLE',
              title: `Angle tracking in ${snapSettings.polarStepDeg}° steps`,
              state: snapSettings.polar,
              toggle: () => setSnapSettings((s) => ({ ...s, polar: !s.polar })),
              icon: <Compass className="w-3 h-3" />,
            },
            {
              label: 'CONSTR',
              title: 'Construction layer: new geometry is drawn as non-solid reference lines',
              state: constructionMode,
              toggle: () => setConstructionMode((c) => !c),
              icon: <ScanLine className="w-3 h-3" />,
            },
          ].map(({ label, title, state: on, toggle, icon }) => (
            <button
              key={label}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={on}
              onClick={toggle}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563EB] ${
                on
                  ? 'bg-[#2563EB] text-white border-[#2563EB]'
                  : 'bg-white text-[#69717D] border-[#E1E4E8] hover:border-[#2563EB]'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}

          {/* ── Drafting settings popover ──── */}
          <div className="relative" ref={draftingRef}>
            <button
              type="button"
              title="Drafting & snap settings"
              aria-label="Drafting and snap settings"
              aria-haspopup="dialog"
              aria-expanded={draftingOpen}
              onClick={() => setDraftingOpen((o) => !o)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#2563EB] ${
                draftingOpen
                  ? 'bg-[#2563EB] text-white border-[#2563EB]'
                  : 'bg-white text-[#69717D] border-[#E1E4E8] hover:border-[#2563EB]'
              }`}
            >
              <Sliders className="w-3 h-3" />
              <span>DRAFT</span>
            </button>

            {draftingOpen && (
              <div
                role="dialog"
                aria-label="Drafting and snap settings"
                className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-white border border-[#E1E4E8] rounded-sm shadow-lg p-3 text-[11px] text-[#171A1F]"
              >
                <label className="flex items-center gap-1.5 pb-2 mb-2 border-b border-[#EDEFF3] font-semibold cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={snapEnabled}
                    onChange={(e) => setSnapEnabled(e.target.checked)}
                    className="accent-[#2563EB]"
                  />
                  <span>Snapping enabled</span>
                  <span className="ml-auto text-[10px] font-normal text-[#8A929E]">F3</span>
                </label>

                <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">
                  Snap to
                </span>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {(
                    [
                      ['endpoint', 'Endpoints'],
                      ['midpoint', 'Midpoints'],
                      ['center', 'Centres'],
                      ['quadrant', 'Quadrants'],
                      ['intersection', 'Intersections'],
                      ['perpendicular', 'Perpendicular'],
                      ['parallel', 'Parallel'],
                      ['onCurve', 'On edge'],
                      ['alignment', 'Align guides'],
                      ['grid', 'Grid snap'],
                    ] as [SnapBoolKey, string][]
                  ).map(([k, lbl]) => (
                    <label
                      key={k}
                      className="flex items-center gap-1.5 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(snapSettings[k])}
                        onChange={(e) => setSnapSettings((s) => ({ ...s, [k]: e.target.checked }))}
                        className="accent-[#2563EB]"
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>

                <div className="mt-3 pt-3 border-t border-[#EDEFF3]">
                  <label className="flex items-center justify-between gap-2 cursor-pointer select-none">
                    <span className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={snapSettings.polar}
                        onChange={(e) => setSnapSettings((s) => ({ ...s, polar: e.target.checked }))}
                        className="accent-[#2563EB]"
                      />
                      <span>Angle tracking</span>
                    </span>
                    <select
                      value={snapSettings.polarStepDeg}
                      disabled={!snapSettings.polar}
                      onChange={(e) =>
                        setSnapSettings((s) => ({ ...s, polarStepDeg: Number(e.target.value) }))
                      }
                      className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[11px] disabled:opacity-40"
                    >
                      {POLAR_STEP_CHOICES.map((d) => (
                        <option key={d} value={d}>
                          {d}°
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-3 pt-3 border-t border-[#EDEFF3] flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#8A929E] leading-tight">
                    F3 snap · F7 grid · F8 ortho · F9 grid snap
                  </span>
                  <button
                    type="button"
                    onClick={() => setSnapSettings({ ...DEFAULT_SNAP_SETTINGS })}
                    className="px-2 py-0.5 rounded border border-[#E1E4E8] text-[10px] font-semibold text-[#69717D] hover:text-[#171A1F] hover:border-[#2563EB] transition-colors shrink-0"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════════════════════ CANVAS ════════════════════════════════════════════ */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden outline-none focus:outline-none"
        style={{
          cursor: isPickingPlotPoints
            ? 'crosshair'
            : draggingDomainHandle
              ? draggingDomainHandle === 'top' || draggingDomainHandle === 'bottom'
                ? 'ns-resize'
                : 'ew-resize'
              : hoveredDomainHandle
                ? hoveredDomainHandle === 'top' || hoveredDomainHandle === 'bottom'
                  ? 'ns-resize'
                  : 'ew-resize'
                : draggingAoAHandle || hoveredAoAHandle
                  ? 'crosshair'
                  : showBlocking && canvasMode === 'cad' && blockTool !== 'select'
                    ? blockTool === 'delete'
                      ? 'pointer'
                      : 'crosshair'
                    : tool === 'select'
                      ? 'default'
                      : 'crosshair',
        }}
      >
        {/* Top Controls Bar - only when it actually has controls (blocks/mesh
            toggle in CAD/mesh stages, overlay toggles in Results). The solver
            stage has neither, so no empty pill. */}
        {displayOnly && (!meshOnly || showField) && (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-white border border-[#E1E4E8] rounded px-2 py-1 text-xs select-none">
            {!meshOnly ? (
              <>
                {[
                  // "Blocks" only exists for structured meshing (showBlocking).
                  ...(showBlocking
                    ? [
                        {
                          id: 'blocks',
                          label: 'Blocks',
                          active: canvasMode === 'cad',
                          disabled: false,
                          title: undefined as string | undefined,
                          onClick: () => setCanvasMode('cad'),
                        },
                      ]
                    : []),
                  {
                    id: 'mesh',
                    label: 'Mesh',
                    active: canvasMode === 'mesh' && !showMeshQuality,
                    disabled: !meshData || meshStale,
                    title: undefined as string | undefined,
                    onClick: () => {
                      setCanvasMode('mesh');
                      setShowMeshQuality(false);
                    },
                  },
                  {
                    id: 'quality',
                    label: 'Quality',
                    active: canvasMode === 'mesh' && showMeshQuality,
                    disabled: !meshData || meshStale,
                    title: 'Colour each cell by skewness - spot bad cells before solving',
                    onClick: () => {
                      setCanvasMode('mesh');
                      setShowMeshQuality(true);
                    },
                  },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => !m.disabled && m.onClick()}
                    disabled={m.disabled}
                    title={m.title || (m.disabled ? 'Generate a mesh first' : undefined)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                      m.active
                        ? 'bg-[#F5F6F8] text-[#171A1F] font-semibold'
                        : 'text-[#69717D] hover:text-[#171A1F] disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
                {meshStale && showMesh && (
                  <span className="ml-1 text-[10px] text-[#D97706] font-medium">
                    stale - regenerate
                  </span>
                )}
              </>
            ) : showField ? (
              <div className="flex items-center gap-1">
                {/* Mesh Wireframe Toggle */}
                <button
                  onClick={() => setShowMeshWireframe((w) => !w)}
                  title="Toggle Mesh Cells Wireframe Overlay"
                  className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                    showMeshWireframe
                      ? 'bg-[#2563EB] text-white font-semibold '
                      : 'text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8]'
                  }`}
                >
                  <span>Mesh</span>
                </button>

                {/* Streamlines Toggle */}
                <button
                  onClick={() => setShowResultsStreamlines((s) => !s)}
                  title="Toggle Flow Streamlines Overlay"
                  className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1.5 transition-colors ${
                    showResultsStreamlines
                      ? 'bg-[#2563EB] text-white font-semibold '
                      : 'text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8]'
                  }`}
                >
                  <span>Streamlines</span>
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* Solver stage: live cell-based field preview controls - mesh
            wireframe and field colouring are independent toggles, not a
            single radio group, and each field button re-clicks off. */}
        {/* Block editor tools - Blocks view only. Geometry is locked here; these
            edit the block topology, ICEM CFD Hexa style. */}
        {displayOnly &&
          showBlocking &&
          canvasMode === 'cad' &&
          blockMode === 'manual' &&
          onUpdateBlocking &&
          (() => {
            const tools = [
              { id: 'select', label: 'Select', key: 'V' },
              { id: 'draw', label: 'Draw', key: 'B' },
              { id: 'split', label: 'Split', key: 'K' },
              { id: 'ogrid', label: 'O-grid', key: 'O' },
              { id: 'assoc', label: 'Associate', key: 'A' },
              { id: 'mergeV', label: 'Merge vtx', key: 'M' },
              { id: 'mergeB', label: 'Merge blk', key: 'J' },
              { id: 'delete', label: 'Delete', key: 'X' },
            ] as const;
            const selEdge = selectedEdgeId
              ? blocking?.edges.find((x) => x.id === selectedEdgeId)
              : undefined;
            const curveNames = (ids?: string[]) =>
              (ids ?? [])
                .map((id) => {
                  const ent = cadState.entities.find((x) => x.id === id);
                  return ent
                    ? `${ent.type}${ent.role === 'domain_boundary' ? ' (domain)' : ''}`
                    : 'missing curve';
                })
                .join(', ');
            const btn =
              'px-2 py-0.5 rounded font-medium text-[#69717D] hover:text-[#171A1F] disabled:opacity-40 disabled:cursor-not-allowed';
            return (
              <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1 select-none max-w-[calc(100%-14rem)]">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded border border-[#F59E0B] text-[#B45309] bg-[#FFFBEB] text-[9px] font-semibold uppercase tracking-wider">
                    Beta
                  </span>
                  <div className="flex items-center gap-0.5 flex-wrap bg-white border border-[#E1E4E8] rounded px-1.5 py-1 text-[11px]">
                    {tools.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setBlockTool(t.id);
                          setBlockDrawPts([]);
                          setBlockMsg(null);
                        }}
                        className={`px-2 py-0.5 rounded font-medium ${
                          blockTool === t.id
                            ? 'bg-[#F5F6F8] text-[#171A1F] font-semibold'
                            : 'text-[#69717D] hover:text-[#171A1F]'
                        }`}
                      >
                        {t.label}
                        <span className="ml-1 text-[9px] text-[#9AA1AB]">{t.key}</span>
                      </button>
                    ))}
                    <span className="w-px h-4 bg-[#E1E4E8] mx-0.5" />
                    <button onClick={initializeBlocks} className={btn}>
                      Initialize
                    </button>
                    <button
                      onClick={snapProject}
                      disabled={!blocking?.vertices.some((v) => v.curves?.length)}
                      className={btn}
                    >
                      Snap project
                    </button>
                    <button
                      onClick={() => {
                        if (!blocking?.blocks.length) return;
                        if (blockMsg?.text !== 'Click again to clear.') {
                          setBlockMsg({ text: 'Click again to clear.', error: true });
                          return;
                        }
                        onUpdateBlocking(emptyBlocking());
                        setBlockTool('draw');
                        setBlockDrawPts([]);
                        setBlockMsg({ text: 'All blocks cleared.', error: false });
                      }}
                      disabled={!blocking?.blocks.length}
                      className="px-2 py-0.5 rounded font-medium text-[#69717D] hover:text-[#DC2626] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Clear all
                    </button>
                  </div>
                </div>

                {/* Tool options */}
                {blockTool === 'ogrid' && (
                  <div className="flex items-center gap-2 bg-white border border-[#E1E4E8] rounded px-2 py-1 text-[11px]">
                    <span className="text-[#434A54]">Centre block size</span>
                    <input
                      type="range"
                      min={0.2}
                      max={0.8}
                      step={0.05}
                      value={ogridScale}
                      onChange={(ev) => setOgridScale(parseFloat(ev.target.value))}
                      className="w-28 accent-[#2563EB]"
                    />
                    <span className="font-mono text-[#171A1F] w-8">{ogridScale.toFixed(2)}</span>
                    <span className="text-[#9AA1AB]">of the block</span>
                  </div>
                )}
                {blockTool === 'assoc' && (
                  <div className="flex items-center gap-1 flex-wrap bg-white border border-[#E1E4E8] rounded px-2 py-1 text-[11px]">
                    <span
                      className={
                        assocStage === 'edges' ? 'font-semibold text-[#171A1F]' : 'text-[#69717D]'
                      }
                    >
                      1 Pick edges ({assocEdges.length})
                    </span>
                    <span className="text-[#9AA1AB]">then</span>
                    <span
                      className={
                        assocStage === 'curve' ? 'font-semibold text-[#171A1F]' : 'text-[#69717D]'
                      }
                    >
                      2 Click a curve
                    </span>
                    <span className="w-px h-4 bg-[#E1E4E8] mx-1" />
                    {assocStage === 'edges' ? (
                      <button
                        disabled={!assocEdges.length}
                        onClick={() => {
                          setAssocStage('curve');
                        }}
                        className="px-2 py-0.5 rounded bg-[#2563EB] text-white font-medium disabled:opacity-40"
                      >
                        Pick curve (Enter)
                      </button>
                    ) : (
                      <button onClick={() => setAssocStage('edges')} className={btn}>
                        Back to edges
                      </button>
                    )}
                    <button
                      disabled={!assocEdges.length}
                      onClick={() => {
                        if (!blocking) return;
                        onUpdateBlocking(disassociateEdges(blocking, assocEdges));
                        setBlockMsg({
                          text: `${assocEdges.length} edge${assocEdges.length > 1 ? 's' : ''} disassociated.`,
                          error: false,
                        });
                        setAssocEdges([]);
                      }}
                      className={btn}
                    >
                      Disassociate
                    </button>
                    <button
                      disabled={!assocEdges.length}
                      onClick={() => setAssocEdges([])}
                      className={btn}
                    >
                      Clear picks
                    </button>
                  </div>
                )}
                {blockTool === 'select' && selEdge && blocking && (
                  <div className="bg-white border border-[#E1E4E8] rounded px-2 py-1.5 text-[11px] space-y-1.5 w-[300px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#171A1F]">Edge params</span>
                      <span className="text-[#9AA1AB]">
                        {selEdge.patch ??
                          (unpatchedEdgeIds.has(selEdge.id) ? 'no patch' : 'internal')}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 items-end">
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-[#69717D]">Nodes</span>
                        <input
                          type="number"
                          min={2}
                          step={1}
                          defaultValue={selEdge.nodes}
                          key={`n-${selEdge.id}-${selEdge.nodes}`}
                          onBlur={(ev) => {
                            const n = parseInt(ev.target.value, 10);
                            if (n >= 2 && n !== selEdge.nodes)
                              onUpdateBlocking(setEdgeParams(blocking, selEdge.id, { nodes: n }));
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                          }}
                          className="px-1.5 py-0.5 border border-[#E1E4E8] rounded font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-[#69717D]">Spacing law</span>
                        <select
                          value={selEdge.law}
                          onChange={(ev) =>
                            onUpdateBlocking(
                              setEdgeParams(blocking, selEdge.id, {
                                law: ev.target.value as typeof selEdge.law,
                              }),
                            )
                          }
                          className="px-1 py-0.5 border border-[#E1E4E8] rounded bg-white"
                        >
                          <option value="uniform">Uniform</option>
                          <option value="geometric">Geometric</option>
                          <option value="bump">Bump</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-[#69717D]">Ratio</span>
                        <input
                          type="number"
                          min={0.01}
                          step={0.1}
                          defaultValue={selEdge.ratio}
                          key={`r-${selEdge.id}-${selEdge.ratio}`}
                          disabled={selEdge.law === 'uniform'}
                          onBlur={(ev) => {
                            const r = parseFloat(ev.target.value);
                            if (r > 0 && r !== selEdge.ratio)
                              onUpdateBlocking(setEdgeParams(blocking, selEdge.id, { ratio: r }));
                          }}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                          }}
                          className="px-1.5 py-0.5 border border-[#E1E4E8] rounded font-mono disabled:bg-[#F5F6F8]"
                        />
                      </label>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        onClick={() => {
                          onUpdateBlocking(
                            setEdgeParams(blocking, selEdge.id, {
                              law: selEdge.law,
                              ratio: selEdge.ratio,
                              copyParallel: true,
                            }),
                          );
                          setBlockMsg({
                            text: 'Spacing copied to every parallel edge.',
                            error: false,
                          });
                        }}
                        className="px-2 py-0.5 rounded border border-[#E1E4E8] hover:border-[#2563EB] hover:text-[#1D4ED8]"
                      >
                        Copy to parallel edges
                      </button>
                      {selEdge.curves?.length ? (
                        <>
                          <span className="text-[#059669]">on {curveNames(selEdge.curves)}</span>
                          <button
                            onClick={() =>
                              onUpdateBlocking(disassociateEdges(blocking, [selEdge.id]))
                            }
                            className={btn}
                          >
                            Disassociate
                          </button>
                        </>
                      ) : (
                        <span className="text-[#9AA1AB]">not associated</span>
                      )}
                    </div>
                  </div>
                )}

                {(blockMsg ||
                  badBlockIds.size > 0 ||
                  outsideBlockIds.size > 0 ||
                  unpatchedEdgeIds.size > 0 ||
                  (blockCoverage !== null && blockCoverage < 0.995)) && (
                  <div className="bg-white border border-[#E1E4E8] rounded px-2 py-1 text-[11px] leading-snug max-w-[520px]">
                    {blockMsg && (
                      <div className={blockMsg.error ? 'text-[#DC2626]' : 'text-[#434A54]'}>
                        {blockMsg.text}
                      </div>
                    )}
                    {outsideBlockIds.size > 0 && (
                      <div className="text-[#DC2626]">
                        {outsideBlockIds.size} block{outsideBlockIds.size > 1 ? 's' : ''} outside
                        the fluid
                      </div>
                    )}
                    {badBlockIds.size > 0 && (
                      <div className="text-[#DC2626]">
                        {badBlockIds.size} block{badBlockIds.size > 1 ? 's' : ''} over a body
                      </div>
                    )}
                    {unpatchedEdgeIds.size > 0 && (
                      <div className="text-[#DC2626]">
                        {unpatchedEdgeIds.size} unpatched boundary edge
                        {unpatchedEdgeIds.size > 1 ? 's' : ''}
                      </div>
                    )}
                    {blockCoverage !== null && blockCoverage < 0.995 && (
                      <div className="text-[#D97706]">
                        {Math.round(blockCoverage * 100)}% of the fluid blocked
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        {displayOnly && meshOnly && !showField && livePreview && (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-white border border-[#E1E4E8] rounded px-2 py-1 text-xs select-none">
            <button
              onClick={() => setLiveMeshOn((m) => !m)}
              title="Toggle mesh wireframe overlay"
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                liveMeshOn
                  ? 'bg-[#F5F6F8] text-[#171A1F] font-semibold'
                  : 'text-[#69717D] hover:text-[#171A1F]'
              }`}
            >
              Mesh
            </button>
            {(['U_mag', 'p', 'k'] as const)
              .filter((f) => Array.isArray(livePreview.fields[f]))
              .map((f) => (
                <button
                  key={f}
                  onClick={() => setLiveField((cur) => (cur === f ? null : f))}
                  title={liveField === f ? 'Click to hide this field' : undefined}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                    liveField === f
                      ? 'bg-[#2563EB] text-white font-semibold'
                      : 'text-[#69717D] hover:text-[#171A1F]'
                  }`}
                >
                  {f === 'U_mag' ? '[U]' : f}
                </button>
              ))}
          </div>
        )}

        <canvas
          ref={glCanvasRef}
          className="absolute inset-0 w-full h-full block pointer-events-none bg-[#FAFAFA]"
        />

        <canvas
          ref={canvasRef}
          className="relative z-10 w-full h-full block outline-none focus:outline-none focus:ring-0 select-none bg-transparent"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleCanvasClick}
          onAuxClick={handleAuxClick}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          tabIndex={-1}
        />

        {/* ─── Field colour bar (Results) ─── */}
        {showField &&
          Array.isArray(fieldData?.fields?.[activeField]) &&
          (() => {
            const r = fieldData?.ranges?.[activeField] || [0, 1];
            const stops = Array.from({ length: 12 }, (_, i) => colormapRGB(1 - i / 11, colormap));
            const labels: Record<string, { name: string; unit: string }> = {
              U_mag: { name: '[U]', unit: 'm/s' },
              p: { name: '[p]', unit: 'Pa' },
              k: { name: '[k]', unit: 'm²/s²' },
              omega: { name: '[ω]', unit: '1/s' },
              vorticity: { name: '[∇×U]', unit: '1/s' },
            };
            const fieldLabel = labels[activeField] || { name: activeField, unit: '' };
            return (
              <div
                className="absolute right-3 w-fit bg-white/95 border border-[#E1E4E8] rounded p-1.5 pr-2 text-[10px] font-mono text-[#69717D] pointer-events-none"
                style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 4px)' }}
              >
                <div className="mb-1 text-right text-[#171A1F] font-semibold whitespace-nowrap">
                  {fieldLabel.name} {fieldLabel.unit}
                </div>
                <div className="flex items-stretch justify-end h-56">
                  <div className="flex flex-col justify-between items-end whitespace-nowrap">
                    <span>{Number(r[1]).toPrecision(3)}</span>
                    <span>{Number((Number(r[0]) + Number(r[1])) / 2).toPrecision(3)}</span>
                    <span>{Number(r[0]).toPrecision(3)}</span>
                  </div>
                  <div
                    className="ml-1 w-2.5 shrink-0 rounded-sm border border-[#DDE2E8]"
                    style={{ background: `linear-gradient(to bottom, ${stops.join(',')})` }}
                  />
                </div>
              </div>
            );
          })()}

        {/* ─── Mesh-quality legend (Mesh tab only) ─── */}
        {!showField &&
          !meshOnly &&
          canvasMode === 'mesh' &&
          showMeshQuality &&
          meshSkew &&
          meshSkewStats && (
            <div
              className="absolute right-3 z-20 w-fit bg-white/95 border border-[#E1E4E8] rounded p-2 text-[10px] font-mono text-[#69717D] pointer-events-none"
              style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 4px)' }}
            >
              <div className="mb-1 text-right text-[#171A1F] font-semibold whitespace-nowrap">
                Cell skewness
              </div>
              <div className="flex items-stretch justify-end h-56">
                <div className="flex flex-col justify-between items-end whitespace-nowrap pr-1">
                  <span className="text-[#DC2626] font-semibold">1.0 · degenerate</span>
                  <span>0.80 · poor</span>
                  <span>0.50 · fair</span>
                  <span>0.25 · good</span>
                  <span className="text-[#16A34A] font-semibold">0.0 · ideal</span>
                </div>
                <div
                  className="w-3 shrink-0 rounded-sm border border-[#DDE2E8]"
                  style={{
                    background: `linear-gradient(to bottom, ${Array.from({ length: 16 }, (_, i) => colormapRGB(1 - i / 15, 'quality')).join(',')})`,
                  }}
                />
              </div>
              <div className="mt-2 pt-2 border-t border-[#EDEFF3] text-right leading-relaxed">
                <div>
                  max{' '}
                  <span className="text-[#171A1F] font-semibold">
                    {meshSkewStats.max.toFixed(2)}
                  </span>
                </div>
                <div>
                  median{' '}
                  <span className="text-[#171A1F] font-semibold">
                    {meshSkewStats.median.toFixed(2)}
                  </span>
                </div>
                <div className={meshSkewStats.poorPct > 2 ? 'text-[#DC2626] font-semibold' : ''}>
                  {meshSkewStats.poor} cells &gt; 0.8 ({meshSkewStats.poorPct.toFixed(1)}%)
                </div>
              </div>
            </div>
          )}

        {/* ─── Live solver preview legend (Solver tab) ─── */}
        {liveVals && (
          <div
            className="absolute right-3 z-20 w-fit bg-white/95 border border-[#E1E4E8] rounded p-2 text-[10px] font-mono text-[#69717D] pointer-events-none"
            style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 4px)' }}
          >
            <div className="mb-1 text-right text-[#171A1F] font-semibold whitespace-nowrap">
              {liveField === 'U_mag' ? '[U] m/s' : liveField === 'p' ? 'p Pa' : 'k m²/s²'}
              {livePreview?.time ? ` · t=${livePreview.time}` : ''}
            </div>
            <div className="flex items-stretch justify-end h-44">
              <div className="flex flex-col justify-between items-end whitespace-nowrap pr-1">
                <span>{Number(liveRange[1]).toPrecision(3)}</span>
                <span>{((Number(liveRange[0]) + Number(liveRange[1])) / 2).toPrecision(3)}</span>
                <span>{Number(liveRange[0]).toPrecision(3)}</span>
              </div>
              <div
                className="w-3 shrink-0 rounded-sm border border-[#DDE2E8]"
                style={{
                  background: `linear-gradient(to bottom, ${Array.from({ length: 14 }, (_, i) => colormapRGB(1 - i / 13, colormap)).join(',')})`,
                }}
              />
            </div>
          </div>
        )}

        {/* ─── Transient Flow Simulation Player ─── */}
        {showField && isTransient && (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-30 w-[92%] max-w-2xl bg-white border border-[#E1E4E8] rounded px-4 py-2 flex items-center gap-3 select-none transition-all duration-150"
            style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 4px)' }}
          >
            {/* 5 Playback Control Buttons: First, Prev, Play/Pause, Next, Last */}
            <div className="flex items-center gap-1 shrink-0">
              {/* First Frame */}
              <button
                onClick={() => onSelectTransientFrame?.(0)}
                disabled={transientTimes.length === 0 || transientFrameIndex === 0}
                title="First Frame"
                className="p-1.5 rounded text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronFirst className="w-4 h-4" />
              </button>

              {/* Previous Frame */}
              <button
                onClick={() => onSelectTransientFrame?.(transientFrameIndex - 1)}
                disabled={transientTimes.length === 0 || transientFrameIndex === 0}
                title="Previous Frame"
                className="p-1.5 rounded text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>

              {/* Play / Pause */}
              <button
                onClick={() => onToggleTransientPlay?.()}
                disabled={transientTimes.length < 2}
                title={transientPlaying ? 'Pause' : 'Play Simulation'}
                className="p-2 rounded-full bg-[#2563EB] hover:bg-[#1D4ED8] text-white disabled:opacity-40 disabled:pointer-events-none transition-transform active:scale-95 flex items-center justify-center mx-0.5"
              >
                {transientPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              {/* Next Frame */}
              <button
                onClick={() => onSelectTransientFrame?.(transientFrameIndex + 1)}
                disabled={
                  transientTimes.length === 0 || transientFrameIndex >= transientTimes.length - 1
                }
                title="Next Frame"
                className="p-1.5 rounded text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>

              {/* Last Frame */}
              <button
                onClick={() => onSelectTransientFrame?.(transientTimes.length - 1)}
                disabled={
                  transientTimes.length === 0 || transientFrameIndex >= transientTimes.length - 1
                }
                title="Last Frame"
                className="p-1.5 rounded text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLast className="w-4 h-4" />
              </button>
            </div>

            {/* Middle: Timeline Slider & Timestamp display */}
            <div className="flex-1 flex flex-col justify-center min-w-0 px-1 gap-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#69717D]">
                <span>
                  Time:{' '}
                  <strong className="text-[#171A1F]">
                    {transientTimes[transientFrameIndex] !== undefined
                      ? `${transientTimes[transientFrameIndex]}s`
                      : '0.00s'}
                  </strong>
                </span>
                <span>
                  Frame{' '}
                  <strong className="text-[#171A1F]">
                    {transientTimes.length > 0 ? transientFrameIndex + 1 : 0}
                  </strong>{' '}
                  / {transientTimes.length || 1}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, transientTimes.length - 1)}
                step={1}
                value={transientFrameIndex}
                onChange={(e) => onSelectTransientFrame?.(parseInt(e.target.value, 10))}
                disabled={transientTimes.length < 2}
                className="w-full h-1.5 bg-[#E1E4E8] rounded appearance-none cursor-pointer accent-[#2563EB] disabled:cursor-not-allowed"
              />
            </div>

            {/* Rightmost: Speed Controls (0.05x, 0.1x, 0.25x, 0.5x, 1x, 2x) */}
            <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-[#E1E4E8]">
              {([0.05, 0.1, 0.25, 0.5, 1, 2] as const).map((spd) => (
                <button
                  key={spd}
                  onClick={() => onSelectTransientSpeed?.(spd)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${
                    transientSpeed === spd
                      ? 'bg-[#2563EB] text-white font-semibold'
                      : 'text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8]'
                  }`}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- Historical field loading overlay --- */}
        {showField && historicalStatus?.loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-30 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-2 bg-white border border-[#E1E4E8] rounded text-xs font-medium text-[#171A1F]">
              <Loader2 className="w-4 h-4 animate-spin text-[#2563EB]" />
              <span>Loading flow field snapshot...</span>
            </div>
          </div>
        )}

        {/* --- Historical field error overlay (e.g. 404 / no field stored) --- */}
        {showField && historicalStatus?.error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#FAFAFA]/90 z-30 pointer-events-auto">
            <div className="max-w-sm bg-white border border-[#E1E4E8] rounded p-5 text-center space-y-3">
              <div className="w-9 h-9 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-[#171A1F]">
                  No flow field stored for this run
                </h3>
                <p className="text-[11px] text-[#69717D] leading-relaxed">
                  {historicalStatus.error.toLowerCase().includes('404') ||
                  historicalStatus.error.toLowerCase().includes('no stored')
                    ? 'This solver run has no stored field snapshot on disk. It may have errored or stopped before fields were written.'
                    : historicalStatus.error}
                </p>
              </div>
              {onRestoreLive && (
                <button
                  type="button"
                  onClick={onRestoreLive}
                  className="px-3 py-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded text-xs font-medium transition-colors cursor-pointer"
                >
                  Back to Latest Run
                </button>
              )}
            </div>
          </div>
        )}

        {/* ─── Dynamic Dimension Input Box (Onshape / Fusion 360 style) ─── */}
        {!displayOnly &&
          dimPrompt &&
          (() => {
            const screenPos = toScreen(dimPrompt.worldPos.x, dimPrompt.worldPos.y);
            const containerW = containerRef.current?.clientWidth || 800;
            const containerH = containerRef.current?.clientHeight || 600;
            const posX = Math.max(12, Math.min(containerW - 270, screenPos.x - 100));
            const posY = Math.max(12, Math.min(containerH - 60, screenPos.y - 48));

            return (
              <div
                className="absolute z-30 flex items-center gap-2 bg-white text-[#171A1F] px-2.5 py-1.5 rounded-sm border border-[#E1E4E8] text-xs font-mono select-none transition-all duration-75"
                style={{ left: `${posX}px`, top: `${posY}px` }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Field 1 */}
                <div className="flex items-center gap-1">
                  <span className="text-[#2563EB] font-bold text-[11px]">{dimPrompt.label1}:</span>
                  <input
                    ref={input1Ref}
                    type="number"
                    step="any"
                    value={inputVal1}
                    onChange={(e) => {
                      if (dimPrompt.live) setManualDim(true);
                      setInputVal1(e.target.value);
                      if (dimPrompt.type === 'circle' && dimPrompt.label2 === 'Ø') {
                        const n = parseFloat(e.target.value);
                        if (!isNaN(n)) setInputVal2((n * 2).toFixed(4));
                      }
                    }}
                    onKeyDown={handleDimKeyDown}
                    className="w-20 px-1.5 py-0.5 bg-[#F5F6F8] hover:bg-white focus:bg-white border border-[#E1E4E8] focus:border-[#2563EB] rounded text-right text-[#171A1F] font-mono text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                  />
                </div>

                {/* Field 2 */}
                {dimPrompt.label2 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[#2563EB] font-bold text-[11px]">
                      {dimPrompt.label2}:
                    </span>
                    <input
                      ref={input2Ref}
                      type="number"
                      step="any"
                      value={inputVal2}
                      onChange={(e) => {
                        if (dimPrompt.live) setManualDim(true);
                        setInputVal2(e.target.value);
                        if (dimPrompt.type === 'circle' && dimPrompt.label2 === 'Ø') {
                          const n = parseFloat(e.target.value);
                          if (!isNaN(n)) setInputVal1((n / 2).toFixed(4));
                        }
                      }}
                      onKeyDown={handleDimKeyDown}
                      className="w-18 px-1.5 py-0.5 bg-[#F5F6F8] hover:bg-white focus:bg-white border border-[#E1E4E8] focus:border-[#2563EB] rounded text-right text-[#171A1F] font-mono text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                    />
                  </div>
                )}

                {/* Hints */}
                <div className="flex items-center gap-1 pl-1.5 border-l border-[#E1E4E8] text-[9px] text-[#69717D]">
                  <span className="px-1 py-0.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded text-[8px] font-semibold">
                    Tab ⇥
                  </span>
                  <span className="px-1 py-0.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded text-[8px] font-semibold">
                    ↵
                  </span>
                </div>
              </div>
            );
          })()}
      </div>

      {/* ════════════════════ FLOATING STATUS READOUTS ═════════════════════════════════ */}
      {!(displayOnly && !showMesh) && (
        <>
          {/* Bottom Left: Live Cursor Position & Google Maps Style Scale Indicator */}
          <div
            className="absolute left-3 z-20 flex items-center gap-3 bg-white border border-[#E1E4E8] rounded-sm px-2.5 py-1 text-[11px] font-mono text-[#69717D] pointer-events-none select-none"
            style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
          >
            <div className="flex items-center gap-2.5">
              <span>
                X: <strong className="text-[#171A1F]">{hud.x}</strong>
              </span>
              <span>
                Y: <strong className="text-[#171A1F]">{hud.y}</strong>
              </span>
            </div>

            <div className="h-3 w-px bg-[#D0D4DC]" />

            {/* Google Maps Style Scale Indicator */}
            <div className="flex items-center gap-1.5" title={`Scale: ${scaleInfo.label}`}>
              <span className="text-[10px] font-bold text-[#171A1F] leading-none">
                {scaleInfo.label}
              </span>
              <div className="flex items-end h-2">
                <div
                  className="h-1.5 border-l-2 border-r-2 border-b border-[#171A1F] bg-black/5"
                  style={{ width: `${scaleInfo.barWidthPx}px` }}
                />
              </div>
            </div>

            {tool !== 'select' && snap.type !== 'grid' && (
              <>
                <div className="h-3 w-px bg-[#D0D4DC]" />
                <span className="text-[10px] text-[#16A34A] uppercase font-bold">
                  [{snap.type}]
                </span>
              </>
            )}
          </div>

          {/* Bottom Right: mesh summary in Mesh view; otherwise the live length/angle/
              diameter of the shape being drawn, or the position of a hovered vertex. */}
          {(() => {
            if (showMesh && meshData?.num_elements) {
              const { triangles, quads } = meshCellCounts;
              const minAngle = meshData.quality?.min_angle_degrees;
              const skew = meshData.quality?.max_skewness;
              return (
                <div
                  className="absolute right-3 z-20 flex items-center gap-3 bg-white border border-[#E1E4E8] rounded-sm px-2.5 py-1 text-[11px] font-mono text-[#69717D] pointer-events-none select-none"
                  style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
                >
                  <span>
                    <strong className="text-[#171A1F]">{meshData.num_nodes}</strong> nodes
                  </span>
                  <span>
                    <strong className="text-[#171A1F]">{meshData.num_elements}</strong> cells
                  </span>
                  <span>
                    <strong className="text-[#171A1F]">{triangles}</strong> tri ·{' '}
                    <strong className="text-[#171A1F]">{quads}</strong> quad
                  </span>
                  {minAngle !== undefined && (
                    <span className={minAngle < 15 ? 'text-amber-600' : 'text-[#16A34A]'}>
                      <strong>{minAngle.toFixed(0)}°</strong> min
                    </span>
                  )}
                  {skew !== undefined && (
                    <span>
                      skew <strong className="text-[#171A1F]">{skew.toFixed(2)}</strong>
                    </span>
                  )}
                </div>
              );
            }

            if (isDrawing && tempPts.length > 0) {
              const isCircular = tool === 'circle_center_radius' || tool === 'ellipse_center';
              return (
                <div
                  className="absolute right-3 z-20 flex items-center gap-2.5 bg-white border border-[#E1E4E8] rounded-sm px-2.5 py-1 text-[11px] font-mono text-[#69717D] pointer-events-none select-none"
                  style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
                >
                  {isCircular ? (
                    <span>
                      ⌀:{' '}
                      <strong className="text-[#171A1F]">
                        {(parseFloat(hud.length) * 2).toFixed(3)}
                      </strong>{' '}
                      m
                    </span>
                  ) : (
                    <>
                      <span>
                        L: <strong className="text-[#171A1F]">{hud.length}</strong> m
                      </span>
                      <div className="h-3 w-px bg-[#D0D4DC]" />
                      <span>
                        ∠: <strong className="text-[#171A1F]">{hud.angle}</strong>°
                      </span>
                    </>
                  )}
                </div>
              );
            }

            if (hoveredVertex) {
              return (
                <div
                  className="absolute right-3 z-20 flex items-center gap-2.5 bg-white border border-[#E1E4E8] rounded-sm px-2.5 py-1 text-[11px] font-mono text-[#69717D] pointer-events-none select-none"
                  style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 10px)' }}
                >
                  <span className="text-[10px] uppercase font-bold text-[#69717D]">Vertex</span>
                  <span>
                    X: <strong className="text-[#171A1F]">{hoveredVertex.x.toFixed(4)}</strong>
                  </span>
                  <span>
                    Y: <strong className="text-[#171A1F]">{hoveredVertex.y.toFixed(4)}</strong>
                  </span>
                </div>
              );
            }

            return null;
          })()}
        </>
      )}

      {meshToastVisible && (
        <div className="absolute right-4 bottom-10 z-40 w-72 rounded border border-[#D9E2F2] bg-white px-3.5 py-3 pointer-events-none">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#171A1F]">
              {meshProgress >= 100 ? 'Mesh complete' : 'Generating mesh'}
            </span>
            <span className="text-xs font-mono font-semibold text-[#2563EB]">
              {Math.round(meshProgress)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E8EEF8]">
            <div
              className="h-full rounded-full bg-[#2563EB] transition-[width] duration-150 ease-out"
              style={{ width: `${meshProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const CadWorkbench2D = React.memo(CadWorkbench2DComponent);
