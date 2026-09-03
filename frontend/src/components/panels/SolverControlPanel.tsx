import React from 'react';
import { SolverControls, SolverType, PhysicsConfig } from '../../types/cfd';
import { Cpu, Play, Square, Settings, SlidersHorizontal, RefreshCw } from 'lucide-react';

interface SolverControlPanelProps {
  solver: SolverControls;
  physics: PhysicsConfig;
  onChangeSolver: (updated: Partial<SolverControls>) => void;
  onChangePhysics: (updated: Partial<PhysicsConfig>) => void;
  onRunSolver: () => void;
  onStopSolver: () => void;
  executionStatus: 'idle' | 'meshing' | 'running' | 'completed' | 'error';
}

export const SolverControlPanel: React.FC<SolverControlPanelProps> = ({
  solver,
  physics,
  onChangeSolver,
  onChangePhysics,
  onRunSolver,
  onStopSolver,
  executionStatus,
}) => {
  return (
    <div className="space-y-4 p-4 text-xs text-slate-700 select-none">
      {/* OpenFOAM Solver Binary Selector */}
      <div className="space-y-1.5">
        <label className="font-semibold text-slate-800 flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-blue-600" />
          <span>OpenFOAM Solver</span>
        </label>
        <select
          value={physics.solver}
          onChange={(e) => onChangePhysics({ solver: e.target.value as SolverType })}
          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium font-mono text-slate-800"
        >
          <option value="simpleFoam">simpleFoam (Steady Incompressible RANS)</option>
          <option value="icoFoam">icoFoam (Transient Incompressible Laminar)</option>
          <option value="pisoFoam">pisoFoam (Transient Incompressible PISO)</option>
          <option value="pimpleFoam">pimpleFoam (Transient Large Timestep)</option>
        </select>
      </div>

      {/* Iterations and Time Controls */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider flex items-center justify-between">
          <span>Simulation Time & Steps</span>
          <Settings className="w-3.5 h-3.5 text-slate-400" />
        </span>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-slate-500 block mb-0.5">End Iterations</span>
            <input
              type="number"
              step="50"
              min="10"
              max="5000"
              value={solver.iterations}
              onChange={(e) => onChangeSolver({ iterations: parseInt(e.target.value) || 150 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
            />
          </div>
          <div>
            <span className="text-slate-500 block mb-0.5">Write Interval</span>
            <input
              type="number"
              step="10"
              value={solver.writeInterval}
              onChange={(e) => onChangeSolver({ writeInterval: parseInt(e.target.value) || 25 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
            />
          </div>
        </div>
      </div>

      {/* Under-Relaxation Factors */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider flex items-center justify-between">
          <span>Relaxation Factors (fvSolution)</span>
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
        </span>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-slate-500 block">Pressure (p)</span>
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="1.0"
              value={solver.relaxationFactors.p}
              onChange={(e) =>
                onChangeSolver({
                  relaxationFactors: { ...solver.relaxationFactors, p: parseFloat(e.target.value) || 0.3 },
                })
              }
              className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded font-mono"
            />
          </div>

          <div>
            <span className="text-slate-500 block">Velocity (U)</span>
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="1.0"
              value={solver.relaxationFactors.U}
              onChange={(e) =>
                onChangeSolver({
                  relaxationFactors: { ...solver.relaxationFactors, U: parseFloat(e.target.value) || 0.7 },
                })
              }
              className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded font-mono"
            />
          </div>

          <div>
            <span className="text-slate-500 block">k</span>
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="1.0"
              value={solver.relaxationFactors.k}
              onChange={(e) =>
                onChangeSolver({
                  relaxationFactors: { ...solver.relaxationFactors, k: parseFloat(e.target.value) || 0.7 },
                })
              }
              className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded font-mono"
            />
          </div>

          <div>
            <span className="text-slate-500 block">ω / ε</span>
            <input
              type="number"
              step="0.05"
              min="0.1"
              max="1.0"
              value={solver.relaxationFactors.omega}
              onChange={(e) =>
                onChangeSolver({
                  relaxationFactors: { ...solver.relaxationFactors, omega: parseFloat(e.target.value) || 0.7 },
                })
              }
              className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded font-mono"
            />
          </div>
        </div>
      </div>

      {/* Main Solver Execution Action */}
      {executionStatus === 'running' ? (
        <button
          onClick={onStopSolver}
          className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
          <span>Stop Solver Execution</span>
        </button>
      ) : (
        <button
          onClick={onRunSolver}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>▶ Run OpenFOAM Solver</span>
        </button>
      )}
    </div>
  );
};
