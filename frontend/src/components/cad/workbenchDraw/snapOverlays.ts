import { SNAP_LABELS } from '../workbenchCore';
import type { DrawFrame, DrawScene } from './types';

/** Assist, alignment and tracking guide lines. */
export function drawSnapGuides(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const { C, snap, tool, hideSnap } = scene;
  if (tool !== 'select' && !hideSnap && snap.guides && snap.guides.length > 0) {
    for (const g of snap.guides) {
      if (g.type === 'origin') continue;
      const p1 = ws(g.from.x, g.from.y);
      const p2 = ws(g.to.x, g.to.y);
      const isAxis = g.type === 'xaxis' || g.type === 'yaxis';
      const isPolar = g.type === 'polar';
      const isExt = g.type === 'extension';

      // Amber for the sketch axes, violet for angle tracking, sky blue for
      // every other inference (vertex alignment, perpendicular, ...), and a
      // faint slate for the tracking lines through a hovered point.
      ctx.strokeStyle = isAxis ? '#F59E0B' : isPolar ? '#7C3AED' : isExt ? C.guide : '#0284C7';
      ctx.lineWidth = isExt ? 1 : 1.2;
      ctx.setLineDash(isExt ? [2, 4] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      if (!isAxis && !isExt && g.type !== 'perpendicular') {
        // Small origin square at the tracking reference point
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(p1.x - 2.5, p1.y - 2.5, 5, 5);
      }

      if (g.label) {
        ctx.font = '10px JetBrains Mono';
        ctx.fillStyle = isPolar ? '#7C3AED' : '#0284C7';
        ctx.fillText(g.label, p2.x + 6, p2.y - 4);
      }

      // For 90° perpendicular snap, draw the right-angle corner square at intersection
      if (g.type === 'perpendicular') {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-3) {
          const vx = dx / len;
          const vy = dy / len;
          const ux = -vy;
          const uy = vx;
          const s = 8;
          ctx.strokeStyle = '#0284C7';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(p1.x + vx * s, p1.y + vy * s);
          ctx.lineTo(p1.x + vx * s + ux * s, p1.y + vy * s + uy * s);
          ctx.lineTo(p1.x + ux * s, p1.y + uy * s);
          ctx.stroke();
        }
      }
    }
  }
}

/** The active snap marker and its label. */
export function drawSnapMarker(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const { C, snap, tool, hideSnap } = scene;
  if (tool !== 'select' && !hideSnap && snap.type !== 'grid') {
    const sp = ws(snap.pt.x, snap.pt.y);
    ctx.setLineDash([]);
    const GREEN = '#16A34A';
    const BLUE = '#0284C7';

    if (snap.type === 'origin') {
      // Amber Origin Snap Double Circle with Crosshair
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sp.x - 8, sp.y);
      ctx.lineTo(sp.x + 8, sp.y);
      ctx.moveTo(sp.x, sp.y - 8);
      ctx.lineTo(sp.x, sp.y + 8);
      ctx.stroke();
    } else if (snap.type === 'endpoint') {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.8;
      ctx.strokeRect(sp.x - 5, sp.y - 5, 10, 10);
    } else if (snap.type === 'midpoint') {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y - 6);
      ctx.lineTo(sp.x + 6, sp.y + 5);
      ctx.lineTo(sp.x - 6, sp.y + 5);
      ctx.closePath();
      ctx.stroke();
    } else if (snap.type === 'center') {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (snap.type === 'quadrant') {
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y - 6);
      ctx.lineTo(sp.x + 6, sp.y);
      ctx.lineTo(sp.x, sp.y + 6);
      ctx.lineTo(sp.x - 6, sp.y);
      ctx.closePath();
      ctx.stroke();
    } else if (snap.type === 'intersection') {
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sp.x - 5, sp.y - 5);
      ctx.lineTo(sp.x + 5, sp.y + 5);
      ctx.moveTo(sp.x + 5, sp.y - 5);
      ctx.lineTo(sp.x - 5, sp.y + 5);
      ctx.stroke();
    } else if (snap.type === 'nearest') {
      ctx.strokeStyle = BLUE;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(sp.x - 4, sp.y - 4, 8, 8);
      ctx.setLineDash([]);
    } else {
      // perpendicular / parallel / alignment / polar / tangent
      ctx.strokeStyle = snap.type === 'polar' ? '#7C3AED' : BLUE;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Name the active inference, the way Onshape/Fusion tag the cursor.
    const label = SNAP_LABELS[snap.type];
    if (label) {
      ctx.font = '10px JetBrains Mono';
      const tw = ctx.measureText(label).width;
      const lx = sp.x + 11;
      const ly = sp.y - 11;
      ctx.fillStyle = C.chipBg;
      ctx.fillRect(lx - 3, ly - 10, tw + 7, 14);
      ctx.strokeStyle = C.chipLine;
      ctx.lineWidth = 1;
      ctx.strokeRect(lx - 3, ly - 10, tw + 7, 14);
      ctx.fillStyle = C.chipText;
      ctx.fillText(label, lx, ly + 1);
    }
  }
}

/** Cursor crosshair for the drawing tools. */
export function drawCrosshair(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const { C, snap, tool, hideSnap } = scene;
  if (tool !== 'select' && !hideSnap) {
    const sp = ws(snap.pt.x, snap.pt.y);
    ctx.strokeStyle = C.cursor;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(sp.x - 12, sp.y);
    ctx.lineTo(sp.x + 12, sp.y);
    ctx.moveTo(sp.x, sp.y - 12);
    ctx.lineTo(sp.x, sp.y + 12);
    ctx.stroke();
  }
}

/** Drag-to-select box (window or crossing). */
export function drawMarquee(f: DrawFrame, scene: DrawScene): void {
  const { ctx } = f;
  const { C, marquee } = scene;
  if (marquee) {
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    // left-to-right drag: solid blue fill; right-to-left: crossing selection (lighter)
    const crossingSelect = marquee.w < 0;
    ctx.fillStyle = crossingSelect ? C.accentA(0.05) : C.accentA(0.08);
    const rx = marquee.w >= 0 ? marquee.x : marquee.x + marquee.w;
    const ry = marquee.h >= 0 ? marquee.y : marquee.y + marquee.h;
    const rw = Math.abs(marquee.w);
    const rh = Math.abs(marquee.h);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
  }
}
