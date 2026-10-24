import React, { useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';
import { cssVar, useResolvedTheme } from '../../utils/theme';
import { RESULT_FIELDS, fieldDef, type FlowReference } from '../../utils/resultFields';
import { plotXY } from './plotData';
import {
  PlotDefinition,
  FlowVariable,
  MonitorField,
  ResidualDataPoint,
  SolverRunRecord,
} from '../../types/cfd';

export const FLOW_VARIABLES: { id: FlowVariable; label: string; unit: string }[] =
  RESULT_FIELDS.map((f) => ({ id: f.id, label: `${f.label} (${f.short})`, unit: f.unit }));

export function getVariableLabel(v: FlowVariable): string {
  return FLOW_VARIABLES.find((item) => item.id === v)?.label ?? fieldDef(v).label;
}

/** Display name of a run, or a short id when the run is gone. */
export function runLabel(runId: string | null, runs: SolverRunRecord[] | undefined): string {
  if (!runId) return 'Current run';
  return runs?.find((r) => r.id === runId)?.label || `Run ${runId.slice(0, 6)}`;
}

/** A 'monitor' plot's quantity, and which key on `ResidualDataPoint` it reads. */
export const MONITOR_FIELDS: {
  id: MonitorField;
  label: string;
  residualKey: keyof ResidualDataPoint;
}[] = [
  { id: 'residual_p', label: 'p residual', residualKey: 'p' },
  { id: 'residual_Ux', label: 'Ux residual', residualKey: 'Ux' },
  { id: 'residual_Uy', label: 'Uy residual', residualKey: 'Uy' },
  { id: 'residual_k', label: 'k residual', residualKey: 'k' },
  { id: 'residual_omega', label: 'omega residual', residualKey: 'omega' },
  { id: 'residual_epsilon', label: 'epsilon residual', residualKey: 'epsilon' },
  { id: 'cd', label: 'Drag coefficient (Cd)', residualKey: 'cd' },
  { id: 'cl', label: 'Lift coefficient (Cl)', residualKey: 'cl' },
];

export function getMonitorLabel(f: MonitorField): string {
  return MONITOR_FIELDS.find((item) => item.id === f)?.label ?? f;
}

export function monitorResidualsFor(
  runId: string | null,
  solverRuns: SolverRunRecord[] | undefined,
): ResidualDataPoint[] {
  if (!runId || !solverRuns) return [];
  return solverRuns.find((r) => r.id === runId)?.residuals ?? [];
}

const COLORMAP_THEMES: Record<string, { stroke: string; fill: string }> = {
  coolwarm: { stroke: '#DC2626', fill: 'rgba(220, 38, 38, 0.12)' },
  viridis: { stroke: '#059669', fill: 'rgba(5, 150, 105, 0.12)' },
  turbo: { stroke: '#D97706', fill: 'rgba(217, 119, 6, 0.12)' },
  jet: { stroke: '#2563EB', fill: 'rgba(37, 99, 235, 0.12)' },
  rainbow: { stroke: '#7C3AED', fill: 'rgba(124, 58, 237, 0.12)' },
};

const MULTI_SERIES_COLORS = ['#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777'];

interface PlotThumbnailProps {
  plot: PlotDefinition;
  isSelected?: boolean;
  onClick: () => void;
  /** Open the plot in the full-size viewer. */
  onExpand: () => void;
  /** Freestream reference for pressure in Pa and derived fields. */
  flowRef: FlowReference;
  /** Needed only for 'monitor' plots, which read a run's residuals live
   * rather than caching sampled data. */
  solverRuns?: SolverRunRecord[];
}

export const PlotThumbnail: React.FC<PlotThumbnailProps> = ({
  plot,
  isSelected = false,
  onClick,
  onExpand,
  flowRef,
  solverRuns,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = COLORMAP_THEMES[plot.colormap] || COLORMAP_THEMES.viridis;
  const isMonitor = plot.kind === 'monitor';

  // One or more {x, y} series plus the color each should draw in. A 'line'
  // plot is always exactly one series; a 'monitor' plot is one per quantity.
  const seriesList = (() => {
    if (isMonitor) {
      const rows = monitorResidualsFor(plot.runId, solverRuns);
      const xKey = plot.monitorX === 'time' ? 'time' : 'iteration';
      return (plot.monitorFields ?? []).map((f, i) => {
        const def = MONITOR_FIELDS.find((m) => m.id === f);
        const pts = rows
          .map((r) => ({
            x: Number((r as any)[xKey] ?? r.iteration),
            y: (r as any)[def?.residualKey ?? f],
          }))
          .filter((p) => typeof p.y === 'number' && isFinite(p.y));
        return { color: MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length], pts };
      });
    }
    const { xs, ys: values } = plotXY(plot, plot.data, flowRef);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < values.length; i++) {
      let y = values[i];
      const x = xs?.[i];
      if (typeof x !== 'number' || !isFinite(x)) continue;
      if (typeof y !== 'number' || !isFinite(y)) continue;
      if (plot.rangeMin !== null && y < plot.rangeMin) y = NaN;
      if (plot.rangeMax !== null && y > plot.rangeMax) y = NaN;
      pts.push({ x, y });
    }
    return [{ color: theme.stroke, pts }];
  })();

  const uiTheme = useResolvedTheme(); // canvas colours are read per draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW < 10 || cssH < 10) return;

    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const allPts = seriesList.flatMap((s) => s.pts);
    if (allPts.length < 2) {
      ctx.fillStyle = cssVar('--fg-4');
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No data', cssW / 2, cssH / 2);
      return;
    }

    const pad = { l: 6, r: 6, t: 8, b: 6 };
    const plotW = cssW - pad.l - pad.r;
    const plotH = cssH - pad.t - pad.b;

    const minX = Math.min(...allPts.map((p) => p.x));
    const maxX = Math.max(...allPts.map((p) => p.x));
    const xSpan = maxX - minX || 1;
    let vMin = Math.min(...allPts.map((p) => p.y));
    let vMax = Math.max(...allPts.map((p) => p.y));
    if (!isFinite(vMin) || !isFinite(vMax) || vMin === vMax) {
      vMin = 0;
      vMax = 1;
    }
    const vSpan = vMax - vMin || 1;
    const sx = (d: number) => pad.l + ((d - minX) / xSpan) * plotW;
    const sy = (v: number) => pad.t + (1 - (v - vMin) / vSpan) * plotH;

    // Background subtle grid line
    ctx.strokeStyle = cssVar('--line-soft');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, pad.t + plotH / 2);
    ctx.lineTo(pad.l + plotW, pad.t + plotH / 2);
    ctx.stroke();

    // Area fill under a single series only - overlapping fills read as noise
    // once there's more than one line (a multi-quantity monitor plot).
    if (seriesList.length === 1) {
      const pts = seriesList[0].pts;
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const x = sx(pt.x);
        const y = sy(pt.y);
        if (i === 0) {
          ctx.moveTo(x, pad.t + plotH);
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.lineTo(sx(pts[pts.length - 1].x), pad.t + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + plotH);
      grad.addColorStop(0, theme.fill);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // One polyline per series
    for (const s of seriesList) {
      if (s.pts.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      s.pts.forEach((pt, i) => {
        const x = sx(pt.x);
        const y = sy(pt.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Min / max annotations
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillStyle = cssVar('--fg-3');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const fmt = (n: number) =>
      Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01) ? n.toExponential(1) : n.toFixed(2);
    ctx.fillText(fmt(vMax), pad.l, 1);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(fmt(vMin), pad.l + plotW, cssH - 1);
    // seriesList is derived fresh each render from plot/solverRuns, so those
    // are the real dependencies - spreading it as a dep would just thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plot, theme, solverRuns, uiTheme, flowRef]);

  return (
    <div
      onClick={onClick}
      onDoubleClick={onExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onExpand();
      }}
      role="button"
      tabIndex={0}
      className={`group relative rounded border p-2.5 transition-all cursor-pointer text-left ${
        isSelected
          ? 'bg-accent-soft border-accent'
          : 'bg-surface border-line-soft hover:border-line-strong hover:bg-surface-2'
      }`}
    >
      {/* 65px sparkline thumbnail canvas */}
      <div className="relative w-full h-[64px] bg-surface-2 rounded border border-line-soft overflow-hidden mb-2">
        <canvas ref={canvasRef} className="w-full h-full block" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
          title="Open plot"
          aria-label="Open plot"
          className="absolute top-1 right-1 p-1 rounded border border-line bg-surface text-fg-2 opacity-70 group-hover:opacity-100 hover:text-fg hover:border-line-strong transition-opacity"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-semibold text-fg truncate">
          {plot.name || 'Untitled Plot'}
        </span>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: theme.stroke }}
          title={`Colormap: ${plot.colormap}`}
        />
      </div>

      <div className="text-[11px] text-fg-2 truncate mt-0.5 font-medium">
        {isMonitor
          ? (plot.monitorFields ?? []).map(getMonitorLabel).join(', ') || 'No quantity selected'
          : getVariableLabel(plot.variable)}
      </div>

      <div className="flex items-center justify-between text-[10px] text-fg-3 mt-1 font-mono">
        {isMonitor ? (
          <>
            <span>vs {plot.monitorX === 'time' ? 'time' : 'iteration'}</span>
            <span className="truncate">{runLabel(plot.runId, solverRuns)}</span>
          </>
        ) : plot.kind === 'boundary' ? (
          <>
            <span className="truncate">
              on {plot.boundary?.patch} vs{' '}
              {plot.boundary?.axis === 's' ? 'length' : plot.boundary?.axis}
            </span>
            <span className="truncate">{runLabel(plot.runId, solverRuns)}</span>
          </>
        ) : (
          <>
            <span className="truncate">{runLabel(plot.runId, solverRuns)}</span>
            <span className="shrink-0">
              {plot.xAxis && plot.xAxis !== 'distance'
                ? `vs ${getVariableLabel(plot.xAxis)}`
                : plot.line
                  ? `L: ${Math.hypot(plot.line.p2[0] - plot.line.p1[0], plot.line.p2[1] - plot.line.p1[1]).toFixed(2)}m`
                  : ''}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default PlotThumbnail;
