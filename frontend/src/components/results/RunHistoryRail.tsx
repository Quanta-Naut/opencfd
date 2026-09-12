import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, History, X, Loader2 } from 'lucide-react';
import { SolverRunRecord } from '../../types/cfd';
import { CanvasChart, ChartSeries } from '../solver/CanvasChart';

export interface RunHistoryRailProps {
  runs: SolverRunRecord[];
  executionStatus: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRelabelRun: (id: string, label: string) => void;
  onDeleteRun: (id: string) => void;
  selectedRunId?: string | null;
  onSelectRun?: (id: string | null) => void;
  historicalFieldStatus?: {
    loading: boolean;
    error: string | null;
    runId: string | null;
  };
  embedded?: boolean;
}

const MIN_W = 300;
const DEFAULT_W = 400;
const FLOOR = 1e-10;

const RES_SERIES: ChartSeries[] = [
  { key: 'p', name: 'p', color: '#2563EB' },
  { key: 'Ux', name: 'Ux', color: '#16A34A' },
  { key: 'Uy', name: 'Uy', color: '#D97706' },
  { key: 'k', name: 'k', color: '#8B5CF6' },
  { key: 'omega', name: 'ω', color: '#EC4899' },
  { key: 'epsilon', name: 'ε', color: '#0EA5E9' },
];

const COMPARE_COLORS = [
  '#2563EB',
  '#DC2626',
  '#16A34A',
  '#D97706',
  '#8B5CF6',
  '#EC4899',
  '#0EA5E9',
  '#F97316',
];

/** rAF-coalesced state setter */
function useRafState<T>(initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState(initial);
  const pending = useRef<T | null>(null);
  const raf = useRef(0);
  const set = (v: T) => {
    pending.current = v;
    if (!raf.current) {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        if (pending.current !== null) setValue(pending.current);
      });
    }
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return [value, set];
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

