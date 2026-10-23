import React, { useState, useMemo } from 'react';
import { X, Trash2, RefreshCw, Sliders, Check, Loader2 } from 'lucide-react';
import { PlotDefinition, FlowVariable, MonitorField, SolverRunRecord } from '../../types/cfd';
import { CanvasChart, ChartSeries } from '../solver/CanvasChart';
import {
  FLOW_VARIABLES,
  MONITOR_FIELDS,
  getVariableLabel,
  getMonitorLabel,
  monitorResidualsFor,
} from './PlotThumbnail';
import { sampleSolverRunLine } from '../../utils/api';

export interface PlotViewDialogProps {
  plot: PlotDefinition | null;
  open: boolean;
  onClose: () => void;
  onUpdatePlot: (updated: PlotDefinition) => void;
  onDeletePlot: (id: string) => void;
  projectId: string;
  solverRuns?: SolverRunRecord[];
}

const MULTI_SERIES_COLORS = ['#DC2626', '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777'];

const COLORMAPS: Array<'viridis' | 'coolwarm' | 'turbo'> = ['viridis', 'coolwarm', 'turbo'];

const COLORMAP_COLORS: Record<string, string> = {
  coolwarm: '#DC2626',
  viridis: '#059669',
  turbo: '#D97706',
  jet: '#2563EB',
  rainbow: '#7C3AED',
};

