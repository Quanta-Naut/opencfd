import React, { useState, useRef, useEffect, useCallback, useReducer, useMemo } from 'react';
import { requestOffset, requestFillet } from '../../utils/api';
import { toast } from '../ui/Toast';
import {
  BoundaryTag,
  Point2D,
  CadEntity,
  getGeometryBBox,
  validateDomainContainment,
  createDomainEntity,
  extractBoundaryEdges,
  autoSuggestBoundaryTags,
  validateBoundaryTags,
} from '../../types/cadWorkflow';
import {
  Blocking,
  blockPolygon,
  entityRing,
  propagateNodeCounts,
  emptyBlocking,
  outlinesFor,
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
  initializeBlocking,
  associateEdges,
  snapProjectVertices,
} from '../../types/blocking';
import { useMeshGL, type MeshGLScene } from './useMeshGL';
import { useResolvedTheme } from '../../utils/theme';
import { Tooltip } from '../ui/Tooltip';
import { Kbd } from '../ui/Kbd';
import { drawScene } from './workbenchDraw/drawScene';
import type { CadTool, Snap, DynamicDimPrompt, CadState, CadWorkbenchProps } from './workbenchCore';
import {
  INITIAL_ZOOM,
  loadSnapSettings,
  saveSnapSettings,
  computeSnapPoint,
  cadReducer,
  meshEdgeSets,
  meshSkewness,
  canvasPalette,
  dist,
  getMapScaleInfo,
} from './workbenchCore';
import type { SnapSettings } from './workbenchCore';
import { EMPTY_EDGES, nodesBBox } from './workbenchCore';
import { onMouseMove } from './workbenchInput/mouseMove';
import { onMouseDown } from './workbenchInput/mouseDown';
import { onMouseUp } from './workbenchInput/mouseUp';
import { commitPointImpl } from './workbenchInput/commitPoint';
import { onCanvasClick } from './workbenchInput/canvasClick';
import { onKeyDown } from './workbenchInput/keyDown';
import { StatusReadouts } from './workbenchUi/StatusReadouts';
import { DimensionInput } from './workbenchUi/DimensionInput';
import { HistoricalFieldOverlays } from './workbenchUi/HistoricalFieldOverlays';
import { TransientPlayer } from './workbenchUi/TransientPlayer';
import { ViewportLegends } from './workbenchUi/ViewportLegends';
import { LivePreviewControls } from './workbenchUi/LivePreviewControls';
import { BlockEditorTools } from './workbenchUi/BlockEditorTools';
import { ViewModeBar } from './workbenchUi/ViewModeBar';
import { DraftingStrip } from './workbenchUi/DraftingStrip';
import { ToolRail } from './workbenchUi/ToolRail';
import { autoCenterInitialGeometry } from './workbenchView/camera';
import { computeElementBlockColor } from './workbenchView/meshScene';
import { buildGlScene } from './workbenchView/meshScene';
import { snapBlockVertexImpl } from './workbenchInput/hitTest';
import { attachDomainHandleDrag } from './workbenchInput/domainHandleDrag';
import { findEntityAtImpl } from './workbenchInput/hitTest';
import { openDimPromptForEntityImpl } from './workbenchInput/dimensions';
import { commitDimensionImpl } from './workbenchInput/dimensions';
import { importPendingFile } from './workbenchActions/importFile';
import { generateDomain } from './workbenchActions/workflow';
import { meshHandoff } from './workbenchActions/workflow';
import { downloadBlockMeshDict } from './workbenchActions/workflow';

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
  // Neutral canvas colours follow the app theme.
  const C = canvasPalette(useResolvedTheme());

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
  useEffect(
    () =>
      autoCenterInitialGeometry({
        hasAutoCenteredInitialRef,
        userInteractedRef,
        canvasRef,
        containerRef,
        viewport,
        cadState,
        initialEntities,
        fitBoundingBox,
      }),
    [cadState.entities, initialEntities, viewport.w, viewport.h, fitBoundingBox],
  );

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
  // Fillet / Offset take one parameter each; it lives in a small flyout next
  // to the rail button instead of permanently occupying toolbar space.
  const [modifyFlyout, setModifyFlyout] = useState<'fillet' | 'offset' | null>(null);
  const modifyFlyoutRef = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    if (!modifyFlyout) return;
    const onDown = (e: MouseEvent) => {
      if (modifyFlyoutRef.current && !modifyFlyoutRef.current.contains(e.target as Node)) {
        setModifyFlyout(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModifyFlyout(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [modifyFlyout]);

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
  const elementBlockColor = useMemo<(string | null)[] | null>(
    () => computeElementBlockColor({ meshData, directionColors, blocking }),
    [meshData?.nodes, meshData?.elements, blocking, directionColors],
  );

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
  const glScene = useMemo<MeshGLScene>(
    () =>
      buildGlScene({
        meshData,
        displayOnly,
        showMesh,
        liveHasContent,
        C,
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
        showMeshWireframe,
        directionColors,
        elementBlockColor,
        colormap,
      }),
    [
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
      C,
    ],
  );
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
    (raw: Point2D, draggedVid: string) =>
      snapBlockVertexImpl(raw, draggedVid, {
        zoom,
        blocking,
        cadState,
        blockOutlines,
        snapSettings,
        domainRing,
      }),
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
  useEffect(
    () =>
      attachDomainHandleDrag({
        cadState,
        draggingDomainHandleRef,
        canvasRef,
        pan,
        zoom,
        snapEnabled,
        setUpstreamChordFactor,
        setDownstreamChordFactor,
        setLateralHeightFactor,
        blockDrag,
        editDrag,
        setEditDragActive,
        setDraggingDomainHandle,
      }),
    [
      zoom,
      pan,
      cadState.entities,
      snapEnabled,
      setUpstreamChordFactor,
      setDownstreamChordFactor,
      setLateralHeightFactor,
    ],
  );

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
    drawScene(canvasRef.current, {
      activeField,
      activePlotLine,
      activeTagTool,
      assocEdges,
      badBlockIds,
      blockCursor,
      blockDrag,
      blockDrawPts,
      blocking,
      blockPick,
      blockSnapGuides,
      blockTool,
      boundaryEdges,
      C,
      cadState,
      canvasMode,
      colormap,
      currentStep,
      directionColors,
      displayOnly,
      domainAnimScale,
      domainBroken,
      domainEntity,
      domainShape,
      downstreamChordFactor,
      draggingDomainHandle,
      elementBlockColor,
      fieldData,
      flowType,
      geometryBBox,
      glMeshActive,
      hoverCurveId,
      hoveredBlockIdx,
      hoveredBlockVtx,
      hoveredDomainHandle,
      hoveredEdgeKey,
      hoverEdgeId,
      hoveredTrim,
      hoveredVertex,
      isDrawing,
      lateralHeightFactor,
      liveHasContent,
      liveMeshOn,
      liveRange,
      liveVals,
      marquee,
      meshBoundaryEdges,
      meshData,
      meshOnly,
      meshSkew,
      outsideBlockIds,
      pan,
      plotPickPreviewP1,
      selectedBlockId,
      selectedEdgeId,
      showBlocking,
      showConstruction,
      showField,
      showGrid,
      showMesh,
      showMeshQuality,
      showMeshWireframe,
      showResultsStreamlines,
      snap,
      splitHover,
      tempPts,
      tool,
      unpatchedEdgeIds,
      upstreamChordFactor,
      zoom,
    });
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
    C,
  ]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const findEntityAt = useCallback(
    (rawPt: Point2D) => findEntityAtImpl(rawPt, { zoom, cadState }),
    [cadState.entities, zoom],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) =>
      onMouseMove(e, {
        toWorld,
        tool,
        showBlocking,
        canvasMode,
        blockTool,
        snapBlockVertex,
        blockSnapGuides,
        setBlockCursor,
        blockCursor,
        blocking,
        zoom,
        splitHover,
        setSplitHover,
        assocStage,
        pickCurve,
        hoverCurveId,
        setHoverCurveId,
        blockDrag,
        hoverEdgeId,
        setHoverEdgeId,
        onUpdateBlocking,
        cadState,
        hoveredBlockVtx,
        setHoveredBlockVtx,
        hoveredBlockIdx,
        setHoveredBlockIdx,
        computeSnap,
        isDrawing,
        dimPrompt,
        manualDim,
        setSnap,
        tempPts,
        setInputVal1,
        setInputVal2,
        setDimPrompt,
        setHud,
        displayOnly,
        currentStep,
        flowType,
        domainEntity,
        geometryBBox,
        upstreamChordFactor,
        downstreamChordFactor,
        lateralHeightFactor,
        draggingDomainHandle,
        domainShape,
        setHoveredDomainHandle,
        hoveredDomainHandle,
        setHoveredTrim,
        hoveredTrim,
        editDrag,
        showConstruction,
        hoveredVertex,
        setHoveredVertex,
        panning,
        panStart,
        pendingPanRef,
        panOrigin,
        panRafRef,
        setPan,
        dispatch,
        setCmdText,
        dragSelecting,
        canvasRef,
        dragStart,
        setMarquee,
      }),
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
    (e: React.MouseEvent) =>
      onMouseDown(e, {
        userInteractedRef,
        displayOnly,
        currentStep,
        hoveredDomainHandle,
        cadState,
        domainShape,
        geometryBBox,
        upstreamChordFactor,
        downstreamChordFactor,
        lateralHeightFactor,
        dispatch,
        draggingDomainHandleRef,
        setDraggingDomainHandle,
        pan,
        panning,
        panStart,
        panOrigin,
        tool,
        showBlocking,
        canvasMode,
        onUpdateBlocking,
        blockTool,
        toWorld,
        addBlockCorner,
        snapBlockVertex,
        splitHover,
        splitAtHover,
        blocking,
        deleteBlockById,
        applyBlockOp,
        ogridScale,
        zoom,
        blockPick,
        setBlockPick,
        assocStage,
        assocEdges,
        setAssocEdges,
        pickCurve,
        associateTo,
        blockDrag,
        blockSnapGuides,
        setSelectedEdgeId,
        setSelectedBlockId,
        isPickingPlotPoints,
        onPickPlotPoint,
        dragStart,
        editDrag,
        setEditDragActive,
        findEntityAt,
        dragSelecting,
        setMarquee,
      }),
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
    (e: React.MouseEvent) =>
      onMouseUp(e, {
        panning,
        pan,
        panRafRef,
        pendingPanRef,
        setPan,
        blockDrag,
        blockSnapGuides,
        blocking,
        onUpdateBlocking,
        setCmdText,
        editDrag,
        setEditDragActive,
        draggingAoAHandle,
        setDraggingAoAHandle,
        marquee,
        dragSelecting,
        tool,
        canvasRef,
        zoom,
        setMarquee,
        cadState,
        dispatch,
      }),
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
  const openDimPromptForEntity = useCallback(
    (ent: CadEntity) =>
      openDimPromptForEntityImpl(ent, { setDimPrompt, setInputVal1, setInputVal2 }),
    [],
  );

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
    (prompt: DynamicDimPrompt, val1Str: string, val2Str?: string) =>
      commitDimensionImpl(prompt, val1Str, val2Str, {
        setDimPrompt,
        dispatch,
        cadState,
        setTempPts,
        setCmdText,
      }),
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
    (pt: Point2D) =>
      commitPointImpl(pt, {
        constructionMode,
        tool,
        isDrawing,
        setTempPts,
        setIsDrawing,
        setManualDim,
        setDimPrompt,
        setInputVal1,
        setInputVal2,
        setCmdText,
        tempPts,
        dispatch,
        zoom,
        inputVal1,
        manualDim,
        dimPrompt,
        inputVal2,
      }),
    [tool, isDrawing, tempPts, zoom, constructionMode, dimPrompt],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) =>
      onCanvasClick(e, {
        displayOnly,
        panning,
        dragStart,
        tool,
        toWorld,
        snap,
        zoom,
        activeTagTool,
        boundaryEdges,
        cadState,
        setEdgeTagMap,
        setCmdText,
        findEntityAt,
        dispatch,
        setDimPrompt,
        setHoveredTrim,
        commitPoint,
      }),
    [snap, tool, cadState.entities, commitPoint, zoom, toWorld],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) =>
      onKeyDown(e, {
        tool,
        redo,
        displayOnly,
        showBlocking,
        canvasMode,
        blockDrawPts,
        setBlockDrawPts,
        blockPick,
        setBlockPick,
        assocStage,
        setAssocStage,
        assocEdges,
        setAssocEdges,
        setBlockTool,
        setBlockMsg,
        blockTool,
        selectedBlockId,
        deleteBlockById,
        isDrawing,
        tempPts,
        setIsDrawing,
        setTempPts,
        setCmdText,
        dispatch,
        setTool,
        constructionMode,
        lastEditRef,
        blockUndoRef,
        undo,
        undoBlocking,
        blockRedoRef,
        redoBlocking,
        setOrtho,
        setSnapEnabled,
        setShowGrid,
        setSnapSettings,
        setDimPrompt,
        setManualDim,
      }),
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
  useEffect(
    () =>
      importPendingFile({
        pendingImportFile,
        setIsLoading,
        dispatch,
        setCadName,
        setCmdText,
        setPan,
        setZoom,
        onClearPendingImport,
      }),
    [pendingImportFile, onClearPendingImport],
  );

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

  const handleGenerateDomain = useCallback(
    () =>
      generateDomain({
        cadState,
        domainShape,
        geometryBBox,
        upstreamChordFactor,
        downstreamChordFactor,
        lateralHeightFactor,
        dispatch,
        setCmdText,
        fitBoundingBox,
        setDomainAnimScale,
      }),
    [
      domainShape,
      geometryBBox,
      upstreamChordFactor,
      downstreamChordFactor,
      lateralHeightFactor,
      cadState.entities,
      fitBoundingBox,
    ],
  );

  const handleSetSelectedAsDomain = useCallback(() => {
    const selIds = new Set(cadState.entities.filter((e) => e.selected).map((e) => e.id));
    if (selIds.size === 0) {
      setCmdText(
        'DOMAIN: Select the loop (or all its segments) first, then click "Use selected loop as the domain".',
      );
      toast.info('Select the boundary loop on the canvas first');
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
    toast.success('Fluid domain defined');
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

  const handleMeshHandoff = useCallback(
    async () =>
      meshHandoff({
        cadState,
        flowType,
        setCmdText,
        setIsLoading,
        domainLength,
        domainHeight,
        resolution,
        firstLayerMm,
        onApplySketchMesh,
        cadName,
      }),
    [
      cadState.entities,
      flowType,
      domainLength,
      domainHeight,
      resolution,
      firstLayerMm,
      onApplySketchMesh,
      cadName,
    ],
  );

  const handleDownloadBlockMeshDict = useCallback(
    () =>
      downloadBlockMeshDict({
        flowType,
        angleOfAttackDeg,
        freestreamVelocity,
        geometryBBox,
        setCmdText,
      }),
    [flowType, angleOfAttackDeg, freestreamVelocity, geometryBBox],
  );

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

  // ── Tool rail helpers ─────────────────────────────────────────────────────────
  // Plain render functions, not components: a component declared inside the
  // render would remount (and drop its tooltip state) on every render.
  const railBtn = (active: boolean) =>
    `w-8 h-8 inline-flex items-center justify-center rounded transition-colors disabled:opacity-30 disabled:pointer-events-none ${
      active ? 'bg-accent-soft text-accent-fg' : 'text-fg-2 hover:bg-surface-3 hover:text-fg'
    }`;
  const tip = (label: string, kbd?: string) => (
    <span className="flex items-center gap-2">
      {label}
      {kbd && <Kbd>{kbd}</Kbd>}
    </span>
  );
  const toolBtn = (t: CadTool, icon: React.ReactNode, label: string, kbd?: string) => (
    <Tooltip key={t} content={tip(label, kbd)} delay={350} side="right">
      <button
        type="button"
        aria-label={`${label} tool${kbd ? ` (${kbd})` : ''}`}
        aria-pressed={tool === t}
        onClick={() => {
          setTool(t);
          setIsDrawing(false);
          setTempPts([]);
          setCmdText(`${label}: ${prompt_for(t)}`);
        }}
        className={railBtn(tool === t)}
      >
        {icon}
      </button>
    </Tooltip>
  );
  const railSep = <span className="h-px w-5 bg-line my-1 shrink-0" />;

  const fitView = () => {
    if (showMesh && meshData?.nodes?.length) {
      fitBoundingBox(nodesBBox(meshData.nodes), 0.72);
      return;
    }
    const allGeom = cadState.entities.filter((e) => e.layer !== 'construction');
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
    const bottomBarPx =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-bottom-bar')) ||
      32;
    setZoom(INITIAL_ZOOM);
    setPan({ x: 0, y: -(bottomBarPx / 2) });
  };

  // One-parameter modify commands: the rail button opens a flyout holding the
  // value and an Apply button, so the parameter is only on screen when used.
  const modifyBtn = (
    id: 'fillet' | 'offset',
    icon: React.ReactNode,
    label: string,
    hint: string,
    value: number,
    setValue: (v: number) => void,
    apply: () => void,
  ) => (
    <div className="relative" ref={modifyFlyout === id ? modifyFlyoutRef : undefined}>
      <Tooltip content={label} delay={350} side="right">
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={modifyFlyout === id}
          disabled={isLoading}
          onClick={() => setModifyFlyout((f) => (f === id ? null : id))}
          className={railBtn(modifyFlyout === id)}
        >
          {icon}
        </button>
      </Tooltip>
      {modifyFlyout === id && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-full top-0 ml-2 z-50 w-56 bg-surface border border-line rounded p-2.5 text-[12px] text-fg"
        >
          <div className="font-semibold mb-0.5">{label}</div>
          <div className="text-[11px] text-fg-3 mb-2 leading-snug">{hint}</div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              setModifyFlyout(null);
              apply();
            }}
          >
            <input
              type="number"
              step="0.005"
              autoFocus
              value={value}
              onChange={(e) => setValue(+e.target.value)}
              className="w-full h-7 px-2 bg-surface-2 border border-line rounded text-right text-fg font-mono text-[12px]"
            />
            <span className="text-[11px] text-fg-3">m</span>
            <button
              type="submit"
              className="h-7 px-2.5 rounded bg-accent text-white text-[12px] font-medium hover:bg-accent-hover shrink-0"
            >
              Apply
            </button>
          </form>
        </div>
      )}
    </div>
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
    <div className="relative w-full h-full flex flex-col bg-surface overflow-hidden">
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
        <ToolRail
          {...{
            displayOnly,
            tip,
            undo,
            railBtn,
            redo,
            railSep,
            toolBtn,
            modifyBtn,
            filletR,
            setFilletR,
            applyFillet,
            offsetD,
            setOffsetD,
            applyOffset,
            dispatch,
            selectedCount,
            setCmdText,
          }}
        />

        <DraftingStrip
          {...{
            displayOnly,
            showGrid,
            setShowGrid,
            snapSettings,
            setSnapSettings,
            snapEnabled,
            setSnapEnabled,
            ortho,
            setOrtho,
            constructionMode,
            setConstructionMode,
            tip,
            draftingRef,
            draftingOpen,
            setDraftingOpen,
            setZoom,
            fitView,
          }}
        />

        <ViewModeBar
          {...{
            displayOnly,
            meshOnly,
            showField,
            showBlocking,
            canvasMode,
            setCanvasMode,
            showMesh,
            showMeshQuality,
            meshData,
            meshStale,
            setShowMeshQuality,
            setShowMeshWireframe,
            showMeshWireframe,
            setShowResultsStreamlines,
            showResultsStreamlines,
          }}
        />

        <BlockEditorTools
          {...{
            displayOnly,
            showBlocking,
            canvasMode,
            blockMode,
            onUpdateBlocking,
            selectedEdgeId,
            blocking,
            cadState,
            setBlockTool,
            setBlockDrawPts,
            setBlockMsg,
            blockTool,
            initializeBlocks,
            snapProject,
            blockMsg,
            ogridScale,
            setOgridScale,
            assocStage,
            assocEdges,
            setAssocStage,
            setAssocEdges,
            unpatchedEdgeIds,
            badBlockIds,
            outsideBlockIds,
            blockCoverage,
          }}
        />
        <LivePreviewControls
          {...{
            displayOnly,
            meshOnly,
            showField,
            livePreview,
            setLiveMeshOn,
            liveMeshOn,
            setLiveField,
            liveField,
          }}
        />

        <canvas
          ref={glCanvasRef}
          className="absolute inset-0 w-full h-full block pointer-events-none bg-viewport"
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

        <ViewportLegends
          {...{
            showField,
            fieldData,
            activeField,
            colormap,
            meshOnly,
            canvasMode,
            showMeshQuality,
            meshSkew,
            meshSkewStats,
            liveVals,
            liveField,
            livePreview,
            liveRange,
          }}
        />

        <TransientPlayer
          {...{
            showField,
            isTransient,
            onSelectTransientFrame,
            transientTimes,
            transientFrameIndex,
            onToggleTransientPlay,
            transientPlaying,
            onSelectTransientSpeed,
            transientSpeed,
          }}
        />

        <HistoricalFieldOverlays {...{ showField, historicalStatus, onRestoreLive }} />

        <DimensionInput
          {...{
            displayOnly,
            dimPrompt,
            toScreen,
            containerRef,
            input1Ref,
            inputVal1,
            setManualDim,
            setInputVal1,
            setInputVal2,
            handleDimKeyDown,
            input2Ref,
            inputVal2,
          }}
        />
      </div>

      <StatusReadouts
        {...{
          displayOnly,
          showMesh,
          hud,
          scaleInfo,
          tool,
          snap,
          meshData,
          meshCellCounts,
          isDrawing,
          tempPts,
          hoveredVertex,
        }}
      />
    </div>
  );
};

export const CadWorkbench2D = React.memo(CadWorkbench2DComponent);
