import React, { useState, useEffect, useMemo } from 'react';
import { X, Crosshair, Loader2, AlertCircle, LineChart, Activity } from 'lucide-react';
import { PlotDefinition, FlowVariable, MonitorField, ResidualDataPoint } from '../../types/cfd';
import { sampleSolverRunLine } from '../../utils/api';
import { FLOW_VARIABLES, MONITOR_FIELDS, getMonitorLabel } from './PlotThumbnail';

export interface CreatePlotModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  targetRunId: string | null;
  targetRunLabel?: string;
  targetRunResiduals?: ResidualDataPoint[];
  defaultName: string;
  pickedP1?: [number, number] | null;
  pickedP2?: [number, number] | null;
  onStartPickPoints: () => void;
  onCreatePlot: (plot: PlotDefinition) => void;
}

const COLORMAPS: Array<'viridis' | 'coolwarm' | 'turbo'> = ['viridis', 'coolwarm', 'turbo'];

export const CreatePlotModal: React.FC<CreatePlotModalProps> = ({
  open,
  onClose,
  projectId,
  targetRunId,
  targetRunLabel,
  targetRunResiduals,
  defaultName,
  pickedP1,
  pickedP2,
  onStartPickPoints,
  onCreatePlot,
}) => {
  const [kind, setKind] = useState<'line' | 'monitor'>('line');
  const [name, setName] = useState(defaultName);
  const [variable, setVariable] = useState<FlowVariable>('U_mag');
  const [xAxis, setXAxis] = useState<'distance' | FlowVariable>('distance');
  const [colormap, setColormap] = useState<'viridis' | 'coolwarm' | 'turbo'>('viridis');
  const [samples, setSamples] = useState(100);

  // Which monitor fields this run actually has data for (not every run has
  // k/omega/Cd/Cl - e.g. a laminar run has no turbulence residuals).
  const availableMonitorFields = useMemo(() => {
    const rows = targetRunResiduals ?? [];
    return MONITOR_FIELDS.filter((f) =>
      rows.some((r) => typeof (r as any)[f.residualKey] === 'number'),
    );
  }, [targetRunResiduals]);
  const [monitorFields, setMonitorFields] = useState<MonitorField[]>([]);
  const [monitorX, setMonitorX] = useState<'iteration' | 'time'>('iteration');
  const hasTime = (targetRunResiduals ?? []).some((r) => typeof r.time === 'number');

  useEffect(() => {
    if (kind === 'monitor' && monitorFields.length === 0 && availableMonitorFields.length > 0) {
      setMonitorFields([availableMonitorFields[0].id]);
    }
  }, [kind, availableMonitorFields, monitorFields.length]);

  // Coordinates
  const [p1x, setP1x] = useState<string>('0.0');
  const [p1y, setP1y] = useState<string>('0.0');
  const [p2x, setP2x] = useState<string>('1.0');
  const [p2y, setP2y] = useState<string>('0.0');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync picked points from viewport
  useEffect(() => {
    if (pickedP1) {
      setP1x(pickedP1[0].toFixed(4));
      setP1y(pickedP1[1].toFixed(4));
    }
  }, [pickedP1]);

  useEffect(() => {
    if (pickedP2) {
      setP2x(pickedP2[0].toFixed(4));
      setP2y(pickedP2[1].toFixed(4));
    }
  }, [pickedP2]);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
    }
  }, [open, defaultName]);

  if (!open) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!targetRunId) {
      setError('No completed solver run selected. Please run the solver first.');
      return;
    }

    if (kind === 'monitor') {
      if (monitorFields.length === 0) {
        setError('Pick at least one quantity to monitor.');
        return;
      }
      const newPlot: PlotDefinition = {
        id: `plot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || defaultName,
        kind: 'monitor',
        runId: targetRunId,
        variable: 'U_mag',
        monitorFields,
        monitorX,
        colormap,
        rangeMin: null,
        rangeMax: null,
        data: null,
        createdAt: Date.now(),
      };
      onCreatePlot(newPlot);
      return;
    }

    const x1 = parseFloat(p1x);
    const y1 = parseFloat(p1y);
    const x2 = parseFloat(p2x);
    const y2 = parseFloat(p2y);

    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
      setError('Coordinates for Point 1 and Point 2 must be valid numbers.');
      return;
    }

    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist <= 1e-12) {
      setError('Point 1 and Point 2 must not be identical (line length is zero).');
      return;
    }

    const s = Math.round(samples);
    if (s < 2 || s > 2000) {
      setError('Samples must be an integer between 2 and 2000.');
      return;
    }

    setLoading(true);
    try {
      const res = await sampleSolverRunLine(projectId, targetRunId, [x1, y1], [x2, y2], s);
      if (!res.data || !res.data.distance) {
        setError(res.detail || 'Failed to sample line data from solver run.');
        setLoading(false);
        return;
      }

      const values = res.data.fields[variable] ?? [];
      const newPlot: PlotDefinition = {
        id: `plot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || defaultName,
        kind: 'line',
        runId: targetRunId,
        variable,
        xAxis,
        line: {
          p1: [x1, y1],
          p2: [x2, y2],
          samples: s,
        },
        colormap,
        rangeMin: null,
        rangeMax: null,
        data: {
          distance: res.data.distance,
          values,
          fields: res.data.fields,
        },
        createdAt: Date.now(),
      };

      onCreatePlot(newPlot);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Network error while sampling line.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded bg-surface border border-line flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Create New Plot"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line-soft bg-surface-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded bg-app border border-line text-fg flex items-center justify-center">
              <LineChart className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-fg">New Plot</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded text-fg-2 hover:bg-surface-3 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target Run info */}
        <div className="px-5 py-2 bg-surface-2 border-b border-line flex items-center justify-between text-xs">
          <span className="text-fg-2 font-medium">Run:</span>
          <span className="font-mono text-fg font-semibold">
            {targetRunLabel || targetRunId
              ? `${targetRunLabel || targetRunId}`
              : 'No active run found'}
          </span>
        </div>

        {/* Plot kind */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-2 gap-1 p-0.5 bg-app rounded border border-line">
            <button
              type="button"
              onClick={() => setKind('line')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${
                kind === 'line'
                  ? 'bg-surface text-fg font-semibold border border-line'
                  : 'text-fg-2 hover:text-fg'
              }`}
            >
              <LineChart className="w-3.5 h-3.5" />
              Line probe
            </button>
            <button
              type="button"
              onClick={() => setKind('monitor')}
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded text-xs font-medium transition-colors ${
                kind === 'monitor'
                  ? 'bg-surface text-fg font-semibold border border-line'
                  : 'text-fg-2 hover:text-fg'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Convergence monitor
            </button>
          </div>
        </div>

        {/* Error notification */}
        {error && (
          <div className="px-5 py-2.5 bg-danger-soft border-b border-danger-line flex items-start gap-2 text-xs text-danger">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-danger" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleConfirm} className="p-5 space-y-4 text-xs text-fg">
          {/* Plot Name */}
          <div>
            <label className="block text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-1">
              Plot Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Centerline Velocity"
              className="w-full px-3 py-1.5 bg-surface border border-line rounded-sm text-xs text-fg focus:outline-none focus:border-accent"
            />
          </div>

          {kind === 'monitor' ? (
            <div className="border border-line rounded p-3 bg-surface-2 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-1.5">
                  Quantities to plot
                </label>
                {availableMonitorFields.length === 0 ? (
                  <p className="text-fg-2">
                    This run has no residual history yet - run the solver first.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {availableMonitorFields.map((f) => {
                      const checked = monitorFields.includes(f.id);
                      return (
                        <label
                          key={f.id}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded border cursor-pointer transition-colors ${
                            checked
                              ? 'border-accent bg-accent-soft'
                              : 'border-line bg-surface hover:bg-app'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setMonitorFields((prev) =>
                                checked ? prev.filter((x) => x !== f.id) : [...prev, f.id],
                              )
                            }
                          />
                          <span className="font-medium text-fg">{f.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-1">
                  X axis
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {(['iteration', 'time'] as const).map((x) => (
                    <button
                      key={x}
                      type="button"
                      disabled={x === 'time' && !hasTime}
                      onClick={() => setMonitorX(x)}
                      className={`py-1 rounded capitalize text-[11px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
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
            <>
              {/* X axis, Y variable & Colormap */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-1">
                    X axis
                  </label>
                  <select
                    value={xAxis}
                    onChange={(e) => setXAxis(e.target.value as 'distance' | FlowVariable)}
                    className="w-full px-2.5 py-1.5 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
                  >
                    <option value="distance">Distance along line</option>
                    {FLOW_VARIABLES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-1">
                    Y axis
                  </label>
                  <select
                    value={variable}
                    onChange={(e) => setVariable(e.target.value as FlowVariable)}
                    className="w-full px-2.5 py-1.5 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
                  >
                    {FLOW_VARIABLES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-1">
                    Colormap
                  </label>
                  <div className="grid grid-cols-3 gap-1">
                    {COLORMAPS.map((map) => (
                      <button
                        key={map}
                        type="button"
                        onClick={() => setColormap(map)}
                        className={`py-1 rounded capitalize text-[11px] font-medium border transition-colors ${
                          colormap === map
                            ? 'bg-accent-soft text-accent-fg border-accent-line'
                            : 'bg-surface text-fg-2 border-line hover:bg-app'
                        }`}
                      >
                        {map}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Line Definition: Points & Pick Mode */}
              <div className="border border-line rounded p-3 bg-surface-2 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-fg uppercase tracking-wider">
                    Line Coordinates (meters)
                  </span>
                  <button
                    type="button"
                    onClick={onStartPickPoints}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:text-accent-fg bg-surface border border-accent/40 px-2 py-1 rounded hover:bg-accent-soft transition-colors cursor-pointer"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>Pick on Viewport</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* Point 1 */}
                  <div className="bg-surface p-2.5 rounded border border-line">
                    <div className="text-[11px] font-semibold text-accent mb-1.5 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-accent" />
                      Point 1 (Start)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-fg-3 block mb-0.5">X (m)</span>
                        <input
                          type="number"
                          step="any"
                          value={p1x}
                          onChange={(e) => setP1x(e.target.value)}
                          className="w-full px-2 py-1 bg-surface border border-line rounded text-xs font-mono focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-fg-3 block mb-0.5">Y (m)</span>
                        <input
                          type="number"
                          step="any"
                          value={p1y}
                          onChange={(e) => setP1y(e.target.value)}
                          className="w-full px-2 py-1 bg-surface border border-line rounded text-xs font-mono focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Point 2 */}
                  <div className="bg-surface p-2.5 rounded border border-line">
                    <div className="text-[11px] font-semibold text-success mb-1.5 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-success" />
                      Point 2 (End)
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-fg-3 block mb-0.5">X (m)</span>
                        <input
                          type="number"
                          step="any"
                          value={p2x}
                          onChange={(e) => setP2x(e.target.value)}
                          className="w-full px-2 py-1 bg-surface border border-line rounded text-xs font-mono focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-fg-3 block mb-0.5">Y (m)</span>
                        <input
                          type="number"
                          step="any"
                          value={p2y}
                          onChange={(e) => setP2y(e.target.value)}
                          className="w-full px-2 py-1 bg-surface border border-line rounded text-xs font-mono focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Samples */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] font-medium text-fg-2">Number of Samples:</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={2}
                      max={2000}
                      value={samples}
                      onChange={(e) =>
                        setSamples(Math.max(2, Math.min(2000, parseInt(e.target.value) || 2)))
                      }
                      className="w-20 px-2 py-1 bg-surface border border-line rounded text-xs font-mono text-center focus:outline-none focus:border-accent"
                    />
                    <span className="text-[10px] text-fg-3">(2-2000)</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line-soft">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-1.5 text-xs font-medium text-fg-2 hover:bg-app rounded-sm transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !targetRunId}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent-hover rounded-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sampling line...</span>
                </>
              ) : (
                <span>Create Plot</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreatePlotModal;
