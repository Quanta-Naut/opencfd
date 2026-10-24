import { Point2D, CadEntity, BoundaryTag } from '../cadWorkflow';
import { Blocking } from './types';
import { Outline } from './editor';
import { applyVertexMove } from './edgeOps';
import { curveChain } from './hexa';
import { vertexHome, vertexMoveKeepsBlocksValid } from './vertexHome';

// ICEM "Move Vertices" by number: Set Edge Length and Align Vertices In-line.
// A vertex only ever moves where it is allowed to: along the curve it is
// associated to, along the outline stretch it sits on, anywhere when free,
// and not at all when pinned to a geometry corner.

type Tag = (a: Point2D, b: Point2D) => BoundaryTag | undefined;

export interface MoveCtx {
  entities: CadEntity[];
  outlines: Outline[];
  tag?: Tag;
}

/** Where a vertex can travel: a polyline it is held to, free, or pinned. */
type Track =
  | { kind: 'pinned' }
  | { kind: 'free' }
  | { kind: 'on'; pts: Point2D[]; closed: boolean };

function trackOf(bk: Blocking, vid: string, ctx: MoveCtx): Track {
  const v = bk.vertices.find((x) => x.id === vid);
  if (!v) return { kind: 'pinned' };
  if (v.curves?.length) {
    const c = curveChain(v.curves, ctx.entities);
    return c ? { kind: 'on', pts: c.pts, closed: c.closed } : { kind: 'free' };
  }
  const h = vertexHome(v.pt, ctx.outlines, ctx.tag);
  if (h.kind === 'point') return { kind: 'pinned' };
  if (h.kind === 'curve') return { kind: 'on', pts: h.pts, closed: false };
  if (h.kind === 'ring') return { kind: 'on', pts: h.pts, closed: true };
  return { kind: 'free' };
}

/** A polyline walked by arc length. */
function walker(pts: Point2D[], closed: boolean) {
  const P = closed ? [...pts, pts[0]] : pts;
  const cum = [0];
  for (let i = 1; i < P.length; i++)
    cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
  const total = cum[cum.length - 1];
  const at = (s: number): Point2D => {
    s = closed ? ((s % total) + total) % total : Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < P.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return { x: P[i - 1].x + t * (P[i].x - P[i - 1].x), y: P[i - 1].y + t * (P[i].y - P[i - 1].y) };
  };
  const param = (p: Point2D): number => {
    let best = Infinity,
      s = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1],
        b = P[i];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const L2 = dx * dx + dy * dy || 1e-30;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
      const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
      if (d < best) {
        best = d;
        s = cum[i - 1] + t * Math.sqrt(L2);
      }
    }
    return s;
  };
  return { at, param, total };
}

const edgeLen = (bk: Blocking, edgeId: string) => {
  const e = bk.edges.find((x) => x.id === edgeId)!;
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
  let L = 0;
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
};

/**
 * ICEM "Set Edge Length": move one end of an edge until the edge is `length`
 * long, the other end staying put. The moving end keeps to its track (the
 * edge's own line when free), and the solution nearest where it is now wins.
 */
