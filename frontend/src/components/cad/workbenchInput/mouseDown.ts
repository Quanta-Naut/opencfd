import type { CadAction } from '../workbenchCore';
import React from 'react';
import {
  CadWorkflowStep,
  DomainShapeType,
  Point2D,
  CadEntity,
  GeometryBBox,
  createDomainEntity,
} from '../../../types/cadWorkflow';
import {
  Blocking,
  pickEdge,
  blockAt,
  currentCellSize,
  mergeVertices,
  mergeBlocks,
  ogridBlock,
} from '../../../types/blocking';
import type { CadTool } from '../workbenchCore';

/** Canvas mouse down: starts pans, drags, marquees and block-editor picks. */
export function onMouseDown(e: React.MouseEvent, wb: MouseDownContext) {
  const {
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
  } = wb;
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
    const selected = cadState.entities.filter((en) => en.selected && en.layer !== 'construction');
    const vHit = 12 / zoom;

    // 1. Grab a vertex of ANY entity (not just selected) → resize / reshape.
    // Every other vertex on the same point moves with it, so joined segments
    // stay joined. The nearest vertex to the click wins.
    let grabbed: Point2D | null = null;
    let grabbedDist = Infinity;
    let grabbedId: string | null = null;
    for (const en of cadState.entities) {
      if (en.layer === 'construction' || en.type === 'circle' || en.type === 'ellipse') continue;
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
}

/** What onMouseDown reads from the workbench component. */
export interface MouseDownContext {
  userInteractedRef: React.RefObject<boolean>;
  displayOnly: boolean;
  currentStep: CadWorkflowStep;
  hoveredDomainHandle: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial';
  cadState: { entities: CadEntity[] };
  domainShape: DomainShapeType;
  geometryBBox: GeometryBBox;
  upstreamChordFactor: number;
  downstreamChordFactor: number;
  lateralHeightFactor: number;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  draggingDomainHandleRef: React.RefObject<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial'>;
  setDraggingDomainHandle: React.Dispatch<
    React.SetStateAction<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial'>
  >;
  pan: Point2D;
  panning: React.RefObject<boolean>;
  panStart: React.RefObject<Point2D>;
  panOrigin: React.RefObject<Point2D>;
  tool: CadTool;
  showBlocking: boolean;
  canvasMode: 'cad' | 'mesh';
  onUpdateBlocking: (bk: Blocking | null) => void;
  blockTool: 'select' | 'draw' | 'split' | 'delete' | 'ogrid' | 'mergeV' | 'mergeB' | 'assoc';
  toWorld: (sx: number, sy: number) => Point2D;
  addBlockCorner: (pt: Point2D) => void;
  snapBlockVertex: (
    raw: Point2D,
    draggedVid: string,
  ) => { pt: Point2D; guides: { a: Point2D; b: Point2D }[] };
  splitHover: { edgeId: string; pt: Point2D; cut: Point2D[][] };
  splitAtHover: () => void;
  blocking: Blocking;
  deleteBlockById: (id: string) => void;
  applyBlockOp: (res: Blocking | { error: string } | null, okText: string) => boolean;
  ogridScale: number;
  zoom: number;
  blockPick: string;
  setBlockPick: React.Dispatch<React.SetStateAction<string>>;
  assocStage: 'edges' | 'curve';
  assocEdges: string[];
  setAssocEdges: React.Dispatch<React.SetStateAction<string[]>>;
  pickCurve: (p: Point2D, radius: number) => string | null;
  associateTo: (curveId: string) => void;
  blockDrag: React.RefObject<{ vid: string; origin: Point2D; recorded?: boolean }>;
  blockSnapGuides: React.RefObject<{ a: Point2D; b: Point2D }[]>;
  setSelectedEdgeId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedBlockId: React.Dispatch<React.SetStateAction<string>>;
  isPickingPlotPoints: boolean;
  onPickPlotPoint: (pt: [number, number]) => void;
  dragStart: React.RefObject<Point2D>;
  editDrag: React.RefObject<
    | {
        mode: 'vertex';
        targets: { id: string; idx: number }[];
        startWorld: Point2D;
        snapshot: CadEntity[];
      }
    | { mode: 'move'; startWorld: Point2D; snapshot: CadEntity[] }
  >;
  setEditDragActive: React.Dispatch<React.SetStateAction<boolean>>;
  findEntityAt: (rawPt: Point2D) => string | null;
  dragSelecting: React.RefObject<boolean>;
  setMarquee: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number }>>;
}
