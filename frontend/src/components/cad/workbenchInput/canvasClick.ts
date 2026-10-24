import type { CadAction } from '../workbenchCore';
import React from 'react';
import { BoundaryTag, BoundaryEdge, Point2D, CadEntity } from '../../../types/cadWorkflow';
import type { CadTool, Snap, DynamicDimPrompt } from '../workbenchCore';
import { uid, distToSegment, getTrimTarget } from '../workbenchCore';

/** Canvas click: selection with the Select tool, otherwise a snapped point for the active tool. */
export function onCanvasClick(e: React.MouseEvent, wb: CanvasClickContext) {
  const {
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
    transformPick,
  } = wb;
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

  // Move / Scale / Rotate / Mirror take objects and points from the canvas.
  if (transformPick) {
    transformPick(snapPt, findEntityAt(rawPt), e.shiftKey);
    return;
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
}

/** What onCanvasClick reads from the workbench component. */
export interface CanvasClickContext {
  displayOnly: boolean;
  panning: React.RefObject<boolean>;
  dragStart: React.RefObject<Point2D>;
  tool: CadTool;
  toWorld: (sx: number, sy: number) => Point2D;
  snap: Snap;
  zoom: number;
  activeTagTool: BoundaryTag;
  boundaryEdges: BoundaryEdge[];
  cadState: { entities: CadEntity[] };
  setEdgeTagMap: React.Dispatch<React.SetStateAction<Record<string, BoundaryTag>>>;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
  findEntityAt: (rawPt: Point2D) => string | null;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  setDimPrompt: React.Dispatch<React.SetStateAction<DynamicDimPrompt>>;
  setHoveredTrim: React.Dispatch<
    React.SetStateAction<{ p0: Point2D; p1: Point2D; polyline?: Point2D[] }>
  >;
  commitPoint: (pt: Point2D) => void;
  transformPick: ((pt: Point2D, hitId: string | null, shift: boolean) => void) | null;
}
