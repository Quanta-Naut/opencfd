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

  // When a run starts, open the drawer so its output is visible. On an error,
  // jump to the console where the failure is spelled out.
  const prevStatus = React.useRef(executionStatus);
  useEffect(() => {
    if (executionStatus === 'running' && prevStatus.current !== 'running') {
      setIsExpanded(true);
      setActiveTab('residuals');
    }
    if (executionStatus === 'error') {
      setIsExpanded(true);
      setActiveTab('console');
    }
    prevStatus.current = executionStatus;
  }, [executionStatus]);

  // Tell floating things (toasts) how tall the bottom bar area is so they can sit
  // above it instead of overlapping the console. 24px status bar + 32px header
  // + 176px expanded body.
  useEffect(() => {
    const h = 24 + 32 + (isExpanded ? 176 : 0);
    document.documentElement.style.setProperty('--app-bottom-bar', `${h}px`);
    return () => { document.documentElement.style.removeProperty('--app-bottom-bar'); };
  }, [isExpanded]);

  // Live ticker stats - real values from the last residual point the solver sent
  const last = residuals.length > 0 ? residuals[residuals.length - 1] : undefined;
  const lastIter = last?.iteration ?? 0;
  const cd = typeof last?.cd === 'number' ? last.cd : null;
  const cl = typeof last?.cl === 'number' ? last.cl : null;
  const fmtCoef = (v: number | null) => (v === null ? '-' : v.toFixed(4));

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

      {/* 2. EXPANDED CONTENT DRAWER (HEIGHT ~ 160PX) */}
      {isExpanded && (
        <div className="h-44 bg-white relative overflow-hidden">
          {/* TAB 1: RESIDUALS CONVERGENCE */}
          {activeTab === 'residuals' && (
            <div className="w-full h-full p-2">
              {residuals.length < 2 ? (
                <div className="w-full h-full flex flex-col items-center justify-center text-[#A5ACB5] text-xs font-mono">
                  <span>Residuals will plot in real-time when solver is running</span>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={residuals} margin={{ top: 5, right: 15, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F5" />
                    <XAxis dataKey="iteration" stroke="#A5ACB5" fontSize={10} tickLine={false} />
                    <YAxis
                      stroke="#A5ACB5"
                      fontSize={10}
                      tickLine={false}
                      scale="log"
                      domain={['auto', 'auto']}
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
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '2px' }} />
                    <Line type="monotone" dataKey="p" name="p" stroke="#2563EB" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Ux" name="Ux" stroke="#16A34A" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="Uy" name="Uy" stroke="#D97706" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    {residuals[0]?.k !== undefined && (
                      <Line type="monotone" dataKey="k" name="k" stroke="#8B5CF6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    )}
                    {residuals[0]?.omega !== undefined && (
                      <Line type="monotone" dataKey="omega" name="ω" stroke="#EC4899" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    )}
                  </RechartsLineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* TAB 2: AERODYNAMIC FORCES */}
          {activeTab === 'forces' && (
            <div className="w-full h-full p-2 flex items-center justify-center">
              {cd === null && cl === null ? (
                <span className="text-[#A5ACB5] text-xs font-mono">
                  Force coefficients appear here once the solver reports them
                </span>
              ) : (
                <div className="grid grid-cols-3 gap-6 text-center">
                  <div className="p-3 bg-[#F5F6F8] rounded-md border border-[#E1E4E8]">
                    <span className="text-[10px] uppercase text-[#69717D] font-mono block">Drag Coefficient (Cd)</span>
                    <span className="text-xl font-bold font-mono text-[#171A1F]">{fmtCoef(cd)}</span>
                  </div>
                  <div className="p-3 bg-[#F5F6F8] rounded-md border border-[#E1E4E8]">
                    <span className="text-[10px] uppercase text-[#69717D] font-mono block">Lift Coefficient (Cl)</span>
                    <span className="text-xl font-bold font-mono text-[#171A1F]">{fmtCoef(cl)}</span>
                  </div>
                  <div className="p-3 bg-[#F5F6F8] rounded-md border border-[#E1E4E8]">
                    <span className="text-[10px] uppercase text-[#69717D] font-mono block">Lift-to-Drag Ratio (L/D)</span>
                    <span className="text-xl font-bold font-mono text-[#2563EB]">
                      {cd && cl ? (cl / cd).toFixed(2) : '-'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: LIVE CONSOLE LOGS */}
          {activeTab === 'console' && (
            <div className="w-full h-full p-3 font-mono text-[11px] leading-relaxed text-[#171A1F] overflow-y-auto bg-[#F5F6F8]/60">
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
      )}
    </div>
  );
};
