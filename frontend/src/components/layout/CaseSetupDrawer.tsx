import React from 'react';
import { CircleHelp, Droplets, Gauge, Layers3, LockKeyhole, Thermometer, Wind, Zap } from 'lucide-react';
import { CFDProjectState } from '../../types/cfd';
import { FlowType } from '../../types/cadWorkflow';

interface CaseSetupDrawerProps {
  state: CFDProjectState;
  flowType: FlowType;
  onFlowTypeChange: (value: FlowType) => void;
  updatePhysics: (updated: Partial<CFDProjectState['physics']>) => void;
  updateBoundaries: (updated: Partial<CFDProjectState['boundaries']>) => void;
}

const modes = [
  ['lbm', 'Incompressible LBM', Zap],
  ['convection', 'Convection Heat Transfer', Thermometer],
  ['cht', 'Conjugate Heat Transfer', Layers3],
  ['multiphase', 'Multiphase Flow', Droplets],
  ['comfort', 'Pedestrian Wind Comfort', Wind],
] as const;

export const CaseSetupDrawer: React.FC<CaseSetupDrawerProps> = ({ state, flowType, onFlowTypeChange, updatePhysics, updateBoundaries }) => {
  const compressible = state.physics.compressibility === 'compressible';
  const inputClass = 'w-full px-2.5 py-2 bg-white border border-[#DDE2E8] rounded-md font-mono text-xs focus:outline-none focus:border-[#2563EB]';
  const updateNumber = (key: keyof CFDProjectState['physics'], fallback: number) => (event: React.ChangeEvent<HTMLInputElement>) => updatePhysics({ [key]: parseFloat(event.target.value) || fallback });

  return (
    <div className="h-full w-full bg-[#F5F6F8] flex min-h-0" role="region" aria-label="Case setup">
      <aside className="w-[280px] bg-white border-r border-[#E1E4E8] p-4 shrink-0 overflow-y-auto">
        <div className="flex items-center justify-between mb-3"><span className="text-[10px] font-bold text-[#69717D] uppercase tracking-wider">CFD analysis</span><CircleHelp className="w-3.5 h-3.5 text-[#A5ACB5]" /></div>
        <div className="space-y-1.5">
          <button onClick={() => updatePhysics({ compressibility: 'incompressible', equationOfState: 'constantDensity', energyModel: 'disabled' })} className={`w-full p-3 rounded-lg border text-left transition-all ${!compressible ? 'bg-blue-50 border-[#2563EB] ring-1 ring-[#2563EB]' : 'border-[#E1E4E8] hover:bg-[#F8F9FA]'}`}><div className="flex items-center gap-2"><Gauge className={`w-4 h-4 ${!compressible ? 'text-[#2563EB]' : 'text-[#69717D]'}`} /><span className="text-xs font-semibold">Incompressible Flow</span></div><span className="text-[10px] text-[#69717D] block ml-6 mt-1">Constant-density flow</span></button>
          <button onClick={() => updatePhysics({ compressibility: 'compressible', equationOfState: 'perfectGas', energyModel: 'enabled' })} className={`w-full p-3 rounded-lg border text-left transition-all ${compressible ? 'bg-blue-50 border-[#2563EB] ring-1 ring-[#2563EB]' : 'border-[#E1E4E8] hover:bg-[#F8F9FA]'}`}><div className="flex items-center gap-2"><Wind className={`w-4 h-4 ${compressible ? 'text-[#2563EB]' : 'text-[#69717D]'}`} /><span className="text-xs font-semibold">Compressible Flow</span></div><span className="text-[10px] text-[#69717D] block ml-6 mt-1">Density and energy effects</span></button>
        </div>
        <div className="border-t border-[#E1E4E8] my-5" /><span className="text-[10px] font-bold text-[#A5ACB5] uppercase tracking-wider block mb-2">More CFD modes</span>
        <div className="space-y-1">{modes.map(([id, label, Icon]) => <div key={id} className="p-2.5 rounded-lg flex items-center gap-2.5 text-[#A5ACB5] cursor-not-allowed"><LockKeyhole className="w-3.5 h-3.5 shrink-0" /><Icon className="w-3.5 h-3.5 shrink-0" /><span className="text-[11px] leading-tight">{label}<span className="block text-[9px] mt-0.5 uppercase tracking-wide">Coming soon</span></span></div>)}</div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="w-full p-5 lg:p-7 grid grid-cols-1 xl:grid-cols-2 gap-4 content-start items-start">

          <section className="xl:col-span-2 bg-white border border-[#E1E4E8] rounded-xl p-5 space-y-4">
            <div><h2 className="text-sm font-bold text-[#171A1F]">Analysis definition</h2><p className="text-[10px] text-[#69717D] mt-1">Choose how the fluid domain and flow should be interpreted.</p></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">Flow topology</span><div className={`${inputClass} flex items-center justify-between text-[#69717D] bg-[#F5F6F8]`}><span className="capitalize">{flowType} flow</span><span className="text-[9px]">Set in Geometry ▸ Domain</span></div></div>
              <div><span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">Flow regime</span><div className="grid grid-cols-2 gap-1.5"><button onClick={() => updatePhysics({ regime: 'laminar' })} className={`py-2 rounded-md border text-xs font-medium ${state.physics.regime === 'laminar' ? 'bg-[#2563EB] border-[#2563EB] text-white' : 'border-[#DDE2E8] text-[#69717D]'}`}>Laminar</button><button onClick={() => updatePhysics({ regime: 'turbulent' })} className={`py-2 rounded-md border text-xs font-medium ${state.physics.regime === 'turbulent' ? 'bg-[#2563EB] border-[#2563EB] text-white' : 'border-[#DDE2E8] text-[#69717D]'}`}>Turbulent</button></div></div>
              <label className="block"><span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">Time formulation</span><select value={state.physics.timeFormulation} onChange={(e) => updatePhysics({ timeFormulation: e.target.value as 'steady' | 'transient' })} className={inputClass}><option value="steady">Steady state</option><option value="transient">Transient</option></select></label>
            </div>
          </section>

          <section className="xl:col-span-2 bg-white border border-[#E1E4E8] rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2"><Wind className="w-4 h-4 text-[#2563EB]" /><div><h2 className="text-sm font-bold text-[#171A1F]">Reference flow conditions</h2><p className="text-[10px] text-[#69717D] mt-1">Used for Reynolds number, y⁺ estimation and initial mesh sizing.</p></div></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label><span className="field-label">Velocity U∞</span><div className="unit-input"><input type="number" step="1" value={state.physics.inletVelocity} onChange={updateNumber('inletVelocity', 35)} className={inputClass} /><span>m/s</span></div></label>
              <label><span className="field-label">Pressure p∞</span><div className="unit-input"><input type="number" step="100" value={state.physics.inletPressure} onChange={updateNumber('inletPressure', 101325)} className={inputClass} /><span>Pa</span></div></label>
              <label><span className="field-label">Temperature T∞</span><div className="unit-input"><input type="number" step="0.1" value={state.physics.inletTemperature} onChange={updateNumber('inletTemperature', 288.15)} className={inputClass} /><span>K</span></div></label>
              <label><span className="field-label">Density ρ</span><div className="unit-input"><input type="number" step="0.001" value={state.physics.density} onChange={updateNumber('density', 1.225)} className={inputClass} /><span>kg/m³</span></div></label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[510px]"><label><span className="field-label">Kinematic viscosity ν</span><div className="unit-input"><input type="number" step="1e-7" value={state.physics.kinematicViscosity} onChange={updateNumber('kinematicViscosity', 1.5e-5)} className={inputClass} /><span>m²/s</span></div></label><label><span className="field-label">Characteristic length</span><div className="unit-input"><input type="number" step="0.01" value={state.geometry.chord || 1} readOnly className={`${inputClass} text-[#69717D]`} /><span>m</span></div></label></div>
          </section>

          <section className="self-start bg-white border border-[#E1E4E8] rounded-xl p-5 space-y-4"><div className="flex items-center gap-2"><Layers3 className="w-4 h-4 text-violet-600" /><div><h2 className="text-sm font-bold text-[#171A1F]">Turbulence and wall treatment</h2><p className="text-[10px] text-[#69717D] mt-1">These settings determine the near-wall mesh strategy.</p></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><label><span className="field-label">Turbulence model</span><select disabled={state.physics.regime !== 'turbulent'} value={state.physics.turbulenceModel} onChange={(e) => updatePhysics({ turbulenceModel: e.target.value as CFDProjectState['physics']['turbulenceModel'] })} className={`${inputClass} disabled:opacity-50`}><option value="kOmegaSST">k-ω SST</option><option value="kEpsilon">Standard k-ε</option><option value="realizableKE">Realizable k-ε</option><option value="RNGkEpsilon">RNG k-ε</option><option value="SpalartAllmaras">Spalart-Allmaras</option></select></label><label><span className="field-label">Wall treatment</span><select value={state.physics.wallTreatment} onChange={(e) => updatePhysics({ wallTreatment: e.target.value as CFDProjectState['physics']['wallTreatment'] })} className={inputClass}><option value="wall_functions">Wall functions</option><option value="low_re_resolved">Low-Re resolved</option></select></label></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label><span className="field-label">Turbulence intensity</span><div className="unit-input"><input type="number" step="0.5" value={state.boundaries.turbulenceIntensityPercent} onChange={(e) => updateBoundaries({ turbulenceIntensityPercent: parseFloat(e.target.value) || 5 })} className={inputClass} /><span>%</span></div></label><label><span className="field-label">Turbulent length scale</span><div className="unit-input"><input type="number" step="0.001" value={state.boundaries.turbulentLengthScaleM} onChange={(e) => updateBoundaries({ turbulentLengthScaleM: parseFloat(e.target.value) || 0.01 })} className={inputClass} /><span>m</span></div></label></div></section>

          {compressible && <section className="self-start bg-white border border-blue-200 rounded-xl p-5 space-y-4"><div className="flex items-center gap-2"><Thermometer className="w-4 h-4 text-[#2563EB]" /><div><h2 className="text-sm font-bold text-[#171A1F]">Thermodynamics and transport</h2><p className="text-[10px] text-[#69717D] mt-1">Required for density variation and energy coupling.</p></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label><span className="field-label">Equation of state</span><select value={state.physics.equationOfState} onChange={(e) => updatePhysics({ equationOfState: e.target.value as 'perfectGas' | 'constantDensity' })} className={inputClass}><option value="perfectGas">Perfect gas</option><option value="constantDensity">Constant density</option></select></label><label><span className="field-label">Energy model</span><select value={state.physics.energyModel} onChange={(e) => updatePhysics({ energyModel: e.target.value as 'disabled' | 'enabled' })} className={inputClass}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label><label><span className="field-label">Transport model</span><select value={state.physics.transportModel} onChange={(e) => updatePhysics({ transportModel: e.target.value as 'constant' | 'sutherland' })} className={inputClass}><option value="sutherland">Sutherland</option><option value="constant">Constant properties</option></select></label><label><span className="field-label">Prandtl number Pr</span><input type="number" step="0.01" value={state.physics.prandtlNumber} onChange={updateNumber('prandtlNumber', 0.71)} className={inputClass} /></label></div><div className="grid grid-cols-1 md:grid-cols-2 gap-3"><label><span className="field-label">Specific heat ratio γ</span><input type="number" step="0.01" value={state.physics.specificHeatRatio} onChange={updateNumber('specificHeatRatio', 1.4)} className={inputClass} /></label><label><span className="field-label">Gas constant R</span><div className="unit-input"><input type="number" step="0.1" value={state.physics.gasConstant} onChange={updateNumber('gasConstant', 287.05)} className={inputClass} /><span>J/kg·K</span></div></label><label><span className="field-label">Specific heat Cp</span><div className="unit-input"><input type="number" step="1" value={state.physics.specificHeat} onChange={updateNumber('specificHeat', 1005)} className={inputClass} /><span>J/kg·K</span></div></label><label><span className="field-label">Thermal conductivity k</span><div className="unit-input"><input type="number" step="0.0001" value={state.physics.thermalConductivity} onChange={updateNumber('thermalConductivity', 0.0262)} className={inputClass} /><span>W/m·K</span></div></label></div></section>}
        </div>
      </main>
    </div>
  );
};
