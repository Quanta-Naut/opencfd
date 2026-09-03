import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Activity } from 'lucide-react';
import { ResidualDataPoint } from '../../types/cfd';
import { CanvasChart, ChartSeries } from './CanvasChart';

interface SolverMonitorRailProps {
  residuals: ResidualDataPoint[];
  executionStatus: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FLOOR = 1e-10;
const MIN_W = 300;
const DEFAULT_W = 400;

const RES_SERIES: ChartSeries[] = [
  { key: 'p', name: 'p', color: '#2563EB' },
  { key: 'Ux', name: 'Ux', color: '#16A34A' },
  { key: 'Uy', name: 'Uy', color: '#D97706' },
  { key: 'k', name: 'k', color: '#8B5CF6' },
  { key: 'omega', name: 'ω', color: '#EC4899' },
  { key: 'epsilon', name: 'ε', color: '#0EA5E9' },
];
const FORCE_SERIES: ChartSeries[] = [
  { key: 'cd', name: 'Cd', color: '#DC2626' },
  { key: 'cl', name: 'Cl', color: '#2563EB' },
];

/** rAF-coalesced state setter - drag handlers fire per mousemove, but we only
 * want one React update per frame so resizing stays smooth. */
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

export const SolverMonitorRail: React.FC<SolverMonitorRailProps> = ({
  residuals,
  executionStatus,
  open,
  onOpenChange,
}) => {
  const [width, setWidth] = useRafState<number>(
    Number(typeof localStorage !== 'undefined' && localStorage.getItem('opencfd_monitor_w')) >= MIN_W
      ? Number(localStorage.getItem('opencfd_monitor_w'))
      : DEFAULT_W,
  );
  const [split, setSplit] = useRafState<number>(
    (() => {
      const s = Number(typeof localStorage !== 'undefined' && localStorage.getItem('opencfd_monitor_split'));
      return s > 0.15 && s < 0.85 ? s : 0.5;
    })(),
  );

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const vDragRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wRef = useRef(width);
  const sRef = useRef(split);
  wRef.current = width;
  sRef.current = split;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const maxW = Math.max(MIN_W, window.innerWidth - 360);
        setWidth(
          Math.min(maxW, Math.max(MIN_W, dragRef.current.startW + (dragRef.current.startX - e.clientX))),
        );
      } else if (vDragRef.current && bodyRef.current) {
        const r = bodyRef.current.getBoundingClientRect();
        setSplit(Math.min(0.85, Math.max(0.15, (e.clientY - r.top) / r.height)));
      }
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        try { localStorage.setItem('opencfd_monitor_w', String(Math.round(wRef.current))); } catch { /* ignore */ }
      }
      if (vDragRef.current) {
        vDragRef.current = false;
        try { localStorage.setItem('opencfd_monitor_split', sRef.current.toFixed(3)); } catch { /* ignore */ }
      }
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setWidth, setSplit]);

  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: wRef.current };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };
  const startVDrag = () => {
    vDragRef.current = true;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  };

  const last = residuals.length > 0 ? residuals[residuals.length - 1] : undefined;
  const cd = typeof last?.cd === 'number' ? last.cd : null;
  const cl = typeof last?.cl === 'number' ? last.cl : null;
  const lastIter = last?.iteration ?? 0;
  const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(4));

  const resData = useMemo(
    () =>
      residuals.map((r) => {
        const o: Record<string, number> = { iteration: r.iteration };
        for (const s of RES_SERIES) {
          const v = (r as any)[s.key];
          if (typeof v === 'number' && isFinite(v)) o[s.key] = Math.max(v, FLOOR);
        }
        return o;
      }),
    [residuals],
  );
  const resActive = useMemo(
    () => RES_SERIES.filter((s) => resData.some((r) => typeof r[s.key] === 'number')),
    [resData],
  );

  const forceData = useMemo(
    () =>
      residuals
        .filter((r) => typeof r.cd === 'number' || typeof r.cl === 'number')
        .map((r) => ({ iteration: r.iteration, cd: r.cd as number, cl: r.cl as number })),
    [residuals],
  );

  const statusChip =
    executionStatus === 'running' ? (
      <span className="text-[#2563EB]">● running</span>
    ) : executionStatus === 'completed' ? (
      <span className="text-[#16A34A]">converged</span>
    ) : executionStatus === 'error' ? (
      <span className="text-[#DC2626]">failed</span>
    ) : (
      <span className="text-[#9AA3AF]">idle</span>
    );

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        title="Open solver monitor"
        className="h-full w-9 shrink-0 border-l border-[#E1E4E8] bg-white hover:bg-[#F5F6F8] flex flex-col items-center justify-center gap-2 text-[#69717D]"
      >
        <Activity className={`w-4 h-4 ${executionStatus === 'running' ? 'text-[#2563EB]' : ''}`} />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-wider">
          Monitor
        </span>
        {executionStatus === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] animate-pulse" />}
      </button>
    );
  }

  return (
    <div
      className="relative h-full shrink-0 border-l border-[#E1E4E8] bg-white flex flex-col select-none"
      style={{ width }}
    >
      <div
        onMouseDown={startDrag}
        title="Drag to resize"
        className="absolute left-0 top-0 bottom-0 -ml-1 w-2 cursor-col-resize z-10 hover:bg-[#2563EB]/30 transition-colors"
      />

      <div className="h-9 px-3 flex items-center justify-between border-b border-[#E1E4E8] bg-[#F5F6F8]">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#69717D]">Solver monitor</span>
        <button
          onClick={() => onOpenChange(false)}
          title="Collapse"
          className="p-1 rounded text-[#69717D] hover:bg-[#E1E4E8]"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3 py-2 flex items-center gap-4 text-[11px] font-mono border-b border-[#EDEFF3] text-[#69717D]">
        {statusChip}
        <span>Cd <strong className="text-[#171A1F]">{fmt(cd)}</strong></span>
        <span>Cl <strong className="text-[#171A1F]">{fmt(cl)}</strong></span>
        <span className="ml-auto">iter <strong className="text-[#171A1F]">{lastIter}</strong></span>
      </div>

      <div ref={bodyRef} className="flex-1 min-h-0 flex flex-col">
        {/* Residuals (top) */}
        <div className="min-h-0 flex flex-col" style={{ flexGrow: split, flexBasis: 0 }}>
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8A929E]">
            Residual convergence
          </div>
          <div className="flex-1 min-h-0 px-1 pb-1">
            {resData.length < 2 ? (
              <div className="w-full h-full flex items-center justify-center text-center text-[#A5ACB5] text-[11px] font-mono px-4">
                Plots in real time once the solver is running.
              </div>
            ) : (
              <CanvasChart data={resData} xKey="iteration" series={resActive} yScale="log" />
            )}
          </div>
        </div>

        <div
          onMouseDown={startVDrag}
          title="Drag to resize"
          className="h-1.5 shrink-0 cursor-row-resize bg-[#EDEFF3] hover:bg-[#2563EB]/40 transition-colors"
        />

        {/* Forces (bottom) */}
        <div className="min-h-0 flex flex-col" style={{ flexGrow: 1 - split, flexBasis: 0 }}>
          <div className="px-3 pt-2 pb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#8A929E]">Force coefficients</span>
            {forceData.length >= 2 && (
              <span className="text-[10px] font-mono text-[#69717D]">
                L/D <strong className="text-[#2563EB]">{cd && cl ? (cl / cd).toFixed(2) : '—'}</strong>
              </span>
            )}
          </div>
          <div className="flex-1 min-h-0 px-1 pb-1">
            {forceData.length < 2 ? (
              <div className="w-full h-full flex items-center justify-center text-center text-[#A5ACB5] text-[11px] font-mono px-4">
                Cd / Cl appear once the solver reports force coefficients.
              </div>
            ) : (
              <CanvasChart data={forceData} xKey="iteration" series={FORCE_SERIES} yScale="linear" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SolverMonitorRail;
