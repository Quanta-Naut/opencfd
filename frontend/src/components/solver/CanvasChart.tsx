import React, { useEffect, useRef } from 'react';

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
}

interface CanvasChartProps {
  data: Array<Record<string, number>>;
  xKey: string;
  series: ChartSeries[];
  yScale?: 'linear' | 'log';
  yFormat?: (n: number) => string;
  /** hard cap on points drawn per line - LTTB keeps the shape */
  maxDrawPoints?: number;
}

type XY = [number, number];

/** Largest-Triangle-Three-Buckets: down-samples to `threshold` points while
 * preserving spikes and inflections. Standard for streaming time-series charts. */
function lttb(points: XY[], threshold: number): XY[] {
  const n = points.length;
  if (threshold >= n || threshold < 3) return points;
  const out: XY[] = [points[0]];
  const bucket = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i += 1) {
    const rangeStart = Math.floor((i + 1) * bucket) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucket) + 1, n);
    let avgX = 0;
    let avgY = 0;
    const cnt = Math.max(rangeEnd - rangeStart, 1);
    for (let j = rangeStart; j < rangeEnd; j += 1) {
      avgX += points[j][0];
      avgY += points[j][1];
    }
    avgX /= cnt;
    avgY /= cnt;
    const curStart = Math.floor(i * bucket) + 1;
    const curEnd = Math.floor((i + 1) * bucket) + 1;
    const [ax, ay] = points[a];
    let maxArea = -1;
    let maxIdx = curStart;
    for (let j = curStart; j < curEnd; j += 1) {
      const area = Math.abs((ax - avgX) * (points[j][1] - ay) - (ax - points[j][0]) * (avgY - ay));
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }
    out.push(points[maxIdx]);
    a = maxIdx;
  }
  out.push(points[n - 1]);
  return out;
}

const PAD = { l: 46, r: 10, t: 8, b: 34 };

