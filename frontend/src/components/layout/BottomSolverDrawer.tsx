import React, { useEffect, useLayoutEffect, useState } from 'react';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

interface BottomSolverDrawerProps {
  terminalLogs: string[];
  executionStatus: string;
  onClearLogs: () => void;
}

/** Bottom drawer — solver console only. Residuals / forces live in the right-hand
 * SolverMonitorRail; OpenFOAM dictionaries open from the top bar. */
export const BottomSolverDrawer: React.FC<BottomSolverDrawerProps> = ({
  terminalLogs,
  executionStatus,
  onClearLogs,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Console auto-follow: pinned to the bottom until the user scrolls up.
  const consoleRef = React.useRef<HTMLDivElement | null>(null);
  const stickBottom = React.useRef(true);

  const MIN_H = 120;
  const [bodyH, setBodyH] = useState<number>(() => {
    const saved = Number(
      typeof localStorage !== 'undefined' && localStorage.getItem('opencfd_drawer_h'),
    );
    return saved >= MIN_H ? saved : 220;
  });
  const dragRef = React.useRef<{ startY: number; startH: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const maxH = Math.max(MIN_H, window.innerHeight - 160);
      const next = Math.min(
        maxH,
        Math.max(MIN_H, dragRef.current.startH + (dragRef.current.startY - e.clientY)),
      );
      setBodyH(next);
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        try {
          localStorage.setItem('opencfd_drawer_h', String(bodyH));
        } catch {
          /* ignore */
        }
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [bodyH]);
  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: bodyH };
    document.body.style.userSelect = 'none';
  };

  // Open the console when a run starts or fails so its output is visible, and
  // re-pin it to the bottom so the streaming output follows.
  const prevStatus = React.useRef(executionStatus);
  useEffect(() => {
    if (
      (executionStatus === 'running' || executionStatus === 'meshing' || executionStatus === 'error') &&
      prevStatus.current !== executionStatus
    ) {
      setIsExpanded(true);
      stickBottom.current = true;
      const el = consoleRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    prevStatus.current = executionStatus;
  }, [executionStatus]);

  // Publish the drawer height so floating canvas widgets sit above it.
  useEffect(() => {
    const h = 32 + (isExpanded ? bodyH : 0);
    document.documentElement.style.setProperty('--app-bottom-bar', `${h}px`);
    return () => {
      document.documentElement.style.removeProperty('--app-bottom-bar');
    };
  }, [isExpanded, bodyH]);

  // Auto-follow the newest line only while the user is parked at the bottom;
  // scrolling up pauses the follow, scrolling back down resumes it.
  const onConsoleScroll = () => {
    const el = consoleRef.current;
    if (!el) return;
    // ignore the scroll event our own auto-scroll just fired
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  };
  // useLayoutEffect: run after the new lines are in the DOM but before paint, so
  // scrollHeight is current and there is no visible jump.
  useLayoutEffect(() => {
    const el = consoleRef.current;
    if (el && isExpanded && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [terminalLogs.length, isExpanded, bodyH]);
  useEffect(() => {
    if (!isExpanded) return;
    stickBottom.current = true;
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isExpanded]);

  return (
    <div className="w-full bg-white border-t border-[#E1E4E8] flex flex-col select-none shrink-0 z-20">
      {/* Header */}
      <div className="h-8 bg-[#F5F6F8] px-4 flex items-center justify-between border-b border-[#E1E4E8] text-xs">
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
            isExpanded
              ? 'bg-white text-[#171A1F] font-semibold border border-[#E1E4E8]'
              : 'text-[#69717D] hover:text-[#171A1F]'
          }`}
        >
          Console
        </button>

        <div className="flex items-center gap-3 text-[11px] font-mono text-[#69717D]">
          {executionStatus === 'running' && <span className="text-[#2563EB]">running</span>}
          {executionStatus === 'completed' && <span className="text-[#16A34A]">converged</span>}
          {executionStatus === 'error' && <span className="text-[#DC2626]">failed</span>}
          {isExpanded && terminalLogs.length > 0 && (
            <button
              onClick={onClearLogs}
              title="Clear console"
              className="p-1 hover:bg-[#E1E4E8] rounded text-[#69717D]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-[#E1E4E8] rounded transition-colors text-[#171A1F]"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          <div
            onMouseDown={startDrag}
            className="h-1.5 -mt-1.5 cursor-ns-resize bg-transparent hover:bg-[#2563EB]/40 transition-colors"
            title="Drag to resize"
          />
          <div
            ref={consoleRef}
            onScroll={onConsoleScroll}
            className="w-full p-3 font-mono text-[11px] leading-relaxed text-[#171A1F] overflow-y-auto bg-[#F5F6F8]/60 select-text cursor-text [user-select:text] selection:bg-[#2563EB]/25"
            style={{ height: bodyH }}
          >
            {terminalLogs.length === 0 && <span className="text-[#A5ACB5]">No output yet.</span>}
            {terminalLogs.map((log, i) => (
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
            ))}
          </div>
        </>
      )}
    </div>
  );
};