export const RunHistoryRail: React.FC<RunHistoryRailProps> = ({
  runs,
  executionStatus,
  open,
  onOpenChange,
  onRelabelRun,
  onDeleteRun,
  selectedRunId = null,
  onSelectRun,
  historicalFieldStatus,
  embedded = false,
}) => {
  const [width, setWidth] = useRafState<number>(
    Number(typeof localStorage !== 'undefined' && localStorage.getItem('opencfd_runs_rail_w')) >= MIN_W
      ? Number(localStorage.getItem('opencfd_runs_rail_w'))
      : DEFAULT_W,
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [compareMode, setCompareMode] = useState<boolean>(false);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [showLogsId, setShowLogsId] = useState<string | null>(null);

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const wRef = useRef(width);
  wRef.current = width;

  useEffect(() => {
    if (embedded) return;
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const maxW = Math.max(MIN_W, window.innerWidth - 360);
        setWidth(
          Math.min(maxW, Math.max(MIN_W, dragRef.current.startW + (dragRef.current.startX - e.clientX))),
        );
      }
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        try {
          localStorage.setItem('opencfd_runs_rail_w', String(Math.round(wRef.current)));
        } catch {
          /* ignore */
        }
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setWidth, embedded]);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: wRef.current };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.startedAt - a.startedAt),
    [runs],
  );

  const pinnedRuns = useMemo(
    () => sortedRuns.filter((r) => pinnedIds.has(r.id)),
    [sortedRuns, pinnedIds],
  );

  const cdCompareSeries: ChartSeries[] = useMemo(
    () =>
      pinnedRuns.map((r, i) => ({
        key: `run_${r.id}`,
        name: r.label || `Run ${r.id.slice(0, 6)}`,
        color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      })),
    [pinnedRuns],
  );

  const cdCompareData = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    pinnedRuns.forEach((r) => {
      for (const pt of r.residuals) {
        if (typeof pt.cd !== 'number') continue;
        const row = map.get(pt.iteration) || { iteration: pt.iteration };
        row[`run_${r.id}`] = pt.cd;
        map.set(pt.iteration, row);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.iteration - b.iteration);
  }, [pinnedRuns]);

  const clCompareSeries: ChartSeries[] = useMemo(
    () =>
      pinnedRuns.map((r, i) => ({
        key: `run_${r.id}`,
        name: r.label || `Run ${r.id.slice(0, 6)}`,
        color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      })),
    [pinnedRuns],
  );

  const clCompareData = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    pinnedRuns.forEach((r) => {
      for (const pt of r.residuals) {
        if (typeof pt.cl !== 'number') continue;
        const row = map.get(pt.iteration) || { iteration: pt.iteration };
        row[`run_${r.id}`] = pt.cl;
        map.set(pt.iteration, row);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.iteration - b.iteration);
  }, [pinnedRuns]);

  const pCompareSeries: ChartSeries[] = useMemo(
    () =>
      pinnedRuns.map((r, i) => ({
        key: `run_${r.id}`,
        name: r.label || `Run ${r.id.slice(0, 6)}`,
        color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      })),
    [pinnedRuns],
  );

  const pCompareData = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    pinnedRuns.forEach((r) => {
      for (const pt of r.residuals) {
        if (typeof pt.p !== 'number') continue;
        const row = map.get(pt.iteration) || { iteration: pt.iteration };
        row[`run_${r.id}`] = Math.max(pt.p, FLOOR);
        map.set(pt.iteration, row);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.iteration - b.iteration);
  }, [pinnedRuns]);

  if (!embedded && !open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        title="Open run history"
        className="h-full w-9 shrink-0 border-l border-[#E1E4E8] bg-white hover:bg-[#F5F6F8] flex flex-col items-center justify-center gap-2 text-[#69717D]"
      >
        <History className={`w-4 h-4 ${executionStatus === 'running' ? 'text-[#10B981]' : ''}`} />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-wider">
          RUNS
        </span>
        {executionStatus === 'running' && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
        )}
      </button>
    );
  }

  return (
    <div
      className={
        embedded
          ? 'relative w-full h-full min-h-0 bg-white flex flex-col select-none'
          : 'relative h-full shrink-0 border-l border-[#E1E4E8] bg-white flex flex-col select-none'
      }
      style={embedded ? undefined : { width }}
    >
      {!embedded && (
        <div
          onMouseDown={startDrag}
          title="Drag to resize"
          className="absolute left-0 top-0 bottom-0 -ml-1 w-2 cursor-col-resize z-10 hover:bg-[#2563EB]/30 transition-colors"
        />
      )}

      <div className="h-9 px-3 flex items-center justify-between border-b border-[#E1E4E8] bg-[#F5F6F8] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#69717D]">
            Previous runs
          </span>
          {runs.length > 0 && (
            <span className="text-[10px] font-mono text-[#8A929E]">
              {runs.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCompareMode((v) => !v)}
            title={compareMode ? 'Exit comparison mode' : 'Compare runs'}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              compareMode
                ? 'bg-[#2563EB] text-white'
                : 'text-[#69717D] hover:text-[#171A1F] hover:bg-[#E1E4E8]'
            }`}
          >
            Compare
          </button>
          {!embedded && (
            <button
              onClick={() => onOpenChange(false)}
              title="Collapse"
              className="p-1 rounded text-[#69717D] hover:bg-[#E1E4E8]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {compareMode && (
        <div className="shrink-0 border-b border-[#E1E4E8] bg-[#F9FAFB]">
          {pinnedRuns.length < 2 ? (
            <div className="px-3 py-3 text-center text-[11px] text-[#8A929E] font-mono">
              Pick 2+ runs to compare
            </div>
          ) : (
            <div className="p-2 space-y-2 max-h-[320px] overflow-y-auto">
              <div className="bg-white border border-[#EDEFF3] rounded p-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8A929E] mb-1">
                  Cd vs iteration
                </div>
                <div className="h-[120px] w-full min-h-0">
                  {cdCompareData.length < 2 ? (
                    <div className="w-full h-full flex items-center justify-center text-[#A5ACB5] text-[11px] font-mono">
                      No Cd force data for selected runs.
                    </div>
                  ) : (
                    <CanvasChart
                      data={cdCompareData}
                      xKey="iteration"
                      series={cdCompareSeries}
                      yScale="linear"
                    />
                  )}
                </div>
              </div>

              <div className="bg-white border border-[#EDEFF3] rounded p-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8A929E] mb-1">
                  p residual vs iteration
                </div>
                <div className="h-[120px] w-full min-h-0">
                  {pCompareData.length < 2 ? (
                    <div className="w-full h-full flex items-center justify-center text-[#A5ACB5] text-[11px] font-mono">
                      No p residual data for selected runs.
                    </div>
                  ) : (
                    <CanvasChart
                      data={pCompareData}
                      xKey="iteration"
                      series={pCompareSeries}
                      yScale="log"
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {sortedRuns.length === 0 ? (
        <div className="flex-1 p-6 flex flex-col items-center justify-center text-center text-[#A5ACB5] text-[11px] font-mono">
          <History className="w-8 h-8 mb-2 stroke-[1.5] text-[#C4C9D0]" />
          <p className="max-w-[220px] leading-relaxed">
            No solver runs yet. Runs you start on the Solver tab appear here.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-[#EDEFF3]">
          {sortedRuns.map((run) => {
            const isExpanded = expandedId === run.id;
            const hasForces = typeof run.finalCd === 'number' || typeof run.finalCl === 'number';
            const lastRes = run.residuals.length > 0 ? run.residuals[run.residuals.length - 1] : undefined;
            const cdVal = typeof run.finalCd === 'number' ? run.finalCd : (typeof lastRes?.cd === 'number' ? lastRes.cd : null);
            const clVal = typeof run.finalCl === 'number' ? run.finalCl : (typeof lastRes?.cl === 'number' ? lastRes.cl : null);
            const itersCount = run.iterationsRun ?? (lastRes?.iteration ?? 0);
            const durationMs = run.finishedAt
              ? run.finishedAt - run.startedAt
              : (run.status === 'running' ? Math.max(0, Date.now() - run.startedAt) : 0);
            const shortDateStr = new Date(run.startedAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });

            const runResData = run.residuals.map((r) => {
              const o: Record<string, number> = { iteration: r.iteration };
              for (const s of RES_SERIES) {
                const v = (r as any)[s.key];
                if (typeof v === 'number' && isFinite(v)) o[s.key] = Math.max(v, FLOOR);
              }
              return o;
            });
            const runResActive = RES_SERIES.filter((s) => runResData.some((r) => typeof r[s.key] === 'number'));

            return (
              <div key={run.id} className="flex flex-col">
                {/* Collapsed Row */}
                <div
                  onClick={() => {
                    setExpandedId(isExpanded ? null : run.id);
                    onSelectRun?.(run.id);
                  }}
                  className={`group px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    isExpanded ? 'bg-[#F0F5FF]' : 'hover:bg-[#F5F6F8]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {compareMode && (
                      <input
                        type="checkbox"
                        checked={pinnedIds.has(run.id)}
                        onChange={(e) => {
                          e.stopPropagation();
                          setPinnedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(run.id)) next.delete(run.id);
                            else next.add(run.id);
                            return next;
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-3.5 h-3.5 rounded border-[#C4C9D0] text-[#2563EB] focus:ring-0 cursor-pointer shrink-0"
                      />
                    )}

                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        run.status === 'running'
                          ? 'bg-[#2563EB] animate-pulse'
                          : run.status === 'completed'
                          ? 'bg-[#16A34A]'
                          : run.status === 'error'
                          ? 'bg-[#DC2626]'
                          : 'bg-[#9AA3AF]'
                      }`}
                      title={`Status: ${run.status}`}
                    />

                    {editingId === run.id ? (
                      <input
                        type="text"
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onBlur={() => {
                          const trimmed = editingText.trim();
                          if (trimmed && trimmed !== run.label) {
                            onRelabelRun(run.id, trimmed);
                          }
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const trimmed = editingText.trim();
                            if (trimmed && trimmed !== run.label) {
                              onRelabelRun(run.id, trimmed);
                            }
                            setEditingId(null);
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="px-1 py-0 text-[11px] font-medium border border-[#2563EB] rounded bg-white text-[#171A1F] outline-none min-w-0 w-full"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingId(run.id);
                          setEditingText(run.label);
                        }}
                        title="Double-click to rename"
                        className={`truncate cursor-text text-[11px] font-medium ${
                          isExpanded ? 'text-[#1E40AF]' : 'text-[#171A1F]'
                        }`}
                      >
                        {run.label}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {selectedRunId === run.id && (
                      <span className="text-[10px] font-semibold text-[#171A1F] bg-[#EFF6FF] border border-[#2563EB]/30 px-1.5 py-0.5 rounded-sm">
                        Viewing
                      </span>
                    )}
                    <span className="text-[10px] text-[#8A929E] font-mono">
                      {shortDateStr}
                    </span>
                    {hasForces && (
                      <span className="text-[10px] text-[#69717D] font-mono">
                        Cd {typeof run.finalCd === 'number' ? run.finalCd.toFixed(3) : '-'} / Cl {typeof run.finalCl === 'number' ? run.finalCl.toFixed(3) : '-'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Delete "${run.label}"?`)) {
                          onDeleteRun(run.id);
                          if (expandedId === run.id) setExpandedId(null);
                          setPinnedIds((prev) => {
                            const next = new Set(prev);
                            next.delete(run.id);
                            return next;
                          });
                        }
                      }}
                      title="Delete run"
                      className="p-0.5 rounded text-[#9AA3AF] hover:text-[#DC2626] hover:bg-[#FEE2E2] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-[#8A929E] transition-transform duration-150 ${
                        isExpanded ? 'rotate-180 text-[#1E40AF]' : ''
                      }`}
                    />
                  </div>
                </div>

                {/* Expanded Card */}
                {isExpanded && (
                  <div className="p-3 bg-[#F8FAFC] border-t border-[#EDEFF3] space-y-3 select-text cursor-default">
                    {/* 1. Verdict line */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span
                          className={`font-semibold ${
                            run.status === 'completed'
                              ? 'text-[#16A34A]'
                              : run.status === 'error'
                              ? 'text-[#DC2626]'
                              : run.status === 'running'
                              ? 'text-[#2563EB]'
                              : 'text-[#69717D]'
                          }`}
                        >
                          {run.status === 'completed'
                            ? 'Converged'
                            : run.status === 'error'
                            ? 'Diverged or errored'
                            : run.status === 'stopped'
                            ? 'Stopped early'
                            : 'Running...'}
                        </span>
                        <span className="text-[#A5ACB5]">-</span>
                        <span className="font-mono text-[#374151]">{itersCount} iters</span>
                      </div>
                      <span className="text-[11px] font-mono text-[#69717D]">
                        {formatDuration(durationMs)}
                      </span>
                    </div>

                    {/* Flow field in viewport control */}
                    <div className="flex items-center justify-between gap-2 p-2 bg-white border border-[#EDEFF3] rounded">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="text-[#69717D]">Flow field:</span>
                        {historicalFieldStatus?.runId === run.id && historicalFieldStatus.loading ? (
                          <span className="text-[#2563EB] font-mono text-[10px] flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Loading snapshot...
                          </span>
                        ) : historicalFieldStatus?.runId === run.id && historicalFieldStatus.error ? (
                          <span className="text-[#DC2626] font-mono text-[10px]">
                            No stored field
                          </span>
                        ) : selectedRunId === run.id ? (
                          <span className="text-[#16A34A] font-semibold text-[10px]">
                            Active in viewport
                          </span>
                        ) : (
                          <span className="text-[#8A929E] text-[10px]">Stored snapshot</span>
                        )}
                      </div>
                      {selectedRunId === run.id ? (
                        <span className="px-2 py-0.5 bg-[#F5F6F8] text-[#8A929E] rounded text-[10px] font-medium">
                          Viewing
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRun?.(run.id);
                          }}
                          className="px-2 py-0.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          View in Viewport
                        </button>
                      )}
                    </div>

                    {/* 2. Config chips */}
                    {run.config && (
                      <div className="flex flex-wrap gap-1">
                        <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                          {run.config.timeFormulation}
                        </span>
                        {run.config.turbulenceModel && (
                          <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                            {run.config.turbulenceModel}
                          </span>
                        )}
                        {typeof run.config.reynolds === 'number' && (
                          <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                            Re {Number(run.config.reynolds.toPrecision(3))}
                          </span>
                        )}
                        {typeof run.config.velocity === 'number' && (
                          <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                            U {run.config.velocity} m/s
                          </span>
                        )}
                        {typeof run.config.cells === 'number' && (
                          <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                            {run.config.cells.toLocaleString()} cells
                          </span>
                        )}
                        {typeof run.config.iterations === 'number' && (
                          <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                            {run.config.iterations} iters
                          </span>
                        )}
                        {run.config.momentumOrder && (
                          <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                            {run.config.momentumOrder}
                          </span>
                        )}
                        {run.config.axisymmetric && (
                          <span className="px-1.5 py-0.5 bg-white border border-[#E1E4E8] rounded text-[10px] font-mono text-[#4B5563]">
                            axisymmetric
                          </span>
                        )}
                      </div>
                    )}

                    {/* 3. Residual convergence mini-chart */}
                    <div className="bg-white border border-[#EDEFF3] rounded p-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8A929E] mb-1">
                        Residual convergence
                      </div>
                      <div className="h-[120px] w-full min-h-0">
                        {runResData.length < 2 ? (
                          <div className="w-full h-full flex items-center justify-center text-[#A5ACB5] text-[11px] font-mono">
                            No residuals recorded for this run.
                          </div>
                        ) : (
                          <CanvasChart
                            data={runResData}
                            xKey="iteration"
                            series={runResActive}
                            yScale="log"
                          />
                        )}
                      </div>
                    </div>

                    {/* 4. Final forces */}
                    <div className="grid grid-cols-2 gap-2 bg-white border border-[#EDEFF3] rounded p-2 text-center">
                      <div>
                        <div className="text-[10px] uppercase font-semibold text-[#8A929E]">Cd (Drag)</div>
                        <div className="text-base font-bold font-mono text-[#171A1F]">
                          {cdVal !== null ? cdVal.toFixed(4) : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase font-semibold text-[#8A929E]">Cl (Lift)</div>
                        <div className="text-base font-bold font-mono text-[#171A1F]">
                          {clVal !== null ? clVal.toFixed(4) : '-'}
                        </div>
                      </div>
                    </div>

                    {/* 5. Collapsible console log */}
                    <div className="border border-[#EDEFF3] rounded bg-white overflow-hidden">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowLogsId((prev) => (prev === run.id ? null : run.id));
                        }}
                        className="w-full px-2.5 py-1.5 flex items-center justify-between text-[11px] font-medium text-[#69717D] hover:bg-[#F5F6F8] transition-colors"
                      >
                        <span>Console log ({run.logs ? run.logs.length : 0} lines)</span>
                        {showLogsId === run.id ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {showLogsId === run.id && (
                        <div className="w-full max-h-48 p-2.5 font-mono text-[11px] leading-relaxed text-[#171A1F] overflow-y-auto bg-[#F5F6F8]/60 border-t border-[#EDEFF3] select-text cursor-text [user-select:text] selection:bg-[#2563EB]/25">
                          {!run.logs || run.logs.length === 0 ? (
                            <span className="text-[#A5ACB5]">No console output recorded.</span>
                          ) : (
                            run.logs.map((log, i) => (
                              <div
                                key={i}
                                className={`py-0.5 whitespace-pre-wrap ${
                                  /converged|finished/i.test(log)
                                    ? 'text-[#16A34A] font-semibold'
                                    : /error|fail|cannot|not found|no such/i.test(log)
                                    ? 'text-[#DC2626]'
                                    : ''
                                }`}
                              >
                                {log}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {/* 6. Viewport note */}
                    <div className="text-[10px] text-[#8A929E] italic leading-tight">
                      Selecting this run renders its captured mesh and velocity/pressure contours in the viewport.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RunHistoryRail;
