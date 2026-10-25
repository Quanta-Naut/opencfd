import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip } from '../../ui/Tooltip';
import { toast } from '../../ui/Toast';
import { CFDProjectState } from '../../../types/cfd';
import {
  Blocking,
  emptyBlocking,
  applyTargetCellSize,
  applyWallSpacing,
  applyAlongWall,
  scaleSizes,
  spacingJumps,
  syncSpacings,
  currentCellSize,
  edgeDirectionGroups,
  setEdgeParams,
  wallNormalEdges,
  DIRECTION_COLORS,
} from '../../../types/blocking';
import { EdgeParams } from '../../cad/workbenchUi/blockEditor/BlockInspector';
import { fmtLen } from '../../cad/workbenchUi/blockEditor/shared';
import { computeFallbackYPlus } from '../../../utils/api';
import { NumberField } from './NumberField';

// The ICEM CFD Hexa blocking process, done on the canvas with the block tools.
const WORKFLOW = [
  'Initialize',
  'Split',
  'O-grid',
  'Delete blocks in bodies',
  'Associate',
  'Move vertices',
  'Edge params',
  'Pre-mesh',
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
  /** The open section, so the canvas can show blocks or the mesh. */
  onStep?: (step: 'blocking' | 'sizing') => void;
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
  onStep,
}) => {
  const hasBlocks = !!blocking && blocking.blocks.length > 0;
  const [openStep, setOpenStep] = useState<1 | 2>(1);
  const [openDir, setOpenDir] = useState<string | null>(null);
  // Along-wall clustering inputs; the corner cell defaults from the cell size.
  const [cornerCell, setCornerCell] = useState<number | null>(null);
  const [curvature, setCurvature] = useState(1);
  const [scaleWall, setScaleWall] = useState(false);
  useEffect(() => {
    onStep?.(openStep === 2 ? 'sizing' : 'blocking');
  }, [openStep, onStep]);

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

  // ── Step 1: Blocking ──
  const step1 = (
    <div className="space-y-2.5">
      {!hasBlocks && (
        <>
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

      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px] text-fg-2">
        {WORKFLOW.map((title, i) => (
          <li key={title} className="flex items-center gap-1">
            {i > 0 && <span className="text-fg-3">›</span>}
            <span className="text-fg">{title}</span>
          </li>
        ))}
      </ol>
    </div>
  );

  // ── Step 2: Mesh ──
  let step2: React.ReactNode = <p className="text-[10px] text-fg-2">Build the blocks first.</p>;
  if (hasBlocks && blocking) {
    const bkNow = blocking;
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
    // First-cell height for the target y+. `state.yplus.first_layer_height_mm`
    // is kept live by the auto-y+ effect in App.tsx; when it is missing,
    // estimate it here from the physics.
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
    const walls = wallNormalEdges(blocking);
    const wallGroups = new Set([...walls.keys()].map((id) => String(groupOf.get(id) ?? 0)));
    const firstCellM = liveFirstCellMm != null ? liveFirstCellMm / 1000 : null;
    const growth = state.yplus.expansion_ratio ?? 1.2;
    const lbl = 'text-[10px] text-fg-2 block mb-1';
    const cellNow = currentCellSize(bkNow);
    const corner = cornerCell ?? Number((cellNow / 10).toPrecision(2));
    const jumps = spacingJumps(bkNow);
    const scale = (f: number) => onUpdateBlocking?.(scaleSizes(bkNow, f, !scaleWall));
    const btn =
      'px-2 py-1.5 text-[10px] rounded border border-line bg-surface hover:border-accent hover:text-accent-fg transition-colors';

    step2 = (
      <div className="space-y-2.5">
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-1.5">
          <label>
            <Tooltip content="Even cell size for the directions with no grading.">
              <span className={`${lbl} cursor-help`}>Cell size</span>
            </Tooltip>
            <NumberField
              value={Number(cellNow.toPrecision(3))}
              min={1e-4}
              onChange={(v) => onUpdateBlocking?.(applyTargetCellSize(bkNow, v))}
              className={field}
            />
          </label>
          <Tooltip content="Half the cells everywhere, gradings kept.">
            <button onClick={() => scale(0.5)} className={btn}>
              Coarser
            </button>
          </Tooltip>
          <Tooltip content="Twice the cells everywhere, gradings kept.">
            <button onClick={() => scale(2)} className={btn}>
              Finer
            </button>
          </Tooltip>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-fg-2">
          <input
            type="checkbox"
            checked={scaleWall}
            onChange={(ev) => setScaleWall(ev.target.checked)}
            className="accent-accent"
          />
          <Tooltip content="Off keeps the first cell at walls (your y+). On scales it too, for a grid refinement study.">
            <span className="cursor-help">Scale the wall cell too</span>
          </Tooltip>
        </label>

        <div className="p-2.5 bg-surface-2 border border-line rounded space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-fg">Wall layers</span>
            <span className="text-[10px] text-fg-2">
              {walls.size} edge{walls.size === 1 ? '' : 's'} off walls
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label>
              <Tooltip content="Target y+ of the first cell at the wall.">
                <span className={`${lbl} cursor-help`}>y+</span>
              </Tooltip>
              <NumberField
                value={state.yplus.target_yplus ?? 30}
                min={0.1}
                step="1"
                fallback={30}
                onChange={(n) => updateYPlus({ target_yplus: n })}
                className={field}
              />
            </label>
            <div>
              <Tooltip content="First cell height for this y+, from the flow conditions.">
                <span className={`${lbl} cursor-help`}>First cell</span>
              </Tooltip>
              <div className="h-[29px] flex items-center font-mono text-[11px] text-fg">
                {firstCellM != null ? fmtLen(firstCellM) : '-'}
              </div>
            </div>
            <label>
              <Tooltip content="Growth from one layer to the next. 1.1 to 1.2 for a boundary layer.">
                <span className={`${lbl} cursor-help`}>Growth</span>
              </Tooltip>
              <NumberField
                value={growth}
                min={1.01}
                max={2}
                fallback={1.2}
                onChange={(n) => updateYPlus({ expansion_ratio: n })}
                className={field}
              />
            </label>
          </div>
          <button
            onClick={() =>
              firstCellM &&
              onUpdateBlocking?.(
                applyWallSpacing(bkNow, firstCellM, growth, currentCellSize(bkNow)),
              )
            }
            disabled={!walls.size || !firstCellM}
            className="w-full py-1.5 rounded-sm bg-accent hover:bg-accent-hover text-white text-[11px] font-medium disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Apply wall layers
          </button>
          <div className="border-t border-line pt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <label>
              <Tooltip content="Cell length along the wall where it turns a corner or ends.">
                <span className={`${lbl} cursor-help`}>Corner cell</span>
              </Tooltip>
              <NumberField
                value={corner}
                min={1e-7}
                onChange={(n) => setCornerCell(n)}
                className={field}
              />
            </label>
            <label>
              <Tooltip content="Nodes gather where the wall bends. 0 is off, 1 sends about half there.">
                <span className={`${lbl} cursor-help`}>Curvature</span>
              </Tooltip>
              <NumberField
                value={curvature}
                min={0}
                max={10}
                onChange={(n) => setCurvature(n)}
                className={field}
              />
            </label>
            <button
              onClick={() =>
                onUpdateBlocking?.(applyAlongWall(bkNow, corner, growth, curvature).blocking)
              }
              disabled={!walls.size}
              className={btn}
            >
              Along walls
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px]">
          {jumps.length ? (
            <span className="text-warning">
              {jumps.length} spacing jump{jumps.length > 1 ? 's' : ''} at block joins
            </span>
          ) : (
            <span className="text-fg-2">No spacing jumps at block joins</span>
          )}
          <Tooltip content="Match the cell size on both sides of every block join.">
            <button
              onClick={() => {
                const r = syncSpacings(bkNow);
                onUpdateBlocking?.(r.blocking);
                const added = r.refined
                  ? ` Added nodes to ${r.refined} edge group${r.refined > 1 ? 's' : ''} so ${r.refined > 1 ? 'they' : 'it'} could grade.`
                  : '';
                if (!r.left)
                  toast.success('Spacings synced', {
                    id: 'sync-spacings',
                    description: `Fixed ${r.fixed} join${r.fixed > 1 ? 's' : ''}.${added}`,
                  });
                else
                  toast.warning(`${r.left} join${r.left > 1 ? 's' : ''} left`, {
                    id: 'sync-spacings',
                    description: `Fixed ${r.fixed}.${added} The rest need more nodes than allowed (300) to grade smoothly; coarsen the fine side or set the edge by hand.`,
                  });
              }}
              disabled={!jumps.length}
              className={`${btn} disabled:opacity-40 disabled:pointer-events-none`}
            >
              Sync
            </button>
          </Tooltip>
        </div>

        <div className="space-y-1">
          {groupList.map(([gid, ids], i) => {
            const e = edgeById(ids[0]);
            const color = DIRECTION_COLORS[i % DIRECTION_COLORS.length];
            const open = openDir === gid;
            return (
              <div key={gid} className="bg-surface-2 border border-line rounded">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    onClick={() => setOpenDir(open ? null : gid)}
                    className="flex-1 min-w-0 flex items-center gap-2 text-left"
                    title="Edges along this colour on the canvas"
                  >
                    <ChevronDown
                      className={`w-3 h-3 text-fg-4 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                    <span className="truncate text-[10px] text-fg-2 lowercase">
                      {patchLabel(ids)}
                      {wallGroups.has(gid) ? ' · off wall' : ''}
                      {e.law !== 'uniform'
                        ? ` · ${e.law === 'bigeometric' ? 'graded' : e.law}`
                        : ''}
                    </span>
                  </button>
                  <NumberField
                    value={e.nodes}
                    integer
                    min={2}
                    max={600}
                    fallback={30}
                    onChange={(n) => onUpdateBlocking?.(setEdgeParams(bkNow, ids[0], { nodes: n }))}
                    className={`${field} !w-14 text-right`}
                  />
                </div>
                {open && (
                  <div className="px-2 pb-2 text-[11px]">
                    <EdgeParams
                      bare
                      group
                      blocking={bkNow}
                      onUpdateBlocking={(bk) => onUpdateBlocking?.(bk)}
                      entities={[]}
                      edgeIds={[ids[0]]}
                      blockSpacingJumps={[]}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {setStructuredSmooth && (
          <label className="flex items-center justify-between text-[10px] text-fg-2">
            <Tooltip content="After meshing, relax the interior grid with an elliptic (Winslow) pass so grid lines flow across block seams. Kept only if it does not make the worst cell worse.">
              <span className="cursor-help">Elliptic smoothing</span>
            </Tooltip>
            <input
              type="checkbox"
              checked={structuredSmooth !== false}
              onChange={(ev) => setStructuredSmooth(ev.target.checked)}
              className="accent-accent"
            />
          </label>
        )}
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
