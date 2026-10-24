import type { CadAction } from '../workbenchCore';
import React from 'react';
import { Point2D } from '../../../types/cadWorkflow';
import type { CadTool, DynamicDimPrompt } from '../workbenchCore';
import { uid, dist, splineEntity } from '../workbenchCore';

/** Commit one picked point for the active drawing / modify tool. */
export function commitPointImpl(pt: Point2D, wb: CommitPointContext) {
  const {
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
  } = wb;
  const layer = constructionMode ? 'construction' : 'default';

  if (tool === 'point') {
    // A reference point: always construction, so it guides snapping and
    // never becomes geometry.
    dispatch({
      type: 'ADD_ENTITY',
      entity: { id: uid(), type: 'point', layer: 'construction', pts: [{ ...pt }] },
    });
    setCmdText(
      `POINT: Placed at (${pt.x.toFixed(4)}, ${pt.y.toFixed(4)}). Click or type the next.`,
    );
  } else if (tool === 'spline') {
    // Click fit points; the curve passes through each. Click the first point
    // to close it, Enter to finish it open.
    if (!isDrawing) {
      setTempPts([pt]);
      setIsDrawing(true);
      setCmdText('SPLINE: Click the next fit point.');
    } else if (tempPts.length >= 3 && dist(pt, tempPts[0]) < 12 / zoom) {
      dispatch({ type: 'ADD_ENTITY', entity: splineEntity({ id: uid(), layer }, tempPts, true) });
      setIsDrawing(false);
      setTempPts([]);
      setCmdText('SPLINE: Closed. Click the first point of the next spline.');
    } else {
      setTempPts((prev) => [...prev, pt]);
      setCmdText('SPLINE: Next fit point. Enter finishes, click the first point to close.');
    }
  } else if (tool === 'line') {
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
      setCmdText('POLYLINE: Type Length, press Tab for Angle, Enter for next vertex - or click.');
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
      const typedR = dimPrompt?.live && dimPrompt.type === 'arc' ? parseFloat(dimPrompt.val1) : NaN;
      const r = !isNaN(typedR) && typedR > 0 ? typedR : dist(c, s);
      const sNew =
        !isNaN(typedR) && typedR > 0 ? { x: c.x + r * Math.cos(sa), y: c.y + r * Math.sin(sa) } : s;
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
}

/** What commitPointImpl reads from the workbench component. */
export interface CommitPointContext {
  constructionMode: boolean;
  tool: CadTool;
  isDrawing: boolean;
  setTempPts: React.Dispatch<React.SetStateAction<Point2D[]>>;
  setIsDrawing: React.Dispatch<React.SetStateAction<boolean>>;
  setManualDim: React.Dispatch<React.SetStateAction<boolean>>;
  setDimPrompt: React.Dispatch<React.SetStateAction<DynamicDimPrompt>>;
  setInputVal1: React.Dispatch<React.SetStateAction<string>>;
  setInputVal2: React.Dispatch<React.SetStateAction<string>>;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
  tempPts: Point2D[];
  dispatch: React.ActionDispatch<[action: CadAction]>;
  zoom: number;
  inputVal1: string;
  manualDim: boolean;
  dimPrompt: DynamicDimPrompt;
  inputVal2: string;
}