export function setEdgeLength(
  bk: Blocking,
  edgeId: string,
  length: number,
  moveVid: string,
  ctx: MoveCtx,
): Blocking | { error: string } {
  const e = bk.edges.find((x) => x.id === edgeId);
  if (!e || (moveVid !== e.v0 && moveVid !== e.v1)) return { error: 'Edge not found.' };
  if (!(length > 0)) return { error: 'Give a length above zero.' };
  const fixedVid = moveVid === e.v0 ? e.v1 : e.v0;
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const F = vm.get(fixedVid)!,
    M = vm.get(moveVid)!;
  const track = trackOf(bk, moveVid, ctx);
  if (track.kind === 'pinned') return { error: 'That end is fixed to a geometry corner.' };
  // Candidate positions by one parameter, and where the vertex is now.
  let at: (s: number) => Point2D, s0: number, lo: number, hi: number;
  if (track.kind === 'free') {
    const d = Math.hypot(M.x - F.x, M.y - F.y) || 1e-12;
    const u = { x: (M.x - F.x) / d, y: (M.y - F.y) / d };
    at = (s) => ({ x: F.x + u.x * s, y: F.y + u.y * s });
    s0 = d;
    lo = 1e-9 * d;
    hi = Math.max(4 * d, 4 * length);
  } else {
    const w = walker(track.pts, track.closed);
    at = w.at;
    s0 = w.param(M);
    lo = track.closed ? s0 - w.total / 2 : 0;
    hi = track.closed ? s0 + w.total / 2 : w.total;
  }
  const f = (s: number) =>
    edgeLen(applyVertexMove(bk, moveVid, at(s), ctx.entities), edgeId) - length;
  const N = 96;
  const ss = Array.from({ length: N + 1 }, (_, k) => lo + ((hi - lo) * k) / N);
  const fs = ss.map(f);
  let best: [number, number] | null = null;
  for (let k = 0; k < N; k++) {
    if (fs[k] === 0 || fs[k] * fs[k + 1] < 0) {
      const mid = (ss[k] + ss[k + 1]) / 2;
      if (!best || Math.abs(mid - s0) < Math.abs((best[0] + best[1]) / 2 - s0))
        best = [ss[k], ss[k + 1]];
    }
  }
  if (!best) return { error: 'That length cannot be reached along this vertex’s track.' };
  let [a, b] = best;
  let fa = f(a);
  for (let it = 0; it < 48; it++) {
    const m = (a + b) / 2,
      fm = f(m);
    if (fa * fm <= 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  const next = applyVertexMove(bk, moveVid, at((a + b) / 2), ctx.entities);
  if (!vertexMoveKeepsBlocksValid(bk, next, moveVid))
    return { error: 'That length would fold a block.' };
  return next;
}

/** Points where the infinite line through a, b crosses a polyline. */
function lineHits(a: Point2D, b: Point2D, pts: Point2D[], closed: boolean): Point2D[] {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const side = (p: Point2D) => dx * (p.y - a.y) - dy * (p.x - a.x);
  const out: Point2D[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      q = pts[(i + 1) % pts.length];
    const sp = side(p),
      sq = side(q);
    if (sp === 0) out.push({ ...p });
    else if (sp * sq < 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

/**
 * ICEM "Align Vertices In-line": put vertices on the line through two
 * reference vertices. A free vertex moves straight across to the line; one
 * held to a curve moves along it to where the curve meets the line. Pinned
 * vertices, curves that never meet the line, and moves that would fold a
 * block are skipped and counted.
 */
export function alignVertices(
  bk: Blocking,
  fromVid: string,
  toVid: string,
  vids: string[],
  ctx: MoveCtx,
): { blocking: Blocking; moved: number; skipped: number } | { error: string } {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const A = vm.get(fromVid),
    B = vm.get(toVid);
  if (!A || !B || fromVid === toVid) return { error: 'Pick two different vertices for the line.' };
  const dx = B.x - A.x,
    dy = B.y - A.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-24) return { error: 'The two line vertices are on top of each other.' };
  let out = bk,
    moved = 0,
    skipped = 0;
  for (const vid of vids) {
    if (vid === fromVid || vid === toVid) continue;
    const P = out.vertices.find((v) => v.id === vid)?.pt;
    if (!P) continue;
    const track = trackOf(out, vid, ctx);
    let target: Point2D | null = null;
    if (track.kind === 'free') {
      const t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / L2;
      target = { x: A.x + t * dx, y: A.y + t * dy };
    } else if (track.kind === 'on') {
      let bd = Infinity;
      for (const h of lineHits(A, B, track.pts, track.closed)) {
        const d = Math.hypot(h.x - P.x, h.y - P.y);
        if (d < bd) {
          bd = d;
          target = h;
        }
      }
    }
    if (!target) {
      skipped++;
      continue;
    }
    if (Math.hypot(target.x - P.x, target.y - P.y) < 1e-12) continue;
    const next = applyVertexMove(out, vid, target, ctx.entities);
    if (!vertexMoveKeepsBlocksValid(out, next, vid)) {
      skipped++;
      continue;
    }
    out = next;
    moved++;
  }
  return { blocking: out, moved, skipped };
}
