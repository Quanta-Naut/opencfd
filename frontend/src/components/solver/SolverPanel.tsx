import React from 'react';
import { Play, Square } from 'lucide-react';
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
  'w-full px-2.5 py-1.5 bg-white border border-[#E1E4E8] rounded font-mono text-[11px] text-[#171A1F] focus:outline-none focus:border-[#2563EB]';
const sel =
  'w-full px-2.5 py-1.5 bg-white border border-[#E1E4E8] rounded-md text-[11px] text-[#171A1F] focus:outline-none focus:border-[#2563EB]';

/** Numeric input with a local editing buffer. Controlled numeric values cannot
 * represent an empty string, so parsing directly in onChange makes backspace
 * appear broken. This keeps the draft as text and commits on valid edits/blur. */
const NumericInput: React.FC<{
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
}> = ({ value, onCommit, className = num, ...props }) => {
  const [draft, setDraft] = React.useState(String(value));
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  return <input
    type="text"
    inputMode="decimal"
    {...props}
    className={className}
    value={draft}
    onFocus={() => setFocused(true)}
    onChange={(e) => {
      const next = e.target.value;
      setDraft(next);
      const parsed = Number(next);
      if (next.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed);
    }}
    onBlur={() => {
      setFocused(false);
      const parsed = Number(draft);
      if (draft.trim() !== '' && Number.isFinite(parsed)) onCommit(parsed);
      else setDraft(String(value));
    }}
  />;
};

const Head: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#69717D] pt-3 mt-1 border-t border-[#E1E4E8] first:border-t-0 first:pt-0 first:mt-0">
    {children}
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="grid grid-cols-[1fr_130px] items-center gap-2 text-[11px] text-[#69717D]">
    <span>{label}</span>
    {children}
  </label>
);

export interface SolverPanelProps {
  state: CFDProjectState;
  setSolution: (patch: (c: SolverConfig) => SolverConfig) => void;
  setTimeFormulation: (t: 'steady' | 'transient') => void;
  patchNames: string[];
  wallPatches: string[];
  running: boolean;
  onRun: () => void;
  onStop: () => void;
  convergence?: { iteration: number; maxResidual: number; cd?: number; cl?: number } | null;
}

