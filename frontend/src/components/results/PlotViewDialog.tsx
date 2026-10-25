import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Trash2,
  RefreshCw,
  Sliders,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Layers,
  Download,
  Loader2,
  Upload,
} from 'lucide-react';
import { PlotDefinition, FlowVariable, SolverRunRecord } from '../../types/cfd';
import { CanvasChart, ChartSeries } from '../solver/CanvasChart';
import {
  MONITOR_FIELDS,
  getVariableLabel,
  getMonitorLabel,
  monitorResidualsFor,
  runLabel,
} from './PlotThumbnail';
import { loadPlotSamples, plotXLabel, plotXY, withLineXY, type PlotSamples } from './plotData';
import { RESULT_FIELDS, fieldValues, type FlowReference } from '../../utils/resultFields';
import { toast } from '../ui/Toast';
import { parseXYText } from '../../utils/xyCsv';

export interface PlotViewDialogProps {
  plot: PlotDefinition | null;
  open: boolean;
  onClose: () => void;
  onUpdatePlot: (updated: PlotDefinition) => void;
  onDeletePlot: (id: string) => void;
  projectId: string;
  solverRuns?: SolverRunRecord[];
  /** The plots the arrows step through: this plot's run, in rail order. */
  siblings: PlotDefinition[];
  onNavigate: (plot: PlotDefinition) => void;
  /** Freestream reference for pressure in Pa and derived fields. */
  flowRef: FlowReference;
  /** The project mesh, for older runs stored without patch lists. */
  currentMesh?: { nodes?: ArrayLike<unknown>; boundaries?: Record<string, number[]> } | null;
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

type Loaded =
  | { status: 'loading' }
  | { status: 'ok'; data: PlotSamples }
  | { status: 'error'; detail: string };

/** Cache key for another run's samples of this plot's line or boundary. */
const samplesKey = (plot: PlotDefinition, runId: string) =>
  `${runId}|${plot.kind ?? 'line'}|${JSON.stringify(plot.boundary ?? plot.line ?? null)}`;

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName));

