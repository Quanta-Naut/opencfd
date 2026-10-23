import type { StageId, StageStatus } from '../stages';
import { CFDProjectState } from '../../../types/cfd';
import { Plus } from 'lucide-react';
import { StageGate } from './StageGate';

/** Results stage: field, colormap and export controls (or the stage gate while locked). */
export function ResultsStagePanel(p: ResultsStagePanelProps) {
  const {
    activeStage,
    stageStatus,
    onSelectStage,
    state,
    updatePostProcess,
    onCreatePlot,
    projectId,
  } = p;
  return (
    <>
      {/* 07 RESULTS */}
      {activeStage === 'results' && stageStatus?.results?.locked && (
        <StageGate
          title="Results are locked"
          reason={stageStatus.results.reason || 'Generate a mesh first.'}
          ctaLabel="Go to Mesh"
          onCta={onSelectStage ? () => onSelectStage('mesh') : undefined}
        />
      )}

      {activeStage === 'results' && !stageStatus?.results?.locked && (
        <div className="flex-1 min-h-0 flex flex-col justify-between">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs text-fg">
            <div>
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Scalar Field Variable
              </span>
              <select
                value={state.postprocess.activeField}
                onChange={(e) => updatePostProcess({ activeField: e.target.value as any })}
                className="w-full px-2.5 py-1.5 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                <option value="U_mag">Velocity Magnitude (|U|)</option>
                <option value="p">Static Pressure (p)</option>
                <option value="k">Turbulent Kinetic Energy (k)</option>
                <option value="omega">Specific Dissipation (ω)</option>
                <option value="vorticity">Vorticity (∇×U)</option>
              </select>
            </div>

            <div className="border-t border-line pt-3 space-y-1.5">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1">
                Scientific Colormap
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(['viridis', 'coolwarm', 'turbo'] as const).map((map) => (
                  <button
                    key={map}
                    onClick={() => updatePostProcess({ colormap: map })}
                    className={`py-1 rounded capitalize text-xs font-medium border transition-colors ${
                      state.postprocess.colormap === map
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {map}
                  </button>
                ))}
              </div>
            </div>

            {/* Line Plot Probe */}
            <div className="border-t border-line pt-3 space-y-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                Line Plot Probe
              </span>
              <button
                type="button"
                onClick={onCreatePlot}
                className="w-full py-2 px-3 rounded bg-accent hover:bg-accent-hover text-white font-semibold text-[11px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Plot</span>
              </button>
              {/* moved out of the live UI - see layout/LeftStagePanel.tsx (Line Plot Probe), kept for a future tutorial
              <p className="text-[10px] text-fg-2 leading-relaxed">
                Sample flow variables along a 2D line probe and visualize XY convergence or field
                profiles.
              </p>
              */}
            </div>
          </div>

          {/* Pinned ParaView Footer */}
          <div className="px-4 py-4 border-t border-line bg-surface shrink-0">
            <button
              type="button"
              onClick={async () => {
                const { launchParaview, checkParaviewStatus } = await import('../../../utils/api');
                const status = await checkParaviewStatus();
                if (!status.available) {
                  alert(
                    'ParaView was not found on your system. Please install ParaView to use external 3D visualization.',
                  );
                  return;
                }
                const res = await launchParaview(projectId);
                if (!res.success) {
                  alert(`Failed to launch ParaView: ${res.detail}`);
                }
              }}
              className="w-full py-2 px-3 rounded border border-line bg-surface text-fg hover:bg-app font-semibold text-[11px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Open in ParaView</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export interface ResultsStagePanelProps {
  activeStage: StageId;
  stageStatus: Partial<Record<StageId, StageStatus>>;
  onSelectStage: (stage: StageId) => void;
  state: CFDProjectState;
  updatePostProcess: (p: any) => void;
  onCreatePlot: () => void;
  projectId: string;
}
