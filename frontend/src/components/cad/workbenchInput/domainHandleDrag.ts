import type { BlockDragState } from '../../../types/blocking';
import React from 'react';
import { Point2D, CadEntity, getGeometryBBox } from '../../../types/cadWorkflow';

/** Global domain-handle drag: document listeners so the cursor can leave the canvas. Returns the cleanup. */
export function attachDomainHandleDrag(wb: DomainHandleDragContext) {
  const {
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
  } = wb;
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
}

/** What attachDomainHandleDrag reads from the workbench component. */
export interface DomainHandleDragContext {
  cadState: { entities: CadEntity[] };
  draggingDomainHandleRef: React.RefObject<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial'>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  pan: Point2D;
  zoom: number;
  snapEnabled: boolean;
  setUpstreamChordFactor: (f: number) => void;
  setDownstreamChordFactor: (f: number) => void;
  setLateralHeightFactor: (f: number) => void;
  blockDrag: React.RefObject<BlockDragState>;
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
  setDraggingDomainHandle: React.Dispatch<
    React.SetStateAction<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial'>
  >;
}