export const PlotViewDialog: React.FC<PlotViewDialogProps> = ({
  plot,
  open,
  onClose,
  onUpdatePlot,
  onDeletePlot,
  projectId,
  solverRuns,
  siblings,
  onNavigate,
  flowRef,
  currentMesh,
}) => {
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [reSampling, setReSampling] = useState(false);
  const [reSampleError, setReSampleError] = useState<string | null>(null);
  // Other runs drawn over this plot. Kept while stepping through plots, so a
  // comparison carries across every plot of the run.
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [runsMenuOpen, setRunsMenuOpen] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const inFlight = useRef(new Set<string>());
  const runsMenuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement>(null);

  // Hooks must run unconditionally on every render, so everything the chart
  // needs lives here, above the early return below.
  const isMonitor = plot?.kind === 'monitor';
  const xAxis = plot?.xAxis ?? 'distance';
  const monitorX = plot?.monitorX ?? 'iteration';
  const runs = solverRuns ?? [];

  useEffect(() => {
    setEditingName(false);
    setReSampleError(null);
  }, [plot?.id]);

  useEffect(() => {
    if (!open) {
      setRunsMenuOpen(false);
      setDataMenuOpen(false);
      setCompareIds([]);
    }
  }, [open]);

  // Runs another run can be compared from: finished ones with something to
  // show (residuals for a monitor plot, a stored field for the others).
  const candidates = useMemo(
    () =>
      runs.filter(
        (r) =>
          r.id !== plot?.runId &&
          r.status !== 'running' &&
          (isMonitor ? r.residuals.length > 1 : r.status !== 'error'),
      ),
    [runs, plot?.runId, isMonitor],
  );
  const shownCompare = compareIds.filter((id) => candidates.some((r) => r.id === id));
  const shownRuns = [plot?.runId ?? null, ...shownCompare];

  // Fetch the compared runs' samples of this plot's line or boundary.
  useEffect(() => {
    if (!open || !plot || isMonitor) return;
    for (const runId of shownCompare) {
      const key = samplesKey(plot, runId);
      if (loaded[key] || inFlight.current.has(key)) continue;
      inFlight.current.add(key);
      setLoaded((m) => ({ ...m, [key]: { status: 'loading' } }));
      loadPlotSamples(plot, projectId, runId, currentMesh).then((res) => {
        inFlight.current.delete(key);
        setLoaded((m) => ({
          ...m,
          [key]: res.data
            ? { status: 'ok', data: res.data }
            : { status: 'error', detail: res.detail || 'Could not load' },
        }));
      });
    }
  }, [open, plot, isMonitor, shownCompare.join(','), projectId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!runsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!runsMenuRef.current?.contains(e.target as Node)) setRunsMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [runsMenuOpen]);

  useEffect(() => {
    if (!dataMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!dataMenuRef.current?.contains(e.target as Node)) setDataMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [dataMenuOpen]);

  const index = plot ? siblings.findIndex((p) => p.id === plot.id) : -1;
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (runsMenuOpen) setRunsMenuOpen(false);
        else if (!isTyping(e.target)) onClose();
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && prev) {
        e.preventDefault();
        onNavigate(prev);
      } else if (e.key === 'ArrowRight' && next) {
        e.preventDefault();
        onNavigate(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prev, next, onNavigate, onClose, runsMenuOpen]);

  const multi = shownRuns.length > 1;
  const runColor = (i: number) => MULTI_SERIES_COLORS[i % MULTI_SERIES_COLORS.length];

  // Rows for every shown run, concatenated: each run writes its own series
  // keys, and the chart skips rows without a series' key.
  const { chartData, series } = useMemo(() => {
    const rows: Array<Record<string, number>> = [];
    const ser: ChartSeries[] = [];
    if (!plot) return { chartData: rows, series: ser };
    if (isMonitor) {
      const fields = plot.monitorFields ?? [];
      shownRuns.forEach((runId, i) => {
        const res = monitorResidualsFor(runId, solverRuns);
        fields.forEach((f, j) => {
          const def = MONITOR_FIELDS.find((m) => m.id === f);
          ser.push({
            key: `${def?.residualKey ?? f}__${i}`,
            name: multi ? `${getMonitorLabel(f)} · ${runLabel(runId, runs)}` : getMonitorLabel(f),
            color: MULTI_SERIES_COLORS[(i * fields.length + j) % MULTI_SERIES_COLORS.length],
          });
        });
        for (const r of res) {
          const row: Record<string, number> = { x: Number((r as any)[monitorX] ?? r.iteration) };
          fields.forEach((f) => {
            const k = MONITOR_FIELDS.find((m) => m.id === f)?.residualKey ?? f;
            const v = (r as any)[k];
            if (typeof v === 'number') row[`${k}__${i}`] = v;
          });
          rows.push(row);
        }
      });
      return { chartData: rows, series: ser };
    }
    shownRuns.forEach((runId, i) => {
      const entry = i === 0 ? null : loaded[samplesKey(plot, runId!)];
      const data = i === 0 ? plot.data : entry?.status === 'ok' ? entry.data : null;
      // A run still loading or without this data stays out of the legend;
      // the runs menu says why.
      if (i > 0 && !data) return;
      const key = `v${i}`;
      ser.push({
        key,
        name: multi ? runLabel(runId, runs) : getVariableLabel(plot.variable),
        color: multi ? runColor(i) : COLORMAP_COLORS[plot.colormap] || '#2563EB',
      });
      const { xs, ys } = plotXY(plot, data, flowRef);
      for (let n = 0; n < ys.length; n++) {
        const x = xs[n];
        if (typeof x !== 'number' || !isFinite(x)) continue;
        let v = ys[n];
        if (!isFinite(v)) v = NaN;
        else if (plot.rangeMin != null && v < plot.rangeMin) v = NaN;
        else if (plot.rangeMax != null && v > plot.rangeMax) v = NaN;
        rows.push({ x, [key]: v });
      }
    });
    // Imported measurements, as points over the lines.
    (plot.experimental ?? []).forEach((e, j) => {
      const key = `e${j}`;
      ser.push({
        key,
        name: e.name,
        color: MULTI_SERIES_COLORS[(shownRuns.length + j) % MULTI_SERIES_COLORS.length],
        markers: true,
      });
      for (let n = 0; n < e.x.length; n++) rows.push({ x: e.x[n], [key]: e.y[n] });
    });
    return { chartData: rows, series: ser };
  }, [plot, isMonitor, shownRuns.join(','), solverRuns, monitorX, loaded, flowRef, multi]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fields this plot's samples can show, raw or derived.
  // Built-in fields, then the project's calculator fields.
  const fieldIds = useMemo<FlowVariable[]>(
    () => [...RESULT_FIELDS.map((f) => f.id), ...(flowRef.custom ?? []).map((f) => f.id)],
    [flowRef],
  );
  const available = useMemo(() => {
    if (!plot?.data?.fields) return null;
    const f = withLineXY(plot, plot.data);
    return new Set(fieldIds.filter((id) => fieldValues(f, id, flowRef)));
  }, [plot, fieldIds, flowRef]);

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

  const reSample = async (variable: FlowVariable) => {
    if (!plot.runId) return;
    setReSampling(true);
    setReSampleError(null);
    try {
      const res = await loadPlotSamples(plot, projectId, plot.runId, currentMesh);
      if (res.data) {
        const vals = fieldValues(res.data.fields, variable, flowRef);
        onUpdatePlot({
          ...plot,
          variable,
          data: { ...res.data, values: vals ? Array.from(vals) : [] },
        });
      } else {
        setReSampleError(res.detail || 'Failed to re-sample.');
      }
    } catch (err: any) {
      setReSampleError(err?.message || 'Re-sampling request failed.');
    } finally {
      setReSampling(false);
    }
  };

  const handleVariableChange = (newVar: FlowVariable) => {
    // Computable from the cached samples: switch instantly.
    const vals = plot.data ? fieldValues(withLineXY(plot, plot.data), newVar, flowRef) : null;
    if (vals && plot.data) {
      onUpdatePlot({ ...plot, variable: newVar, data: { ...plot.data, values: Array.from(vals) } });
      return;
    }
    reSample(newVar);
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

  const handleDelete = () => {
    if (confirm(`Delete plot "${plot.name}"?`)) {
      // Land on a neighbour rather than closing, so stepping through and
      // pruning plots stays in the viewer.
      const after = next ?? prev;
      onDeletePlot(plot.id);
      if (after) onNavigate(after);
      else onClose();
    }
  };

  const handleImportData = async (file: File | undefined) => {
    if (!file) return;
    const { data, error } = parseXYText(await file.text(), file.name.replace(/\.[^.]+$/, ''));
    if (!data) {
      toast.error('Could not read the data', { description: error ?? undefined });
      return;
    }
    const entry = { id: `ex_${Date.now().toString(36)}`, name: data.name, x: data.x, y: data.y };
    onUpdatePlot({ ...plot, experimental: [...(plot.experimental ?? []), entry] });
    toast.success(`Added ${data.name}`, { description: `${data.x.length} points` });
  };

  const handleExportCsv = () => {
    const xName = isMonitor ? monitorX : xAxis === 'distance' ? plotXLabel(plot) : xAxis;
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [[xName, ...series.map((s) => s.name)].map(esc).join(',')];
    for (const r of chartData) {
      lines.push(
        [r.x, ...series.map((s) => r[s.key])]
          .map((v) => (typeof v === 'number' && isFinite(v) ? String(v) : ''))
          .join(','),
      );
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `${plot.name.replace(/[^\w.-]+/g, '_') || 'plot'}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast.success(`Saved ${a.download}`);
  };

  const toggleCompare = (id: string) =>
    setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const lineLength = plot.line
    ? Math.hypot(plot.line.p2[0] - plot.line.p1[0], plot.line.p2[1] - plot.line.p1[1])
    : 0;

  const navBtn =
    'p-1.5 rounded border border-line bg-surface text-fg-2 hover:text-fg hover:bg-app transition-colors disabled:opacity-40 disabled:pointer-events-none';
  const toolBtn =
    'inline-flex items-center gap-1 text-xs font-medium text-fg-2 hover:text-fg bg-surface border border-line px-2.5 py-1.5 rounded-sm hover:bg-app transition-colors disabled:opacity-50';

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
        aria-label="Plot"
      >
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-line-soft bg-surface-2 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className={navBtn}
                disabled={!prev}
                onClick={() => prev && onNavigate(prev)}
                title="Previous plot of this run (Left arrow)"
                aria-label="Previous plot"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="min-w-[44px] text-center text-[11px] font-mono text-fg-2">
                {index >= 0 ? `${index + 1} / ${siblings.length}` : '-'}
              </span>
              <button
                type="button"
                className={navBtn}
                disabled={!next}
                onClick={() => next && onNavigate(next)}
                title="Next plot of this run (Right arrow)"
                aria-label="Next plot"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
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
                  className="px-2 py-1 text-sm font-semibold text-fg border border-accent rounded bg-surface focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleSaveRename}
                  className="p-1 text-success hover:bg-success-soft rounded"
                  aria-label="Save name"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <h2
                onClick={handleStartRename}
                title="Click to rename"
                className="text-sm font-semibold text-fg truncate cursor-text hover:text-accent transition-colors"
              >
                {plot.name}
              </h2>
            )}
            <span className="shrink-0 text-[11px] text-fg-2 font-mono bg-surface-3 px-2 py-0.5 rounded border border-line">
              {runLabel(plot.runId, runs)}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Runs to draw: this plot's run always, others overlaid. */}
            <div className="relative" ref={runsMenuRef}>
              <button
                type="button"
                onClick={() => setRunsMenuOpen((o) => !o)}
                className={`${toolBtn} ${shownCompare.length ? 'bg-accent-soft text-accent-fg border-accent-line' : ''}`}
                title="Overlay this plot from other runs"
                aria-haspopup="listbox"
                aria-expanded={runsMenuOpen}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {shownCompare.length ? `${shownCompare.length + 1} runs` : 'Compare runs'}
                </span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {runsMenuOpen && (
                <div
                  role="listbox"
                  aria-multiselectable="true"
                  className="absolute right-0 top-full mt-1 z-10 w-72 max-h-80 overflow-y-auto rounded border border-line bg-surface p-1"
                >
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-fg-3">
                    <span
                      className="w-3.5 h-3.5 rounded-sm border border-line-strong bg-surface-3 flex items-center justify-center"
                      aria-hidden
                    >
                      <Check className="w-3 h-3" />
                    </span>
                    <span className="truncate flex-1">{runLabel(plot.runId, runs)}</span>
                    <span className="text-[10px]">this plot</span>
                  </div>
                  {candidates.length === 0 && (
                    <div className="px-2 py-2 text-[11px] text-fg-3">No other finished runs.</div>
                  )}
                  {candidates.map((r) => {
                    const on = compareIds.includes(r.id);
                    const st = on && !isMonitor ? loaded[samplesKey(plot, r.id)] : undefined;
                    const i = shownRuns.indexOf(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        onClick={() => toggleCompare(r.id)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-fg hover:bg-surface-2 text-left"
                      >
                        <span
                          className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                            on
                              ? 'bg-accent-soft border-accent-line text-accent-fg'
                              : 'border-line-strong'
                          }`}
                        >
                          {on && <Check className="w-3 h-3" />}
                        </span>
                        <span className="truncate flex-1">{r.label || r.id.slice(0, 6)}</span>
                        {st?.status === 'loading' && (
                          <Loader2 className="w-3 h-3 animate-spin text-fg-3" />
                        )}
                        {st?.status === 'error' && (
                          <span
                            className="text-[10px] text-danger truncate max-w-[140px]"
                            title={st.detail}
                          >
                            {st.detail}
                          </span>
                        )}
                        {on && i > 0 && !isMonitor && (
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: runColor(i) }}
                          />
                        )}
                        <span className="text-[10px] text-fg-3 font-mono">
                          {new Date(r.startedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {!isMonitor && (
              <div className="relative" ref={dataMenuRef}>
                <button
                  type="button"
                  onClick={() => setDataMenuOpen((o) => !o)}
                  className={`${toolBtn} ${plot.experimental?.length ? 'bg-accent-soft text-accent-fg border-accent-line' : ''}`}
                  title="Draw measured data over this plot"
                  aria-haspopup="menu"
                  aria-expanded={dataMenuOpen}
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {plot.experimental?.length ? `Data (${plot.experimental.length})` : 'Add data'}
                  </span>
                </button>
                {dataMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 z-10 w-72 rounded border border-line bg-surface p-1"
                  >
                    {(plot.experimental ?? []).map((e, j) => (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-fg"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              MULTI_SERIES_COLORS[
                                (shownRuns.length + j) % MULTI_SERIES_COLORS.length
                              ],
                          }}
                        />
                        <span className="truncate flex-1" title={e.name}>
                          {e.name}
                        </span>
                        <span className="text-[10px] text-fg-3 font-mono">{e.x.length} pts</span>
                        <button
                          type="button"
                          aria-label={`Remove ${e.name}`}
                          onClick={() =>
                            onUpdatePlot({
                              ...plot,
                              experimental: (plot.experimental ?? []).filter((x) => x.id !== e.id),
                            })
                          }
                          className="text-fg-3 hover:text-fg"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => fileRef.current?.click()}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs text-fg hover:bg-surface-2 text-left"
                    >
                      <Upload className="w-3.5 h-3.5 text-fg-3" />
                      Import a CSV file
                    </button>
                    <p className="px-2 py-1.5 text-[10px] leading-snug text-fg-3">
                      Two columns, x then y, in the same units as this plot's axes. A first row of
                      names is fine.
                    </p>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt,.dat,.tsv,text/csv,text/plain"
                  className="hidden"
                  aria-label="Data file"
                  onChange={(e) => {
                    void handleImportData(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={handleExportCsv}
              title="Save the plotted data as CSV"
              className={toolBtn}
            >
              <Download className="w-3.5 h-3.5" />
              <span>CSV</span>
            </button>
            {!isMonitor && (
              <button
                type="button"
                onClick={() => reSample(plot.variable)}
                disabled={reSampling || !plot.runId}
                title="Sample again from this plot's run"
                className={toolBtn}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reSampling ? 'animate-spin' : ''}`} />
                <span>Re-sample</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDelete}
              title="Delete this plot"
              className="inline-flex items-center gap-1 text-xs font-medium text-danger bg-surface border border-danger-line px-2.5 py-1.5 rounded-sm hover:bg-danger-soft transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-fg-2 hover:bg-surface-3 rounded transition-colors"
              aria-label="Close"
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
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                X axis:
              </span>
              <select
                value={xAxis}
                onChange={(e) => handleXAxisChange(e.target.value as 'distance' | FlowVariable)}
                className="px-2.5 py-1 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                <option value="distance">{plotXLabel(plot)}</option>
                {fieldIds
                  .filter((id) => !available || available.has(id))
                  .map((id) => (
                    <option key={id} value={id}>
                      {getVariableLabel(id)}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                Y axis:
              </span>
              <select
                value={plot.variable}
                onChange={(e) => handleVariableChange(e.target.value as FlowVariable)}
                className="px-2.5 py-1 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                {fieldIds.map((id) => (
                  <option key={id} value={id} disabled={!!available && !available.has(id)}>
                    {getVariableLabel(id)}
                  </option>
                ))}
              </select>
            </div>

            {!multi && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
                  Colour:
                </span>
                <div className="flex items-center gap-1">
                  {COLORMAPS.map((map) => (
                    <button
                      key={map}
                      type="button"
                      onClick={() => handleColormapChange(map)}
                      title={map}
                      aria-label={map}
                      className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${
                        plot.colormap === map
                          ? 'border-accent-line bg-accent-soft'
                          : 'border-line bg-surface hover:bg-app'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORMAP_COLORS[map] }}
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider flex items-center gap-1">
                <Sliders className="w-3 h-3 text-fg-2" />
                Clip:
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

        <div className="px-5 py-2.5 border-t border-line-soft bg-surface-2 flex items-center justify-between gap-4 text-[11px] text-fg-3 font-mono shrink-0">
          {isMonitor ? (
            <span>{monitorResidualsFor(plot.runId, solverRuns).length} iterations</span>
          ) : plot.kind === 'boundary' && plot.boundary ? (
            <span>
              Boundary {plot.boundary.patch}, {plotXLabel(plot).toLowerCase()},{' '}
              {plot.data?.distance.length ?? 0} points
            </span>
          ) : plot.line ? (
            <span>
              P1 ({plot.line.p1[0].toFixed(3)}, {plot.line.p1[1].toFixed(3)}) m, P2 (
              {plot.line.p2[0].toFixed(3)}, {plot.line.p2[1].toFixed(3)}) m, length{' '}
              {lineLength.toFixed(3)} m, {plot.line.samples} samples
            </span>
          ) : (
            <span />
          )}
          <span className="text-fg-4">Left and right arrows step through this run's plots</span>
        </div>
      </div>
    </div>
  );
};

export default PlotViewDialog;
