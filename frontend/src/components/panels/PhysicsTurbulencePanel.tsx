import React from 'react';
import { PhysicsConfig, FlowRegime, TurbulenceModel } from '../../types/cfd';
import { Activity, Flame, Shield, Droplet } from 'lucide-react';

interface PhysicsTurbulencePanelProps {
  config: PhysicsConfig;
  onChange: (updated: Partial<PhysicsConfig>) => void;
}

export const PhysicsTurbulencePanel: React.FC<PhysicsTurbulencePanelProps> = ({
  config,
  onChange,
}) => {
  return (
    <div className="space-y-4 p-4 text-xs text-fg select-none">
      {/* Flow Regime Selector (Laminar vs Turbulent) */}
      <div className="space-y-1.5">
        <label className="font-semibold text-fg flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-fg-2" />
            <span>Flow Regime</span>
          </span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChange({ regime: 'laminar' })}
            className={`py-2 rounded font-medium border text-center transition-all ${
              config.regime === 'laminar'
                ? 'bg-accent-soft text-accent-fg border-accent-line '
                : 'bg-surface text-fg-2 border-line hover:bg-surface-2'
            }`}
          >
            Laminar Flow
          </button>
          <button
            onClick={() => onChange({ regime: 'turbulent' })}
            className={`py-2 rounded font-medium border text-center transition-all ${
              config.regime === 'turbulent'
                ? 'bg-accent-soft text-accent-fg border-accent-line '
                : 'bg-surface text-fg-2 border-line hover:bg-surface-2'
            }`}
          >
            Turbulent (RANS)
          </button>
        </div>
      </div>

      {/* Dynamic Turbulence Model Selection & Branching */}
      {config.regime === 'turbulent' && (
        <div className="p-3 bg-surface-2 border border-line rounded space-y-3">
          <div>
            <label className="font-semibold text-fg block mb-1">Turbulence Model Branch</label>
            <select
              value={config.turbulenceModel}
              onChange={(e) => onChange({ turbulenceModel: e.target.value as TurbulenceModel })}
              className="w-full px-2.5 py-1.5 bg-surface border border-line rounded-sm focus:outline-none focus:ring-1 focus:ring-accent font-medium text-fg"
            >
              <option value="kOmegaSST">k-ω SST (Menter Shear Stress Transport)</option>
              <option value="kEpsilon">Standard k-ε Model</option>
              <option value="realizableKE">Realizable k-ε</option>
              <option value="RNGkEpsilon">RNG k-ε</option>
              <option value="SpalartAllmaras">Spalart-Allmaras (1-Equation)</option>
            </select>
          </div>

          {/* Dynamic Model-Specific Constants */}
          <div className="p-2.5 bg-surface border border-line rounded space-y-2">
            <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
              {config.turbulenceModel === 'kOmegaSST' && 'k-ω SST Closure Constants'}
              {config.turbulenceModel.includes('kEpsilon') && 'k-ε Empirical Constants'}
              {config.turbulenceModel === 'SpalartAllmaras' && 'Spalart-Allmaras Parameters'}
            </span>

            {config.turbulenceModel === 'kOmegaSST' && (
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-fg-2 block">β* (betaStar)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.kOmegaConstants.betaStar}
                    onChange={(e) =>
                      onChange({
                        kOmegaConstants: {
                          ...config.kOmegaConstants,
                          betaStar: parseFloat(e.target.value) || 0.09,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
                <div>
                  <span className="text-fg-2 block">α1 (alpha1)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.kOmegaConstants.alpha1}
                    onChange={(e) =>
                      onChange({
                        kOmegaConstants: {
                          ...config.kOmegaConstants,
                          alpha1: parseFloat(e.target.value) || 0.55,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
                <div>
                  <span className="text-fg-2 block">σ_k1</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.kOmegaConstants.sigmaK1}
                    onChange={(e) =>
                      onChange({
                        kOmegaConstants: {
                          ...config.kOmegaConstants,
                          sigmaK1: parseFloat(e.target.value) || 0.85,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
              </div>
            )}

            {config.turbulenceModel.includes('kEpsilon') && (
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <span className="text-fg-2 block">C_μ</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.kEpsilonConstants.cMu}
                    onChange={(e) =>
                      onChange({
                        kEpsilonConstants: {
                          ...config.kEpsilonConstants,
                          cMu: parseFloat(e.target.value) || 0.09,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
                <div>
                  <span className="text-fg-2 block">C_1ε</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.kEpsilonConstants.c1Eps}
                    onChange={(e) =>
                      onChange({
                        kEpsilonConstants: {
                          ...config.kEpsilonConstants,
                          c1Eps: parseFloat(e.target.value) || 1.44,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
                <div>
                  <span className="text-fg-2 block">C_2ε</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.kEpsilonConstants.c2Eps}
                    onChange={(e) =>
                      onChange({
                        kEpsilonConstants: {
                          ...config.kEpsilonConstants,
                          c2Eps: parseFloat(e.target.value) || 1.92,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
              </div>
            )}

            {config.turbulenceModel === 'SpalartAllmaras' && (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-fg-2 block">C_b1</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.saConstants.cb1}
                    onChange={(e) =>
                      onChange({
                        saConstants: {
                          ...config.saConstants,
                          cb1: parseFloat(e.target.value) || 0.1355,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
                <div>
                  <span className="text-fg-2 block">Von Kármán κ</span>
                  <input
                    type="number"
                    step="0.01"
                    value={config.saConstants.kappa}
                    onChange={(e) =>
                      onChange({
                        saConstants: {
                          ...config.saConstants,
                          kappa: parseFloat(e.target.value) || 0.41,
                        },
                      })
                    }
                    className="w-full px-1.5 py-0.5 bg-surface-2 border border-line rounded"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Wall Treatment */}
          <div>
            <span className="block text-fg-2 mb-1 font-medium">Near-Wall Modeling</span>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <button
                onClick={() => onChange({ wallTreatment: 'low_re_resolved' })}
                className={`py-1 px-1.5 rounded border text-center transition-colors ${
                  config.wallTreatment === 'low_re_resolved'
                    ? 'bg-accent-soft text-accent-fg border-accent-line font-medium'
                    : 'bg-surface text-fg-2 border-line'
                }`}
              >
                Low-Re (y+ ≈ 1)
              </button>
              <button
                onClick={() => onChange({ wallTreatment: 'wall_functions' })}
                className={`py-1 px-1.5 rounded border text-center transition-colors ${
                  config.wallTreatment === 'wall_functions'
                    ? 'bg-accent-soft text-accent-fg border-accent-line font-medium'
                    : 'bg-surface text-fg-2 border-line'
                }`}
              >
                Wall Functions (y+ &gt; 30)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fluid Transport Properties */}
      <div className="p-3 bg-surface-2 border border-line rounded space-y-3">
        <span className="font-semibold text-fg block text-[11px] uppercase tracking-wider flex items-center justify-between">
          <span>Fluid Properties</span>
          <Droplet className="w-3.5 h-3.5 text-fg-4" />
        </span>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-fg-2 block mb-0.5">Density (ρ)</span>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={config.density}
                onChange={(e) => onChange({ density: parseFloat(e.target.value) || 1.225 })}
                className="w-full px-2 py-1 bg-surface border border-line rounded font-mono"
              />
              <span className="absolute right-2 top-1 text-[10px] text-fg-4">kg/m³</span>
            </div>
          </div>

          <div>
            <span className="text-fg-2 block mb-0.5">Viscosity (ν)</span>
            <div className="relative">
              <input
                type="number"
                step="1e-6"
                value={config.kinematicViscosity}
                onChange={(e) =>
                  onChange({ kinematicViscosity: parseFloat(e.target.value) || 1.5e-5 })
                }
                className="w-full px-2 py-1 bg-surface border border-line rounded font-mono"
              />
              <span className="absolute right-2 top-1 text-[10px] text-fg-4">m²/s</span>
            </div>
          </div>
        </div>

        {/* Quick fluid presets */}
        <div className="flex gap-1.5 text-[10px]">
          <button
            onClick={() => onChange({ density: 1.225, kinematicViscosity: 1.5e-5 })}
            className="px-2 py-0.5 bg-surface border border-line rounded hover:bg-surface-3 text-fg-2"
          >
            Air (20°C)
          </button>
          <button
            onClick={() => onChange({ density: 998.2, kinematicViscosity: 1.0e-6 })}
            className="px-2 py-0.5 bg-surface border border-line rounded hover:bg-surface-3 text-fg-2"
          >
            Water (20°C)
          </button>
        </div>
      </div>
    </div>
  );
};
