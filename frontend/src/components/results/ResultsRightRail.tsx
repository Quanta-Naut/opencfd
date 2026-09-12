import React, { useEffect, useRef, useState } from 'react';
import { LineChart, History, ChevronRight } from 'lucide-react';
import { SolverRunRecord, PlotDefinition } from '../../types/cfd';
import { PlotsRail } from './PlotsRail';
import { RunHistoryRail } from './RunHistoryRail';

export interface ResultsRightRailProps {
  // Plots panel props
  plots: PlotDefinition[];
  selectedPlotId: string | null;
  onSelectPlot: (plot: PlotDefinition) => void;

  // Runs panel props
  runs: SolverRunRecord[];
  executionStatus: string;
  selectedRunId: string | null;
  onSelectRun: (id: string | null) => void;
  onRelabelRun: (id: string, label: string) => void;
  onDeleteRun: (id: string) => void;
  historicalFieldStatus?: {
    loading: boolean;
    error: string | null;
    runId: string | null;
  };

  // Rail open/close
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_W = 300;
const DEFAULT_W = 400;
const STORAGE_KEY_W = 'opencfd_runs_rail_w';
const STORAGE_KEY_TAB = 'opencfd_results_rail_tab';

/** rAF-coalesced state setter */
function useRafState<T>(initial: T | (() => T)): [T, (v: T) => void] {
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

export const ResultsRightRail: React.FC<ResultsRightRailProps> = ({
  plots,
  selectedPlotId,
  onSelectPlot,
  runs,
  executionStatus,
  selectedRunId,
  onSelectRun,
  onRelabelRun,
  onDeleteRun,
  historicalFieldStatus,
  open,
  onOpenChange,
}) => {
  // Active tab: 'plots' | 'runs'
  const [activeTab, setActiveTab] = useState<'plots' | 'runs'>(() => {
    if (typeof localStorage === 'undefined') return 'runs';
    const stored = localStorage.getItem(STORAGE_KEY_TAB);
    return stored === 'plots' ? 'plots' : 'runs';
  });

  const handleTabChange = (tab: 'plots' | 'runs') => {
    setActiveTab(tab);
    try {
      localStorage.setItem(STORAGE_KEY_TAB, tab);
    } catch {
      /* ignore */
    }
  };

  // Outer width
  const [width, setWidth] = useRafState<number>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_W;
    const stored = Number(localStorage.getItem(STORAGE_KEY_W));
    return stored >= MIN_W ? stored : DEFAULT_W;
  });

  const dragWRef = useRef<{ startX: number; startW: number } | null>(null);
  const wRef = useRef(width);
  wRef.current = width;

