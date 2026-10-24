import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';
import { CFDProjectState } from '../../../types/cfd';
import {
  Blocking,
  BlockEdge,
  EdgeLaw,
  propagateNodeCounts,
  emptyBlocking,
  applyTargetCellSize,
  currentCellSize,
  edgeLength,
  edgeDirectionGroups,
  DIRECTION_COLORS,
  premesh,
  premeshQuality,
  PREMESH_MIN_ANGLE,
  PREMESH_MIN_DET,
} from '../../../types/blocking';
import { computeFallbackYPlus } from '../../../utils/api';
import { NumberField } from './NumberField';

// The ICEM CFD Hexa blocking process, done on the canvas with the block tools.
const WORKFLOW: [string, string][] = [
  ['Initialize', 'One block around all the geometry (rail, top).'],
  [
    'Shape the topology',
    'Split (K) the block at the geometry features, then Delete (X) the blocks inside bodies.',
  ],
  [
    'Wrap the bodies',
    'O-grid (O) the blocks around a body. Pass through the outlet edge for a C-grid.',
  ],
  [
    'Associate',
    'Associate (A) the edges along walls to their curves. Vertices go green and slide on them.',
  ],
  ['Move vertices', 'Drag vertices for square, even blocks. Red ones are fixed to the geometry.'],
  ['Size the edges', 'Click an edge: nodes, law, end spacings. Or use Mesh sizing below.'],
  ['Check the pre-mesh', 'Show it (P). Aim for determinant over 0.2 and angles over 18 deg.'],
];

// Rules of thumb from structured meshing practice (ICEM, Pointwise, and the
// usual CFD texts).
const GUIDELINES = [
  'Put block corners on geometry corners and on every change of boundary patch.',
  'Wrap every wall in an O-grid (or C-grid for a sharp trailing edge) so grid lines leave the wall square.',
  'Keep block corners near 90 deg. Under 45 or over 135 deg makes skewed cells.',
  'Keep neighbouring cells within a growth of about 1.2 to 1.3, also across block joins.',
  'Match the cell size on both sides of a block join: no sudden jumps.',
  'Place points where 3 or 5 blocks meet away from walls and strong gradients.',
  'Align blocks with the flow, and run a block line down the wake.',
  'Give the first cell at a wall the height your y+ target needs.',
];

/**
 * Structured (block-structured) mesh controls, in two steps: (1) Blocking -
 * build the blocks by hand on the canvas, ICEM CFD style, with the workflow
 * and the live pre-mesh quality here; (2) Mesh sizing - per-direction cell
 * counts and wall grading.
 */
export const StructuredMeshPanel: React.FC<{
  blocking: Blocking | null;
  onInitializeBlocking?: () => void;
  onUpdateBlocking?: (bk: Blocking | null) => void;
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
}> = ({
  blocking,
  onInitializeBlocking,
  onUpdateBlocking,
  structuredSmooth,
  setStructuredSmooth,
  field,
  state,
  updateYPlus,
  onDirectionColors,
}) => {
  const hasBlocks = !!blocking && blocking.blocks.length > 0;
  const [openStep, setOpenStep] = useState<1 | 2>(1);
  const [showRules, setShowRules] = useState(false);

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

  // Pre-mesh quality of the current blocks (ICEM's determinant and angle).
  const quality = useMemo(
    () => (hasBlocks && blocking ? premeshQuality(premesh(blocking, 60)) : null),
    [blocking, hasBlocks],
  );

  // ── Step 1: Blocking ──
  const step1 = (
    <div className="space-y-2.5">
      {!hasBlocks && (
        <>
          <p className="text-[10px] text-fg-2 leading-relaxed">
            Build the blocks by hand on the canvas, the way ANSYS ICEM CFD does: start from one
            block and split, wrap and associate it to the geometry.
          </p>
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
        </>
      )}

      {quality && (
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              ['Blocks', String(blocking!.blocks.length), true],
              ['Min determinant', quality.minDet.toFixed(2), quality.minDet >= PREMESH_MIN_DET],
              [
                'Min angle',
                `${quality.minAngle.toFixed(1)} deg`,
                quality.minAngle >= PREMESH_MIN_ANGLE,
              ],
            ] as const
          ).map(([label, v, ok]) => (
            <div key={label} className="p-1.5 rounded border border-line bg-surface">
              <span className="text-[10px] text-fg-2 block">{label}</span>
              <span
                className={`text-[12px] font-mono font-semibold ${ok ? 'text-fg' : 'text-danger'}`}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
      )}

      <ol className="space-y-1.5">
        {WORKFLOW.map(([title, how], i) => (
          <li key={title} className="flex gap-2 text-[10px] leading-snug">
            <span className="w-4 h-4 rounded-full bg-surface-3 text-fg-2 flex items-center justify-center text-[9px] font-semibold shrink-0">
              {i + 1}
            </span>
            <span>
              <span className="text-fg font-semibold">{title}.</span>{' '}
              <span className="text-fg-2">{how}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="border-t border-line pt-2">
        <button
          onClick={() => setShowRules((v) => !v)}
          className="w-full flex items-center justify-between text-[10px] font-semibold text-fg-2 uppercase tracking-wider"
        >
          Blocking guidelines
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${showRules ? 'rotate-180' : ''}`}
          />
        </button>
        {showRules && (
          <ul className="mt-1.5 space-y-1 list-disc pl-4 text-[10px] text-fg-2 leading-snug">
            {GUIDELINES.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  // ── Step 2: Mesh sizing ──
  let step2: React.ReactNode = <p className="text-[10px] text-fg-2">Build the blocks first.</p>;
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
                  <option value="tanh">Spacing (tanh, set per edge)</option>
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
