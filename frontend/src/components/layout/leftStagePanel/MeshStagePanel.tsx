import React from 'react';
import type { StageId, StageStatus } from '../stages';
import { Tooltip } from '../../ui/Tooltip';
import { CFDProjectState } from '../../../types/cfd';
import { Layers, ChevronRight, ChevronDown } from 'lucide-react';
import { Blocking, BlockKind } from '../../../types/blocking';
import type { BlockingReport } from '../../../app/blockingRunner';
import { NumberField } from './NumberField';
import { StageGate } from './StageGate';
import { StructuredMeshPanel } from './StructuredMeshPanel';

/** Mesh stage: topology choice, unstructured sizing or the structured blocking panel, and Generate mesh. */
export function MeshStagePanel(p: MeshStagePanelProps) {
  const {
    activeStage,
    state,
    updateGeometry,
    stageStatus,
    onSelectStage,
    setMeshTopology,
    meshTopology,
    blocking,
    onBuildBlocks,
    blockingReport,
    onOptimizeBlocks,
    onInitializeBlocking,
    onUpdateBlocking,
    ogridBodies,
    onWrapBody,
    ogridParams,
    onUpdateOgridParams,
    structuredHint,
    structuredSmooth,
    setStructuredSmooth,
    updateYPlus,
    onApplyYPlusToMesh,
    onDirectionColors,
    onBlockModeChange,
    yplusDraft,
    commitYplusDraft,
    normalizeYplusDraft,
    setMeshAdvancedOpen,
    meshAdvancedOpen,
    onGenerateStructuredMesh,
    isMeshing,
    meshError,
    meshStale,
    meshData,
    onGenerateMesh,
  } = p;
  return (
    <>
      {/* 03 MESH */}
      {activeStage === 'mesh' &&
        (() => {
          const g = state.geometry;
          const set = updateGeometry;
          const resolutionHint: Record<string, string> = {
            coarse: 'Fast preview. Large free-stream / wake cells.',
            medium: 'Balanced. Good default for first runs.',
            fine: 'Dense wake and near-body. Slower to solve.',
          };
          const field =
            'w-full px-2 py-1 bg-app border border-line rounded font-mono focus:outline-none focus:border-accent';
          const meshLock = stageStatus?.mesh;
          if (meshLock?.locked) {
            return (
              <div className="h-full min-h-0 flex flex-col text-xs text-fg">
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <StageGate
                    title="Meshing is locked"
                    reason="Complete these pre-processing steps before generating a mesh:"
                    missing={meshLock.missing}
                    onCta={onSelectStage ? () => onSelectStage('geometry') : undefined}
                  />
                </div>
                <div className="shrink-0 px-4 py-4 mt-3 border-t border-line bg-surface">
                  <button
                    disabled
                    className="w-full py-2 bg-accent text-white font-medium rounded-sm opacity-40"
                  >
                    Generate mesh
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div className="h-full min-h-0 flex flex-col text-xs text-fg">
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 pt-4">
                {/* Topology */}
                <div>
                  <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                    Mesh topology
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => setMeshTopology('unstructured')}
                      className={`py-2 rounded border font-medium transition-colors ${meshTopology === 'unstructured' ? 'border-accent bg-accent-soft text-accent-fg' : 'bg-surface border-line text-fg-2 hover:border-line-strong hover:bg-surface-2'}`}
                    >
                      Unstructured
                    </button>
                    <button
                      onClick={() => setMeshTopology('structured')}
                      className={`py-2 rounded border font-medium transition-colors ${meshTopology === 'structured' ? 'border-accent bg-accent-soft text-accent-fg' : 'bg-surface border-line text-fg-2 hover:border-line-strong hover:bg-surface-2'}`}
                    >
                      Structured
                    </button>
                  </div>
                </div>

                {meshTopology === 'structured' ? (
                  <StructuredMeshPanel
                    blocking={blocking ?? null}
                    onBuildBlocks={onBuildBlocks}
                    blockingReport={blockingReport}
                    onOptimizeBlocks={onOptimizeBlocks}
                    onInitializeBlocking={onInitializeBlocking}
                    onUpdateBlocking={onUpdateBlocking}
                    ogridBodies={ogridBodies}
                    onWrapBody={onWrapBody}
                    ogridParams={ogridParams}
                    onUpdateOgridParams={onUpdateOgridParams}
                    structuredHint={structuredHint}
                    structuredSmooth={structuredSmooth}
                    setStructuredSmooth={setStructuredSmooth}
                    field={field}
                    state={state}
                    updateYPlus={updateYPlus}
                    onApplyYPlusToMesh={onApplyYPlusToMesh}
                    onDirectionColors={onDirectionColors}
                    onBlockModeChange={onBlockModeChange}
                  />
                ) : (
                  <>
                    {/* Resolution */}
                    <div>
                      <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                        Resolution
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['coarse', 'medium', 'fine'] as const).map((res) => (
                          <button
                            key={res}
                            onClick={() => set({ meshResolution: res })}
                            className={`py-1.5 rounded capitalize font-medium border transition-colors ${g.meshResolution === res ? 'border-accent bg-accent-soft text-accent-fg' : 'bg-surface text-fg-2 border-line hover:border-line-strong hover:bg-surface-2'}`}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] text-fg-2 block mt-1">
                        {resolutionHint[g.meshResolution]}
                      </span>
                    </div>

                    {/* Element type */}
                    <label className="block">
                      <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                        Element type
                      </span>
                      <select
                        value={g.elementType}
                        onChange={(e) =>
                          set({ elementType: e.target.value as typeof g.elementType })
                        }
                        className="w-full px-2 py-1.5 bg-app border border-line rounded-sm focus:outline-none focus:border-accent"
                      >
                        <option value="hybrid">Hybrid: prism layers at wall + triangles</option>
                        <option value="tri">Triangles: fully unstructured</option>
                        <option value="quad_dominant">Quad-dominant: mostly quads</option>
                        <option value="quad">Quads: recombined all-quad</option>
                      </select>
                    </label>

                    {/* Boundary layer */}
                    <div className="border-t border-line pt-3">
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                            Boundary layer
                          </span>
                          <span className="text-[10px] text-fg-2 block mt-0.5">
                            Prism cells along tagged walls
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={g.usePrismLayers}
                          onChange={(e) => set({ usePrismLayers: e.target.checked })}
                          className="accent-accent"
                        />
                      </label>
                      {g.usePrismLayers && (
                        <>
                          <div className="grid grid-cols-3 gap-2 mt-2.5">
                            <label>
                              <Tooltip content="Height of the first cell against the wall, in mm. Sets y⁺ together with the flow speed. Smaller = finer boundary layer.">
                                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  First cell (mm)
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.firstLayerHeightMm}
                                min={0.0001}
                                fallback={0.05}
                                onChange={(n) => set({ firstLayerHeightMm: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Number of prism layers stacked from the wall outward.">
                                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Layers
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.numPrismLayers}
                                integer
                                min={1}
                                max={50}
                                fallback={12}
                                onChange={(n) => set({ numPrismLayers: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Each prism layer is this many times thicker than the one below it (1.1-1.3 typical).">
                                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Growth
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.prismExpansionRatio}
                                min={1.01}
                                max={2}
                                fallback={1.2}
                                onChange={(n) => set({ prismExpansionRatio: n })}
                                className={field}
                              />
                            </label>
                          </div>

                          <Tooltip content="y⁺, first-cell height and layer count size the prism stack against the wall (Hybrid element type only). They don't set the overall cell size - that's the Resolution preset. For a plain triangle / quad mesh, near-wall size is Local wall / region size under Advanced. Low y⁺ (~1) resolves the boundary layer; high (~30-100) uses wall functions.">
                            <div className="mt-2.5 p-2.5 bg-surface-2 border border-line rounded space-y-2 cursor-help">
                              <div className="flex items-end gap-2">
                                <label className="flex-1">
                                  <span className="text-[10px] text-fg-2 block mb-1">
                                    Target y⁺
                                  </span>
                                  <input
                                    type="number"
                                    min="0.1"
                                    step="1"
                                    value={yplusDraft}
                                    onChange={(e) => commitYplusDraft(e.target.value)}
                                    onBlur={normalizeYplusDraft}
                                    className={`${field} bg-surface border-line`}
                                  />
                                </label>
                                <div className="flex-1 pb-1">
                                  <span className="text-[10px] text-fg-2 block">Gives Δy</span>
                                  <span className="font-mono font-semibold text-fg">
                                    {state.yplus.first_layer_height_mm?.toFixed(4)} mm
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={onApplyYPlusToMesh}
                                className="w-full py-1.5 rounded-sm bg-surface border border-line text-fg hover:bg-app font-medium transition-colors"
                              >
                                Apply y⁺ sizing to first cell &amp; layers
                              </button>
                            </div>
                          </Tooltip>
                        </>
                      )}
                    </div>

                    {/* Advanced (collapsible) */}
                    <div className="border-t border-line pt-3">
                      <button
                        onClick={() => setMeshAdvancedOpen((v) => !v)}
                        className="w-full flex items-center justify-between text-[11px] font-semibold text-fg-2 uppercase tracking-wider"
                      >
                        <span>Advanced</span>
                        {meshAdvancedOpen ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {meshAdvancedOpen && (
                        <div className="space-y-2.5 mt-2.5">
                          <label className="block">
                            <span className="text-fg-2 block mb-1">Algorithm</span>
                            <select
                              value={g.meshAlgorithm}
                              onChange={(e) =>
                                set({ meshAlgorithm: e.target.value as typeof g.meshAlgorithm })
                              }
                              className="w-full px-2 py-1.5 bg-app border border-line rounded-sm focus:outline-none focus:border-accent"
                            >
                              <option value="frontal_delaunay">
                                Frontal-Delaunay (recommended)
                              </option>
                              <option value="mesh_adapt">MeshAdapt (robust fallback)</option>
                              <option value="delaunay">Delaunay (fast preview)</option>
                            </select>
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <label>
                              <Tooltip content="How fast cells grow moving away from the wall. Low (1.1) = wide gradual transition to the coarse free stream; high (1.5+) = fine band collapses to coarse quickly.">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Growth rate
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.growthRate}
                                min={1.01}
                                max={2}
                                fallback={1.2}
                                onChange={(n) => set({ growthRate: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Target number of edge segments around a full circle of curvature - controls how finely curved boundaries (arcs, leading edges) are faceted.">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Elements / curve
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.elementsPerCurve}
                                integer
                                min={4}
                                max={100}
                                fallback={12}
                                onChange={(n) => set({ elementsPerCurve: n })}
                                className={field}
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label>
                              <Tooltip content="Absolute smallest cell edge length allowed anywhere, in metres. Blank = auto.">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Min size (m)
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.minElementSize}
                                min={0}
                                allowEmpty
                                placeholder="auto"
                                onChange={(n) => set({ minElementSize: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Cell edge length in the free stream / far field, in metres. Larger = coarser away from the body. Blank = auto (from the Resolution preset).">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Max size (m)
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.maxElementSize}
                                min={0}
                                allowEmpty
                                placeholder="auto"
                                onChange={(n) => set({ maxElementSize: n })}
                                className={field}
                              />
                            </label>
                          </div>
                          <label className="block">
                            <Tooltip content="Cell edge length in the fine band next to wall-tagged edges, in metres. This is the near-wall cell size for a plain triangle / quad mesh (no prism layers). Blank = auto.">
                              <span className="text-fg-2 inline-block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                Local wall / region size (m)
                              </span>
                            </Tooltip>
                            <NumberField
                              value={g.localRefinementSize}
                              min={0}
                              allowEmpty
                              placeholder="auto"
                              onChange={(n) => set({ localRefinementSize: n })}
                              className={field}
                            />
                          </label>
                          <label className="flex items-center justify-between text-fg-2">
                            <Tooltip content="Adds cells where the boundary curves sharply (leading edges, fillets) and where two walls come close together (thin gaps), so those features stay resolved. It also widens the fine near-wall band downstream. Turn off for a tighter fine band that drops to coarse faster.">
                              <span className="cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                Curvature + proximity refinement
                              </span>
                            </Tooltip>
                            <input
                              type="checkbox"
                              checked={g.useProximityRefinement}
                              onChange={(e) => set({ useProximityRefinement: e.target.checked })}
                              className="accent-accent"
                            />
                          </label>
                          <label className="flex items-center justify-between text-fg-2">
                            <Tooltip content="After meshing, runs Laplacian smoothing and Netgen optimisation to improve cell shape - fewer slivers, larger minimum angle, more uniform size transitions. Slightly slower. Leave on unless you want the raw generator output.">
                              <span className="cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                Optimize / smooth mesh
                              </span>
                            </Tooltip>
                            <input
                              type="checkbox"
                              checked={g.optimizeMesh}
                              onChange={(e) => set({ optimizeMesh: e.target.checked })}
                              className="accent-accent"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="shrink-0 px-4 py-4 mt-3 border-t border-line bg-surface space-y-2">
                {meshTopology === 'structured' ? (
                  <button
                    onClick={onGenerateStructuredMesh}
                    disabled={isMeshing || !blocking}
                    className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-sm transition-colors disabled:opacity-40"
                  >
                    {isMeshing
                      ? 'Generating…'
                      : !blocking
                        ? 'Build blocks first'
                        : meshError
                          ? 'Retry mesh'
                          : meshStale && meshData?.num_elements
                            ? 'Regenerate mesh'
                            : 'Generate mesh'}
                  </button>
                ) : (
                  <button
                    onClick={onGenerateMesh}
                    disabled={isMeshing}
                    className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-sm transition-colors disabled:opacity-40"
                  >
                    {isMeshing
                      ? 'Generating…'
                      : meshError
                        ? 'Retry mesh'
                        : meshStale && meshData?.num_elements
                          ? 'Regenerate mesh'
                          : 'Generate mesh'}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
    </>
  );
}

export interface MeshStagePanelProps {
  activeStage: StageId;
  state: CFDProjectState;
  updateGeometry: (p: any) => void;
  stageStatus: Partial<Record<StageId, StageStatus>>;
  onSelectStage: (stage: StageId) => void;
  setMeshTopology: (t: 'unstructured' | 'structured') => void;
  meshTopology: 'unstructured' | 'structured';
  blocking: Blocking;
  onBuildBlocks: (kind: BlockKind) => void;
  onInitializeBlocking: () => void;
  blockingReport?: BlockingReport | null;
  onOptimizeBlocks?: () => void;
  onUpdateBlocking: (bk: Blocking | null) => void;
  ogridBodies: { index: number; name: string; blockId: string | null; wrapped: boolean }[];
  onWrapBody: (bodyIndex: number) => void;
  ogridParams: { offsetFactor: number; radialNodes: number; radialRatio: number };
  onUpdateOgridParams: (
    p: Partial<{ offsetFactor: number; radialNodes: number; radialRatio: number }>,
  ) => void;
  structuredHint: BlockKind;
  structuredSmooth: boolean;
  setStructuredSmooth: (v: boolean) => void;
  updateYPlus: (p: any) => void;
  onApplyYPlusToMesh: () => void;
  onDirectionColors: (colors: Record<string, string> | null) => void;
  onBlockModeChange: (mode: 'auto' | 'manual') => void;
  yplusDraft: string;
  commitYplusDraft: (raw: string) => void;
  normalizeYplusDraft: () => void;
  setMeshAdvancedOpen: React.Dispatch<React.SetStateAction<boolean>>;
  meshAdvancedOpen: boolean;
  onGenerateStructuredMesh: () => void;
  isMeshing: boolean;
  meshError: string;
  meshStale: boolean;
  meshData: any;
  onGenerateMesh: () => void;
}
