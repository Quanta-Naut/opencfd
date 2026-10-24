import type { MeshLocator } from '../../../utils/meshLocator';
import type { ResultsOverlay } from '../workbenchCore';
import type { DrawFrame } from './types';

/**
 * Results overlays on the 2D canvas, over the field colours: velocity
 * vectors on an even screen-space grid (so their density stays readable at
 * any zoom) and probe markers with their value.
 */
export function drawResultsOverlay(
  f: DrawFrame,
  ov: ResultsOverlay,
  fields: Record<string, ArrayLike<number> | undefined> | undefined,
  locator: MeshLocator | null,
): void {
  const { ctx, cw, ch, o, ws, SCALE } = f;
  const ux = fields?.Ux,
    uy = fields?.Uy;

  if (ov.showVectors && locator && ux && uy) {
    const step = Math.max(10, ov.vectorSpacing);
    // Arrow length: the fastest flow on screen gets about one grid step.
    const samples: { x: number; y: number; vx: number; vy: number }[] = [];
    let vmax = 0;
    for (let sy = step / 2; sy < ch; sy += step) {
      for (let sx = step / 2; sx < cw; sx += step) {
        const wx = (sx - o.x) / SCALE,
          wy = (o.y - sy) / SCALE;
        const h = locator.locate(wx, wy);
        if (!h) continue;
        const [a, b, c] = h.nodes;
        const vx = h.w[0] * ux[a] + h.w[1] * ux[b] + h.w[2] * ux[c];
        const vy = h.w[0] * uy[a] + h.w[1] * uy[b] + h.w[2] * uy[c];
        const m = Math.hypot(vx, vy);
        if (!(m > 0)) continue;
        if (m > vmax) vmax = m;
        samples.push({ x: sx, y: sy, vx, vy });
      }
    }
    if (vmax > 0) {
      const k = (step * 0.9 * ov.vectorScale) / vmax;
      ctx.lineCap = 'round';
      // Dark halo under a light arrow reads on every colormap.
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.55)';
        ctx.lineWidth = pass ? 1.1 : 2.6;
        ctx.beginPath();
        for (const s of samples) {
          const dx = s.vx * k,
            dy = -s.vy * k;
          const L = Math.hypot(dx, dy);
          if (L < 1.5) continue;
          const x0 = s.x - dx / 2,
            y0 = s.y - dy / 2,
            x1 = s.x + dx / 2,
            y1 = s.y + dy / 2;
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          const hl = Math.min(5, L * 0.35),
            ux1 = dx / L,
            uy1 = dy / L;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - hl * (ux1 + uy1 * 0.5), y1 - hl * (uy1 - ux1 * 0.5));
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - hl * (ux1 - uy1 * 0.5), y1 - hl * (uy1 + ux1 * 0.5));
        }
        ctx.stroke();
      }
    }
  }

  // Lines at typed values: a light line on a dark halo, with the value on a
  // tag at one point of each line that is on screen.
  if (ov.isoLines.length) {
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.6)';
      ctx.lineWidth = pass ? 1.4 : 3.2;
      ctx.beginPath();
      for (const iso of ov.isoLines) {
        const s = iso.segs;
        for (let i = 0; i + 3 < s.length; i += 4) {
          const a = ws(s[i], s[i + 1]);
          const b = ws(s[i + 2], s[i + 3]);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    }
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    // Tags already placed, so the next line's tag goes somewhere else.
    const placed: { x: number; y: number }[] = [];
    for (const iso of ov.isoLines) {
      // The on-screen point nearest the view centre that is clear of other
      // tags, so the tag stays visible and readable.
      const s = iso.segs;
      let best: { x: number; y: number } | null = null;
      let bestD = Infinity;
      for (let i = 0; i + 1 < s.length; i += 2) {
        const p = ws(s[i], s[i + 1]);
        if (p.x < 30 || p.y < 20 || p.x > cw - 60 || p.y > ch - 20) continue;
        if (placed.some((q) => Math.abs(q.x - p.x) < 56 && Math.abs(q.y - p.y) < 22)) continue;
        const d = Math.hypot(p.x - cw / 2, p.y - ch / 2);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (!best) continue;
      placed.push(best);
      const w = ctx.measureText(iso.label).width + 8;
      ctx.fillStyle = 'rgba(17,17,17,0.85)';
      ctx.fillRect(best.x - w / 2, best.y - 8, w, 16);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(iso.label, best.x - w / 2 + 4, best.y);
    }
  }

  // Probes: a ringed dot and a numbered tag with the active field's value.
  ctx.font = '600 10px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ov.probes.forEach((p, i) => {
    const s = ws(p.x, p.y);
    if (s.x < -20 || s.y < -20 || s.x > cw + 20 || s.y > ch + 20) return;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const text = `${i + 1}  ${p.label}`;
    const w = ctx.measureText(text).width + 10;
    const bx = s.x + 8,
      by = s.y - 18;
    ctx.fillStyle = 'rgba(17,17,17,0.85)';
    ctx.fillRect(bx, by, w, 16);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + 5, by + 8);
  });
}
