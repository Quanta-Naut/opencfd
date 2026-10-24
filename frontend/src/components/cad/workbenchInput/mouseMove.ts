import { activeFieldOf } from '../workbenchUi/blockEditor/toolFields';
import type { BlockTool } from '../workbenchUi/blockEditor/shared';
import {
  constrainToHome,
  moveShapePoint,
  vertexMoveKeepsBlocksValid,
} from '../../../types/blocking';
import type { BlockDragState } from '../../../types/blocking';
import React from 'react';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  Point2D,
  CadEntity,
  GeometryBBox,
} from '../../../types/cadWorkflow';
import {
  Blocking,
  blockPolygon,
  applyVertexMove,
  pickEdge,
  splitSheet,
} from '../../../types/blocking';
import type { CadAction, CadTool, Snap, DynamicDimPrompt } from '../workbenchCore';
import {
  moveEntityVertex,
  translateEntity,
  dist,
  pointInPolygon,
  getTrimTarget,
  editPoints,
} from '../workbenchCore';

/** Canvas mouse move: hover state, drags (vertex, selection, block vertex, domain handle), marquee, panning and the live snap. */
export function onMouseMove(e: React.MouseEvent, wb: MouseMoveContext) {
  const {
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
    toolField,
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
    snapAnchor,
    selecting,
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
  } = wb;
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
  // The curve or block edge a click would pick: for the active field of the
  // tool's dialog, or for its params under Select.
  if (showBlocking && canvasMode === 'cad' && blocking) {
    const kind = blockTool === 'select' ? 'edge' : activeFieldOf(blockTool, toolField)?.kind;
    const hc = kind === 'curve' ? pickCurve(raw, 10 / zoom) : null;
    if (hc !== hoverCurveId) setHoverCurveId(hc);
    const edgeStage = kind === 'edge';
    const he =
      edgeStage && !blockDrag.current ? (pickEdge(blocking, raw, 8 / zoom)?.edgeId ?? null) : null;
    if (he !== hoverEdgeId) setHoverEdgeId(he);
  }

  // Structured block-vertex drag / hover (mesh stage).
  if (showBlocking && canvasMode === 'cad' && blocking) {
    const sd = blockDrag.current?.shape;
    if (sd && onUpdateBlocking) {
      const next = moveShapePoint(blocking, sd.edgeId, sd.index, raw);
      // The edge's vertex stands in for it: its blocks must stay unfolded.
      if (vertexMoveKeepsBlocksValid(blocking, next, blockDrag.current!.vid))
        onUpdateBlocking(next);
      return;
    }
    if (blockDrag.current && onUpdateBlocking) {
      const { vid, home } = blockDrag.current;
      const held = home ? constrainToHome(home, raw) : null;
      const { pt, guides } = held ? { pt: held, guides: [] } : snapBlockVertex(raw, vid);
      blockSnapGuides.current = guides;
      const next = applyVertexMove(blocking, vid, pt, cadState.entities);
      // Refuse a position that would fold a block inside out; the vertex
      // stays at its last good spot until the cursor comes back.
      if (vertexMoveKeepsBlocksValid(blocking, next, vid)) onUpdateBlocking(next);
      return;
    }
    const vHit = 12 / zoom;
    let hov: string | null = null;
    const pickingVertex =
      blockTool === 'select' || activeFieldOf(blockTool, toolField)?.kind === 'vertex';
    let bd = pickingVertex ? vHit : 0;
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

  // Ortho and Angle measure from the dragged vertex's start, the move's grab
  // point, or a transform command's base point, as well as from the last
  // point placed while drawing.
  const s = computeSnap(raw, editDrag.current?.startWorld ?? snapAnchor ?? undefined);
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

    const handlePts: Record<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial', Point2D> = {
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
      target ? { p0: target.subSeg.p0, p1: target.subSeg.p1, polyline: target.subPolyline } : null,
    );
  } else if (hoveredTrim) {
    setHoveredTrim(null);
  }

  // Hover: mark the single nearest entity vertex (Select tool) so you can see
  // exactly which point a click / drag will grab.
  if ((tool === 'select' || selecting) && !displayOnly && !isDrawing && !editDrag.current) {
    const r = 11 / zoom;
    let best: Point2D | null = null;
    let bd = r;
    for (const en of cadState.entities) {
      if (en.layer === 'construction' && !showConstruction) continue;
      for (const p of editPoints(en)) {
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
}

/** What onMouseMove reads from the workbench component. */
export interface MouseMoveContext {
  toWorld: (sx: number, sy: number) => Point2D;
  tool: CadTool;
  showBlocking: boolean;
  canvasMode: 'cad' | 'mesh';
  blockTool: BlockTool;
  snapBlockVertex: (
    raw: Point2D,
    draggedVid: string,
  ) => { pt: Point2D; guides: { a: Point2D; b: Point2D }[] };
  blockSnapGuides: React.RefObject<{ a: Point2D; b: Point2D }[]>;
  setBlockCursor: React.Dispatch<React.SetStateAction<Point2D>>;
  blockCursor: Point2D;
  blocking: Blocking;
  zoom: number;
  splitHover: { edgeId: string; pt: Point2D; cut: Point2D[][] };
  setSplitHover: React.Dispatch<
    React.SetStateAction<{ edgeId: string; pt: Point2D; cut: Point2D[][] }>
  >;
  toolField: string;
  pickCurve: (p: Point2D, radius: number) => string | null;
  hoverCurveId: string;
  setHoverCurveId: React.Dispatch<React.SetStateAction<string>>;
  blockDrag: React.RefObject<BlockDragState>;
  hoverEdgeId: string;
  setHoverEdgeId: React.Dispatch<React.SetStateAction<string>>;
  onUpdateBlocking: (bk: Blocking | null) => void;
  cadState: { entities: CadEntity[] };
  hoveredBlockVtx: string;
  setHoveredBlockVtx: React.Dispatch<React.SetStateAction<string>>;
  hoveredBlockIdx: number;
  setHoveredBlockIdx: React.Dispatch<React.SetStateAction<number>>;
  computeSnap: (raw: Point2D, anchor?: Point2D) => Snap;
  snapAnchor: Point2D | null;
  /** A transform command is selecting (not picking a point). */
  selecting: boolean;
  isDrawing: boolean;
  dimPrompt: DynamicDimPrompt;
  manualDim: boolean;
  setSnap: React.Dispatch<React.SetStateAction<Snap>>;
  tempPts: Point2D[];
  setInputVal1: React.Dispatch<React.SetStateAction<string>>;
  setInputVal2: React.Dispatch<React.SetStateAction<string>>;
  setDimPrompt: React.Dispatch<React.SetStateAction<DynamicDimPrompt>>;
  setHud: React.Dispatch<
    React.SetStateAction<{ length: string; angle: string; x: string; y: string }>
  >;
  displayOnly: boolean;
  currentStep: CadWorkflowStep;
  flowType: FlowType;
  domainEntity: CadEntity;
  geometryBBox: GeometryBBox;
  upstreamChordFactor: number;
  downstreamChordFactor: number;
  lateralHeightFactor: number;
  draggingDomainHandle: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial';
  domainShape: DomainShapeType;
  setHoveredDomainHandle: React.Dispatch<
    React.SetStateAction<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial'>
  >;
  hoveredDomainHandle: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial';
  setHoveredTrim: React.Dispatch<
    React.SetStateAction<{ p0: Point2D; p1: Point2D; polyline?: Point2D[] }>
  >;
  hoveredTrim: { p0: Point2D; p1: Point2D; polyline?: Point2D[] };
  editDrag: React.RefObject<
    | {
        mode: 'vertex';
        targets: { id: string; idx: number }[];
        startWorld: Point2D;
        snapshot: CadEntity[];
      }
    | { mode: 'move'; startWorld: Point2D; snapshot: CadEntity[] }
  >;
  showConstruction: boolean;
  hoveredVertex: Point2D;
  setHoveredVertex: React.Dispatch<React.SetStateAction<Point2D>>;
  panning: React.RefObject<boolean>;
  panStart: React.RefObject<Point2D>;
  pendingPanRef: React.RefObject<Point2D>;
  panOrigin: React.RefObject<Point2D>;
  panRafRef: React.RefObject<number>;
  setPan: React.Dispatch<React.SetStateAction<Point2D>>;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
  dragSelecting: React.RefObject<boolean>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  dragStart: React.RefObject<Point2D>;
  setMarquee: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number }>>;
}
