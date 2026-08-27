import React from 'react';
import { BoundaryConditions, PhysicsConfig } from '../../types/cfd';
import { Compass, Wind, ShieldAlert, ArrowDownRight } from 'lucide-react';

interface BoundaryConditionsPanelProps {
  boundaries: BoundaryConditions;
  physics: PhysicsConfig;
  onChange: (updated: Partial<BoundaryConditions>) => void;
}

export const BoundaryConditionsPanel: React.FC<BoundaryConditionsPanelProps> = ({
  boundaries,
  physics,
  onChange,
}) => {
  return (
    <div className="space-y-4 p-4 text-xs text-slate-700 select-none">
      {/* Inlet Boundary Condition */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Wind className="w-3.5 h-3.5 text-blue-600" />
            <span>Inlet Boundary</span>
          </span>
          <span className="text-[10px] text-blue-600 font-mono font-medium">fixedValue</span>
        </span>

        <div>
          <span className="text-slate-500 block mb-0.5">Velocity Magnitude (U)</span>
          <div className="relative">
            <input
              type="number"
              step="1"
              value={boundaries.inletVelocity}
              onChange={(e) => onChange({ inletVelocity: parseFloat(e.target.value) || 20.0 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
            />
            <span className="absolute right-2 top-1 text-[10px] text-slate-400">m/s</span>
          </div>
        </div>

        {physics.regime === 'turbulent' && (
          <div className="pt-2 border-t border-slate-200/80 space-y-2">
            <span className="text-[11px] font-semibold text-slate-600 block">
              Inlet Turbulence Specification
            </span>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-slate-500 block mb-0.5">Turb. Intensity (I)</span>
                <div className="relative">
                  <input
                    type="number"
                    step="0.5"
                    min="0.1"
                    max="20"
                    value={boundaries.turbulenceIntensityPercent}
                    onChange={(e) =>
                      onChange({ turbulenceIntensityPercent: parseFloat(e.target.value) || 5.0 })
                    }
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
                  />
                  <span className="absolute right-2 top-1 text-[10px] text-slate-400">%</span>
                </div>
              </div>

              <div>
                <span className="text-slate-500 block mb-0.5">Length Scale (Lt)</span>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={boundaries.turbulentLengthScaleM}
                    onChange={(e) =>
                      onChange({ turbulentLengthScaleM: parseFloat(e.target.value) || 0.07 })
                    }
                    className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
                  />
                  <span className="absolute right-2 top-1 text-[10px] text-slate-400">m</span>
                </div>
              </div>
            </div>

            {/* Inflow derived fields */}
            <div className="grid grid-cols-2 gap-1.5 p-2 bg-white border border-slate-200 rounded text-[10px] font-mono">
              <div>k = {boundaries.inletK.toFixed(3)} m²/s²</div>
              <div>ω = {boundaries.inletOmega.toFixed(1)} 1/s</div>
              <div>ε = {boundaries.inletEpsilon.toFixed(2)} m²/s³</div>
              <div>ν_t = {boundaries.inletNut.toFixed(4)} m²/s</div>
            </div>
          </div>
        )}
      </div>

      {/* Outlet Boundary Condition */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ArrowDownRight className="w-3.5 h-3.5 text-slate-500" />
            <span>Outlet Boundary</span>
          </span>
          <span className="text-[10px] text-slate-500 font-mono">zeroGradient (U)</span>
        </span>

        <div>
          <span className="text-slate-500 block mb-0.5">Static Gauge Pressure (p)</span>
          <div className="relative">
            <input
              type="number"
              value={boundaries.outletPressure}
              onChange={(e) => onChange({ outletPressure: parseFloat(e.target.value) || 0.0 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
            />
            <span className="absolute right-2 top-1 text-[10px] text-slate-400">Pa</span>
          </div>
        </div>
      </div>

      {/* Wall Boundary Condition */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
            <span>Wall & Geometry Surface</span>
          </span>
        </span>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onChange({ wallType: 'noSlip' })}
            className={`py-1.5 rounded border text-center font-medium transition-colors ${
              boundaries.wallType === 'noSlip'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            No-Slip Wall
          </button>
          <button
            onClick={() => onChange({ wallType: 'slip' })}
            className={`py-1.5 rounded border text-center font-medium transition-colors ${
              boundaries.wallType === 'slip'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
            }`}
          >
            Free Slip Wall
          </button>
        </div>
      </div>
    </div>
  );
};
