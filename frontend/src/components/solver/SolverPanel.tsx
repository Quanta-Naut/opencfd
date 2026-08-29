import React, { useState } from 'react';
import { ChevronDown, Play, Square, Gauge, Sliders, Target, Activity, Sparkles, Cpu } from 'lucide-react';
import { CFDProjectState } from '../../types/cfd';
import {
  SolverConfig, StabilityPreset, PRESET_RELAX, PRESET_METHODS, SpatialOrder,
} from '../../solver/solverConfig';

const ORDER_OPTS: Array<[SpatialOrder, string]> = [
  ['firstOrder', '1st-order upwind'],
  ['secondOrder', '2nd-order (bounded)'],
  ['central', 'Central (linear)'],
  ['blended', 'Blended 75/25'],
];

const num =
  'w-full px-2 py-1 bg-[#F5F6F8] border border-[#E1E4E8] rounded font-mono text-[11px] focus:outline-none focus:border-[#2563EB]';
const sel =
  'w-full px-2 py-1.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md text-[11px] focus:outline-none focus:border-[#2563EB]';

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="grid grid-cols-[1fr_92px] items-center gap-2 text-[11px] text-[#69717D]">
    <span>{label}</span>
    {children}
  </label>
);

export interface SolverPanelProps {
  state: CFDProjectState;
  setSolution: (patch: (c: SolverConfig) => SolverConfig) => void;
  patchNames: string[];
  wallPatches: string[];
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  convergence?: { iteration: number; maxResidual: number; cd?: number; cl?: number } | null;
}

