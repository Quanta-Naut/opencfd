import { Point2D } from '../cadWorkflow';
import { Block, BlockEdge, BlockVertex, Blocking } from './types';
import { boundsOf, lerp, pointInRing, uid } from './geometry';
import { blockCornerIds, blockPolygon, splitSheet } from './blockEdit';
import { cleanBlocking, propagateNodeCounts } from './sizing';

// ICEM CFD "Split Block > O-grid Block" around any selection of blocks.
//
// The outline of the selection stays where it is, so the blocks around it are
// untouched. A ring of blocks is laid just inside that outline and the
// selected blocks shrink to fit inside the ring. Edges marked pass-through
// ("add faces" in ICEM) open the ring: the grid lines run straight through
// them. One pass-through edge gives a C-grid (an airfoil block plus its wake
// block, open at the outlet), two adjacent ones an L-grid (a quarter O-grid).
// A block across a pass-through edge is split so the mesh stays conformal.

const clone = (bk: Blocking): Blocking => ({
  vertices: bk.vertices.map((v) => ({
    ...v,
    pt: { ...v.pt },
    curves: v.curves ? [...v.curves] : undefined,
  })),
  edges: bk.edges.map((e) => ({ ...e, path: e.path.map((q) => ({ ...q })) })),
  blocks: bk.blocks.map((b) => ({ id: b.id, edges: [...b.edges] as Block['edges'] })),
  links: (bk.links ?? []).map((g) => [...g]),
});

const areaOf = (pts: Point2D[]) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

/** Full point chain of an edge starting from vertex `from`. */
function chainFrom(e: BlockEdge, from: string, vm: Map<string, Point2D>): Point2D[] {
  const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
  return e.v0 === from ? pts : pts.reverse();
}

/** The point at arc-length fraction t along a chain. */
function along(pts: Point2D[], t: number): Point2D {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const d = t * cum[cum.length - 1];
  let i = 0;
  while (i + 2 < pts.length && cum[i + 1] < d) i++;
  return lerp(pts[i], pts[i + 1], (d - cum[i]) / (cum[i + 1] - cum[i] || 1));
}

const chainLen = (pts: Point2D[]) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
};

/**
 * O-grid the blocks `blockIds`. `passEdgeIds` are edges on the outline of the
 * selection the O-grid passes through. `scale` is the size of the shrunk
 * selection relative to the original (0.5 = halfway to each block's centre).
 */
