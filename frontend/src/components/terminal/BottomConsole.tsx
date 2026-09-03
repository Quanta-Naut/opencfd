import React, { useState, useEffect, useRef } from 'react';
import { Terminal, LineChart, Trash2 } from 'lucide-react';
import { ResponsiveContainer, LineChart as RechartsLineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { ResidualDataPoint } from '../../types/cfd';

interface BottomConsoleProps {
  terminalLogs: string[];
  residuals: ResidualDataPoint[];
  executionStatus: 'idle' | 'meshing' | 'running' | 'completed' | 'error';
  onClearLogs: () => void;
}

export const BottomConsole: React.FC<BottomConsoleProps> = ({
  terminalLogs,
  residuals,
  executionStatus,
  onClearLogs,
}) => {
  const [activeTab, setActiveTab] = useState<'terminal' | 'residuals'>('terminal');
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [terminalLogs]);

  return (
    <div className="w-full h-full flex flex-col bg-white border-t border-slate-200 min-h-[160px]">
      {/* Console Header Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs select-none">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors ${
              activeTab === 'terminal'
                ? 'bg-white text-slate-800 border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Terminal Output</span>
            {terminalLogs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-slate-200 text-slate-600 rounded-full text-[10px]">
                {terminalLogs.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('residuals')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-medium transition-colors ${
              activeTab === 'residuals'
                ? 'bg-white text-slate-800 border border-slate-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <LineChart className="w-3.5 h-3.5" />
            <span>Residuals Convergence</span>
            {residuals.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-blue-100 text-blue-700 rounded-full text-[10px]">
                {residuals.length} iter
              </span>
            )}
          </button>
        </div>

        {/* Status Indicator & Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                executionStatus === 'running'
                  ? 'bg-blue-500 animate-pulse'
                  : executionStatus === 'completed'
                  ? 'bg-emerald-500'
                  : executionStatus === 'meshing'
                  ? 'bg-amber-500 animate-pulse'
                  : executionStatus === 'error'
                  ? 'bg-red-500'
                  : 'bg-slate-300'
              }`}
            />
            <span className="font-mono text-slate-600 uppercase text-[10px] tracking-wide">
              {executionStatus}
            </span>
          </div>

          <div className="w-px h-3.5 bg-slate-300" />

          {activeTab === 'terminal' && (
            <button
              onClick={onClearLogs}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-700 p-1 hover:bg-slate-200 rounded transition-colors"
              title="Clear Terminal"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 min-h-[120px] bg-white relative">
        {activeTab === 'terminal' ? (
          <div
            ref={logContainerRef}
            className="absolute inset-0 p-3 font-mono text-[11px] leading-relaxed text-slate-700 overflow-y-auto bg-slate-50/50"
          >
            {terminalLogs.length === 0 ? (
              <div className="text-slate-400 italic">No solver or meshing output yet. Click 'Run Solver' or 'Generate Mesh'.</div>
            ) : (
              terminalLogs.map((log, idx) => (
                <div
                  key={idx}
                  className={`py-0.5 whitespace-pre-wrap ${
                    log.includes('converged') || log.includes('complete')
                      ? 'text-emerald-600 font-semibold'
                      : log.includes('error') || log.includes('FATAL')
                      ? 'text-red-600 font-bold'
                      : log.includes('Solving for')
                      ? 'text-blue-700'
                      : 'text-slate-700'
                  }`}
                >
                  {log}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="absolute inset-0 p-2 bg-white">
            {residuals.length < 2 ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-xs">
                <LineChart className="w-8 h-8 mb-2 stroke-1 text-slate-300" />
                <span>Run solver to stream real-time convergence residuals</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={200} minHeight={100}>
                <RechartsLineChart data={residuals} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="iteration"
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={10}
                    tickLine={false}
                    domain={[0, 'auto']}
                    tickFormatter={(val) => typeof val === 'number' ? val.toExponential(0) : val}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '6px',
                      fontSize: '11px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} />
                  <Line type="monotone" dataKey="p" name="p (Pressure)" stroke="#2563eb" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Ux" name="Ux (Velocity X)" stroke="#10b981" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="Uy" name="Uy (Velocity Y)" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  {residuals[0]?.k !== undefined && (
                    <Line type="monotone" dataKey="k" name="k (Turbulent Kinetic)" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  )}
                  {residuals[0]?.omega !== undefined && (
                    <Line type="monotone" dataKey="omega" name="ω (Dissipation)" stroke="#ec4899" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  )}
                </RechartsLineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