export const SolverPanel: React.FC<SolverPanelProps> = ({
  state, setSolution, setTimeFormulation, wallPatches, running, onRun, onStop, convergence,
}) => {
  const c = state.solution;
  const transient = state.physics.timeFormulation === 'transient';
  const compressible = state.physics.compressibility === 'compressible';

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

  const chooseRegime = (t: 'steady' | 'transient') => {
    setTimeFormulation(t);
    setMethods({ time: t === 'steady' ? 'steadyState' : c.methods.time === 'steadyState' ? 'Euler' : c.methods.time });
  };

  return (
    <div className="h-full min-h-0 flex flex-col text-xs text-[#171A1F]">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 space-y-2">
        <Head>Run type</Head>
        <div className="grid grid-cols-2 gap-1.5">
          {(['steady', 'transient'] as const).map((t) => (
            <button
              key={t}
              onClick={() => chooseRegime(t)}
              className={`py-2 rounded-lg border text-[11px] font-medium transition-colors ${
                (t === 'transient') === transient
                  ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]'
                  : 'border-[#E1E4E8] text-[#69717D] bg-white'
              }`}
            >
              {t === 'steady' ? 'Steady state' : 'Transient'}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[#69717D] leading-relaxed">
          {transient
            ? 'Marches in time. Set how long to run and the time step.'
            : 'Iterates to a converged solution - no time axis.'}
        </p>
        {transient && (
          <>
            <Row label="End time (s)">
              <NumericInput step={0.5} min={0} value={c.run.endTime} onCommit={(v) => setRun({ endTime: v })} />
            </Row>
            <Row label="Time step Δt (s)">
              <NumericInput value={c.run.deltaT} onCommit={(v) => setRun({ deltaT: v })} />
            </Row>
            <Row label="Time scheme">
              <select className={sel} value={c.methods.time} onChange={(e) => setMethods({ time: e.target.value as any })}>
                <option value="Euler">Euler (1st)</option>
                <option value="backward">Backward (2nd)</option>
                <option value="CrankNicolson">Crank-Nicolson</option>
              </select>
            </Row>
            <Row label="Max Courant">
              <NumericInput step={1} min={0.1} value={c.controls.maxCo} onCommit={(v) => setControls({ maxCo: v })} />
            </Row>
            <Row label="Outer correctors">
              <NumericInput min={1} max={20} value={c.methods.nOuterCorrectors} onCommit={(v) => setMethods({ nOuterCorrectors: Math.max(1, Math.round(v)) })} />
            </Row>
          </>
        )}
        {!transient && (
          <Row label="Iterations">
            <NumericInput step={100} min={1} value={c.run.iterations} onCommit={(v) => setRun({ iterations: Math.max(1, Math.round(v)) })} />
          </Row>
        )}

        <Head>Solution methods</Head>
        <Row label="Coupling">
          <select className={sel} value={c.methods.coupling} onChange={(e) => setMethods({ coupling: e.target.value as any })}>
            <option value="SIMPLE">SIMPLE</option>
            <option value="SIMPLEC">SIMPLEC</option>
            <option value="PIMPLE">PIMPLE</option>
            <option value="PISO">PISO</option>
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
        {compressible && (
          <Row label="Energy">
            <select className={sel} value={c.methods.energy} onChange={(e) => setMethods({ energy: e.target.value as any })}>
              {ORDER_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Row>
        )}
        <Row label="Gradient">
          <select className={sel} value={c.methods.gradient} onChange={(e) => setMethods({ gradient: e.target.value as any })}>
            <option value="gauss">Gauss linear</option>
            <option value="leastSquares">Least squares</option>
            <option value="cellLimited">Cell-limited</option>
          </select>
        </Row>
        <Row label="Non-ortho correctors">
          <NumericInput min={0} max={5} value={c.methods.nNonOrthogonalCorrectors} onCommit={(v) => setMethods({ nNonOrthogonalCorrectors: Math.max(0, Math.round(v)) })} />
        </Row>

        <Head>Solution controls</Head>
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
            <NumericInput step={0.05} min={0.05} max={1} value={c.controls.relax[f]}
              onCommit={(v) => setControls({ relax: { ...c.controls.relax, [f]: v } })} />
          </Row>
        ))}
        <Row label="Residual target">
          <NumericInput value={c.controls.residualTargets.U}
            onCommit={(v) => setControls({ residualTargets: { p: v, U: v, turbulence: v } })} />
        </Row>

        <Head>Report definitions</Head>
        <label className="flex items-center justify-between text-[11px] text-[#69717D]">
          <span>Force coefficients (Cd, Cl, Cm)</span>
          <input type="checkbox" className="accent-[#2563EB]" checked={c.monitors.forces.enabled}
            onChange={(e) => setForces({ enabled: e.target.checked })} />
        </label>
        {c.monitors.forces.enabled && (
          <>
            <Row label="Body patch">
              <select className={sel} value={c.monitors.forces.bodyPatch} onChange={(e) => setForces({ bodyPatch: e.target.value })}>
                <option value="">auto (wall)</option>
                {wallPatches.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </Row>
            <Row label="Ref. area (m²)">
              <NumericInput step={0.01} value={c.monitors.forces.refArea} onCommit={(v) => setForces({ refArea: v })} placeholder="auto" />
            </Row>
            <Row label="Ref. length (m)">
              <NumericInput step={0.01} value={c.monitors.forces.refLength} onCommit={(v) => setForces({ refLength: v })} placeholder="auto" />
            </Row>
            <p className="text-[9px] text-[#8B95A1]">
              Lift / drag directions follow the {state.geometry.angleOfAttackDeg}° angle of attack.
            </p>
          </>
        )}

        <Head>Initialization</Head>
        <Row label="Method">
          <select className={sel} value={c.run.init} onChange={(e) => setRun({ init: e.target.value as any })}>
            <option value="uniform">Uniform (reference)</option>
            <option value="potentialFlow">Potential flow</option>
            <option value="continue">Continue previous</option>
          </select>
        </Row>

        <Head>Output</Head>
        <Row label="Write every">
          <NumericInput step={50} min={0} value={c.run.writeInterval} onCommit={(v) => setRun({ writeInterval: Math.max(0, Math.round(v)) })} placeholder="0 = auto" />
        </Row>
        <Row label="Parallel (procs)">
          <NumericInput step={1} min={1} max={64} value={c.run.parallelProcs} onCommit={(v) => setRun({ parallelProcs: Math.max(1, Math.round(v)) })} />
        </Row>
      </div>

      <div className="shrink-0 px-4 pt-3 pb-3 border-t border-[#E1E4E8] bg-white space-y-2">
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