export function ogridBlocks(
  bk: Blocking,
  blockIds: string[],
  passEdgeIds: string[] = [],
  scale = 0.5,
  cellSize?: number,
): Blocking | { error: string } {
  const sel = new Set(blockIds.filter((id) => bk.blocks.some((b) => b.id === id)));
  if (!sel.size) return { error: 'Select the blocks to O-grid first.' };
  for (const id of sel) {
    const blk = bk.blocks.find((b) => b.id === id)!;
    if (blockCornerIds(bk, blk).length !== 4)
      return { error: 'Only clean 4-sided blocks can be O-gridded.' };
  }
  const s = Math.max(0.05, Math.min(0.95, scale));
  let out = clone(bk);
  const size =
    cellSize ??
    (() => {
      const b = boundsOf(bk.vertices.map((v) => v.pt));
      return Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9) / 90;
    })();

  // ── The outline of the selection: edges used by exactly one selected block.
  const uses = new Map<string, number>();
  for (const b of out.blocks)
    if (sel.has(b.id)) for (const e of b.edges) uses.set(e, (uses.get(e) ?? 0) + 1);
  let em = new Map(out.edges.map((e) => [e.id, e] as const));
  const outline = [...uses].filter(([, n]) => n === 1).map(([id]) => em.get(id)!);
  const pass = new Set(passEdgeIds);
  for (const id of pass)
    if (!outline.some((e) => e.id === id))
      return { error: 'Pass-through edges must lie on the outside of the selection.' };
  if (pass.size >= outline.length) return { error: 'Leave at least one edge for the ring.' };
  const byVertex = new Map<string, BlockEdge[]>();
  for (const e of outline)
    for (const v of [e.v0, e.v1]) byVertex.set(v, [...(byVertex.get(v) ?? []), e]);
  if ([...byVertex.values()].some((l) => l.length !== 2))
    return { error: 'The selection must be one region without holes, joined along edges.' };
  // Walk the outline as one loop.
  const loopV: string[] = [];
  const loopE: BlockEdge[] = [];
  {
    let e = outline[0];
    let v = e.v0;
    for (let guard = 0; guard <= outline.length; guard++) {
      loopV.push(v);
      loopE.push(e);
      v = e.v0 === v ? e.v1 : e.v0;
      const nextE: BlockEdge = byVertex.get(v)!.find((x) => x.id !== e.id)!;
      if (v === loopV[0]) break;
      e = nextE;
    }
    if (loopE.length !== outline.length)
      return { error: 'The selection must be one region without holes, joined along edges.' };
  }
  let vm = new Map(out.vertices.map((v) => [v.id, v.pt] as const));
  const ring = loopV.map((id) => vm.get(id)!);
  if (areaOf(ring) < 0) {
    // Counter-clockwise: edge k runs from loopV[k] to loopV[k + 1].
    loopV.reverse();
    loopE.reverse();
    loopV.unshift(loopV.pop()!);
  }
  const N = loopV.length;
  const ringPts = loopV.map((id) => vm.get(id)!);

  // ── Where each outline vertex goes. The ring has one thickness all round:
  // each outline edge moves inward by `h` and the inner corners sit where
  // the moved edges meet, so the ring blocks come out as square as the
  // outline allows. `h` is the share (1 - scale) of half the thinnest
  // selected block, so the shrunk selection always keeps some room.
  const selBlocks = out.blocks.filter((b) => sel.has(b.id));
  let thin = Infinity;
  for (const b of selBlocks) {
    const poly = blockCornerIds(out, b).map((id) => vm.get(id)!);
    for (let k = 0; k < 4; k++) {
      const p = poly[k];
      const q = poly[(k + 1) % 4];
      thin = Math.min(thin, Math.hypot(q.x - p.x, q.y - p.y));
    }
  }
  const h = (1 - s) * 0.5 * thin;
  /** Unit tangent of edge e at vertex `at`, pointing away from it. */
  const tangentAt = (e: BlockEdge, at: string) => {
    const ch = chainFrom(e, at, vm);
    for (let i = 1; i < ch.length; i++) {
      const dx = ch[i].x - ch[0].x;
      const dy = ch[i].y - ch[0].y;
      const L = Math.hypot(dx, dy);
      if (L > 1e-12) return { x: dx / L, y: dy / L };
    }
    return { x: 1, y: 0 };
  };
  // Inward (left, the loop runs counter-clockwise) normal of a loop edge
  // where it leaves vertex `at` going forward.
  const inwardOf = (e: BlockEdge, at: string, forward: boolean) => {
    const t = tangentAt(e, at);
    const d = forward ? t : { x: -t.x, y: -t.y };
    return { x: -d.y, y: d.x };
  };
  // A vertex next to a pass-through edge slides along it instead, to where
  // the moved ring edge meets it.
  type Place = { kind: 'offset'; pt: Point2D } | { kind: 'on'; edge: BlockEdge; dist: number };
  const place = new Map<string, Place | null>();
  for (let k = 0; k < N; k++) {
    const vid = loopV[k];
    const prev = loopE[(k - 1 + N) % N];
    const next = loopE[k];
    const pp = pass.has(prev.id);
    const pn = pass.has(next.id);
    const p = vm.get(vid)!;
    const n1 = inwardOf(prev, vid, false);
    const n2 = inwardOf(next, vid, true);
    if (!pp && !pn) {
      // Miter: the point h in from both edges (capped at a sharp corner).
      const den = Math.max(0.15, 1 + n1.x * n2.x + n1.y * n2.y);
      place.set(vid, {
        kind: 'offset',
        pt: { x: p.x + (h * (n1.x + n2.x)) / den, y: p.y + (h * (n1.y + n2.y)) / den },
      });
    } else if (pp && pn) place.set(vid, null);
    else {
      const edge = pp ? prev : next;
      const ring = pp ? n2 : n1;
      const along = tangentAt(edge, vid);
      const cos = Math.max(0.2, along.x * ring.x + along.y * ring.y);
      const L = chainLen(chainFrom(edge, vid, vm)) || 1;
      place.set(vid, { kind: 'on', edge, dist: Math.min(h / cos, 0.45 * L) });
    }
  }
  // An offset point must stay inside the selection.
  for (const pl of place.values())
    if (pl?.kind === 'offset' && !pointInRing(pl.pt.x, pl.pt.y, ringPts))
      return { error: 'The ring would fold here. Make the centre larger or reshape the blocks.' };

  // ── Cut each pass-through edge where the ring meets it. A block across it
  // is split along the same line (sheet propagation keeps it conformal).
  const target = new Map<string, Point2D>(); // outline vertex -> point its inner copy sits at
  for (const [vid, pl] of place) {
    if (!pl) continue;
    if (pl.kind === 'offset') target.set(vid, pl.pt);
    else {
      const ch = chainFrom(pl.edge, vid, vm);
      target.set(vid, along(ch, pl.dist / (chainLen(ch) || 1)));
    }
  }
  const cutPts: { edgeId: string; pt: Point2D }[] = [];
  for (const [vid, pl] of place)
    if (pl?.kind === 'on') cutPts.push({ edgeId: pl.edge.id, pt: target.get(vid)! });
  const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < size * 1e-3;
  const vertexAt = (pt: Point2D) => out.vertices.find((v) => near(v.pt, pt));
  for (const { edgeId, pt } of cutPts) {
    const orig = em.get(edgeId);
    if (!orig) continue;
    // A block across the edge (or across the piece left by an earlier cut)
    // is split through the point.
    const pieceId = findPieceHolding(out, pt, sel, size * 1e-3);
    if (pieceId) {
      const next = splitSheet(out, pieceId, pt, sel);
      if (!next) return { error: 'The block across a pass-through edge could not be split.' };
      out = next;
      em = new Map(out.edges.map((e) => [e.id, e] as const));
      vm = new Map(out.vertices.map((v) => [v.id, v.pt] as const));
    }
    if (!vertexAt(pt)) {
      const v: BlockVertex = { id: uid(), pt: { ...pt } };
      if (orig.curves?.length) v.curves = [...orig.curves];
      out.vertices.push(v);
      vm.set(v.id, v.pt);
    }
  }

  // ── Inner copies of the outline vertices.
  const inner = new Map<string, string>();
  for (const vid of loopV) {
    const pl = place.get(vid);
    if (!pl) {
      inner.set(vid, vid);
      continue;
    }
    const pt = target.get(vid)!;
    const existing = pl.kind === 'on' ? vertexAt(pt) : undefined;
    if (existing) inner.set(vid, existing.id);
    else {
      const v: BlockVertex = { id: uid(), pt: { ...pt } };
      out.vertices.push(v);
      vm.set(v.id, v.pt);
      inner.set(vid, v.id);
    }
  }

  // ── Edges between two vertices: reuse one that exists, else make it.
  const findEdge = (a: string, b: string) =>
    out.edges.find((e) => (e.v0 === a && e.v1 === b) || (e.v0 === b && e.v1 === a));
  const newEdge = (a: string, b: string, nodes: number, like?: BlockEdge): BlockEdge => {
    const e: BlockEdge = {
      id: uid(),
      v0: a,
      v1: b,
      path: [],
      nodes: Math.max(2, nodes),
      law: 'uniform',
      ratio: 1,
      ...(like
        ? {
            patch: like.patch,
            curveId: like.curveId,
            curves: like.curves ? [...like.curves] : undefined,
          }
        : {}),
    };
    out.edges.push(e);
    em.set(e.id, e);
    return e;
  };
  const cellsBetween = (a: Point2D, b: Point2D) =>
    Math.max(4, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / size) + 1);
  /** A straight piece of pass-through edge `orig` between two of its points. */
  const piece = (orig: BlockEdge, a: string, b: string): BlockEdge => {
    const found = findEdge(a, b);
    if (found) return found;
    const pa = vm.get(a)!;
    const pb = vm.get(b)!;
    const full = chainLen([vm.get(orig.v0)!, ...orig.path, vm.get(orig.v1)!]) || 1;
    const nodes = Math.round((orig.nodes - 1) * (Math.hypot(pb.x - pa.x, pb.y - pa.y) / full)) + 1;
    return newEdge(a, b, Math.max(2, nodes), orig);
  };

  // Radial edge at each outline vertex: from it to its inner copy.
  const radial = new Map<string, BlockEdge>();
  for (const vid of loopV) {
    const iv = inner.get(vid)!;
    if (iv === vid) continue;
    const pl = place.get(vid)!;
    radial.set(
      vid,
      pl.kind === 'on'
        ? piece(em.get(pl.edge.id) ?? pl.edge, vid, iv)
        : (findEdge(vid, iv) ?? newEdge(vid, iv, cellsBetween(vm.get(vid)!, vm.get(iv)!))),
    );
  }

  // ── Ring blocks along every outline edge that is not passed through, and
  // the edges the shrunk selection now uses instead of the outline.
  const replace = new Map<string, string>(); // outline edge -> its replacement inside
  for (let k = 0; k < N; k++) {
    const e = loopE[k];
    const a = loopV[k];
    const b = loopV[(k + 1) % N];
    const ia = inner.get(a)!;
    const ib = inner.get(b)!;
    if (pass.has(e.id)) {
      replace.set(e.id, piece(e, ia, ib).id);
      continue;
    }
    const inEdge = newEdge(ia, ib, e.nodes);
    replace.set(e.id, inEdge.id);
    out.blocks.push({
      id: uid(),
      edges: [e.id, radial.get(b)!.id, inEdge.id, radial.get(a)!.id] as Block['edges'],
    });
  }

  // ── The selected blocks, moved onto the inner copies.
  const moved = new Map<string, string>(); // interior edge -> copy with moved ends
  const remapEdge = (id: string): string => {
    const r = replace.get(id);
    if (r) return r;
    const e = em.get(id)!;
    const v0 = inner.get(e.v0) ?? e.v0;
    const v1 = inner.get(e.v1) ?? e.v1;
    if (v0 === e.v0 && v1 === e.v1) return id;
    const done = moved.get(id);
    if (done) return done;
    const copy = findEdge(v0, v1) ?? newEdge(v0, v1, e.nodes);
    copy.law = e.law;
    copy.ratio = e.ratio;
    moved.set(id, copy.id);
    return copy.id;
  };
  for (const b of out.blocks) if (sel.has(b.id)) b.edges = b.edges.map(remapEdge) as Block['edges'];

  const res = propagateNodeCounts(cleanBlocking(out));
  for (const b of res.blocks) {
    if (blockCornerIds(res, b).length !== 4) return { error: 'The O-grid did not close up here.' };
    if (Math.abs(areaOf(blockPolygon(res, b))) < size * size * 1e-6)
      return { error: 'The O-grid would make a flat block here.' };
  }
  return res;
}

/** The edge a block outside the selection uses that holds `pt`: the
 *  pass-through edge itself, or the piece of it left by an earlier cut. */
function findPieceHolding(bk: Blocking, pt: Point2D, sel: Set<string>, tol: number): string | null {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const outside = new Set(bk.blocks.filter((b) => !sel.has(b.id)).flatMap((b) => b.edges));
  const candidates = bk.edges.filter((e) => outside.has(e.id));
  let best: string | null = null;
  let bd = tol;
  for (const e of candidates) {
    const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy || 1e-24;
      const u = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / L2;
      if (u <= 1e-6 || u >= 1 - 1e-6) continue;
      const d = Math.hypot(a.x + u * dx - pt.x, a.y + u * dy - pt.y);
      if (d < bd) {
        bd = d;
        best = e.id;
      }
    }
  }
  return best;
}
