import type { StageId } from '../stages';
import { CFDProjectState } from '../../../types/cfd';
import { Zap } from 'lucide-react';

/** y+ calculator: target y+ to first-cell height. */
export function YPlusStagePanel(p: YPlusStagePanelProps) {
  const {
    activeStage,
    updateYPlus,
    state,
    yplusDraft,
    commitYplusDraft,
    normalizeYplusDraft,
    onApplyYPlusToMesh,
  } = p;
  return (
    <>
      {/* 04 y+ CALCULATOR */}
      {activeStage === 'yplus' && (
        <div className="p-4 space-y-4 text-xs text-fg">
          <div>
            <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-2">
              Target y⁺ Objective
            </span>
            <div className="grid grid-cols-4 gap-1">
              {[1.0, 30.0, 60.0, 100.0].map((val) => (
                <button
                  key={val}
                  onClick={() => updateYPlus({ target_yplus: val })}
                  className={`py-1 rounded text-xs font-mono font-medium border transition-colors ${
                    state.yplus.target_yplus === val
                      ? 'bg-accent-soft text-accent-fg border-accent-line'
                      : 'bg-surface text-fg-2 border-line hover:bg-app'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-fg-2 whitespace-nowrap">Custom y⁺</span>
              <input
                type="number"
                min="0.1"
                step="1"
                value={yplusDraft}
                onChange={(e) => commitYplusDraft(e.target.value)}
                onBlur={normalizeYplusDraft}
                className="w-full px-2 py-1 bg-surface border border-line rounded font-mono focus:outline-none focus:border-accent"
              />
            </label>
            <span className="text-[10px] text-fg-2 block mt-1">
              y⁺ ≈ 1 resolves the viscous sublayer; y⁺ 30-100 uses wall functions.
            </span>
          </div>

          <div className="border-t border-line pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-fg-4 block text-[10px] uppercase">Inputs</span>
                <div className="font-mono text-fg-2 space-y-0.5 mt-1">
                  <div>U∞: {state.boundaries.inletVelocity} m/s</div>
                  <div>L: {state.geometry.chord || 1.0} m</div>
                  <div>ρ: {state.physics.density}</div>
                </div>
              </div>
              <div>
                <span className="text-fg-4 block text-[10px] uppercase">Results</span>
                <div className="font-mono text-fg space-y-0.5 mt-1">
                  <div>Re: {state.yplus.reynolds_number.toExponential(2)}</div>
                  <div>Cf: {state.yplus.skin_friction_coefficient.toFixed(4)}</div>
                  <div>τw: {state.yplus.wall_shear_stress.toFixed(2)} Pa</div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-app border border-line rounded text-center space-y-1">
            <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
              First Cell Height (Δy)
            </span>
            <div className="text-xl font-bold font-mono text-fg">
              {state.yplus.first_layer_height_mm.toFixed(4)} mm
            </div>
            <div className="text-[10px] text-fg-2 font-mono">
              Boundary layer thickness: {state.yplus.boundary_layer_thickness_mm.toFixed(1)} mm
            </div>
          </div>

          <button
            onClick={onApplyYPlusToMesh}
            className="w-full py-2 bg-success hover:bg-success text-white font-medium rounded-sm flex items-center justify-center gap-1.5 transition-colors"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>Apply Sizing to Gmsh</span>
          </button>
        </div>
      )}
    </>
  );
}

export interface YPlusStagePanelProps {
  activeStage: StageId;
  updateYPlus: (p: any) => void;
  state: CFDProjectState;
  yplusDraft: string;
  commitYplusDraft: (raw: string) => void;
  normalizeYplusDraft: () => void;
  onApplyYPlusToMesh: () => void;
}
