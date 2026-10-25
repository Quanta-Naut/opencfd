import { colormapRGB } from '../components/cad/workbenchCore';
import { cssVar } from './theme';
import { fmtValue } from './resultFields';

export interface ExportLegend {
  title: string;
  unit: string;
  lo: number;
  hi: number;
  colormap: string;
  /** Flat bands (0 = smooth). */
  levels: number;
}

/**
 * Save the Results view as a PNG: every canvas layer under `root` (the GPU
 * field, then the 2D overlays) at screen resolution, with the colour legend
 * drawn in, since the on-screen legend is HTML and not part of any canvas.
 */
export function exportViewImage(
  root: HTMLElement,
  legend: ExportLegend | null,
  name: string,
): void {
  composeView(root, legend)?.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${name}.png`);
  }, 'image/png');
}

/** The Results view as one canvas: the canvas layers under `root`, the
 *  colour legend, and an optional caption (such as the time) top right.
 *  `scale` is output pixels per CSS pixel (the screen's by default). */
export function composeView(
  root: HTMLElement,
  legend: ExportLegend | null,
  caption?: string,
  scale?: number,
): HTMLCanvasElement | null {
  const box = root.getBoundingClientRect();
  const dpr = scale ?? (window.devicePixelRatio || 1);
  const out = document.createElement('canvas');
  out.width = Math.round(box.width * dpr);
  out.height = Math.round(box.height * dpr);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = cssVar('--surface') || '#ffffff';
  ctx.fillRect(0, 0, box.width, box.height);
  root.querySelectorAll('canvas').forEach((c) => {
    const r = c.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    ctx.drawImage(c, r.left - box.left, r.top - box.top, r.width, r.height);
  });

  if (legend) {
    const barH = 220,
      barW = 12;
    const x = box.width - 92,
      y = box.height - barH - 40;
    ctx.fillStyle = cssVar('--fg') || '#111111';
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${legend.title}${legend.unit ? ` [${legend.unit}]` : ''}`, x, y - 8);
    const steps = legend.levels || barH;
    for (let i = 0; i < steps; i++) {
      // Top of the bar is the high end.
      const t = legend.levels ? 1 - (i + 0.5) / steps : 1 - i / (steps - 1);
      ctx.fillStyle = colormapRGB(t, legend.colormap);
      ctx.fillRect(x, y + (i * barH) / steps, barW, barH / steps + 0.5);
    }
    ctx.strokeStyle = cssVar('--line') || '#999999';
    ctx.strokeRect(x + 0.5, y + 0.5, barW, barH);
    ctx.fillStyle = cssVar('--fg-2') || '#444444';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 4; k++) {
      const v = legend.hi - ((legend.hi - legend.lo) * k) / 4;
      ctx.fillText(fmtValue(v), x + barW + 6, y + (barH * k) / 4);
    }
  }

  if (caption) {
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const w = ctx.measureText(caption).width;
    ctx.fillStyle = 'rgba(17,17,17,0.85)';
    ctx.fillRect(box.width - w - 28, 12, w + 16, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(caption, box.width - 20, 18);
  }
  return out;
}

/** Hand a file to the user as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
