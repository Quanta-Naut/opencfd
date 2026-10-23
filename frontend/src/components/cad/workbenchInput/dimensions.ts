import type { CadAction } from '../workbenchCore';
import React from 'react';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import type { DynamicDimPrompt } from '../workbenchCore';
import { dist } from '../workbenchCore';

/** Open the dimension box for an existing entity (double-click to edit its length / radius). */
export function openDimPromptForEntityImpl(ent: CadEntity, wb: OpenDimPromptContext) {
  const { setDimPrompt, setInputVal1, setInputVal2 } = wb;
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
}

/** What openDimPromptForEntityImpl reads from the workbench component. */
export interface OpenDimPromptContext {
  setDimPrompt: React.Dispatch<React.SetStateAction<DynamicDimPrompt>>;
  setInputVal1: React.Dispatch<React.SetStateAction<string>>;
  setInputVal2: React.Dispatch<React.SetStateAction<string>>;
}

/** Apply a typed dimension: finish the entity being drawn, or resize an existing one. */
export function commitDimensionImpl(
  prompt: DynamicDimPrompt,
  val1Str: string,
  val2Str: string | undefined,
  wb: CommitDimensionContext,
) {
  const { setDimPrompt, dispatch, cadState, setTempPts, setCmdText } = wb;
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
}

/** What commitDimensionImpl reads from the workbench component. */
export interface CommitDimensionContext {
  setDimPrompt: React.Dispatch<React.SetStateAction<DynamicDimPrompt>>;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  cadState: { entities: CadEntity[] };
  setTempPts: React.Dispatch<React.SetStateAction<Point2D[]>>;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
}