export const CanvasChart: React.FC<CanvasChartProps> = ({
  data,
  xKey,
  series,
  yScale = 'linear',
  yFormat = (n) => (Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01) ? n.toExponential(1) : n.toFixed(2)),
  maxDrawPoints = 800,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ data, xKey, series, yScale, yFormat, maxDrawPoints });
  stateRef.current = { data, xKey, series, yScale, yFormat, maxDrawPoints };

  const dirtyRef = useRef(true);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    dirtyRef.current = true;
  }, [data, series, yScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ro = new ResizeObserver(() => {
      dirtyRef.current = true;
    });
    ro.observe(wrap);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const { data: rows, xKey: xk, series: ser, yScale: ys, yFormat: yf, maxDrawPoints: cap } =
        stateRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      if (cssW < 20 || cssH < 20) return;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const plotW = cssW - PAD.l - PAD.r;
      const plotH = cssH - PAD.t - PAD.b;
      if (plotW < 10 || plotH < 10 || rows.length < 2) {
        ctx.fillStyle = '#A5ACB5';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('waiting for data…', cssW / 2, cssH / 2);
        return;
      }

      // Per-series polylines, LTTB-reduced.
      const lines = ser.map((s) => {
        const pts: XY[] = [];
        for (const r of rows) {
          const y = r[s.key];
          if (typeof y === 'number' && isFinite(y)) pts.push([r[xk], y]);
        }
        return { s, pts: lttb(pts, cap) };
      });

      let xMin = Infinity;
      let xMax = -Infinity;
      const allY: number[] = [];
      for (const { pts } of lines) {
        for (const [x, y] of pts) {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
          if (ys === 'log' ? y > 0 : isFinite(y)) allY.push(y);
        }
      }
      if (!isFinite(xMin) || allY.length === 0 || xMax === xMin) return;
      allY.sort((a, b) => a - b);
      let yMin: number;
      let yMax: number;
      if (ys === 'log') {
        yMin = Math.max(allY[0], 1e-12);
        yMax = Math.max(allY[allY.length - 1], yMin * 10);
      } else {
        // clip the tails so one startup transient spike doesn't flatten the rest
        const q = (p: number) => allY[Math.min(allY.length - 1, Math.max(0, Math.round(p * (allY.length - 1))))];
        yMin = q(0.02);
        yMax = q(0.98);
        if (yMax - yMin < 1e-9) {
          yMin = allY[0];
          yMax = allY[allY.length - 1];
        }
        const pad = (yMax - yMin) * 0.1 || 1;
        yMin -= pad;
        yMax += pad;
      }

      const sx = (x: number) => PAD.l + ((x - xMin) / (xMax - xMin)) * plotW;
      const sy = (y: number) => {
        if (ys === 'log') {
          const t = (Math.log10(Math.max(y, 1e-12)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin));
          return PAD.t + (1 - t) * plotH;
        }
        return PAD.t + (1 - (y - yMin) / (yMax - yMin)) * plotH;
      };

      // Grid + Y ticks
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillStyle = '#A5ACB5';
      ctx.strokeStyle = '#F0F2F5';
      ctx.lineWidth = 1;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const yTicks: number[] =
        ys === 'log'
          ? (() => {
              const t: number[] = [];
              for (let e = Math.ceil(Math.log10(yMin)); e <= Math.floor(Math.log10(yMax)); e += 1) t.push(10 ** e);
              return t.length ? t : [yMin, yMax];
            })()
          : Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));
      for (const t of yTicks) {
        const y = sy(t);
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(cssW - PAD.r, y);
        ctx.stroke();
        ctx.fillText(ys === 'log' ? t.toExponential(0) : yf(t), PAD.l - 6, y);
      }

      // X ticks
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const xTickN = Math.max(2, Math.min(8, Math.floor(plotW / 70)));
      for (let i = 0; i <= xTickN; i += 1) {
        const xv = xMin + (i / xTickN) * (xMax - xMin);
        const x = sx(xv);
        ctx.fillText(String(Math.round(xv)), x, cssH - PAD.b + 6);
      }

      // Series lines (clipped to the plot rect)
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD.l, PAD.t, plotW, plotH);
      ctx.clip();
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      for (const { s, pts } of lines) {
        if (pts.length < 2) continue;
        ctx.strokeStyle = s.color;
        ctx.beginPath();
        pts.forEach(([x, y], i) => {
          const px = sx(x);
          const py = sy(y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
      ctx.restore();

      // Legend
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '10px ui-monospace, monospace';
      let lx = PAD.l;
      const ly = cssH - 12;
      for (const s of ser) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, ly - 3, 10, 3);
        ctx.fillStyle = '#69717D';
        ctx.fillText(s.name, lx + 14, ly);
        lx += 14 + ctx.measureText(s.name).width + 12;
      }

      // Crosshair + readout
      const hov = hoverRef.current;
      if (hov && hov.x >= PAD.l && hov.x <= cssW - PAD.r) {
        const xv = xMin + ((hov.x - PAD.l) / plotW) * (xMax - xMin);
        // nearest row
        let best = rows[0];
        let bd = Infinity;
        for (const r of rows) {
          const d = Math.abs(r[xk] - xv);
          if (d < bd) {
            bd = d;
            best = r;
          }
        }
        const cx = sx(best[xk]);
        ctx.strokeStyle = '#C4C9D0';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, PAD.t);
        ctx.lineTo(cx, cssH - PAD.b);
        ctx.stroke();
        ctx.setLineDash([]);

        const items = ser
          .filter((s) => typeof best[s.key] === 'number' && isFinite(best[s.key]))
          .map((s) => ({ s, v: best[s.key] }));
        const boxW = 96;
        const boxH = 16 + items.length * 13;
        let bx = cx + 8;
        if (bx + boxW > cssW - PAD.r) bx = cx - 8 - boxW;
        const by = PAD.t + 4;
        ctx.fillStyle = 'rgba(255,255,255,0.96)';
        ctx.strokeStyle = '#E1E4E8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(bx, by, boxW, boxH);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#171A1F';
        ctx.textAlign = 'left';
        ctx.fillText(`${xk} ${Math.round(best[xk])}`, bx + 6, by + 8);
        items.forEach((it, i) => {
          ctx.fillStyle = it.s.color;
          ctx.fillRect(bx + 6, by + 18 + i * 13, 6, 6);
          ctx.fillStyle = '#3A4149';
          ctx.fillText(
            `${it.s.name} ${ys === 'log' ? it.v.toExponential(2) : yf(it.v)}`,
            bx + 16,
            by + 21 + i * 13,
          );
        });
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="block w-full h-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
          dirtyRef.current = true;
        }}
        onMouseLeave={() => {
          hoverRef.current = null;
          dirtyRef.current = true;
        }}
      />
    </div>
  );
};

export default CanvasChart;
