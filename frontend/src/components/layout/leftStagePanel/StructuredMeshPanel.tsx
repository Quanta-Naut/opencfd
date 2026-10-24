import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';
import { CFDProjectState } from '../../../types/cfd';
import {
  Blocking,
  BlockEdge,
  EdgeLaw,
  propagateNodeCounts,
  emptyBlocking,
  splitBlock,
  deleteBlock,
  applyTargetCellSize,
  currentCellSize,
  edgeLength,
  edgeDirectionGroups,
  DIRECTION_COLORS,
  BlockKind,
  scoreBlocking,
} from '../../../types/blocking';
import type { BlockingReport } from '../../../app/blockingRunner';
import { computeFallbackYPlus } from '../../../utils/api';
import { NumberField } from './NumberField';

/** Equiangle skewness color: under 0.5 is good, over 0.75 is poor. */
const skewTone = (v: number) =>
  v < 0.5 ? 'text-success' : v < 0.75 ? 'text-warning' : 'text-danger';

/**
 * Structured (block-structured) mesh controls, in two steps like the Geometry
 * stage: (1) Blocking - pick a topology type and generate the mapped block
 * layout; (2) Mesh sizing - per-direction cell counts and wall grading.
 */
export const StructuredMeshPanel: React.FC<{
  blocking: Blocking | null;
  onBuildBlocks?: (kind: BlockKind) => void;
  onInitializeBlocking?: () => void;
  blockingReport?: BlockingReport | null;
  onOptimizeBlocks?: () => void;
  onUpdateBlocking?: (bk: Blocking | null) => void;
  ogridBodies?: { index: number; name: string; blockId: string | null; wrapped: boolean }[];
  onWrapBody?: (bodyIndex: number) => void;
  ogridParams?: { offsetFactor: number; radialNodes: number; radialRatio: number };
  onUpdateOgridParams?: (
    p: Partial<{ offsetFactor: number; radialNodes: number; radialRatio: number }>,
  ) => void;
  structuredHint?: BlockKind;
  structuredSmooth?: boolean;
  setStructuredSmooth?: (v: boolean) => void;
  field: string;
  state: CFDProjectState;
  updateYPlus: (p: any) => void;
  onApplyYPlusToMesh?: () => void;
  /** Reports the Direction-A/B/C -> color map while mesh sizing is open, so the
   * canvas can paint each block edge the same color as its direction card
   * (null when that step isn't open, so the canvas falls back to patch colors). */
  onDirectionColors?: (colors: Record<string, string> | null) => void;
  /** Reports whether Automatic or Manual (ICEM-style) blocking is selected, so
   * the canvas only shows the manual block-editing tool palette in Manual mode. */
  onBlockModeChange?: (mode: 'auto' | 'manual') => void;
}> = ({
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
  field,
  state,
  updateYPlus,
  onApplyYPlusToMesh,
  onDirectionColors,
  onBlockModeChange,
}) => {
  const hasBlocks = !!blocking && blocking.blocks.length > 0;
  const recommended: BlockKind = structuredHint ?? 'auto';
  const [kind, setKind] = useState<BlockKind>(recommended);
  const [openStep, setOpenStep] = useState<1 | 2>(1);
  // Automatic = our topology generators. Manual = ICEM Hexa style: initialize
  // one block, then split / delete / associate / O-grid it on the canvas.
  const [blockMode, setBlockMode] = useState<'auto' | 'manual'>('auto');
  useEffect(() => {
    onBlockModeChange?.(blockMode);
  }, [blockMode, onBlockModeChange]);
  const kindRef = useRef(recommended);
  useEffect(() => {
    // follow the recommendation until the user has picked, and until blocks exist
    if (!hasBlocks && kindRef.current !== recommended) {
      kindRef.current = recommended;
      setKind(recommended);
    }
  }, [recommended, hasBlocks]);
  useEffect(() => {
    if (hasBlocks) setOpenStep(2);
  }, [hasBlocks]);

  // Tell the canvas which color each block edge's direction group should draw
  // as, only while the Mesh sizing step (where "Direction A/B/C" live) is open.
  useEffect(() => {
    if (!onDirectionColors) return;
    if (!(hasBlocks && blocking && openStep === 2)) {
      onDirectionColors(null);
      return;
    }
    const groupOf = edgeDirectionGroups(blocking);
    const colors: Record<string, string> = {};
    blocking.edges.forEach((e) => {
      colors[e.id] = DIRECTION_COLORS[(groupOf.get(e.id) ?? 0) % DIRECTION_COLORS.length];
    });
    onDirectionColors(colors);
    return () => onDirectionColors(null);
  }, [blocking, openStep, hasBlocks, onDirectionColors]);

  // Live quality of the current blocks, so manual edits show their effect.
  const quality = useMemo(
    () => (hasBlocks && blocking ? scoreBlocking(blocking) : null),
    [blocking, hasBlocks],
  );
  const tried = blockingReport?.ranking ?? [];

  const currentOffset = ogridParams?.offsetFactor ?? 0.25;
  const [sliderDraft, setSliderDraft] = useState(currentOffset);
  useEffect(() => {
    setSliderDraft(currentOffset);
  }, [currentOffset]);

  const pick = (k: BlockKind) => {
    kindRef.current = k;
    setKind(k);
  };

  // ── Step 1: Blocking ──
  const modeToggle = (
    <div className="grid grid-cols-2 gap-1 p-0.5 bg-app rounded border border-line">
      {(
        [
          ['auto', 'Automatic'],
          ['manual', 'Manual (ICEM-style)'],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          onClick={() => setBlockMode(m)}
          className={`py-1 rounded text-[11px] font-medium transition-colors ${
            blockMode === m
              ? 'bg-surface text-fg font-semibold border border-line'
              : 'text-fg-2 hover:text-fg'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const manualPanel = (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => onInitializeBlocking?.()}
          className="py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-sm transition-colors"
        >
          Initialize block
        </button>
        <button
          onClick={() => onUpdateBlocking?.(emptyBlocking())}
          className="py-2 rounded-sm border border-line bg-surface hover:border-line-strong text-fg font-medium transition-colors"
        >
          Start empty
        </button>
      </div>
    </div>
  );

  const step1 = (
    <div className="space-y-2.5">
      {modeToggle}
      {blockMode === 'manual' ? (
        manualPanel
      ) : (
        <>
          <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
            Topology
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['auto', 'Best fit', 'Try every topology, keep the best mesh'],
                ['hgrid', 'H-grid', 'Box / channel / step'],
                ['ogrid', 'O-grid', 'Body in the flow'],
                ['cgrid', 'C-grid', 'Airfoil + open wake'],
                ['cgrid_closed', 'Airfoil O-grid', 'Airfoil, wake pinches shut'],
              ] as const
            ).map(([k, label, hint]) => (
              <button
                key={k}
                onClick={() => pick(k)}
                className={`p-2 rounded border text-left transition-colors ${k === 'auto' ? 'col-span-2 ' : ''}${
                  kind === k
                    ? 'border-accent bg-accent-soft'
                    : 'bg-surface border-line hover:border-line-strong hover:bg-surface-2'
                }`}
              >
                <span
                  className={`text-[11px] font-semibold block ${kind === k ? 'text-accent-fg' : 'text-fg'}`}
                >
                  {label}
                  {recommended === k && (
                    <span className="ml-1 text-[10px] font-medium text-success">rec.</span>
                  )}
                </span>
                <span className="text-[10px] text-fg-2 block leading-tight mt-0.5">{hint}</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => onBuildBlocks?.(kind)}
            className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-sm transition-colors"
          >
            {hasBlocks ? 'Rebuild blocks' : 'Generate blocks'}
          </button>
        </>
      )}

      {quality && (
        <div className="border-t border-line pt-2.5 space-y-2">
          <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
            Block quality
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ['Wall skew', quality.wallWorst],
                ['Worst skew', quality.worst],
                ['Mean skew', quality.mean],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="p-1.5 rounded border border-line bg-surface">
                <span className="text-[10px] text-fg-2 block">{label}</span>
                <span className={`text-[12px] font-mono font-semibold ${skewTone(v)}`}>
                  {v.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          {quality.invalid > 0 && (
            <p className="text-[10px] text-danger leading-relaxed">
              {quality.invalid} block{quality.invalid > 1 ? 's fold' : ' folds'} over and will not
              mesh. Optimize or move its vertices.
            </p>
          )}
          <Tooltip content="Move the free block vertices and edges until the cells stop improving. Wall and corner vertices stay on the geometry.">
            <button
              onClick={() => onOptimizeBlocks?.()}
              className="w-full py-1.5 rounded-sm border border-line bg-surface hover:border-line-strong text-fg font-medium transition-colors"
            >
              Optimize shape
            </button>
          </Tooltip>
          {tried.length > 1 && (
            <div className="space-y-1">
              <span className="text-[10px] text-fg-2 block">Topologies tried</span>
              {tried.map((t, i) => (
                <div key={t.label} className="flex items-center gap-1.5 text-[10px]">
                  <span
                    className={`flex-1 truncate ${i === 0 && !t.failed ? 'text-fg font-semibold' : 'text-fg-2'}`}
                  >
                    {t.label}
                  </span>
                  {t.failed ? (
                    <Tooltip content={t.failed}>
                      <span className="text-fg-3">did not fit</span>
                    </Tooltip>
                  ) : Number.isFinite(t.rank) ? (
                    <span className="font-mono text-fg-2">
                      wall {t.wallWorst?.toFixed(2)} · worst {t.worst?.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-danger">folds</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {hasBlocks && blocking && (
        <>
          <div className="border-t border-line pt-2.5 space-y-1.5">
            <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
              Blocks ({blocking.blocks.length})
            </span>
            {blocking.blocks.map((blk, i) => (
              <div key={blk.id} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-fg-2 w-12 shrink-0">Block {i + 1}</span>
                <button
                  onClick={() =>
                    onUpdateBlocking?.(propagateNodeCounts(splitBlock(blocking, blk.id, 'x')))
                  }
                  className="flex-1 py-1 rounded border border-line bg-surface hover:border-accent hover:text-accent-fg transition-colors"
                >
                  Split &#8596;
                </button>
                <button
                  onClick={() =>
                    onUpdateBlocking?.(propagateNodeCounts(splitBlock(blocking, blk.id, 'y')))
                  }
                  className="flex-1 py-1 rounded border border-line bg-surface hover:border-accent hover:text-accent-fg transition-colors"
                >
                  Split &#8597;
                </button>
                <button
                  onClick={() =>
                    onUpdateBlocking?.(propagateNodeCounts(deleteBlock(blocking, blk.id)))
                  }
                  disabled={blocking.blocks.length <= 1}
                  className="px-2 py-1 rounded border border-line bg-surface text-danger hover:border-danger disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Del
                </button>
              </div>
            ))}
          </div>

          {ogridBodies && ogridBodies.length > 0 && (
            <div className="border-t border-line pt-2.5 space-y-1.5">
              <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
                Bodies
              </span>
              {ogridBodies.map((b) => (
                <div key={b.index} className="flex items-center gap-1.5 text-[10px]">
                  <span className="flex-1 text-fg truncate">{b.name}</span>
                  {b.wrapped ? (
                    <span className="px-2 py-1 text-success font-medium">Wrapped</span>
                  ) : (
                    <button
                      onClick={() => onWrapBody?.(b.index)}
                      disabled={!b.blockId}
                      className="px-2 py-1 rounded border border-line bg-surface hover:border-accent hover:text-accent-fg transition-colors disabled:opacity-30"
                    >
                      Wrap O-grid
                    </button>
                  )}
                </div>
              ))}
              {ogridBodies.some((b) => !b.blockId && !b.wrapped) && (
                <p className="text-[10px] text-fg-2 leading-relaxed">
                  Body must sit clear of the domain edges to wrap.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {(kind === 'ogrid' || ogridBodies?.some((b) => b.wrapped)) && (
        <div className="border-t border-line pt-2.5 space-y-2">
          <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
            O-grid ring
          </span>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-fg-2">Ring thickness</span>
              <span className="text-[10px] font-mono text-fg">{sliderDraft.toFixed(2)} x body</span>
            </div>
            <input
              type="range"
              min={0.06}
              max={1.2}
              step={0.02}
              value={sliderDraft}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setSliderDraft(v);
                if (!ogridBodies?.some((b) => b.wrapped)) {
                  onUpdateOgridParams?.({ offsetFactor: v });
                }
              }}
              onPointerUp={(e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                onUpdateOgridParams?.({ offsetFactor: v });
              }}
              onMouseUp={(e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                onUpdateOgridParams?.({ offsetFactor: v });
              }}
              onKeyUp={(e) => {
                const v = parseFloat((e.target as HTMLInputElement).value);
                onUpdateOgridParams?.({ offsetFactor: v });
              }}
              className="w-full accent-accent cursor-pointer"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="text-[10px] text-fg-2 block mb-1">Radial nodes</span>
              <NumberField
                value={ogridParams?.radialNodes ?? 26}
                integer
                min={4}
                max={400}
                fallback={26}
                onChange={(n) => onUpdateOgridParams?.({ radialNodes: n })}
                className={field}
              />
            </label>
            <label>
              <Tooltip content="Higher = finer first cell at the wall (like y+ clustering).">
                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                  Wall clustering
                </span>
              </Tooltip>
              <NumberField
                value={ogridParams?.radialRatio ?? 10}
                min={1}
                max={100}
                fallback={10}
                onChange={(n) => onUpdateOgridParams?.({ radialRatio: n })}
                className={field}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );

  // ── Step 2: Mesh sizing ──
  let step2: React.ReactNode = <p className="text-[10px] text-fg-2">Generate the blocks first.</p>;
  if (hasBlocks && blocking) {
    const groupOf = edgeDirectionGroups(blocking);
    const groups: Record<string, string[]> = {};
    blocking.edges.forEach((e) => {
      const g = String(groupOf.get(e.id) ?? 0);
      (groups[g] ||= []).push(e.id);
    });
    const groupList = Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b));
    const edgeById = (id: string) => blocking.edges.find((e) => e.id === id)!;
    const patchLabel = (ids: string[]) => {
      const ps = Array.from(new Set(ids.map((id) => edgeById(id).patch).filter(Boolean)));
      return ps.length ? ps.join(' / ') : 'interior';
    };
    const applyToGroup = (
      ids: string[],
      patch: Partial<{ nodes: number; law: EdgeLaw; ratio: number }>,
    ) => {
      if (!onUpdateBlocking) return;
      onUpdateBlocking(
        propagateNodeCounts({
          ...blocking,
          edges: blocking.edges.map((e) => (ids.includes(e.id) ? { ...e, ...patch } : e)),
        }),
      );
    };
    // First-cell height for the current target y+. `state.yplus.first_layer_height_mm`
    // is kept live by the auto-y+ effect in App.tsx (recomputes on target change).
    // Fall back to a client-side estimate from the physics if it is missing - the
    // saved yplus blob does NOT carry the velocity/length/density/viscosity inputs.
    const liveFirstCellMm = (() => {
      const v = state.yplus.first_layer_height_mm;
      if (typeof v === 'number' && isFinite(v) && v > 0) return v;
      try {
        const r = computeFallbackYPlus({
          velocity: state.physics.inletVelocity || state.boundaries?.inletVelocity || 1,
          length: state.geometry.chord || state.geometry.domainLength || 1,
          density: state.physics.density || 1.225,
          viscosity:
            (state.physics.density || 1.225) * (state.physics.kinematicViscosity || 1.5e-5),
          target_yplus: state.yplus.target_yplus || 30,
          expansion_ratio: state.yplus.expansion_ratio ?? 1.2,
          flow_regime: state.physics.regime === 'laminar' ? 'laminar' : 'turbulent',
        });
        const fc = r.first_layer_height_mm;
        return typeof fc === 'number' && isFinite(fc) && fc > 0 ? fc : null;
      } catch {
        return null;
      }
    })();

    // Cluster genuinely wall-normal block edges toward their wall end. An edge
    // qualifies only if it touches a `wall` patch at exactly one endpoint AND
    // runs roughly perpendicular (within 45 deg) to that wall edge - so an edge
    // that merely clips a wall corner while running along the domain is left
    // alone. Drawing units are metres. The grading is capped: an H-grid on a
    // slanted / curved wall can't hold an extreme y+ without shearing, so this
    // gives a strong-but-safe boundary-layer grade, not an exact y+.
    const growth = Math.max(1.05, Math.min(state.yplus.expansion_ratio ?? 1.2, 1.4));
    const RATIO_CAP = 40; // strongest last/first cell we allow
    const N_CAP = 45; // most cells we put on a wall-normal edge
    const wallCount = blocking.edges.filter((e) => e.patch === 'wall').length;
    const vpt = (id: string) => blocking.vertices.find((v) => v.id === id)?.pt;
    const applyYPlusClustering = () => {
      if (!onUpdateBlocking || !(liveFirstCellMm && liveFirstCellMm > 0)) return;
      const h1 = liveFirstCellMm / 1000;
      const wallEdges = blocking.edges.filter((e) => e.patch === 'wall');
      const wallVids = new Set<string>();
      for (const e of wallEdges) {
        wallVids.add(e.v0);
        wallVids.add(e.v1);
      }
      const edgeDirLeaving = (e: BlockEdge, vid: string): { x: number; y: number } | null => {
        const a = vpt(e.v0),
          b = vpt(e.v1);
        if (!a || !b) return null;
        const pts = [a, ...(e.path ?? []), b];
        if (e.v0 === vid) {
          for (let i = 1; i < pts.length; i++) {
            const d = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y);
            if (d > 1e-6) return { x: (pts[i].x - pts[0].x) / d, y: (pts[i].y - pts[0].y) / d };
          }
        } else if (e.v1 === vid) {
          const last = pts.length - 1;
          for (let i = last - 1; i >= 0; i--) {
            const d = Math.hypot(pts[last].x - pts[i].x, pts[last].y - pts[i].y);
            if (d > 1e-6)
              return { x: (pts[last].x - pts[i].x) / d, y: (pts[last].y - pts[i].y) / d };
          }
        }
        return null;
      };
      const chordDirOf = (e: BlockEdge): { x: number; y: number } | null => {
        const a = vpt(e.v0),
          b = vpt(e.v1);
        if (!a || !b) return null;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
      };
      const perpToWallAt = (edge: BlockEdge, wallVid: string): boolean => {
        // 1. Topological check: In a quad block containing a wall edge meeting wallVid,
        // the edges adjacent to the wall edge in the 4-edge cycle are wall-normal.
        for (const blk of blocking.blocks) {
          const idx = blk.edges.indexOf(edge.id);
          if (idx === -1) continue;
          const adj1 = blocking.edges.find((x) => x.id === blk.edges[(idx + 1) % 4]);
          const adj2 = blocking.edges.find((x) => x.id === blk.edges[(idx + 3) % 4]);
          if (
            (adj1?.patch === 'wall' && (adj1.v0 === wallVid || adj1.v1 === wallVid)) ||
            (adj2?.patch === 'wall' && (adj2.v0 === wallVid || adj2.v1 === wallVid))
          ) {
            return true;
          }
        }

        // 2. Geometric check: Roughly perpendicular to the local tangent or chord of the wall edge.
        const ed = edgeDirLeaving(edge, wallVid);
        if (!ed) return false;
        for (const w of wallEdges) {
          if (w.v0 !== wallVid && w.v1 !== wallVid) continue;
          const wt = edgeDirLeaving(w, wallVid);
          if (wt) {
            const dot = Math.abs(ed.x * wt.x + ed.y * wt.y);
            if (dot <= Math.cos(Math.PI / 4) + 1e-4) return true;
          }
          const wd = chordDirOf(w);
          if (wd) {
            const dot = Math.abs(ed.x * wd.x + ed.y * wd.y);
            if (dot <= Math.cos(Math.PI / 4) + 1e-4) return true;
          }
        }
        return false;
      };
      const edges = blocking.edges.map((e) => {
        const w0 = wallVids.has(e.v0),
          w1 = wallVids.has(e.v1);
        if (w0 === w1) return e;
        const wallVid = w0 ? e.v0 : e.v1;
        if (!perpToWallAt(e, wallVid)) return e;
        const L = edgeLength(blocking, e);
        if (L <= 0) return e;
        const nCellsRaw = Math.ceil(Math.log(1 + (L * (growth - 1)) / h1) / Math.log(growth));
        const nCells = Math.max(10, Math.min(nCellsRaw, N_CAP));
        let lo = 1.0,
          hi = 3.0;
        const sum = (q: number) =>
          Math.abs(q - 1) < 1e-9 ? h1 * nCells : (h1 * (Math.pow(q, nCells) - 1)) / (q - 1);
        while (sum(hi) < L && hi < 20) hi *= 1.5;
        for (let it = 0; it < 60; it++) {
          const m = 0.5 * (lo + hi);
          if (sum(m) < L) lo = m;
          else hi = m;
        }
        let rTotal = Math.min(Math.max(Math.pow(0.5 * (lo + hi), nCells - 1), 1), RATIO_CAP);
        if (rTotal <= 1.0001) return e;
        const ratio = Number((w0 ? rTotal : 1 / rTotal).toPrecision(4));
        return { ...e, nodes: Math.max(e.nodes, nCells + 1), law: 'geometric' as EdgeLaw, ratio };
      });
      onUpdateBlocking(propagateNodeCounts({ ...blocking, edges }));
    };

    const bkNow = blocking;
    step2 = (
      <div className="space-y-2.5">
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <Tooltip content="Target cell edge length. Every direction's node count is set from this and its block-edge length, so a short edge gets few cells and the mesh reads uniform. Adjust a direction below to override.">
              <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                Target cell size
              </span>
            </Tooltip>
            <NumberField
              value={Number(currentCellSize(bkNow).toPrecision(3))}
              min={1e-4}
              onChange={(v) => onUpdateBlocking?.(applyTargetCellSize(bkNow, v))}
              className={field}
            />
          </label>
          <button
            onClick={() =>
              onUpdateBlocking?.(applyTargetCellSize(bkNow, currentCellSize(bkNow) * 0.5))
            }
            className="px-2 py-1.5 text-[10px] rounded border border-line bg-surface hover:border-accent hover:text-accent-fg transition-colors"
          >
            Finer &times;2
          </button>
        </div>

        {setStructuredSmooth && (
          <label className="flex items-center justify-between text-[10px] text-fg-2">
            <Tooltip content="After meshing, relax the interior grid with an elliptic (Winslow) pass so grid lines flow across block seams. Kept only if it does not make the worst cell worse.">
              <span className="cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                Elliptic smoothing
              </span>
            </Tooltip>
            <input
              type="checkbox"
              checked={structuredSmooth !== false}
              onChange={(ev) => setStructuredSmooth(ev.target.checked)}
              className="accent-accent"
            />
          </label>
        )}

        <div className="p-2.5 bg-surface-2 border border-line rounded space-y-2">
          <span className="text-[11px] font-semibold text-fg block">Wall resolution (y+)</span>

          <div className="grid grid-cols-3 gap-2">
            <label>
              <Tooltip content="Target y+ for the first cell at the wall.">
                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                  Target y+
                </span>
              </Tooltip>
              <NumberField
                value={state.yplus.target_yplus ?? 30}
                min={0.1}
                step="1"
                fallback={30}
                onChange={(n) => updateYPlus({ target_yplus: n })}
                className={`${field} bg-surface border-accent-line`}
              />
            </label>
            <div>
              <Tooltip content="First cell height for the current target y+ (live).">
                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                  First cell
                </span>
              </Tooltip>
              <div className="h-[29px] flex items-center font-mono font-semibold text-[11px] text-fg">
                {liveFirstCellMm != null ? `${liveFirstCellMm.toFixed(4)} mm` : '-'}
              </div>
            </div>
            <div>
              <Tooltip content="Wall-tagged block edges found in the current blocking.">
                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                  Wall edges
                </span>
              </Tooltip>
              <div className="h-[29px] flex items-center font-mono font-semibold text-[11px] text-fg">
                {wallCount}
              </div>
            </div>
          </div>

          <button
            onClick={applyYPlusClustering}
            disabled={wallCount === 0}
            className="w-full py-1.5 px-2 rounded-sm border border-line bg-surface hover:bg-surface-3 disabled:opacity-40 disabled:cursor-not-allowed text-fg text-[11px] font-medium transition-colors"
          >
            Cluster wall-normal edges to y+
          </button>
          {wallCount === 0 && (
            <p className="text-[10px] text-fg-2 leading-relaxed">
              Tag a block edge as wall first (Geometry - Boundary patches).
            </p>
          )}
        </div>

        {groupList.map(([gid, ids], i) => {
          const e = edgeById(ids[0]);
          const color = DIRECTION_COLORS[i % DIRECTION_COLORS.length];
          return (
            <div key={gid} className="p-2.5 bg-surface-2 border border-line rounded space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-fg flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: color }}
                  />
                  Direction {String.fromCharCode(65 + i)}
                </span>
                <span className="text-[10px] text-fg-2 lowercase">along {patchLabel(ids)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <Tooltip content="Grid nodes along this direction (cells = nodes minus one).">
                    <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                      Nodes
                    </span>
                  </Tooltip>
                  <NumberField
                    value={e.nodes}
                    integer
                    min={2}
                    max={600}
                    fallback={30}
                    onChange={(n) => applyToGroup(ids, { nodes: n })}
                    className={field}
                  />
                </label>
                <label>
                  <Tooltip content="Last cell / first cell along the edge. 1 = uniform. Above 1 clusters cells toward the start (wall).">
                    <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                      Grading ratio
                    </span>
                  </Tooltip>
                  <NumberField
                    value={e.ratio}
                    min={0.05}
                    max={20}
                    fallback={1}
                    onChange={(n) => applyToGroup(ids, { ratio: n })}
                    className={field}
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] text-fg-2 block mb-1">Distribution</span>
                <select
                  value={e.law}
                  onChange={(ev) => applyToGroup(ids, { law: ev.target.value as EdgeLaw })}
                  className="w-full px-2 py-1.5 bg-surface border border-line rounded-sm text-[11px] focus:outline-none focus:border-accent"
                >
                  <option value="uniform">Uniform</option>
                  <option value="geometric">Geometric (cluster one end)</option>
                  <option value="bump">Bump (cluster both ends)</option>
                </select>
              </label>
            </div>
          );
        })}
      </div>
    );
  }

  const stepRow = (n: 1 | 2, label: string, body: React.ReactNode) => {
    const open = openStep === n;
    const locked = n === 2 && !hasBlocks;
    return (
      <div className="border-t border-line first:border-t-0">
        <button
          onClick={() => !locked && setOpenStep(n)}
          disabled={locked}
          className={`w-full flex items-center gap-2 py-2.5 text-left ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <span
            className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold shrink-0 border ${open ? 'bg-accent-soft text-accent border-accent' : 'bg-surface-3 text-fg-4 border-transparent'}`}
          >
            {n}
          </span>
          <span
            className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${open ? 'text-accent' : 'text-fg-2'}`}
          >
            {label}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-fg-4 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        {open && <div className="pb-3">{body}</div>}
      </div>
    );
  };

  return (
    <div>
      {stepRow(1, 'Blocking', step1)}
      {stepRow(2, 'Mesh sizing', step2)}
    </div>
  );
};
