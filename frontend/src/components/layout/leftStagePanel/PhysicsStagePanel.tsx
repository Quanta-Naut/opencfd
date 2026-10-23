import type { StageId } from '../stages';
import { CFDProjectState, TurbulenceModel } from '../../../types/cfd';
import { Wind, Thermometer } from 'lucide-react';
import { NumberField } from './NumberField';

/** Physics and flow setup: fluid, regime, turbulence model and inflow. */
export function PhysicsStagePanel(p: PhysicsStagePanelProps) {
  const { activeStage, updatePhysics, state } = p;
  return (
    <>
      {/* 02 PHYSICS & FLOW SETUP */}
      {activeStage === 'physics' && (
        <div className="p-4 space-y-4 text-xs text-fg">
          <div className="p-3 bg-surface-2 border border-line rounded space-y-3">
            <div className="flex items-start gap-2">
              <Wind className="w-4 h-4 text-fg-2 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-fg block">Simulation model</span>
                <span className="text-[10px] text-fg-2 block mt-0.5">
                  These reference values drive y⁺ and mesh sizing.
                </span>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Compressibility
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['incompressible', 'compressible'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updatePhysics({ compressibility: mode })}
                    className={`py-2 rounded-sm text-[11px] font-medium border transition-colors ${
                      state.physics.compressibility === mode
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {mode === 'incompressible' ? 'Incompressible' : 'Compressible'}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-fg-2 block mt-1.5">
                {state.physics.compressibility === 'compressible'
                  ? 'Temperature and pressure participate in the flow solution.'
                  : 'Density is treated as constant in the flow solution.'}
              </span>
            </div>

            <div className="pt-2 border-t border-accent-line">
              <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Flow regime
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['laminar', 'turbulent'] as const).map((regime) => (
                  <button
                    key={regime}
                    onClick={() => updatePhysics({ regime })}
                    className={`py-1.5 rounded-sm text-[11px] font-medium border transition-colors capitalize ${
                      state.physics.regime === regime
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {regime}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3 bg-surface border border-line rounded space-y-3">
            <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
              Reference inlet state
            </span>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  label: 'Velocity (U∞)',
                  key: 'inletVelocity',
                  value: state.physics.inletVelocity,
                  unit: 'm/s',
                  step: '1',
                },
                {
                  label: 'Pressure (p∞)',
                  key: 'inletPressure',
                  value: state.physics.inletPressure,
                  unit: 'Pa',
                  step: '100',
                },
              ].map((field) => (
                <label key={field.key} className="block">
                  <span className="text-fg-2 block mb-1">{field.label}</span>
                  <div className="relative">
                    <input
                      type="number"
                      step={field.step}
                      value={field.value}
                      onChange={(e) =>
                        updatePhysics({ [field.key]: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full px-2 py-1.5 pr-9 bg-surface-2 border border-line rounded font-mono focus:outline-none focus:border-accent"
                    />
                    <span className="absolute right-2 top-1.5 text-[10px] text-fg-4">
                      {field.unit}
                    </span>
                  </div>
                </label>
              ))}
            </div>
            <label className="block">
              <span className="text-fg-2 flex items-center gap-1 mb-1">
                <Thermometer className="w-3 h-3" />
                Temperature (T∞)
              </span>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  value={state.physics.inletTemperature}
                  onChange={(e) =>
                    updatePhysics({ inletTemperature: parseFloat(e.target.value) || 288.15 })
                  }
                  className="w-full px-2 py-1.5 pr-9 bg-surface-2 border border-line rounded font-mono focus:outline-none focus:border-accent"
                />
                <span className="absolute right-2 top-1.5 text-[10px] text-fg-4">K</span>
              </div>
            </label>
          </div>

          <div className="p-3 bg-surface-2 border border-line rounded space-y-3">
            <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
              Fluid properties
            </span>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-fg-2 block mb-1">Density (ρ)</span>
                <NumberField
                  value={state.physics.density}
                  min={0}
                  fallback={1.225}
                  onChange={(n) => updatePhysics({ density: n })}
                  className="w-full px-2 py-1.5 bg-surface border border-line rounded font-mono"
                />
              </label>
              <label className="block">
                <span className="text-fg-2 block mb-1">Kinematic ν</span>
                <NumberField
                  value={state.physics.kinematicViscosity}
                  min={0}
                  fallback={1.5e-5}
                  onChange={(n) => updatePhysics({ kinematicViscosity: n })}
                  className="w-full px-2 py-1.5 bg-surface border border-line rounded font-mono"
                />
              </label>
            </div>
          </div>

          {state.physics.regime === 'turbulent' && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                Turbulence model
              </span>
              <select
                value={state.physics.turbulenceModel}
                onChange={(e) =>
                  updatePhysics({ turbulenceModel: e.target.value as TurbulenceModel })
                }
                className="w-full px-2.5 py-1.5 bg-app border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                <option value="kOmegaSST">k-ω SST (Menter)</option>
                <option value="kEpsilon">Standard k-ε</option>
                <option value="realizableKE">Realizable k-ε</option>
                <option value="RNGkEpsilon">RNG k-ε</option>
                <option value="SpalartAllmaras">Spalart-Allmaras</option>
              </select>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export interface PhysicsStagePanelProps {
  activeStage: StageId;
  updatePhysics: (p: any) => void;
  state: CFDProjectState;
}
