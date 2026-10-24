import { Point2D } from '../cadWorkflow';
import { BlockEdge, Blocking } from './types';
import { edgeStations } from './stations';
import { edgeGroup, setEdgeParams } from './hexa';
import { propagateNodeCounts } from './sizing';

// Spacing continuity across block joins (Pointwise "Sync Spacings"). A grid
// line that runs from one block edge into the next should not jump in cell
// size where they meet: the rule of thumb keeps neighbouring cells within a
// growth of about 1.2 to 1.3, so a jump of 2x or more shows as a kink in the
// mesh and a dip in solution accuracy.

/** Above this end-cell ratio across a join the vertex is flagged. */
export const SPACING_JUMP_LIMIT = 2;

/** Largest cell-to-cell growth along an edge that Sync spacings will make. */
const SYNC_MAX_GROWTH = 1.5;

export interface SpacingJump {
  vid: string;
  /** Larger / smaller end cell of the two edges meeting there. */
  ratio: number;
  /** The edge with the larger end cell (the one to refine) and the other. */
  coarse: string;
  fine: string;
}

const chainOf = (e: BlockEdge, vm: Map<string, Point2D>) => [
  vm.get(e.v0)!,
  ...e.path,
  vm.get(e.v1)!,
];

function lengthOf(pts: Point2D[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

/** First cell length of every edge at each of its ends. */
export function endCells(bk: Blocking): Map<string, { at0: number; at1: number }> {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const out = new Map<string, { at0: number; at1: number }>();
  for (const e of bk.edges) {
    const st = edgeStations(bk, e, Infinity, vm, em);
    const L = lengthOf(chainOf(e, vm));
    const n = st.length - 1;
    out.set(e.id, { at0: (st[1] - st[0]) * L, at1: (st[n] - st[n - 1]) * L });
  }
  return out;
}

/** Vertices where a grid line changes cell size abruptly between two edges. */
export function spacingJumps(bk: Blocking, limit = SPACING_JUMP_LIMIT): SpacingJump[] {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const cells = endCells(bk);
  const at = new Map<string, BlockEdge[]>();
  for (const e of bk.edges) for (const v of [e.v0, e.v1]) at.set(v, [...(at.get(v) ?? []), e]);
  // Direction an edge leaves vertex v in.
  const leaving = (e: BlockEdge, v: string) => {
    const pts = chainOf(e, vm);
    const ch = e.v0 === v ? pts : pts.reverse();
    const d = { x: ch[1].x - ch[0].x, y: ch[1].y - ch[0].y };
    const L = Math.hypot(d.x, d.y) || 1;
    return { x: d.x / L, y: d.y / L };
  };
  const out: SpacingJump[] = [];
  for (const [vid, es] of at) {
    let worst: SpacingJump | null = null;
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        const a = es[i];
        const b = es[j];
        const da = leaving(a, vid);
        const db = leaving(b, vid);
        // Only edges that continue one grid line (roughly opposite directions).
        if (da.x * db.x + da.y * db.y > -0.7) continue;
        const ca = a.v0 === vid ? cells.get(a.id)!.at0 : cells.get(a.id)!.at1;
        const cb = b.v0 === vid ? cells.get(b.id)!.at0 : cells.get(b.id)!.at1;
        if (!(ca > 0 && cb > 0)) continue;
        const ratio = Math.max(ca, cb) / Math.min(ca, cb);
        if (ratio > limit && (!worst || ratio > worst.ratio))
          worst = { vid, ratio, coarse: ca > cb ? a.id : b.id, fine: ca > cb ? b.id : a.id };
      }
    }
    if (worst) out.push(worst);
  }
  return out;
}

/**
 * ICEM "Match Edges": each target edge that meets the reference edge takes
 * the reference's cell size at the shared vertex as its end spacing there, so
 * the grid line crosses the join without a jump. Targets keep a spacing law
 * (bi-geometric unless they already use tanh).
 */
