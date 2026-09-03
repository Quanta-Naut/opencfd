import React from 'react';
import { YPlusCalculation } from '../../types/cfd';
import { Calculator, ArrowRight, CheckCircle2, Zap } from 'lucide-react';

interface YPlusCalculatorPanelProps {
  yplus: YPlusCalculation;
  onChange: (updated: Partial<YPlusCalculation>) => void;
  onApplyToMesh: () => void;
}

export const YPlusCalculatorPanel: React.FC<YPlusCalculatorPanelProps> = ({
  yplus,
  onChange,
  onApplyToMesh,
}) => {
  return (
    <div className="space-y-4 p-4 text-xs text-slate-700 select-none">
      {/* Target Y+ Preset Selector */}
      <div className="space-y-1.5">
        <label className="font-semibold text-slate-800 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Calculator className="w-3.5 h-3.5 text-blue-600" />
            <span>Target Y+ (y⁺) Objective</span>
          </span>
        </label>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { val: 1.0, label: 'y⁺ ≈ 1 (Resolved)' },
            { val: 30.0, label: 'y⁺ ≈ 30 (Standard)' },
            { val: 100.0, label: 'y⁺ ≈ 100 (Coarse)' },
          ].map((item) => (
            <button
              key={item.val}
              onClick={() => onChange({ target_yplus: item.val })}
              className={`py-1.5 px-1 rounded-md text-[11px] font-medium border text-center transition-colors ${
                yplus.target_yplus === item.val
                  ? 'bg-blue-600 text-white border-blue-600 '
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Parameters */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider">
          Flow Condition Inputs
        </span>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-slate-500 block mb-0.5">Free-stream U_inf</span>
            <div className="relative">
              <input
                type="number"
                step="1"
                min="0.1"
                value={yplus.velocity}
                onChange={(e) => onChange({ velocity: parseFloat(e.target.value) || 20.0 })}
                className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
              />
              <span className="absolute right-2 top-1 text-[10px] text-slate-400">m/s</span>
            </div>
          </div>

          <div>
            <span className="text-slate-500 block mb-0.5">Ref Length (L)</span>
            <div className="relative">
              <input
                type="number"
                step="0.1"
                min="0.01"
                value={yplus.length}
                onChange={(e) => onChange({ length: parseFloat(e.target.value) || 1.0 })}
                className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
              />
              <span className="absolute right-2 top-1 text-[10px] text-slate-400">m</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-slate-500 block mb-0.5">Custom y⁺ Value</span>
            <input
              type="number"
              step="0.5"
              min="0.1"
              max="500"
              value={yplus.target_yplus}
              onChange={(e) => onChange({ target_yplus: parseFloat(e.target.value) || 1.0 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono text-blue-600 font-semibold"
            />
          </div>

          <div>
            <span className="text-slate-500 block mb-0.5">Expansion Ratio</span>
            <input
              type="number"
              step="0.05"
              min="1.05"
              max="1.5"
              value={yplus.expansion_ratio}
              onChange={(e) => onChange({ expansion_ratio: parseFloat(e.target.value) || 1.2 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded font-mono"
            />
          </div>
        </div>
      </div>

      {/* Calculated Boundary Layer & Mesh Properties */}
      <div className="p-3.5 bg-blue-50/50 border border-blue-200 rounded-lg space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-blue-900 text-[11px] uppercase tracking-wider flex items-center gap-1">
            <Calculator className="w-3.5 h-3.5 text-blue-600" />
            <span>Boundary Layer Results</span>
          </span>
          <span className="font-mono text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-semibold">
            Re = {yplus.reynolds_number.toExponential(2)}
          </span>
        </div>

        {/* Highlight First Layer Height */}
        <div className="p-2.5 bg-white border border-blue-200/80 rounded-md flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-500 block">First Layer Height (Δy)</span>
            <span className="text-sm font-mono font-bold text-slate-900">
              {yplus.first_layer_height_mm.toFixed(4)} mm
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-mono text-slate-400">
              {yplus.first_layer_height_m.toExponential(3)} m
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="p-2 bg-white/80 border border-blue-100 rounded">
            <span className="text-slate-500 block">BL Thickness (δ)</span>
            <span className="font-mono font-semibold text-slate-800">
              {yplus.boundary_layer_thickness_mm.toFixed(2)} mm
            </span>
          </div>
          <div className="p-2 bg-white/80 border border-blue-100 rounded">
            <span className="text-slate-500 block">Prism Layers</span>
            <span className="font-mono font-semibold text-slate-800">
              {yplus.recommended_layers} layers
            </span>
          </div>
          <div className="p-2 bg-white/80 border border-blue-100 rounded">
            <span className="text-slate-500 block">Friction Velocity (u_τ)</span>
            <span className="font-mono font-semibold text-slate-800">
              {yplus.friction_velocity.toFixed(3)} m/s
            </span>
          </div>
          <div className="p-2 bg-white/80 border border-blue-100 rounded">
            <span className="text-slate-500 block">Skin Friction (Cf)</span>
            <span className="font-mono font-semibold text-slate-800">
              {yplus.skin_friction_coefficient.toExponential(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Apply to Gmsh Mesh Button */}
      <button
        onClick={onApplyToMesh}
        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg flex items-center justify-center gap-2 transition-colors"
      >
        <Zap className="w-3.5 h-3.5 fill-current" />
        <span>Apply Sizing to Gmsh Mesh</span>
      </button>
    </div>
  );
};
