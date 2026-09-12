import React, { useState, useMemo } from 'react';
import { X, Trash2, RefreshCw, Sliders, Check, Loader2 } from 'lucide-react';
import { PlotDefinition, FlowVariable } from '../../types/cfd';
import { CanvasChart, ChartSeries } from '../solver/CanvasChart';
import { FLOW_VARIABLES, getVariableLabel } from './PlotThumbnail';
import { sampleSolverRunLine } from '../../utils/api';

export interface PlotViewDialogProps {
  plot: PlotDefinition | null;
  open: boolean;
  onClose: () => void;
  onUpdatePlot: (updated: PlotDefinition) => void;
  onDeletePlot: (id: string) => void;
  projectId: string;
}

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
}) => {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [reSampling, setReSampling] = useState(false);
  const [reSampleError, setReSampleError] = useState<string | null>(null);

  if (!open || !plot) return null;

  const activeThemeColor = COLORMAP_COLORS[plot.colormap] || '#2563EB';

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
    if (!plot.runId) return;
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
    if (!plot.runId) return;
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

  // Prepare chart series & data rows
  const distances = plot.data?.distance ?? [];
  const rawValues = plot.data?.values ?? [];

  const chartData = useMemo(() => {
    const rows: Array<Record<string, number>> = [];
    for (let i = 0; i < distances.length; i++) {
      let v = rawValues[i];
      if (typeof v !== 'number' || !isFinite(v)) {
        v = NaN;
      } else {
        if (plot.rangeMin !== null && v < plot.rangeMin) v = NaN;
        if (plot.rangeMax !== null && v > plot.rangeMax) v = NaN;
      }
      rows.push({
        distance: distances[i],
        [plot.variable]: v,
      });
    }
    return rows;
  }, [distances, rawValues, plot.variable, plot.rangeMin, plot.rangeMax]);

  const series: ChartSeries[] = useMemo(
    () => [
      {
        key: plot.variable,
        name: getVariableLabel(plot.variable),
        color: activeThemeColor,
      },
    ],
    [plot.variable, activeThemeColor],
  );

  const lineLength = Math.hypot(
    plot.line.p2[0] - plot.line.p1[0],
    plot.line.p2[1] - plot.line.p1[1],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B0D10]/50 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-5xl h-[82vh] rounded-xl bg-white border border-[#E4E7EC] shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Plot Details"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-[#EDEFF3] bg-[#FAFBFC] flex items-center justify-between shrink-0">
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
                  className="px-2 py-1 text-sm font-bold text-[#171A1F] border border-[#2563EB] rounded bg-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveRename}
                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-0">
                <h2
                  onClick={handleStartRename}
                  title="Click to rename"
                  className="text-base font-bold text-[#171A1F] truncate cursor-pointer hover:text-[#2563EB] transition-colors"
                >
                  {plot.name}
                </h2>
                <button
                  type="button"
                  onClick={handleStartRename}
                  className="text-[11px] text-[#8A929E] hover:text-[#2563EB] underline"
                >
                  rename
                </button>
              </div>
            )}
            <span className="text-[11px] text-[#8A929E] font-mono bg-[#F1F3F5] px-2 py-0.5 rounded border border-[#E1E4E8]">
              {plot.runId ? `Run: ${plot.runId}` : 'Current Run'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReSample}
              disabled={reSampling}
              title="Re-sample line data from solver run"
              className="inline-flex items-center gap-1 text-xs font-medium text-[#69717D] hover:text-[#171A1F] bg-white border border-[#E1E4E8] px-2.5 py-1.5 rounded-md hover:bg-[#F5F6F8] transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reSampling ? 'animate-spin' : ''}`} />
              <span>Re-sample</span>
            </button>
            <button
              type="button"
              onClick={handleDelete}
              title="Delete this plot"
              className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700 bg-white border border-red-200 px-2.5 py-1.5 rounded-md hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#69717D] hover:bg-[#EEF1F5] rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {reSampleError && (
          <div className="px-5 py-2 bg-red-50 text-red-700 text-xs border-b border-red-200">
            {reSampleError}
          </div>
        )}

        {/* Controls Toolbar */}
        <div className="px-5 py-2.5 border-b border-[#EDEFF3] bg-[#F8FAFC] flex flex-wrap items-center justify-between gap-4 text-xs shrink-0">
          {/* Variable Picker */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider">
              Variable:
            </span>
            <select
              value={plot.variable}
              onChange={(e) => handleVariableChange(e.target.value as FlowVariable)}
              className="px-2.5 py-1 bg-white border border-[#E1E4E8] rounded-md font-medium text-[#171A1F] focus:outline-none focus:border-[#2563EB]"
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
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider">
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
                      ? 'bg-[#2563EB] text-white border-[#2563EB]'
                      : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F5F6F8]'
                  }`}
                >
                  {map}
                </button>
              ))}
            </div>
          </div>

          {/* Min / Max Range Controls */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider flex items-center gap-1">
              <Sliders className="w-3 h-3 text-[#69717D]" />
              Clip Range:
            </span>
            <div className="flex items-center gap-1.5 font-mono">
              <input
                type="number"
                step="any"
                placeholder="Min (auto)"
                value={plot.rangeMin ?? ''}
                onChange={(e) => handleMinChange(e.target.value)}
                className="w-24 px-2 py-1 bg-white border border-[#E1E4E8] rounded text-xs focus:outline-none focus:border-[#2563EB]"
              />
              <span className="text-[#8A929E]">to</span>
              <input
                type="number"
                step="any"
                placeholder="Max (auto)"
                value={plot.rangeMax ?? ''}
                onChange={(e) => handleMaxChange(e.target.value)}
                className="w-24 px-2 py-1 bg-white border border-[#E1E4E8] rounded text-xs focus:outline-none focus:border-[#2563EB]"
              />
              {(plot.rangeMin !== null || plot.rangeMax !== null) && (
                <button
                  type="button"
                  onClick={handleResetRange}
                  className="text-[11px] text-[#2563EB] hover:underline ml-1"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Chart Area */}
        <div className="flex-1 min-h-0 relative p-4 bg-white">
          <CanvasChart
            data={chartData}
            xKey="distance"
            series={series}
            xFormat={(d) => `${d.toFixed(2)}m`}
            yFormat={(v) => (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01) ? v.toExponential(2) : v.toFixed(3))}
          />
        </div>

        {/* Footer: Probe Line Specifications */}
        <div className="px-5 py-2.5 border-t border-[#EDEFF3] bg-[#FAFBFC] flex items-center justify-between text-[11px] text-[#8A929E] font-mono shrink-0">
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
        </div>
      </div>
    </div>
  );
};

export default PlotViewDialog;