export function matchEdgeSpacing(
  bk: Blocking,
  refId: string,
  targetIds: string[],
  copyParallel = false,
): Blocking | { error: string } {
  const ref = bk.edges.find((e) => e.id === refId);
  if (!ref) return { error: 'Pick the reference edge.' };
  const cells = endCells(bk).get(ref.id)!;
  let out = bk;
  let done = 0;
  for (const id of targetIds) {
    const t = out.edges.find((e) => e.id === id);
    if (!t || t.id === ref.id) continue;
    const shared = [t.v0, t.v1].find((v) => v === ref.v0 || v === ref.v1);
    if (!shared) continue;
    const size = Number((shared === ref.v0 ? cells.at0 : cells.at1).toPrecision(3));
    out = setEdgeParams(out, t.id, {
      law: t.law === 'tanh' || t.law === 'bigeometric' ? t.law : 'bigeometric',
      [shared === t.v0 ? 'spacing1' : 'spacing2']: size,
      copyParallel,
    });
    done++;
  }
  if (!done) return { error: 'The target edges must meet the reference edge at a vertex.' };
  return out;
}

/** Ids of wall edges: boundary edges (one block) tagged `wall`, or untagged
 *  (the mesher's default patch). */
export function wallEdgeIds(bk: Blocking): Set<string> {
  const uses = new Map<string, number>();
  for (const b of bk.blocks) for (const id of b.edges) uses.set(id, (uses.get(id) ?? 0) + 1);
  return new Set(
    bk.edges
      .filter((e) => uses.get(e.id) === 1 && (!e.patch || e.patch === 'wall'))
      .map((e) => e.id),
  );
}

/** Edges leaving a wall, keyed by edge id, with the wall vertex (or both
 *  ends when the edge runs between two walls). */
export function wallNormalEdges(bk: Blocking): Map<string, Set<string>> {
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const walls = wallEdgeIds(bk);
  const isWall = (id: string) => walls.has(id);
  const out = new Map<string, Set<string>>();
  for (const b of bk.blocks) {
    for (let k = 0; k < 4; k++) {
      if (!isWall(b.edges[k])) continue;
      const w = em.get(b.edges[k])!;
      for (const j of [(k + 1) % 4, (k + 3) % 4]) {
        const id = b.edges[j];
        if (isWall(id)) continue;
        const e = em.get(id);
        if (!e) continue;
        const at = e.v0 === w.v0 || e.v0 === w.v1 ? e.v0 : e.v1;
        if (!out.has(id)) out.set(id, new Set());
        out.get(id)!.add(at);
      }
    }
  }
  return out;
}

/**
 * Wall layers, the way an ICEM user sizes a boundary layer: every edge
 * leaving a wall gets the first cell height at its wall end and grows by
 * `growth` until cells reach `farCell`; the node count is what that takes.
 * Parallel edges follow, so the layers carry round the whole O or C.
 */
export function applyWallSpacing(
  bk: Blocking,
  firstCell: number,
  growth: number,
  farCell: number,
  maxNodes = 300,
): Blocking {
  const g = Math.max(1.01, growth);
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const len = (e: BlockEdge) => lengthOf(chainOf(e, vm));
  const walls = wallNormalEdges(bk);
  const cellsFor = (L: number, ends: number) => cellsToFill(L, firstCell, g, farCell, ends);
  let out = bk;
  const done = new Set<string>();
  for (const [id, at] of walls) {
    if (done.has(id)) continue;
    const e = out.edges.find((x) => x.id === id);
    if (!e) continue;
    const group = edgeGroup(out, id);
    group.forEach((x) => done.add(x));
    // Nodes from the longest wall-normal edge of the group.
    let cells = 2;
    for (const gid of group) {
      const ge = out.edges.find((x) => x.id === gid)!;
      const w = walls.get(gid);
      if (w) cells = Math.max(cells, cellsFor(len(ge), w.size));
    }
    out = setEdgeParams(out, id, {
      nodes: Math.min(maxNodes, cells + 1),
      law: 'bigeometric',
      spacing1: at.has(e.v0) ? firstCell : 0,
      spacing2: at.has(e.v1) ? firstCell : 0,
      ratio1: g,
      ratio2: g,
      maxSpace: 0,
      copyParallel: true,
    });
  }
  return out;
}

/** Cells an edge of length L needs when it starts at `first` from `ends`
 *  ends (1 or 2) and grows by `g` until cells reach `far`, then stays even. */