export const PlotViewDialog: React.FC<PlotViewDialogProps> = ({
  plot,
  open,
  onClose,
  onUpdatePlot,
  onDeletePlot,
  projectId,
  solverRuns,
}) => {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [reSampling, setReSampling] = useState(false);
  const [reSampleError, setReSampleError] = useState<string | null>(null);

  // Hooks must run unconditionally on every render, so the chart data/series
  // memos (and their null-safe inputs) live here, above the early return
  // below - do not move them after the `if (!open || !plot)` guard.
  const isMonitor = plot?.kind === 'monitor';
  const distances = plot?.data?.distance ?? [];
  const rawValues = plot?.data?.values ?? [];
  const xAxis = plot?.xAxis ?? 'distance';
  const xValues = xAxis !== 'distance' ? (plot?.data?.fields?.[xAxis] ?? []) : distances;
  const monitorX = plot?.monitorX ?? 'iteration';
  const monitorRows = useMemo(
    () => (isMonitor ? monitorResidualsFor(plot?.runId ?? null, solverRuns) : []),
    [isMonitor, plot?.runId, solverRuns],
  );

  const chartData = useMemo(() => {
    if (isMonitor) {
      return monitorRows.map(
        (r) => ({ x: Number((r as any)[monitorX] ?? r.iteration), ...r }) as Record<string, number>,
      );
    }
    const rows: Array<Record<string, number>> = [];
    for (let i = 0; i < rawValues.length; i++) {
      let v = rawValues[i];
      const x = xValues[i];
      if (typeof x !== 'number' || !isFinite(x)) continue;
      if (typeof v !== 'number' || !isFinite(v)) {
        v = NaN;
      } else {
        if (plot?.rangeMin != null && v < plot.rangeMin) v = NaN;
        if (plot?.rangeMax != null && v > plot.rangeMax) v = NaN;
      }
      rows.push({ x, [plot?.variable ?? 'value']: v });
    }
    return rows;
  }, [
    isMonitor,
    monitorRows,
    monitorX,
    rawValues,
    xValues,
    plot?.variable,
    plot?.rangeMin,
    plot?.rangeMax,
  ]);

  const series: ChartSeries[] = useMemo(() => {
    if (!plot) return [];
    if (isMonitor) {
      return (plot.monitorFields ?? []).map((f, i) => {
        const def = MONITOR_FIELDS.find((m) => m.id === f);
        return {
          key: def?.residualKey ?? f,
          name: getMonitorLabel(f),
          color: MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length],
        };
      });
    }
    return [
      {
        key: plot.variable,
        name: getVariableLabel(plot.variable),
        color: COLORMAP_COLORS[plot.colormap] || '#2563EB',
      },
    ];
  }, [plot, isMonitor]);

  const isResidualMonitor =
    isMonitor && (plot?.monitorFields ?? []).some((f) => f.startsWith('residual_'));

  if (!open || !plot) return null;

  const handleStartRename = () => {
    setNameVal(plot.name);
    setEditingName(true);
  };

  const handleSaveRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== plot.name) {
      onUpdatePlot({ ...plot, name: trimmed });
    }
    setEditingName(false);
  };

  const handleVariableChange = async (newVar: FlowVariable) => {
    // If all fields are cached, instant switch without network request
    if (plot.data?.fields && plot.data.fields[newVar]) {
      onUpdatePlot({
        ...plot,
        variable: newVar,
        data: {
          ...plot.data,
          values: plot.data.fields[newVar],
        },
      });
      return;
    }

    // Fallback: re-fetch from backend
    if (!plot.runId || !plot.line) return;
    setReSampling(true);
    setReSampleError(null);
    try {
      const res = await sampleSolverRunLine(
        projectId,
        plot.runId,
        plot.line.p1,
        plot.line.p2,
        plot.line.samples,
      );
      if (res.data) {
        onUpdatePlot({
          ...plot,
          variable: newVar,
          data: {
            distance: res.data.distance,
            values: res.data.fields[newVar] ?? [],
            fields: res.data.fields,
          },
        });
      } else {
        setReSampleError(res.detail || 'Failed to re-sample variable.');
      }
    } catch (err: any) {
      setReSampleError(err?.message || 'Re-sampling error.');
    } finally {
      setReSampling(false);
    }
  };

  const handleXAxisChange = (newX: 'distance' | FlowVariable) => {
    onUpdatePlot({ ...plot, xAxis: newX });
  };

  const handleColormapChange = (newMap: 'viridis' | 'coolwarm' | 'turbo') => {
    onUpdatePlot({ ...plot, colormap: newMap });
  };

  const handleMinChange = (valStr: string) => {
    const v = valStr === '' ? null : parseFloat(valStr);
    onUpdatePlot({ ...plot, rangeMin: isNaN(v as any) ? null : v });
  };

  const handleMaxChange = (valStr: string) => {
    const v = valStr === '' ? null : parseFloat(valStr);
    onUpdatePlot({ ...plot, rangeMax: isNaN(v as any) ? null : v });
  };

  const handleResetRange = () => {
    onUpdatePlot({ ...plot, rangeMin: null, rangeMax: null });
  };

  const handleReSample = async () => {
    if (!plot.runId || !plot.line) return;
    setReSampling(true);
    setReSampleError(null);
    try {
      const res = await sampleSolverRunLine(
        projectId,
        plot.runId,
        plot.line.p1,
        plot.line.p2,
        plot.line.samples,
      );
      if (res.data) {
        onUpdatePlot({
          ...plot,
          data: {
            distance: res.data.distance,
            values: res.data.fields[plot.variable] ?? [],
            fields: res.data.fields,
          },
        });
      } else {
        setReSampleError(res.detail || 'Failed to re-sample line data.');
      }
    } catch (err: any) {
      setReSampleError(err?.message || 'Re-sampling request failed.');
    } finally {
      setReSampling(false);
    }
  };

  const handleDelete = () => {
    if (confirm(`Delete plot "${plot.name}"?`)) {
      onDeletePlot(plot.id);
      onClose();
    }
  };

  const lineLength = plot.line
    ? Math.hypot(plot.line.p2[0] - plot.line.p1[0], plot.line.p2[1] - plot.line.p1[1])
    : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl h-[82vh] rounded bg-surface border border-line flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Plot Details"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-line-soft bg-surface-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveRename();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  autoFocus
                  className="px-2 py-1 text-sm font-bold text-fg border border-accent rounded bg-surface focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveRename}
                  className="p-1 text-success hover:bg-green-50 rounded"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <h2
                  onClick={handleStartRename}
                  title="Click to rename"
                  className="text-base font-bold text-fg truncate cursor-pointer hover:text-accent transition-colors"
                >
                  {plot.name}
                </h2>
                <button
                  type="button"
                  onClick={handleStartRename}
                  className="text-[11px] text-fg-3 hover:text-accent underline"
                >
                  rename
                </button>
              </div>
            )}
            <span className="text-[11px] text-fg-3 font-mono bg-surface-3 px-2 py-0.5 rounded border border-line">
              {plot.runId ? `Run: ${plot.runId}` : 'Current Run'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!isMonitor && (
              <button
                type="button"
                onClick={handleReSample}
                disabled={reSampling}
                title="Re-sample line data from solver run"
                className="inline-flex items-center gap-1 text-xs font-medium text-fg-2 hover:text-fg bg-surface border border-line px-2.5 py-1.5 rounded-sm hover:bg-app transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reSampling ? 'animate-spin' : ''}`} />
                <span>Re-sample</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              title="Delete this plot"
              className="inline-flex items-center gap-1 text-xs font-medium text-danger hover:text-danger bg-surface border border-danger-line px-2.5 py-1.5 rounded-sm hover:bg-danger-soft transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-fg-2 hover:bg-surface-3 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {reSampleError && (
          <div className="px-5 py-2 bg-danger-soft text-danger text-xs border-b border-danger-line">
            {reSampleError}
          </div>
        )}

        {/* Controls Toolbar */}
        {isMonitor ? (
          <div className="px-5 py-2.5 border-b border-line-soft bg-surface-2 flex flex-wrap items-center gap-4 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                Quantities:
              </span>
              <div className="flex items-center gap-2">
                {series.map((s) => (
                  <span key={s.key} className="inline-flex items-center gap-1 font-medium text-fg">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                X axis:
              </span>
              <div className="flex items-center gap-1">
                {(['iteration', 'time'] as const).map((x) => (
                  <button
                    key={x}
                    type="button"
                    onClick={() => onUpdatePlot({ ...plot, monitorX: x })}
                    className={`px-2 py-0.5 rounded capitalize text-xs font-medium border transition-colors ${
                      monitorX === x
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-2.5 border-b border-line-soft bg-surface-2 flex flex-wrap items-center justify-between gap-4 text-xs shrink-0">
            {/* X axis Picker */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                X axis:
              </span>
              <select
                value={xAxis}
                onChange={(e) => handleXAxisChange(e.target.value as 'distance' | FlowVariable)}
                className="px-2.5 py-1 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                <option value="distance">Distance along line</option>
                {FLOW_VARIABLES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Variable Picker */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                Y axis:
              </span>
              <select
                value={plot.variable}
                onChange={(e) => handleVariableChange(e.target.value as FlowVariable)}
                className="px-2.5 py-1 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                {FLOW_VARIABLES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Colormap Selector */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                Colormap:
              </span>
              <div className="flex items-center gap-1">
                {COLORMAPS.map((map) => (
                  <button
                    key={map}
                    type="button"
                    onClick={() => handleColormapChange(map)}
                    className={`px-2 py-0.5 rounded capitalize text-xs font-medium border transition-colors ${
                      plot.colormap === map
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {map}
                  </button>
                ))}
              </div>
            </div>

            {/* Min / Max Range Controls */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider flex items-center gap-1">
                <Sliders className="w-3 h-3 text-fg-2" />
                Clip Range:
              </span>
              <div className="flex items-center gap-1.5 font-mono">
                <input
                  type="number"
                  step="any"
                  placeholder="Min (auto)"
                  value={plot.rangeMin ?? ''}
                  onChange={(e) => handleMinChange(e.target.value)}
                  className="w-24 px-2 py-1 bg-surface border border-line rounded text-xs focus:outline-none focus:border-accent"
                />
                <span className="text-fg-3">to</span>
                <input
                  type="number"
                  step="any"
                  placeholder="Max (auto)"
                  value={plot.rangeMax ?? ''}
                  onChange={(e) => handleMaxChange(e.target.value)}
                  className="w-24 px-2 py-1 bg-surface border border-line rounded text-xs focus:outline-none focus:border-accent"
                />
                {(plot.rangeMin !== null || plot.rangeMax !== null) && (
                  <button
                    type="button"
                    onClick={handleResetRange}
                    className="text-[11px] text-accent hover:underline ml-1"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Chart Area */}
        <div className="flex-1 min-h-0 relative p-4 bg-surface">
          <CanvasChart
            data={chartData}
            xKey="x"
            series={series}
            yScale={isResidualMonitor ? 'log' : 'linear'}
            xFormat={(d) =>
              isMonitor
                ? monitorX === 'time'
                  ? `${d.toFixed(2)}s`
                  : d.toFixed(0)
                : xAxis === 'distance'
                  ? `${d.toFixed(2)}m`
                  : d.toFixed(3)
            }
            yFormat={(v) =>
              Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01)
                ? v.toExponential(2)
                : v.toFixed(3)
            }
          />
        </div>

        {/* Footer: Probe Line / Monitor Specifications */}
        <div className="px-5 py-2.5 border-t border-line-soft bg-surface-2 flex items-center justify-between text-[11px] text-fg-3 font-mono shrink-0">
          {isMonitor ? (
            <span>{monitorRows.length} iterations</span>
          ) : plot.line ? (
            <>
              <div className="flex items-center gap-4">
                <span>
                  P1: ({plot.line.p1[0].toFixed(3)}m, {plot.line.p1[1].toFixed(3)}m)
                </span>
                <span>
                  P2: ({plot.line.p2[0].toFixed(3)}m, {plot.line.p2[1].toFixed(3)}m)
                </span>
                <span>Length: {lineLength.toFixed(3)}m</span>
              </div>
              <div>
                <span>{plot.line.samples} samples</span>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PlotViewDialog;
