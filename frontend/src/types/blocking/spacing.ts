import { Point2D } from '../cadWorkflow';
import { BlockEdge, Blocking } from './types';
import { edgeStations } from './stations';
import { edgeGroup, setEdgeParams } from './hexa';

// Spacing continuity across block joins (Pointwise "Sync Spacings"). A grid
// line that runs from one block edge into the next should not jump in cell
// size where they meet: the rule of thumb keeps neighbouring cells within a
// growth of about 1.2 to 1.3, so a jump of 2x or more shows as a kink in the
// mesh and a dip in solution accuracy.

/** Above this end-cell ratio across a join the vertex is flagged. */
export const SPACING_JUMP_LIMIT = 2;

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

/** Edges leaving a wall, keyed by edge id, with the wall vertex (or both
 *  ends when the edge runs between two walls). A wall edge is a boundary
 *  edge tagged `wall`, or untagged (the mesher's default patch). */
export function wallNormalEdges(bk: Blocking): Map<string, Set<string>> {
  const uses = new Map<string, number>();
  for (const b of bk.blocks) for (const id of b.edges) uses.set(id, (uses.get(id) ?? 0) + 1);
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const isWall = (id: string) => {
    const e = em.get(id);
    return !!e && uses.get(id) === 1 && (!e.patch || e.patch === 'wall');
  };
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
  // Cells for one edge: geometric growth up to farCell, then even cells.
  const cellsFor = (L: number, ends: number) => {
    const half = L / ends;
    const k = Math.max(0, Math.ceil(Math.log(Math.max(farCell / firstCell, 1)) / Math.log(g)));
    const grown = (firstCell * (g ** k - 1)) / (g - 1);
    const n =
      grown >= half
        ? Math.log(1 + (half * (g - 1)) / firstCell) / Math.log(g)
        : k + (half - grown) / farCell;
    return Math.ceil(n * ends);
  };
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
