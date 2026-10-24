import type { BlockDragState } from '../../../types/blocking';
import type { CadAction } from '../workbenchCore';
import React from 'react';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import { Blocking, cleanBlocking, propagateNodeCounts } from '../../../types/blocking';
import type { CadTool } from '../workbenchCore';

/** Canvas mouse up: ends drags and resolves the marquee selection. */
export function onMouseUp(e: React.MouseEvent, wb: MouseUpContext) {
  const {
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
  } = wb;
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
          (p) => p.x >= worldMin.x && p.x <= worldMax.x && p.y >= worldMin.y && p.y <= worldMax.y,
        );
        return { ...ent, selected: e.shiftKey ? ent.selected || touches : touches };
      } else {
        // Window (left-to-right): select only if ALL points are inside box
        const inside = ent.pts.every(
          (p) => p.x >= worldMin.x && p.x <= worldMax.x && p.y >= worldMin.y && p.y <= worldMax.y,
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
}

/** What onMouseUp reads from the workbench component. */
export interface MouseUpContext {
  panning: React.RefObject<boolean>;
  pan: Point2D;
  panRafRef: React.RefObject<number>;
  pendingPanRef: React.RefObject<Point2D>;
  setPan: React.Dispatch<React.SetStateAction<Point2D>>;
  blockDrag: React.RefObject<BlockDragState>;
  blockSnapGuides: React.RefObject<{ a: Point2D; b: Point2D }[]>;
  blocking: Blocking;
  onUpdateBlocking: (bk: Blocking | null) => void;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
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
  draggingAoAHandle: boolean;
  setDraggingAoAHandle: React.Dispatch<React.SetStateAction<boolean>>;
  marquee: { x: number; y: number; w: number; h: number };
  dragSelecting: React.RefObject<boolean>;
  tool: CadTool;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  zoom: number;
  setMarquee: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number }>>;
  cadState: { entities: CadEntity[] };
  dispatch: React.ActionDispatch<[action: CadAction]>;
}
