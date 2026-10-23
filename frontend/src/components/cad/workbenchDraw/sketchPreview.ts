import { Point2D } from '../../../types/cadWorkflow';
import { dist } from '../workbenchCore';
import type { DrawFrame, DrawScene } from './types';

/** The entity being drawn, before it is committed. */
export function drawTempGeometry(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws, SCALE } = f;
  const { C, isDrawing, snap, tempPts, tool } = scene;
  if (isDrawing && tempPts.length > 0) {
    ctx.strokeStyle = C.accent;
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
      ctx.strokeStyle = C.guide;
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
}

/** Trim tool hover preview: the piece that would be removed. */
export function drawTrimPreview(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const { hoveredTrim, tool } = scene;
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
}
