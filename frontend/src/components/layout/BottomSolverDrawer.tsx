import React, { useEffect, useState } from 'react';
import { ChevronUp, ChevronDown, Terminal, LineChart, Shield, FileCode, Trash2 } from 'lucide-react';
import { ResponsiveContainer, LineChart as RechartsLineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { ResidualDataPoint } from '../../types/cfd';

interface BottomSolverDrawerProps {
  residuals: ResidualDataPoint[];
  terminalLogs: string[];
  caseFiles: Record<string, string>;
  executionStatus: string;
  onClearLogs: () => void;
}

export const BottomSolverDrawer: React.FC<BottomSolverDrawerProps> = ({
  residuals,
  terminalLogs,
  caseFiles,
  executionStatus,
  onClearLogs,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'residuals' | 'forces' | 'console' | 'dicts'>('residuals');
  const [selectedDict, setSelectedDict] = useState<string>('system/controlDict');

  // Auto-select the first available dictionary if selectedDict isn't valid or when dicts update
  const dictKeys = Object.keys(caseFiles);
  useEffect(() => {
    if (dictKeys.length > 0 && (!selectedDict || !caseFiles[selectedDict])) {
      setSelectedDict(dictKeys[0]);
    }
  }, [dictKeys.length, selectedDict, caseFiles]);

  // Drag-resizable body height.
  const MIN_H = 120;
  const [bodyH, setBodyH] = useState<number>(() => {
    const saved = Number(typeof localStorage !== 'undefined' && localStorage.getItem('opencfd_drawer_h'));
    return saved >= MIN_H ? saved : 220;
  });
  const dragRef = React.useRef<{ startY: number; startH: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const maxH = Math.max(MIN_H, window.innerHeight - 160);
      const next = Math.min(maxH, Math.max(MIN_H, dragRef.current.startH + (dragRef.current.startY - e.clientY)));
      setBodyH(next);
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        try { localStorage.setItem('opencfd_drawer_h', String(bodyH)); } catch { /* ignore */ }
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [bodyH]);
  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startY: e.clientY, startH: bodyH };
    document.body.style.userSelect = 'none';
  };

  // When a run starts, open the drawer so its output is visible and expand to the top.
  // On an error, jump to the console where the failure is spelled out.
  const prevStatus = React.useRef(executionStatus);
  useEffect(() => {
    if (executionStatus === 'running' && prevStatus.current !== 'running') {
      setIsExpanded(true);
      setActiveTab('residuals');
      const maxH = Math.max(MIN_H, window.innerHeight - 200);
      setBodyH(maxH);
    }
    if (executionStatus === 'error') {
      setIsExpanded(true);
      setActiveTab('console');
    }
    prevStatus.current = executionStatus;
  }, [executionStatus]);

  // Tell floating things (player, colorbar) how tall the bottom drawer is inside the canvas
  // area so they sit snugly right above it. 32px header + (isExpanded ? bodyH : 0).
  useEffect(() => {
    const h = 32 + (isExpanded ? bodyH : 0);
    document.documentElement.style.setProperty('--app-bottom-bar', `${h}px`);
    return () => { document.documentElement.style.removeProperty('--app-bottom-bar'); };
  }, [isExpanded, bodyH]);

  // Downsample helper so Recharts rendering stays 60fps even with 5000+ points
  const downsample = <T,>(arr: T[], maxPoints = 500): T[] => {
    if (arr.length <= maxPoints) return arr;
    const step = Math.ceil(arr.length / maxPoints);
    const result: T[] = [];
    for (let i = 0; i < arr.length - 1; i += step) {
      result.push(arr[i]);
    }
    // Always include the absolute latest point
    result.push(arr[arr.length - 1]);
    return result;
  };

  // Live ticker stats - real values from the last residual point the solver sent
  const last = residuals.length > 0 ? residuals[residuals.length - 1] : undefined;
  const lastIter = last?.iteration ?? 0;
  const cd = typeof last?.cd === 'number' ? last.cd : null;
  const cl = typeof last?.cl === 'number' ? last.cl : null;
  const fmtCoef = (v: number | null) => (v === null ? '-' : v.toFixed(4));

  const rawForceSeries = React.useMemo(
    () => residuals.filter((r) => typeof r.cd === 'number' || typeof r.cl === 'number'),
    [residuals],
  );
  const forceSeries = React.useMemo(
    () => downsample(rawForceSeries, 400),
    [rawForceSeries],
  );

  // Log-scale plots break on zero/negative values - clamp to a small floor.
  const FLOOR = 1e-10;
  const rawResSeries = React.useMemo(
    () => residuals.map((r) => {
      const o: any = { iteration: r.iteration };
      for (const key of ['p', 'Ux', 'Uy', 'k', 'omega', 'epsilon'] as const) {
        const v = (r as any)[key];
        if (typeof v === 'number' && isFinite(v)) o[key] = Math.max(v, FLOOR);
      }
      return o;
    }),
    [residuals],
  );
  const resSeries = React.useMemo(
    () => downsample(rawResSeries, 400),
    [rawResSeries],
  );

  const resDomain = React.useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of resSeries) {
      for (const k of ['p', 'Ux', 'Uy', 'k', 'omega', 'epsilon']) {
        const v = p[k];
        if (typeof v === 'number') { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) return [FLOOR, 1] as [number, number];
    return [Math.max(lo / 2, FLOOR), hi * 2] as [number, number];
  }, [resSeries]);
  const hasKey = (k: string) => resSeries.some((p) => typeof p[k] === 'number');

  // Keep the console pinned to the newest line.
  const consoleRef = React.useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = consoleRef.current;
    if (el && activeTab === 'console') el.scrollTop = el.scrollHeight;
  }, [activeTab, isExpanded]);  // jump to bottom when opening the tab
  useEffect(() => {
    const el = consoleRef.current;
    if (!el || activeTab !== 'console') return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;  // follow new lines
  }, [terminalLogs, activeTab]);

  return (
    <div className="w-full bg-white border-t border-[#E1E4E8] flex flex-col select-none shrink-0 z-20">
      {/* 1. DRAWER HEADER TICKER */}
      <div className="h-8 bg-[#F5F6F8] px-4 flex items-center justify-between border-b border-[#E1E4E8] text-xs">
        {/* Left: Tab Switchers or summary */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setIsExpanded(true);
              setActiveTab('residuals');
            }}
            className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
              isExpanded && activeTab === 'residuals'
                ? 'bg-white text-[#171A1F] font-semibold shadow-xs border border-[#E1E4E8]'
                : 'text-[#69717D] hover:text-[#171A1F]'
            }`}
          >
            Residuals
          </button>

          <button
            onClick={() => {
              setIsExpanded(true);
              setActiveTab('forces');
            }}
            className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
              isExpanded && activeTab === 'forces'
                ? 'bg-white text-[#171A1F] font-semibold shadow-xs border border-[#E1E4E8]'
                : 'text-[#69717D] hover:text-[#171A1F]'
            }`}
          >
            Forces (Cd / Cl)
          </button>

          <button
            onClick={() => {
              setIsExpanded(true);
              setActiveTab('console');
            }}
            className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
              isExpanded && activeTab === 'console'
                ? 'bg-white text-[#171A1F] font-semibold shadow-xs border border-[#E1E4E8]'
                : 'text-[#69717D] hover:text-[#171A1F]'
            }`}
          >
            Console
          </button>

          <button
            onClick={() => {
              setIsExpanded(true);
              setActiveTab('dicts');
            }}
            className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${
              isExpanded && activeTab === 'dicts'
                ? 'bg-white text-[#171A1F] font-semibold shadow-xs border border-[#E1E4E8]'
                : 'text-[#69717D] hover:text-[#171A1F]'
            }`}
          >
            OpenFOAM Dicts
          </button>
        </div>

        {/* Center/Right: Live Ticker Statistics */}
        <div className="flex items-center gap-4 text-[11px] font-mono text-[#69717D]">
          {executionStatus === 'running' && <span className="text-[#2563EB]">running</span>}
          {executionStatus === 'completed' && <span className="text-[#16A34A]">converged</span>}
          {executionStatus === 'error' && <span className="text-[#DC2626]">failed</span>}
          <span>
            Cd: <strong className="text-[#171A1F]">{fmtCoef(cd)}</strong>
          </span>
          <span>
            Cl: <strong className="text-[#171A1F]">{fmtCoef(cl)}</strong>
          </span>
          <span>
            Iter: <strong className="text-[#171A1F]">{lastIter}</strong>
          </span>

          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-[#E1E4E8] rounded transition-colors text-[#171A1F]"
            title={isExpanded ? 'Collapse Drawer' : 'Expand Drawer'}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 2. EXPANDED CONTENT DRAWER - drag the top edge to resize */}
      {isExpanded && (
        <>
        <div
          onMouseDown={startDrag}
          className="h-1.5 -mt-1.5 cursor-ns-resize bg-transparent hover:bg-[#2563EB]/40 transition-colors"
          title="Drag to resize"
        />
        <div className="bg-white relative overflow-hidden" style={{ height: bodyH }}>
          {/* TAB 1: RESIDUALS CONVERGENCE */}
          {activeTab === 'residuals' && (
            <div className="w-full h-full p-2">
              {resSeries.length < 2 ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-[#A5ACB5] text-xs font-mono">
                  <span>Residuals will plot in real-time when solver is running</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={resSeries} margin={{ top: 5, right: 15, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                    <XAxis dataKey="iteration" stroke="#A5ACB5" fontSize={10} tickLine={false} />
                    <YAxis
                      stroke="#A5ACB5"
                      fontSize={10}
                      tickLine={false}
                      width={52}
                      scale="log"
                      domain={resDomain}
                      allowDataOverflow
                      tickFormatter={(v) => (typeof v === 'number' ? v.toExponential(0) : v)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E1E4E8',
                        borderRadius: '6px',
                        fontSize: '11px',
                      }}
                      formatter={(v: any) => (typeof v === 'number' ? v.toExponential(2) : v)}
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '2px' }} />
                    <Line type="monotone" dataKey="p" name="p" stroke="#2563EB" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Ux" name="Ux" stroke="#16A34A" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Uy" name="Uy" stroke="#D97706" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    {hasKey('k') && (
                      <Line type="monotone" dataKey="k" name="k" stroke="#8B5CF6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    )}
                    {hasKey('omega') && (
                      <Line type="monotone" dataKey="omega" name="ω" stroke="#EC4899" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    )}
                    {hasKey('epsilon') && (
                      <Line type="monotone" dataKey="epsilon" name="ε" stroke="#EC4899" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    )}
                  </RechartsLineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* TAB 2: AERODYNAMIC FORCES */}
          {activeTab === 'forces' && (
            <div className="w-full h-full p-2 flex flex-col">
              {forceSeries.length < 2 ? (
                <div className="flex-1 flex items-center justify-center text-[#A5ACB5] text-xs font-mono">
                  Cd / Cl plot here once the solver reports force coefficients
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-6 px-2 pb-1 text-[11px] font-mono">
                    <span className="text-[#69717D]">Cd <strong className="text-[#171A1F]">{fmtCoef(cd)}</strong></span>
                    <span className="text-[#69717D]">Cl <strong className="text-[#171A1F]">{fmtCoef(cl)}</strong></span>
                    <span className="text-[#69717D]">L/D <strong className="text-[#2563EB]">{cd && cl ? (cl / cd).toFixed(2) : '-'}</strong></span>
                  </div>
                  <div className="flex-1 min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsLineChart data={forceSeries} margin={{ top: 5, right: 15, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                        <XAxis dataKey="iteration" stroke="#A5ACB5" fontSize={10} tickLine={false} />
                        <YAxis stroke="#A5ACB5" fontSize={10} tickLine={false} width={48}
                          tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(2) : v)} />
                        <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid #E1E4E8', borderRadius: '6px', fontSize: '11px' }} />
                        <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '2px' }} />
                        <Line type="monotone" dataKey="cd" name="Cd" stroke="#DC2626" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        <Line type="monotone" dataKey="cl" name="Cl" stroke="#2563EB" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </RechartsLineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 3: LIVE CONSOLE LOGS */}
          {activeTab === 'console' && (
            <div ref={consoleRef} className="w-full h-full p-3 font-mono text-[11px] leading-relaxed text-[#171A1F] overflow-y-auto bg-[#F5F6F8]/60">
              {terminalLogs.length === 0 && (
                <span className="text-[#A5ACB5]">No output yet.</span>
              )}
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
          )}

          {/* TAB 4: OPENFOAM CASE DICTIONARIES */}
          {activeTab === 'dicts' && (
            <div className="w-full h-full flex flex-col">
              <div className="flex gap-1 p-1 bg-[#F5F6F8] border-b border-[#E1E4E8] overflow-x-auto text-[11px]">
                {Object.keys(caseFiles).map((file) => (
                  <button
                    key={file}
                    onClick={() => setSelectedDict(file)}
                    className={`px-2 py-0.5 rounded font-mono ${
                      selectedDict === file
                        ? 'bg-white text-[#2563EB] font-semibold shadow-xs border border-[#E1E4E8]'
                        : 'text-[#69717D] hover:text-[#171A1F]'
                    }`}
                  >
                    {file}
                  </button>
                ))}
              </div>
              <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] bg-slate-900 text-slate-100 select-text">
                <pre>{caseFiles[selectedDict] || '// Select a dictionary to inspect'}</pre>
              </div>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
};