export function cellsToFill(
  L: number,
  first: number,
  g: number,
  far: number,
  ends: number,
): number {
  const half = L / ends;
  if (!(first > 0) || g <= 1) return Math.ceil(L / Math.max(far, 1e-30));
  const k = Math.max(0, Math.ceil(Math.log(Math.max(far / first, 1)) / Math.log(g)));
  const grown = (first * (g ** k - 1)) / (g - 1);
  const n =
    grown >= half ? Math.log(1 + (half * (g - 1)) / first) / Math.log(g) : k + (half - grown) / far;
  return Math.ceil(n * ends);
}

/**
 * Pointwise "Sync Spacings" over the whole blocking: wherever a grid line
 * jumps in cell size across a block join, the coarse edge takes the fine
 * edge's cell size at that end. Repeats, since one fix can shift a jump
 * along the line, and reports what is left. An edge too short for its node
 * count to grade down to the fine size is left alone: the jump would only
 * move inside it, between its own cells.
 */
export function syncSpacings(
  bk: Blocking,
  limit = SPACING_JUMP_LIMIT,
): { blocking: Blocking; fixed: number; left: number } {
  let out = bk;
  let fixed = 0;
  const skip = new Set<string>();
  for (let pass = 0; pass < 6; pass++) {
    const jumps = spacingJumps(out, limit).filter((j) => !skip.has(`${j.coarse}@${j.vid}`));
    if (!jumps.length) break;
    const cells = endCells(out);
    for (const j of jumps) {
      const coarse = out.edges.find((e) => e.id === j.coarse);
      const fine = out.edges.find((e) => e.id === j.fine);
      if (!coarse || !fine) continue;
      const fc = cells.get(fine.id)!;
      const size = Number((fine.v0 === j.vid ? fc.at0 : fc.at1).toPrecision(3));
      const trial = setEdgeParams(out, coarse.id, {
        law: coarse.law === 'tanh' || coarse.law === 'bigeometric' ? coarse.law : 'bigeometric',
        [coarse.v0 === j.vid ? 'spacing1' : 'spacing2']: size,
      });
      if (growthWithin(trial, coarse.id) > SYNC_MAX_GROWTH) {
        skip.add(`${j.coarse}@${j.vid}`);
        continue;
      }
      out = trial;
      fixed++;
    }
  }
  return { blocking: out, fixed, left: spacingJumps(out, limit).length };
}

/** Largest size ratio between neighbouring cells along one edge. */
function growthWithin(bk: Blocking, edgeId: string): number {
  const e = bk.edges.find((x) => x.id === edgeId)!;
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const em = new Map(bk.edges.map((x) => [x.id, x] as const));
  const st = edgeStations(bk, e, Infinity, vm, em);
  let worst = 1;
  for (let k = 1; k + 1 < st.length; k++) {
    const a = st[k] - st[k - 1],
      b = st[k + 1] - st[k];
    if (a > 0 && b > 0) worst = Math.max(worst, a / b, b / a);
  }
  return worst;
}

/**
 * ICEM "Scale Sizes": the whole mesh `factor` times finer (2) or coarser
 * (0.5) with every grading kept. Node counts scale; end spacings and max
 * spaces shrink by the factor; cell-to-cell ratios become ratio^(1/factor)
 * so the layers keep their shape at the new density. The first cell at a
 * wall can stay as set (its y+), or scale with the rest for a refinement study.
 */
export function scaleSizes(bk: Blocking, factor: number, keepWallCell = true): Blocking {
  if (!(factor > 0) || factor === 1) return bk;
  const atWall = keepWallCell ? wallNormalEdges(bk) : new Map<string, Set<string>>();
  const sc = (x: number | undefined, keep: boolean) => (x && !keep ? x / factor : x);
  const rt = (r: number | undefined) => (r === undefined ? r : Math.max(1.001, r ** (1 / factor)));
  return propagateNodeCounts({
    ...bk,
    edges: bk.edges.map((e) => {
      const w = atWall.get(e.id);
      return {
        ...e,
        nodes: Math.max(2, Math.min(2000, Math.round((e.nodes - 1) * factor) + 1)),
        spacing1: sc(e.spacing1, !!w?.has(e.v0)),
        spacing2: sc(e.spacing2, !!w?.has(e.v1)),
        maxSpace: sc(e.maxSpace, false),
        ratio1: e.law === 'bigeometric' ? rt(e.ratio1 ?? 1.2) : e.ratio1,
        ratio2: e.law === 'bigeometric' ? rt(e.ratio2 ?? 1.2) : e.ratio2,
      };
    }),
  });
}

