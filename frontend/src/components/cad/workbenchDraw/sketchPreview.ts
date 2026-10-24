import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import { dist, sampleSpline, GIZMO } from '../workbenchCore';
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
    } else if (tool === 'spline') {
      // The curve through the fit points so far and the cursor, plus the
      // fit points themselves.
      const curve = sampleSpline([...tempPts, snap.pt]);
      ctx.beginPath();
      curve.forEach((q, i) => {
        const p = ws(q.x, q.y);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.fillStyle = C.accent;
      for (const q of tempPts) {
        const p = ws(q.x, q.y);
        ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
      }
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

/** A shape's outline as world points (circles, ellipses and arcs sampled). */
function outline(e: CadEntity): { pts: Point2D[]; closed: boolean } {
  const ring = (c: Point2D, rx: number, ry: number, rot: number, a0: number, a1: number) =>
    Array.from({ length: 65 }, (_, i) => {
      const t = a0 + ((a1 - a0) * i) / 64;
      const x = rx * Math.cos(t),
        y = ry * Math.sin(t);
      return {
        x: c.x + x * Math.cos(rot) - y * Math.sin(rot),
        y: c.y + x * Math.sin(rot) + y * Math.cos(rot),
      };
    });
  const c = e.pts[0];
  if (e.type === 'circle' && e.pts.length >= 2) {
    const r = e.radius ?? dist(c, e.pts[1]);
    return { pts: ring(c, r, r, 0, 0, 2 * Math.PI), closed: true };
  }
  if (e.type === 'ellipse' && e.pts.length >= 2)
    return {
      pts: ring(c, e.rx ?? dist(c, e.pts[1]), e.ry ?? 0, e.rotation ?? 0, 0, 2 * Math.PI),
      closed: true,
    };
  if (e.type === 'arc' && e.pts.length >= 3) {
    const r = dist(c, e.pts[1]);
    const sa = e.startAngle ?? Math.atan2(e.pts[1].y - c.y, e.pts[1].x - c.x);
    let ea = e.endAngle ?? Math.atan2(e.pts[2].y - c.y, e.pts[2].x - c.x);
    while (ea <= sa) ea += 2 * Math.PI;
    return { pts: ring(c, r, r, 0, sa, ea), closed: false };
  }
  return { pts: e.pts, closed: !!e.isClosed || e.type === 'rectangle' };
}

/** Move / Scale / Rotate / Mirror: a dashed ghost of the result, the base
 *  point and the mirror line. */
export function drawTransformPreview(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws, cw, ch } = f;
  const { C, xformGhost, xformMarks } = scene;
  ctx.save();
  ctx.strokeStyle = C.accent;
  if (xformMarks.line) {
    // The mirror axis, drawn across the view.
    const [a, b] = xformMarks.line;
    const sa = ws(a.x, a.y),
      sb = ws(b.x, b.y);
    const len = Math.hypot(sb.x - sa.x, sb.y - sa.y);
    if (len > 1e-6) {
      const ux = (sb.x - sa.x) / len,
        uy = (sb.y - sa.y) / len,
        ext = cw + ch;
      ctx.lineWidth = 1;
      ctx.setLineDash([10, 3, 2, 3]);
      ctx.beginPath();
      ctx.moveTo(sa.x - ux * ext, sa.y - uy * ext);
      ctx.lineTo(sa.x + ux * ext, sa.y + uy * ext);
      ctx.stroke();
    }
  }
  if (xformGhost) {
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    for (const e of xformGhost) {
      const { pts, closed } = outline(e);
      if (!pts.length) continue;
      if (pts.length === 1) {
        const p = ws(pts[0].x, pts[0].y);
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y - 5);
        ctx.lineTo(p.x + 5, p.y + 5);
        ctx.moveTo(p.x - 5, p.y + 5);
        ctx.lineTo(p.x + 5, p.y - 5);
        ctx.stroke();
        continue;
      }
      ctx.beginPath();
      pts.forEach((q, i) => {
        const p = ws(q.x, q.y);
        if (i) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
      });
      if (closed) ctx.closePath();
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.fillStyle = C.accent;
  for (const q of xformMarks.pts) {
    const p = ws(q.x, q.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  // Picked vertices: filled squares in the selection colour.
  ctx.fillStyle = '#E05A00';
  for (const q of xformMarks.picked) {
    const p = ws(q.x, q.y);
    ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
  }
  if (xformMarks.gizmo) drawGizmo(ctx, ws, xformMarks.gizmo);
  ctx.restore();
}

const AXIS_X = '#DC2626';
const AXIS_Y = '#16A34A';
const HOT = '#F59E0B';

/** The Move / Scale / Rotate handles at the selection (Fusion 360 style):
 *  red X and green Y arms (arrow tips to move, square tips to scale), a
 *  centre square, or a ring to turn. */
function drawGizmo(
  ctx: CanvasRenderingContext2D,
  ws: DrawFrame['ws'],
  g: NonNullable<DrawScene['xformMarks']['gizmo']>,
): void {
  const o = ws(g.at.x, g.at.y);
  const { arm, head, box, ring } = GIZMO;
  ctx.setLineDash([]);
  if (g.kind === 'rotate') {
    ctx.strokeStyle = g.hot === 'rot' ? HOT : '#2563EB';
    ctx.lineWidth = g.hot === 'rot' ? 4 : 2.5;
    ctx.beginPath();
    ctx.arc(o.x, o.y, ring, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(o.x + ring, o.y, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(o.x, o.y, 3, 0, 2 * Math.PI);
    ctx.fill();
    return;
  }
  const armTo = (dx: number, dy: number, color: string, hot: boolean) => {
    const tip = { x: o.x + dx * arm, y: o.y + dy * arm };
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = hot ? 3.5 : 2;
    ctx.beginPath();
    ctx.moveTo(o.x + dx * box, o.y + dy * box);
    ctx.lineTo(
      tip.x - dx * (g.kind === 'move' ? head : 0),
      tip.y - dy * (g.kind === 'move' ? head : 0),
    );
    ctx.stroke();
    ctx.beginPath();
    if (g.kind === 'move') {
      // Arrow head along (dx, dy).
      const w = head * 0.55;
      ctx.moveTo(tip.x + dx * 2, tip.y + dy * 2);
      ctx.lineTo(tip.x - dx * head - dy * w, tip.y - dy * head + dx * w);
      ctx.lineTo(tip.x - dx * head + dy * w, tip.y - dy * head - dx * w);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(tip.x - 5, tip.y - 5, 10, 10);
    }
  };
  armTo(1, 0, g.hot === 'x' ? HOT : AXIS_X, g.hot === 'x');
  armTo(0, -1, g.hot === 'y' ? HOT : AXIS_Y, g.hot === 'y');
  ctx.fillStyle = g.hot === 'xy' ? HOT : 'rgba(37, 99, 235, 0.25)';
  ctx.strokeStyle = g.hot === 'xy' ? HOT : '#2563EB';
  ctx.lineWidth = 1.5;
  ctx.fillRect(o.x - box, o.y - box, box * 2, box * 2);
  ctx.strokeRect(o.x - box, o.y - box, box * 2, box * 2);
}
