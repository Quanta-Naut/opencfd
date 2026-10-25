import React, { useEffect, useLayoutEffect, useState } from 'react';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

interface BottomSolverDrawerProps {
  terminalLogs: string[];
  executionStatus: string;
  onClearLogs: () => void;
  /** Extra tabs after Console (the Results tables). */
  tabs?: DrawerTab[];
  /** Open this tab when `n` changes (a probe was just placed). */
  focus?: { id: string; n: number } | null;
}

export interface DrawerTab {
  id: string;
  label: string;
  /** Shown beside the label, e.g. the number of probes. */
  count?: number;
  node: React.ReactNode;
}

/** Bottom drawer: the solver console, and on the Results stage the probe,
 * report and integral tables. Residuals / forces live in the right-hand
 * SolverMonitorRail; OpenFOAM dictionaries open from the top bar. */
export const BottomSolverDrawer: React.FC<BottomSolverDrawerProps> = ({
  terminalLogs,
  executionStatus,
  onClearLogs,
  tabs = [],
  focus = null,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [tabId, setTabId] = useState('console');
  // A tab that is no longer offered (left the Results stage) falls back.
  const activeExtra = tabs.find((t) => t.id === tabId) ?? null;
  const onConsole = !activeExtra;
  useEffect(() => {
    if (!focus) return;
    setTabId(focus.id);
    setIsExpanded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);
  const pick = (id: string) => {
    if (isExpanded && (id === tabId || (id === 'console' && onConsole))) setIsExpanded(false);
    else {
      setTabId(id);
      setIsExpanded(true);
    }
  };

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
      (executionStatus === 'running' ||
        executionStatus === 'meshing' ||
        executionStatus === 'error') &&
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
    <div className="w-full bg-surface border-t border-line flex flex-col select-none shrink-0 z-20">
      {/* Header */}
      <div className="h-8 bg-app px-4 flex items-center justify-between border-b border-line text-xs">
        <div className="flex items-center gap-1">
          {[{ id: 'console', label: 'Console', count: undefined }, ...tabs].map((t) => {
            const on = isExpanded && (t.id === 'console' ? onConsole : t.id === tabId);
            return (
              <button
                key={t.id}
                onClick={() => pick(t.id)}
                className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
                  on
                    ? 'bg-surface text-fg font-semibold border border-line'
                    : 'text-fg-2 hover:text-fg'
                }`}
              >
                {t.label}
                {t.count ? <span className="ml-1.5 font-mono text-fg-3">{t.count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono text-fg-2">
          {executionStatus === 'running' && <span className="text-accent">running</span>}
          {executionStatus === 'completed' && <span className="text-success">converged</span>}
          {executionStatus === 'error' && <span className="text-danger">failed</span>}
          {isExpanded && onConsole && terminalLogs.length > 0 && (
            <button
              onClick={onClearLogs}
              title="Clear console"
              className="p-1 hover:bg-line rounded text-fg-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-line rounded transition-colors text-fg"
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
            className="h-1.5 -mt-1.5 cursor-ns-resize bg-transparent hover:bg-accent/40 transition-colors"
            title="Drag to resize"
          />
          {activeExtra ? (
            <div className="w-full overflow-auto bg-surface select-text" style={{ height: bodyH }}>
              {activeExtra.node}
            </div>
          ) : (
            <div
              ref={consoleRef}
              onScroll={onConsoleScroll}
              className="w-full p-3 font-mono text-[11px] leading-relaxed text-fg overflow-y-auto bg-app/60 select-text cursor-text [user-select:text] selection:bg-accent/25"
              style={{ height: bodyH }}
            >
              {terminalLogs.length === 0 && <span className="text-fg-4">No output yet.</span>}
              {terminalLogs.map((log, i) => (
                <div
                  key={i}
                  className={`py-0.5 whitespace-pre-wrap ${
                    /converged|finished/i.test(log)
                      ? 'text-success font-semibold'
                      : /error|fail|cannot|not found|no such/i.test(log)
                        ? 'text-danger'
                        : ''
                  }`}
                >
                  {log}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