  // Horizontal width drag handler
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragWRef.current) {
        const maxW = Math.max(MIN_W, window.innerWidth - 360);
        setWidth(
          Math.min(maxW, Math.max(MIN_W, dragWRef.current.startW + (dragWRef.current.startX - e.clientX))),
        );
      }
    };
    const onUp = () => {
      if (dragWRef.current) {
        dragWRef.current = null;
        try {
          localStorage.setItem(STORAGE_KEY_W, String(Math.round(wRef.current)));
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
  }, [setWidth]);

  const startDragW = (e: React.MouseEvent) => {
    dragWRef.current = { startX: e.clientX, startW: wRef.current };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  if (!open) {
    return (
      <div className="h-full w-9 shrink-0 border-l border-[#E1E4E8] bg-white flex flex-col select-none">
        {/* Top half: PLOTS */}
        <button
          type="button"
          onClick={() => {
            handleTabChange('plots');
            onOpenChange(true);
          }}
          title="Open Plots sidebar"
          className="h-1/2 w-full flex flex-col items-center justify-center gap-2 border-b border-[#E1E4E8] hover:bg-[#F5F6F8] text-[#69717D] hover:text-[#171A1F] cursor-pointer transition-colors group p-1"
        >
          <LineChart className="w-4 h-4 text-[#2563EB] group-hover:scale-110 transition-transform" />
          <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-wider">
            PLOTS
          </span>
          {plots.length > 0 && (
            <span className="text-[9px] font-mono text-[#8A929E] bg-[#F0F2F5] px-1 py-0.5 rounded border border-[#E1E4E8]">
              {plots.length}
            </span>
          )}
        </button>

        {/* Bottom half: RUNS */}
        <button
          type="button"
          onClick={() => {
            handleTabChange('runs');
            onOpenChange(true);
          }}
          title="Open Runs sidebar"
          className="h-1/2 w-full flex flex-col items-center justify-center gap-2 hover:bg-[#F5F6F8] text-[#69717D] hover:text-[#171A1F] cursor-pointer transition-colors group p-1"
        >
          <History
            className={`w-4 h-4 ${
              executionStatus === 'running' ? 'text-[#2563EB]' : ''
            } group-hover:scale-110 transition-transform`}
          />
          <span className="[writing-mode:vertical-rl] rotate-180 text-[10px] font-semibold uppercase tracking-wider">
            RUNS
          </span>
          {runs.length > 0 && (
            <span className="text-[9px] font-mono text-[#8A929E] bg-[#F0F2F5] px-1 py-0.5 rounded border border-[#E1E4E8]">
              {runs.length}
            </span>
          )}
          {executionStatus === 'running' && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] animate-pulse" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative h-full shrink-0 border-l border-[#E1E4E8] bg-[#F5F6F8] flex flex-col select-none overflow-hidden"
      style={{ width }}
    >
      {/* Left resize handle */}
      <div
        onMouseDown={startDragW}
        title="Drag to resize sidebar width"
        className="absolute left-0 top-0 bottom-0 -ml-1 w-2 cursor-col-resize z-20 hover:bg-[#2563EB]/40 transition-colors"
      />

      {/* Unified Tab Switcher Header */}
      <div className="h-9 px-2 flex items-center justify-between border-b border-[#E1E4E8] bg-[#F5F6F8] shrink-0">
        <div className="flex items-center gap-1 bg-[#EAECEF] p-0.5 rounded-md">
          <button
            type="button"
            onClick={() => handleTabChange('plots')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'plots'
                ? 'bg-white text-[#171A1F] shadow-xs'
                : 'text-[#69717D] hover:text-[#171A1F]'
            }`}
          >
            <LineChart className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>Plots</span>
            {plots.length > 0 && (
              <span
                className={`text-[10px] font-mono px-1 rounded ${
                  activeTab === 'plots'
                    ? 'bg-[#F0F2F5] text-[#4B5563]'
                    : 'bg-black/5 text-[#69717D]'
                }`}
              >
                {plots.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('runs')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'runs'
                ? 'bg-white text-[#171A1F] shadow-xs'
                : 'text-[#69717D] hover:text-[#171A1F]'
            }`}
          >
            <History
              className={`w-3.5 h-3.5 ${
                executionStatus === 'running' ? 'text-[#2563EB]' : ''
              }`}
            />
            <span>Runs</span>
            {runs.length > 0 && (
              <span
                className={`text-[10px] font-mono px-1 rounded ${
                  activeTab === 'runs'
                    ? 'bg-[#F0F2F5] text-[#4B5563]'
                    : 'bg-black/5 text-[#69717D]'
                }`}
              >
                {runs.length}
              </span>
            )}
            {executionStatus === 'running' && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] animate-pulse" />
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          title="Collapse sidebar"
          className="p-1 rounded text-[#69717D] hover:bg-[#E1E4E8] hover:text-[#171A1F] transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Content Area: full-height view of the selected tab */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white">
        {activeTab === 'plots' ? (
          <PlotsRail
            plots={plots}
            selectedPlotId={selectedPlotId}
            onSelectPlot={onSelectPlot}
          />
        ) : (
          <RunHistoryRail
            runs={runs}
            executionStatus={executionStatus}
            open={true}
            onOpenChange={onOpenChange}
            selectedRunId={selectedRunId}
            onSelectRun={onSelectRun}
            onRelabelRun={onRelabelRun}
            onDeleteRun={onDeleteRun}
            historicalFieldStatus={historicalFieldStatus}
            embedded={true}
          />
        )}
      </div>
    </div>
  );
};

export default ResultsRightRail;
