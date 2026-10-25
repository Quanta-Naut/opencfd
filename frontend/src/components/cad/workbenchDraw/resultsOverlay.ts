import type { MeshLocator } from '../../../utils/meshLocator';
import { colormapRGB } from '../workbenchCore/colormap';
import type { ResultsOverlay } from '../workbenchCore';
import type { DrawFrame } from './types';

/**
 * Results overlays on the 2D canvas, over the field colours: velocity
 * vectors on an even screen-space grid (so their density stays readable at
 * any zoom), lines at values, particle tracks and probe markers with their
 * value.
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

  if (ov.tracks.length || ov.trackSeeds.length) drawTracks(f, ov);
  if (ov.notes.length) drawNotes(f, ov);

  // Probes: a ringed dot and a numbered tag with the active field's value.
  ctx.font = '600 10px ui-monospace, monospace';
  ctx.textBaseline = 'middle';
  ov.probes.forEach((p, i) => {
    const s = ws(p.x, p.y);
    if (s.x < -20 || s.y < -20 || s.x > cw + 20 || s.y > ch + 20) return;
    if (p.selected) {
      // The probe picked in the table: a wide ring around it.
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(17,17,17,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 11.5, 0, Math.PI * 2);
      ctx.stroke();
    }
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

/** Particle tracks, coloured along their length on a light outline (a
 *  single-colour track is white on a dark one), with chevrons showing which
 *  way they run, and the seeds they start from. */
function drawTracks(f: DrawFrame, ov: ResultsOverlay): void {
  const { ctx, ws } = f;
  const range = ov.trackRange;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = range ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const t of ov.tracks) {
    const p = t.pts;
    let s = ws(p[0], p[1]);
    ctx.moveTo(s.x, s.y);
    for (let i = 2; i + 1 < p.length; i += 2) {
      s = ws(p[i], p[i + 1]);
      ctx.lineTo(s.x, s.y);
    }
  }
  ctx.stroke();

  ctx.lineWidth = 2;
  for (const t of ov.tracks) {
    const p = t.pts;
    if (!t.vals || !range) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      let s = ws(p[0], p[1]);
      ctx.moveTo(s.x, s.y);
      for (let i = 2; i + 1 < p.length; i += 2) {
        s = ws(p[i], p[i + 1]);
        ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
      continue;
    }
    // One stroke per run of points in the same of 48 colour steps.
    const span = range[1] - range[0];
    const bucket = (v: number) =>
      Number.isFinite(v) ? Math.max(0, Math.min(47, Math.floor(((v - range[0]) / span) * 48))) : -1;
    let i = 0;
    const n = p.length / 2;
    while (i < n - 1) {
      const b = bucket(t.vals[i]);
      let j = i + 1;
      while (j < n - 1 && bucket(t.vals[j]) === b) j++;
      if (b >= 0) {
        ctx.strokeStyle = colormapRGB((b + 0.5) / 48, ov.colormap);
        ctx.beginPath();
        let s = ws(p[2 * i], p[2 * i + 1]);
        ctx.moveTo(s.x, s.y);
        for (let k = i + 1; k <= j; k++) {
          s = ws(p[2 * k], p[2 * k + 1]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }
      i = j;
    }
  }

  // Direction chevrons about every 120 screen pixels along each track,
  // staggered so neighbouring tracks do not line them up in columns.
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = range ? 'rgba(17,17,17,0.85)' : 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ov.tracks.forEach((t, ti) => {
    const p = t.pts;
    let run = 60 + ((ti * 47) % 120) - 120;
    let a = ws(p[0], p[1]);
    for (let i = 2; i + 1 < p.length; i += 2) {
      const b = ws(p[i], p[i + 1]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      run += L;
      if (run >= 120 && L > 0) {
        run = 0;
        const ux = (b.x - a.x) / L,
          uy = (b.y - a.y) / L;
        ctx.moveTo(b.x - 5 * ux + 3.5 * uy, b.y - 5 * uy - 3.5 * ux);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(b.x - 5 * ux - 3.5 * uy, b.y - 5 * uy + 3.5 * ux);
      }
      a = b;
    }
  });
  ctx.stroke();

  // Seeds: a ring for a point, a dashed line for a line.
  for (const sd of ov.trackSeeds) {
    const a = ws(sd.x0, sd.y0);
    ctx.lineWidth = 1.5;
    if (sd.kind === 'line') {
      const b = ws(sd.x1, sd.y1);
      ctx.setLineDash([4, 3]);
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? '#ffffff' : 'rgba(0,0,0,0.6)';
        ctx.lineWidth = pass ? 1.4 : 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const ends = sd.kind === 'line' ? [a, ws(sd.x1, sd.y1)] : [a];
    for (const e of ends) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** What the track colours mean, top left; drawn outside any clip box. */
export function drawTrackLegend(f: DrawFrame, ov: ResultsOverlay): void {
  const { ctx } = f;
  if (ov.trackLegend && ov.trackRange && ov.tracks.length) {
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const text = `Tracks: ${ov.trackLegend}`;
    const w = ctx.measureText(text).width;
    const x = 12,
      y = 12;
    ctx.fillStyle = 'rgba(17,17,17,0.85)';
    ctx.fillRect(x, y, w + 74, 20);
    for (let k = 0; k < 56; k++) {
      ctx.fillStyle = colormapRGB(k / 55, ov.colormap);
      ctx.fillRect(x + 6 + k, y + 6, 1.2, 8);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, x + 68, y + 10.5);
  }
}

/** Notes: a dot on the point, a leader, and the text on a tag. Long text
 *  wraps at about 28 characters. */
function drawNotes(f: DrawFrame, ov: ResultsOverlay): void {
  const { ctx, cw, ch, ws } = f;
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const n of ov.notes) {
    const p = ws(n.x, n.y);
    if (p.x < -40 || p.y < -40 || p.x > cw + 40 || p.y > ch + 40) continue;
    const lines: string[] = [];
    for (const para of (n.text || 'Note').split('\n')) {
      let cur = '';
      for (const word of para.split(' ')) {
        if (cur && (cur + ' ' + word).length > 28) {
          lines.push(cur);
          cur = word;
        } else cur = cur ? cur + ' ' + word : word;
      }
      lines.push(cur);
    }
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
    const h = lines.length * 15 + 8;
    // Tag up and to the right of the point, flipped when it would leave.
    const dx = p.x + 18 + w > cw ? -18 - w : 18;
    const dy = p.y - 18 - h < 0 ? 18 : -18 - h;
    const bx = p.x + dx,
      by = p.y + dy;
    ctx.strokeStyle = 'rgba(17,17,17,0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(Math.max(bx, Math.min(bx + w, p.x)), dy < 0 ? by + h : by);
    ctx.stroke();
    ctx.fillStyle = 'rgba(17,17,17,0.9)';
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = '#ffffff';
    lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 4 + 7.5 + i * 15));
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