export const SolverPanel: React.FC<SolverPanelProps> = ({
  state, setSolution, wallPatches, running, onRun, onStop, convergence,
}) => {
  const c = state.solution;
  const [open, setOpen] = useState<string>('methods');
  const transient = c.methods.time !== 'steadyState';

  const applyPreset = (p: StabilityPreset) =>
    setSolution((cfg) => ({
      ...cfg,
      controls: { ...cfg.controls, preset: p, relax: p === 'custom' ? cfg.controls.relax : { ...PRESET_RELAX[p] } },
      methods: p === 'custom' ? cfg.methods : { ...cfg.methods, ...PRESET_METHODS[p] },
    }));
  const setMethods = (m: Partial<SolverConfig['methods']>) =>
    setSolution((cfg) => ({ ...cfg, methods: { ...cfg.methods, ...m } }));
  const setControls = (m: Partial<SolverConfig['controls']>) =>
    setSolution((cfg) => ({ ...cfg, controls: { ...cfg.controls, preset: 'custom', ...m } }));
  const setForces = (m: Partial<SolverConfig['monitors']['forces']>) =>
    setSolution((cfg) => ({ ...cfg, monitors: { ...cfg.monitors, forces: { ...cfg.monitors.forces, ...m } } }));
  const setRun = (m: Partial<SolverConfig['run']>) =>
    setSolution((cfg) => ({ ...cfg, run: { ...cfg.run, ...m } }));

  const section = (id: string, label: string, icon: React.ReactNode, body: React.ReactNode) => {
    const isOpen = open === id;
    return (
      <div className="border-t border-[#E1E4E8] first:border-t-0">
        <button
          onClick={() => setOpen(isOpen ? '' : id)}
          className="w-full flex items-center gap-2 py-2.5 text-left"
        >
          <span className="text-[#69717D]">{icon}</span>
          <span className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${isOpen ? 'text-[#2563EB]' : 'text-[#69717D]'}`}>
            {label}
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#A5ACB5] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && <div className="pb-3 space-y-2">{body}</div>}
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 flex flex-col text-xs text-[#171A1F]">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3">
        {section('methods', 'Solution methods', <Sparkles className="w-3.5 h-3.5" />, (
          <>
            <Row label="Coupling">
              <select className={sel} value={c.methods.coupling} onChange={(e) => setMethods({ coupling: e.target.value as any })}>
                <option value="SIMPLE">SIMPLE</option>
                <option value="SIMPLEC">SIMPLEC</option>
                <option value="PIMPLE">PIMPLE</option>
                <option value="PISO">PISO</option>
              </select>
            </Row>
            <Row label="Time">
              <select className={sel} value={c.methods.time} onChange={(e) => setMethods({ time: e.target.value as any })}>
                <option value="steadyState">Steady</option>
                <option value="Euler">Euler (1st)</option>
                <option value="backward">Backward (2nd)</option>
                <option value="CrankNicolson">Crank-Nicolson</option>
              </select>
            </Row>
            <Row label="Momentum">
              <select className={sel} value={c.methods.momentum} onChange={(e) => setMethods({ momentum: e.target.value as any })}>
                {ORDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
            <Row label="Turbulence">
              <select className={sel} value={c.methods.turbulence} onChange={(e) => setMethods({ turbulence: e.target.value as any })}>
                {ORDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Row>
            {state.physics.compressibility === 'compressible' && (
              <Row label="Energy">
                <select className={sel} value={c.methods.energy} onChange={(e) => setMethods({ energy: e.target.value as any })}>
                  {ORDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Row>
            )}
            <Row label="Non-ortho correctors">
              <input type="number" min={0} max={5} className={num} value={c.methods.nNonOrthogonalCorrectors}
                onChange={(e) => setMethods({ nNonOrthogonalCorrectors: Math.max(0, parseInt(e.target.value) || 0) })} />
            </Row>
            {transient && (
              <Row label="Outer correctors">
                <input type="number" min={1} max={20} className={num} value={c.methods.nOuterCorrectors}
                  onChange={(e) => setMethods({ nOuterCorrectors: Math.max(1, parseInt(e.target.value) || 1) })} />
              </Row>
            )}
          </>
        ))}

        {section('controls', 'Solution controls', <Sliders className="w-3.5 h-3.5" />, (
          <>
            <div className="grid grid-cols-3 gap-1">
              {(['conservative', 'balanced', 'aggressive'] as const).map((p) => (
                <button key={p} onClick={() => applyPreset(p)}
                  className={`py-1.5 rounded border text-[10px] font-medium capitalize transition-colors ${
                    c.controls.preset === p ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]' : 'border-[#E1E4E8] text-[#69717D] bg-white'
                  }`}>{p}</button>
              ))}
            </div>
            <p className="text-[9px] text-[#8B95A1]">Under-relaxation {c.controls.preset === 'custom' ? '(custom)' : ''}</p>
            {(['p', 'U', 'k', 'omega'] as const).map((f) => (
              <Row key={f} label={`relax ${f}`}>
                <input type="number" step={0.05} min={0.05} max={1} className={num}
                  value={c.controls.relax[f]}
                  onChange={(e) => setControls({ relax: { ...c.controls.relax, [f]: parseFloat(e.target.value) || c.controls.relax[f] } })} />
              </Row>
            ))}
            {transient && (
              <Row label="Max Courant">
                <input type="number" step={1} min={0.1} className={num} value={c.controls.maxCo}
                  onChange={(e) => setControls({ maxCo: parseFloat(e.target.value) || 5 })} />
              </Row>
            )}
            <Row label="Residual target">
              <input type="text" inputMode="decimal" className={num} value={c.controls.residualTargets.U}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) setControls({ residualTargets: { p: v, U: v, turbulence: v } });
                }} />
            </Row>
          </>
        ))}

        {section('reports', 'Report definitions', <Target className="w-3.5 h-3.5" />, (
          <>
            <label className="flex items-center justify-between text-[11px] text-[#69717D]">
              <span>Force coefficients (Cd, Cl, Cm)</span>
              <input type="checkbox" className="accent-[#2563EB]" checked={c.monitors.forces.enabled}
                onChange={(e) => setForces({ enabled: e.target.checked })} />
            </label>
            {c.monitors.forces.enabled && (
              <>
                <Row label="Body patch">
                  <select className={sel} value={c.monitors.forces.bodyPatch}
                    onChange={(e) => setForces({ bodyPatch: e.target.value })}>
                    <option value="">auto (wall)</option>
                    {wallPatches.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </Row>
                <Row label="Ref. area (m²)">
                  <input type="number" step={0.01} className={num} value={c.monitors.forces.refArea}
                    onChange={(e) => setForces({ refArea: parseFloat(e.target.value) || 0 })} placeholder="auto" />
                </Row>
                <Row label="Ref. length (m)">
                  <input type="number" step={0.01} className={num} value={c.monitors.forces.refLength}
                    onChange={(e) => setForces({ refLength: parseFloat(e.target.value) || 0 })} placeholder="auto" />
                </Row>
                <p className="text-[9px] text-[#8B95A1]">
                  Lift / drag directions follow the {state.geometry.angleOfAttackDeg}° angle of attack.
                </p>
              </>
            )}
          </>
        ))}

        {section('init', 'Initialization', <Activity className="w-3.5 h-3.5" />, (
          <Row label="Method">
            <select className={sel} value={c.run.init} onChange={(e) => setRun({ init: e.target.value as any })}>
              <option value="uniform">Uniform (reference)</option>
              <option value="potentialFlow">Potential flow</option>
              <option value="continue">Continue previous</option>
            </select>
          </Row>
        ))}

        {section('run', 'Run', <Cpu className="w-3.5 h-3.5" />, (
          <>
            <Row label={transient ? 'End time' : 'Iterations'}>
              <input type="number" step={transient ? 0.1 : 100} min={1} className={num}
                value={transient ? c.run.endTime : c.run.iterations}
                onChange={(e) => setRun(transient ? { endTime: parseFloat(e.target.value) || 1 } : { iterations: parseInt(e.target.value) || 500 })} />
            </Row>
            {transient && (
              <Row label="Time step Δt">
                <input type="text" inputMode="decimal" className={num} value={c.run.deltaT}
                  onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setRun({ deltaT: v }); }} />
              </Row>
            )}
            <Row label="Write every">
              <input type="number" step={50} min={1} className={num} value={c.run.writeInterval}
                onChange={(e) => setRun({ writeInterval: parseInt(e.target.value) || 100 })} />
            </Row>
            <Row label="Parallel (procs)">
              <input type="number" step={1} min={1} max={64} className={num} value={c.run.parallelProcs}
                onChange={(e) => setRun({ parallelProcs: Math.max(1, parseInt(e.target.value) || 1) })} />
            </Row>
          </>
        ))}
      </div>

      <div className="shrink-0 px-4 pt-3 pb-3 border-t border-[#E1E4E8] bg-white space-y-2">
        {convergence && (
          <div className="flex items-center justify-between text-[10px] font-mono text-[#69717D]">
            <span>it {convergence.iteration}</span>
            <span>res {convergence.maxResidual.toExponential(1)}</span>
            {convergence.cd != null && <span className="text-[#171A1F]">Cd {convergence.cd.toFixed(4)}</span>}
            {convergence.cl != null && <span className="text-[#171A1F]">Cl {convergence.cl.toFixed(4)}</span>}
          </div>
        )}
        <button
          onClick={running ? onStop : onRun}
          className={`w-full py-2 font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors ${
            running ? 'bg-[#DC2626] hover:bg-[#B91C1C] text-white' : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white'
          }`}
        >
          {running ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          <span>{running ? 'Stop solver' : 'Run solver'}</span>
        </button>
      </div>
    </div>
  );
};

export { Gauge };
