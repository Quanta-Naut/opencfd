import { dist, editPoints } from '../workbenchCore';
import type { DrawFrame, DrawScene } from './types';

/** CAD entities, plus the hovered-vertex marker. */
export function drawEntities(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws, SCALE } = f;
  const {
    C,
    cadState,
    currentStep,
    displayOnly,
    domainBroken,
    hoveredVertex,
    showConstruction,
    tool,
  } = scene;
  for (const e of cadState.entities) {
    const isConst = e.layer === 'construction';
    const isSel = !!e.selected;
    // A pinned domain loop draws dashed (far-field convention) from the Domain
    // step onward. In the Geometry step everything you drew is plain solid
    // geometry - no dashes.
    const isDomain = e.role === 'domain_boundary' && currentStep >= 2;

    if (isDomain) {
      ctx.strokeStyle = domainBroken ? '#DC2626' : isSel ? '#E05A00' : C.accent;
      ctx.lineWidth = isSel ? 2.5 : 1.8;
      ctx.setLineDash([8, 4]);
      ctx.fillStyle = domainBroken ? 'rgba(220, 38, 38, 0.04)' : C.accentA(0.03);
    } else {
      ctx.strokeStyle = isConst ? '#4A90D9' : isSel ? '#E05A00' : C.entity;
      ctx.lineWidth = isSel ? 2.5 : isConst ? 1.2 : 1.8;
      if (isConst) ctx.setLineDash([6, 4]);
      else ctx.setLineDash([]);

      if (!isConst && isSel) {
        ctx.fillStyle = 'rgba(224, 90, 0, 0.07)';
      } else if (!isConst) {
        ctx.fillStyle = C.accentA(0.04);
      } else {
        ctx.fillStyle = 'transparent';
      }
    }

    // Draw entity geometry
    if (e.type === 'point' && e.pts.length) {
      // A reference point: a small cross, ringed when selected.
      const p = ws(e.pts[0].x, e.pts[0].y);
      ctx.setLineDash([]);
      ctx.strokeStyle = isSel ? '#E05A00' : '#4A90D9';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 5);
      ctx.lineTo(p.x + 5, p.y + 5);
      ctx.moveTo(p.x - 5, p.y + 5);
      ctx.lineTo(p.x + 5, p.y - 5);
      ctx.stroke();
      if (isSel) ctx.strokeRect(p.x - 7.5, p.y - 7.5, 15, 15);
    } else if (e.type === 'construction' && e.pts.length === 2) {
      // Infinite reference line: extend far past the viewport in both directions.
      const a = e.pts[0],
        b = e.pts[1];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ext = 1e6;
      const ux = (dx / len) * ext,
        uy = (dy / len) * ext;
      const s0 = ws(a.x - ux, a.y - uy);
      const s1 = ws(b.x + ux, b.y + uy);
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.stroke();
    } else if (
      (e.type === 'line' ||
        e.type === 'polyline' ||
        e.type === 'rectangle' ||
        e.type === 'spline' ||
        e.type === 'construction') &&
      e.pts.length >= 2
    ) {
      ctx.beginPath();
      const p0 = ws(e.pts[0].x, e.pts[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < e.pts.length; i++) {
        const p = ws(e.pts[i].x, e.pts[i].y);
        ctx.lineTo(p.x, p.y);
      }
      if (e.isClosed) {
        ctx.closePath();
        ctx.fill();
      }
      ctx.stroke();

      // Endpoint grips: a small bold dot, a little fatter than the line - never
      // a big white box. On a selected entity each grip also gets a hollow
      // square so it is obvious which vertex a drag will grab.
      if (!isConst || showConstruction) {
        const editable =
          tool === 'select' && !displayOnly && !isConst && e.role !== 'domain_boundary';
        for (const pt of editPoints(e)) {
          const ps = ws(pt.x, pt.y);
          if (isSel && editable) {
            ctx.beginPath();
            ctx.arc(ps.x, ps.y, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = '#E05A00';
            ctx.fill();
            ctx.strokeStyle = '#E05A00';
            ctx.lineWidth = 1.25;
            ctx.strokeRect(ps.x - 6.5, ps.y - 6.5, 13, 13);
          } else if (editable) {
            ctx.beginPath();
            ctx.arc(ps.x, ps.y, 2.6, 0, Math.PI * 2);
            ctx.fillStyle = C.vertexDim;
            ctx.fill();
          } else {
            ctx.fillStyle = isConst ? '#4A90D9' : C.vertex;
            ctx.beginPath();
            ctx.arc(ps.x, ps.y, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else if (e.type === 'circle' && e.pts.length >= 2) {
      const center = ws(e.pts[0].x, e.pts[0].y);
      const r = (e.radius ?? dist(e.pts[0], e.pts[1])) * SCALE;
      ctx.beginPath();
      ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Center mark
      ctx.strokeStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(center.x - 5, center.y);
      ctx.lineTo(center.x + 5, center.y);
      ctx.moveTo(center.x, center.y - 5);
      ctx.lineTo(center.x, center.y + 5);
      ctx.stroke();
    } else if (e.type === 'ellipse' && e.pts.length >= 2) {
      const center = ws(e.pts[0].x, e.pts[0].y);
      const rx = (e.rx ?? dist(e.pts[0], e.pts[1])) * SCALE;
      const ry = (e.ry ?? (rx / SCALE) * 0.5) * SCALE;
      const rot = e.rotation ?? Math.atan2(e.pts[1].y - e.pts[0].y, e.pts[1].x - e.pts[0].x);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, Math.max(0.5, rx), Math.max(0.5, ry), -rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Center mark
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(center.x - 5, center.y);
      ctx.lineTo(center.x + 5, center.y);
      ctx.moveTo(center.x, center.y - 5);
      ctx.lineTo(center.x, center.y + 5);
      ctx.stroke();
    } else if (e.type === 'arc' && e.pts.length >= 3) {
      const center = ws(e.pts[0].x, e.pts[0].y);
      const r = dist(e.pts[0], e.pts[1]) * SCALE;
      const sa = e.startAngle ?? Math.atan2(-(e.pts[1].y - e.pts[0].y), e.pts[1].x - e.pts[0].x);
      const ea = e.endAngle ?? Math.atan2(-(e.pts[2].y - e.pts[0].y), e.pts[2].x - e.pts[0].x);
      ctx.beginPath();
      ctx.arc(center.x, center.y, r, -ea, -sa); // Canvas Y-flipped
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  // Hover: a small solid square around the SINGLE nearest vertex a click would
  // grab (Select tool). One point, not a box over the whole entity.
  if (hoveredVertex) {
    const p = ws(hoveredVertex.x, hoveredVertex.y);
    ctx.save();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([]);
    ctx.strokeRect(p.x - 4.5, p.y - 4.5, 9, 9);
    ctx.restore();
  }
}
