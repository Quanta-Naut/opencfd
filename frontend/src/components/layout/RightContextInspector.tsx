import React, { useEffect, useState } from 'react';
import { CFDProjectState } from '../../types/cfd';
import { ShieldCheck, Wind, Layers, Sliders, Info, ChevronLeft, ChevronRight } from 'lucide-react';

interface RightContextInspectorProps {
  selectedBoundary: string;
  state: CFDProjectState;
  updateBoundaries: (p: any) => void;
  meshData: any;
}

export const RightContextInspector: React.FC<RightContextInspectorProps> = ({
  selectedBoundary,
  state,
  updateBoundaries,
  meshData,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  // Publish the inspector width so floating toasts land just left of it.
  useEffect(() => {
    document.documentElement.style.setProperty('--app-right-inset', isOpen ? '250px' : '28px');
    return () => {
      document.documentElement.style.removeProperty('--app-right-inset');
    };
  }, [isOpen]);

  if (!isOpen) {
    return (
      <aside className="w-7 h-full bg-surface border-l border-line flex flex-col items-center shrink-0 select-none">
        <button
          onClick={() => setIsOpen(true)}
          title="Open Inspector"
          className="w-full flex flex-col items-center py-3 gap-2 text-fg-2 hover:text-fg hover:bg-app transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Inspector
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-[250px] h-full bg-surface border-l border-line flex flex-col select-none shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="p-3.5 border-b border-line flex items-center justify-between shrink-0">
        <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
          Inspector
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-app text-fg-2 rounded border border-line">
            {selectedBoundary.toUpperCase()}
          </span>
          <button
            onClick={() => setIsOpen(false)}
            title="Collapse Inspector"
            className="p-0.5 rounded hover:bg-app text-fg-2 hover:text-fg transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4 text-xs text-fg">
        {/* INLET INSPECTOR */}
        {selectedBoundary === 'inlet' && (
          <>
            <div>
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1">
                Boundary Type
              </span>
              <div className="font-medium text-fg">Velocity Inlet (fixedValue)</div>
            </div>

            <div className="border-t border-line pt-3 space-y-2.5">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                Velocity Specification
              </span>
              <div className="flex justify-between items-center">
                <span className="text-fg-2">Magnitude (U∞)</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="1"
                    value={state.boundaries.inletVelocity}
                    onChange={(e) =>
                      updateBoundaries({ inletVelocity: parseFloat(e.target.value) || 20.0 })
                    }
                    className="w-20 px-2 py-1 bg-app border border-line rounded text-right font-mono"
                  />
                  <span className="text-fg-4 text-[11px]">m/s</span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-fg-2">Flow Angle</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.5"
                    value={state.boundaries.inletAngleDeg}
                    onChange={(e) =>
                      updateBoundaries({ inletAngleDeg: parseFloat(e.target.value) || 0.0 })
                    }
                    className="w-16 px-2 py-1 bg-app border border-line rounded text-right font-mono"
                  />
                  <span className="text-fg-4 text-[11px]">°</span>
                </div>
              </div>
            </div>

            {state.physics.regime === 'turbulent' && (
              <div className="border-t border-line pt-3 space-y-2.5">
                <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                  Turbulence Specification
                </span>

                <div className="flex justify-between items-center">
                  <span className="text-fg-2">Intensity (I)</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.5"
                      min="0.1"
                      value={state.boundaries.turbulenceIntensityPercent}
                      onChange={(e) =>
                        updateBoundaries({
                          turbulenceIntensityPercent: parseFloat(e.target.value) || 5.0,
                        })
                      }
                      className="w-16 px-2 py-0.5 bg-app border border-line rounded text-right font-mono"
                    />
                    <span className="text-fg-4 text-[11px]">%</span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-fg-2">Length Scale (Lt)</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min="0.001"
                      value={state.boundaries.turbulentLengthScaleM}
                      onChange={(e) =>
                        updateBoundaries({
                          turbulentLengthScaleM: parseFloat(e.target.value) || 0.07,
                        })
                      }
                      className="w-20 px-2 py-0.5 bg-app border border-line rounded text-right font-mono"
                    />
                    <span className="text-fg-4 text-[11px]">m</span>
                  </div>
                </div>

                {/* Auto Calculated Values */}
                <div className="mt-2 p-2.5 bg-app rounded border border-line space-y-1">
                  <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
                    Auto-Calculated
                  </span>
                  <div className="font-mono text-[11px] space-y-0.5 text-fg">
                    <div className="flex justify-between">
                      <span className="text-fg-2">k</span>
                      <span>{state.boundaries.inletK.toFixed(3)} m²/s²</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-2">ω</span>
                      <span>{state.boundaries.inletOmega.toFixed(1)} 1/s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-fg-2">νₜ</span>
                      <span>{state.boundaries.inletNut.toExponential(2)} m²/s</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* OUTLET INSPECTOR */}
        {selectedBoundary === 'outlet' && (
          <div className="space-y-3">
            <div>
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1">
                Boundary Type
              </span>
              <div className="font-medium text-fg">Pressure Outlet (zeroGradient U)</div>
            </div>

            <div className="border-t border-line pt-3">
              <div className="flex justify-between items-center">
                <span className="text-fg-2">Gauge Pressure (p)</span>
                <span className="font-mono text-fg">0.0 Pa</span>
              </div>
            </div>
          </div>
        )}

        {/* AIRFOIL / WALL INSPECTOR */}
        {selectedBoundary === 'airfoil' && (
          <div className="space-y-3">
            <div>
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1">
                Surface Condition
              </span>
              <div className="font-medium text-fg">No-Slip Wall</div>
            </div>

            <div className="border-t border-line pt-3 space-y-1.5 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-fg-2">y⁺ target</span>
                <span>{state.yplus.target_yplus}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-2">First cell Δy</span>
                <span>{state.yplus.first_layer_height_mm.toFixed(4)} mm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-2">Wall function</span>
                <span>kqR / omegaWall</span>
              </div>
            </div>
          </div>
        )}

        {/* MESH SUMMARY STATS */}
        <div className="border-t border-line pt-3 space-y-2">
          <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
            Mesh Topology
          </span>
          <div className="font-mono text-[11px] space-y-1 text-fg-2">
            <div className="flex justify-between">
              <span>Nodes</span>
              <span className="text-fg">{meshData?.num_nodes ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span>Elements</span>
              <span className="text-fg">{meshData?.num_elements ?? '-'}</span>
            </div>
            {meshData?.quality && (
              <>
                <div className="flex justify-between">
                  <span>Tris / quads</span>
                  <span className="text-fg">
                    {meshData.quality.triangles ?? 0} / {meshData.quality.quads ?? 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Min angle</span>
                  <span
                    className={meshData.quality.min_angle_degrees < 15 ? 'text-warning' : 'text-fg'}
                  >
                    {meshData.quality.min_angle_degrees?.toFixed(1)}°
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Max skewness</span>
                  <span
                    className={meshData.quality.max_skewness > 0.85 ? 'text-warning' : 'text-fg'}
                  >
                    {meshData.quality.max_skewness?.toFixed(2)}
                  </span>
                </div>
              </>
            )}
            {meshData?.element_type && (
              <div className="flex justify-between">
                <span>Element type</span>
                <span className="text-fg">{meshData.element_type}</span>
              </div>
            )}
            {meshData?.algorithm && (
              <div className="flex justify-between">
                <span>Algorithm</span>
                <span className="text-fg text-[10px]">
                  {meshData.algorithm.replace('Gmsh ', '')}
                </span>
              </div>
            )}
            {meshData?.settings?.smoothing && meshData.settings.smoothing !== 'off' && (
              <div className="flex justify-between gap-2">
                <span className="shrink-0">Smoothing</span>
                <span className="text-fg text-[10px] text-right">
                  {meshData.settings.smoothing}
                </span>
              </div>
            )}
          </div>
          {(() => {
            const raw: string[] = Array.isArray(meshData?.warnings) ? meshData.warnings : [];
            const notes: string[] = [];
            if (raw.some((w) => /boundary-layer|prism|slivers|meshadapt/i.test(w))) {
              notes.push(
                'No prism layers on this mesh - the geometry is too sharp for the boundary-layer extruder, so the wall is resolved with graded triangles instead.',
              );
            }
            raw
              .filter((w) => /coarsen|too aggressive|cell sizes/i.test(w))
              .forEach((w) => notes.push(w));
            if (notes.length === 0) return null;
            return (
              <div className="mt-1.5 space-y-1">
                {notes.map((w, i) => (
                  <div key={i} className="text-[10px] text-fg-2 leading-snug flex gap-1">
                    <span className="text-fg-4">i</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </aside>
  );
};
