import { Point2D } from '../cadWorkflow';
import { BlockEdge, Blocking } from './types';
import { edgeStations } from './stations';

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