/** Turning, in degrees, where two wall edges meet at a vertex. */
const CORNER_TURN_DEG = 20;

/**
 * Cells along walls: each wall edge gets `cornerCell` at every end where the
 * wall turns sharply (a corner, a trailing edge, a step) or stops (it meets
 * another kind of boundary), grows from there by `growth`, and may gather
 * nodes where the wall bends (`curvature`). An end where the wall carries on
 * smoothly is left free. Node counts rise when the grading needs more cells
 * than the edge has, and the parallel edges follow, so the clustering
 * carries straight through the blocks; spacings are then synced across
 * block joins.
 */
export function applyAlongWall(
  bk: Blocking,
  cornerCell: number,
  growth: number,
  curvature: number,
): { blocking: Blocking; edges: number; corners: number } {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const walls = wallEdgeIds(bk);
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const leaving = (e: BlockEdge, v: string) => {
    const pts = chainOf(e, vm);
    const ch = e.v0 === v ? pts : [...pts].reverse();
    // Look a little way along, past any tiny first segment.
    const L = lengthOf(ch);
    let k = 1;
    while (k < ch.length - 1 && Math.hypot(ch[k].x - ch[0].x, ch[k].y - ch[0].y) < L * 0.02) k++;
    const d = { x: ch[k].x - ch[0].x, y: ch[k].y - ch[0].y };
    const l = Math.hypot(d.x, d.y) || 1;
    return { x: d.x / l, y: d.y / l };
  };
  const isCorner = (e: BlockEdge, v: string) => {
    const others = [...walls]
      .map((id) => em.get(id)!)
      .filter((o) => o.id !== e.id && (o.v0 === v || o.v1 === v));
    if (others.length !== 1) return true;
    const a = leaving(e, v),
      b = leaving(others[0], v);
    // Carrying straight on, the two leave in opposite directions.
    const turn =
      180 - (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180) / Math.PI;
    return turn > CORNER_TURN_DEG;
  };
  const plan = [...walls].map((id) => {
    const e = em.get(id)!;
    const c0 = isCorner(e, e.v0),
      c1 = isCorner(e, e.v1);
    const L = lengthOf(chainOf(e, vm));
    const ends = (c0 ? 1 : 0) + (c1 ? 1 : 0);
    const far = L / Math.max(1, e.nodes - 1);
    const need = ends ? cellsToFill(L, cornerCell, growth, far, ends) + 1 : e.nodes;
    return { id, c0, c1, nodes: Math.min(2000, Math.max(e.nodes, need)) };
  });
  const params = (q: (typeof plan)[number], copyParallel: boolean) => ({
    law: 'bigeometric' as const,
    spacing1: q.c0 ? cornerCell : 0,
    spacing2: q.c1 ? cornerCell : 0,
    ratio1: growth,
    ratio2: growth,
    maxSpace: 0,
    curvature,
    copyParallel,
  });
  // Walls in one direction group share a count: the most any of them needs.
  const most = new Map<string, number>();
  for (const q of plan)
    for (const g of edgeGroup(bk, q.id)) most.set(g, Math.max(most.get(g) ?? 0, q.nodes));
  for (const q of plan) q.nodes = most.get(q.id) ?? q.nodes;
  let out = bk;
  // Each wall's grading goes across its blocks; then every wall gets its own
  // back, since two walls can face each other (a channel's floor and roof).
  for (const q of plan) out = setEdgeParams(out, q.id, { ...params(q, true), nodes: q.nodes });
  for (const q of plan) out = setEdgeParams(out, q.id, params(q, false));
  const corners = plan.reduce((k, q) => k + (q.c0 ? 1 : 0) + (q.c1 ? 1 : 0), 0);
  // The fine corner cells must carry on across block joins, or the cells
  // there jump from fine to coarse and skew.
  return { blocking: syncSpacings(propagateNodeCounts(out)).blocking, edges: plan.length, corners };
}
