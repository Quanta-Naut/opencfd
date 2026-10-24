import { Point2D } from '../cadWorkflow';
import { Blocking, Block, BlockEdge } from './types';
import { ekey, lerp, uid, vkey } from './geometry';
import { cleanBlocking } from './sizing';

const edgeMap = (bk: Blocking) => new Map(bk.edges.map((e) => [e.id, e] as const));

/** Reorder 4 edge ids into a walkable loop (edge k+1 continues from edge k's far end). */
export function orderBlockEdges(bk: Blocking, ids: string[]): Block['edges'] | null {
  const em = edgeMap(bk);
  const E = ids.map((id) => em.get(id));
  if (E.length !== 4 || E.some((e) => !e)) return null;
  const edges = E as BlockEdge[];
  for (const startAtV0 of [false, true]) {
    const out: BlockEdge[] = [edges[0]];
    const used = new Set([edges[0].id]);
    const startVert = startAtV0 ? edges[0].v1 : edges[0].v0; // where the loop must return to
    let cur = startAtV0 ? edges[0].v0 : edges[0].v1;         // far end we walk from
    let broke = false;
    for (let step = 0; step < 3; step++) {
      const nxt = edges.find((e) => !used.has(e.id) && (e.v0 === cur || e.v1 === cur));
      if (!nxt) { broke = true; break; }
      used.add(nxt.id);
      cur = nxt.v0 === cur ? nxt.v1 : nxt.v0;
      out.push(nxt);
    }
    if (!broke && cur === startVert) return [out[0].id, out[1].id, out[2].id, out[3].id];
  }
  return null;
}

/** The four corner vertex ids of a block, in [BL, BR, TR, TL]-style loop order. */
export function blockCornerIds(bk: Blocking, blk: Block): string[] {
  const em = edgeMap(bk);
  const es = blk.edges.map((id) => em.get(id)!).filter(Boolean);
  if (es.length !== 4) return [];
  const shared = (a: BlockEdge, b: BlockEdge) =>
    [a.v0, a.v1].find((v) => v === b.v0 || v === b.v1) ?? a.v1;
  const j = [shared(es[0], es[1]), shared(es[1], es[2]), shared(es[2], es[3]), shared(es[3], es[0])];
  return [j[3], j[0], j[1], j[2]];
}

/** Ordered boundary polygon of a block (corners + any edge path points). */
export function blockPolygon(bk: Blocking, blk: Block): Point2D[] {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const em = edgeMap(bk);
  const corners = blockCornerIds(bk, blk);
  if (corners.length !== 4) return [];
  const out: Point2D[] = [];
  for (let k = 0; k < 4; k++) {
    const a = corners[k], b = corners[(k + 1) % 4];
    const pa = vm.get(a); if (pa) out.push(pa);
    const e = em.get(blk.edges[k]);
    if (e && e.path.length) {
      const fwd = e.v0 === a;
      const pts = fwd ? e.path : [...e.path].reverse();
      out.push(...pts);
    }
  }
  return out;
}

function blockBBox(bk: Blocking, blk: Block) {
  const pts = blockPolygon(bk, blk);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Split every block the line x = X (axis 'x') or y = Y (axis 'y') passes through. */
export function splitAllAt(bk: Blocking, axis: 'x' | 'y', value: number): Blocking {
  const out: Blocking = {
    vertices: bk.vertices.map((v) => ({ ...v, pt: { ...v.pt } })),
    edges: bk.edges.map((e) => ({ ...e, path: e.path.map((p) => ({ ...p })) })),
    blocks: bk.blocks.map((b) => ({ id: b.id, edges: [...b.edges] as Block['edges'] })),
    links: (bk.links ?? []).map((g) => [...g]),
  };
  const vm = new Map(out.vertices.map((v) => [v.id, v.pt] as const));

  const targets = out.blocks.filter((b) => {
    const bb = blockBBox(out, b);
    return axis === 'x'
      ? value > bb.minX + 1e-6 && value < bb.maxX - 1e-6
      : value > bb.minY + 1e-6 && value < bb.maxY - 1e-6;
  });
  if (!targets.length) return bk;

  // vertex helper on the working copy
  const vByKey = new Map(out.vertices.map((v) => [vkey(v.pt), v.id] as const));
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vByKey.get(k);
    if (!id) { id = uid(); vByKey.set(k, id); out.vertices.push({ id, pt: { ...p } }); vm.set(id, { ...p }); }
    return id;
  };

  // split one edge at point p -> [half touching e.v0, half touching e.v1]; idempotent by key
  // Where the cut line crosses an edge, following its real path (a curved or
  // bent edge must not be cut on the straight chord between its endpoints, or
  // the cut lands off the geometry and the curve is lost), plus the path
  // points on either side of that crossing.
  const coord = (p: Point2D) => (axis === 'x' ? p.x : p.y);
  const cutAlong = (eId: string): { p: Point2D; before: Point2D[]; after: Point2D[] } | null => {
    const e = out.edges.find((x) => x.id === eId)!;
    const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
    for (let i = 0; i + 1 < pts.length; i++) {
      const va = coord(pts[i]), vb = coord(pts[i + 1]);
      if (Math.min(va, vb) < value - 1e-6 && Math.max(va, vb) > value + 1e-6) {
        return {
          p: lerp(pts[i], pts[i + 1], (value - va) / (vb - va)),
          before: pts.slice(1, i + 1).map((q) => ({ ...q })),
          after: pts.slice(i + 1, -1).map((q) => ({ ...q })),
        };
      }
    }
    return null;
  };

  const splitCache = new Map<string, [string, string]>();
  const splitEdge = (edgeId: string, p: Point2D): [string, string] => {
    const cached = splitCache.get(edgeId);
    if (cached) return cached;
    const e = out.edges.find((x) => x.id === edgeId)!;
    const mid = vid(p);
    const cut = cutAlong(edgeId);
    const keep = { patch: e.patch, nodes: e.nodes, law: e.law, ratio: e.ratio, curveId: e.curveId, curves: e.curves };
    // Each half keeps the end spacing of the end it still has.
    const e0: BlockEdge = { id: uid(), v0: e.v0, v1: mid, path: cut?.before ?? [], ...keep, ...(e.spacing1 ? { spacing1: e.spacing1 } : {}) };
    const e1: BlockEdge = { id: uid(), v0: mid, v1: e.v1, path: cut?.after ?? [], ...keep, ...(e.spacing2 ? { spacing2: e.spacing2 } : {}) };
    out.edges.push(e0, e1);
    const res: [string, string] = [e0.id, e1.id];
    splitCache.set(edgeId, res);
    return res;
  };

  const removedBlocks = new Set<string>();
  const removedEdges = new Set<string>();
  const newBlocks: Block[] = [];

  for (const blk of targets) {
    const corners = blockCornerIds(out, blk).map((id) => ({ id, pt: vm.get(id)! }));
    if (corners.length !== 4) continue;
    // edges of the block, k-th edge connects corner k -> corner k+1
    const be = blk.edges;
    // the two edges the cut crosses (their endpoints straddle `value` in `axis`)
    const crosses = (eId: string) => {
      const e = out.edges.find((x) => x.id === eId)!;
      const va = coord(vm.get(e.v0)!), vb = coord(vm.get(e.v1)!);
      return Math.min(va, vb) < value - 1e-6 && Math.max(va, vb) > value + 1e-6 && cutAlong(eId) !== null;
    };
    const crossIdx = [0, 1, 2, 3].filter((k) => crosses(be[k]));
    if (crossIdx.length !== 2) { newBlocks.push(blk); continue; }
    const [k0, k1] = crossIdx; // opposite edges (should be 0&2 or 1&3)

    const cutPoint = (eId: string): Point2D => cutAlong(eId)!.p;
    const p0 = cutPoint(be[k0]);
    const p1 = cutPoint(be[k1]);
    const [a0, b0] = splitEdge(be[k0], p0); // a0 touches edge.v0
    const [a1, b1] = splitEdge(be[k1], p1);
    removedEdges.add(be[k0]);
    removedEdges.add(be[k1]);
    const mid0 = vid(p0), mid1 = vid(p1);
    const internal: BlockEdge = { id: uid(), v0: mid0, v1: mid1, path: [], nodes: 2, law: 'uniform', ratio: 1 };
    // reuse an existing internal edge with the same endpoints if a sibling made one
    const existing = out.edges.find((e) => ekey(e.v0, e.v1) === ekey(mid0, mid1) && !removedEdges.has(e.id));
    const internalId = existing ? existing.id : (out.edges.push(internal), internal.id);

    // Which half of each crossed edge belongs to which side of the cut?
    // side "low" keeps values < value. Determine by the non-crossed neighbour edges.
    const eK0 = out.edges.find((x) => x.id === be[k0])!;
    const startLow = (axis === 'x' ? vm.get(eK0.v0)!.x : vm.get(eK0.v0)!.y) < value;
    const k0low = startLow ? a0 : b0;
    const k0high = startLow ? b0 : a0;
    const eK1 = out.edges.find((x) => x.id === be[k1])!;
    const start1Low = (axis === 'x' ? vm.get(eK1.v0)!.x : vm.get(eK1.v0)!.y) < value;
    const k1low = start1Low ? a1 : b1;
    const k1high = start1Low ? b1 : a1;

    // the other two block edges (not crossed) - one is on the low side, one high
    const others = [0, 1, 2, 3].filter((k) => k !== k0 && k !== k1).map((k) => be[k]);
    const sideOf = (eId: string) => {
      const e = out.edges.find((x) => x.id === eId)!;
      const a = vm.get(e.v0)!, b = vm.get(e.v1)!;
      const mv = axis === 'x' ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
      return mv < value ? 'low' : 'high';
    };
    const lowOther = others.find((e) => sideOf(e) === 'low')!;
    const highOther = others.find((e) => sideOf(e) === 'high')!;

    const lowOrder = orderBlockEdges(out, [k0low, k1low, internalId, lowOther]);
    const highOrder = orderBlockEdges(out, [k0high, k1high, internalId, highOther]);
    if (!lowOrder || !highOrder) { newBlocks.push(blk); continue; }
    newBlocks.push({ id: uid(), edges: lowOrder });
    newBlocks.push({ id: uid(), edges: highOrder });
    removedBlocks.add(blk.id);
  }

  out.blocks = [
    ...out.blocks.filter((b) => !removedBlocks.has(b.id) && !targets.includes(b)),
    ...newBlocks,
  ];
  return cleanBlocking(out);
}

/** Halve a block with a straight cut across its mid-x ('x') or mid-y ('y'). */
export function splitBlock(bk: Blocking, blockId: string, axis: 'x' | 'y'): Blocking {
  const blk = bk.blocks.find((b) => b.id === blockId);
  if (!blk) return bk;
  const bb = blockBBox(bk, blk);
  return axis === 'x'
    ? splitAllAt(bk, 'x', (bb.minX + bb.maxX) / 2)
    : splitAllAt(bk, 'y', (bb.minY + bb.maxY) / 2);
}

/** Remove a block; drop any edge / vertex nothing else uses. */
export function deleteBlock(bk: Blocking, blockId: string): Blocking {
  return cleanBlocking({ ...bk, blocks: bk.blocks.filter((b) => b.id !== blockId) });
}

/**
 * Split the block across edge `edgeId` at point `p` (on that edge), and keep
 * going: the cut lands on the block's opposite edge at the matching arc-length
 * fraction, which then splits the block beyond it, and so on until the cut
 * reaches an edge only one block uses (the domain boundary, or a hole whose
 * block was removed). Only that one sheet of blocks is split, unlike
 * `splitAllAt`, whose straight line cuts every block it passes on its way
 * across the domain. `skip` is the block (or blocks) on the starting edge's
 * other side that the caller is about to replace, so the sheet runs away from it.
 * Returns null if a block on the way is not a clean quad.
 */
export function splitSheet(
  bk: Blocking,
  edgeId: string,
  p: Point2D,
  skip?: string | Set<string>,
): Blocking | null {
  const skipped = (id: string) => (typeof skip === 'string' ? id === skip : !!skip?.has(id));
  const out: Blocking = {
    vertices: bk.vertices.map((v) => ({ ...v, pt: { ...v.pt } })),
    edges: bk.edges.map((e) => ({ ...e, path: e.path.map((q) => ({ ...q })) })),
    blocks: bk.blocks.map((b) => ({ id: b.id, edges: [...b.edges] as Block['edges'] })),
    links: (bk.links ?? []).map((g) => [...g]),
  };
  const vm = new Map(out.vertices.map((v) => [v.id, v.pt] as const));
  const em = new Map(out.edges.map((e) => [e.id, e] as const));
  const vByKey = new Map(out.vertices.map((v) => [vkey(v.pt), v.id] as const));
  const vid = (q: Point2D): string => {
    const k = vkey(q);
    let id = vByKey.get(k);
    if (!id) { id = uid(); vByKey.set(k, id); out.vertices.push({ id, pt: { ...q } }); vm.set(id, { ...q }); }
    return id;
  };
  const polyOf = (e: BlockEdge) => [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
  const cum = (pts: Point2D[]) => {
    const c = [0];
    for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return c;
  };
  // Arc-length fraction (from v0) of the point on edge e closest to q.
  const fracOf = (e: BlockEdge, q: Point2D): number => {
    const pts = polyOf(e), c = cum(pts);
    let best = 0, bd = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-24;
      const u = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2));
      const d = Math.hypot(a.x + u * dx - q.x, a.y + u * dy - q.y);
      if (d < bd) { bd = d; best = c[i] + u * (c[i + 1] - c[i]); }
    }
    return best / (c[c.length - 1] || 1);
  };
  // Split edge e at fraction t (from v0): halves touching v0 and v1.
  const halves = new Map<string, { h0: string; h1: string; mid: string }>();
  const splitAt = (e: BlockEdge, t: number) => {
    const done = halves.get(e.id);
    if (done) return done;
    const pts = polyOf(e), c = cum(pts), d = t * c[c.length - 1];
    let i = 0;
    while (i + 2 < pts.length && c[i + 1] < d) i++;
    const m = lerp(pts[i], pts[i + 1], (d - c[i]) / (c[i + 1] - c[i] || 1));
    const mid = vid(m);
    // A split point on an associated edge is associated to the same curves.
    if (e.curves?.length) {
      const mv = out.vertices.find((v) => v.id === mid);
      if (mv && !mv.curves) mv.curves = [...e.curves];
    }
    const keep = { patch: e.patch, law: e.law, ratio: e.ratio, curveId: e.curveId, curves: e.curves };
    const h0: BlockEdge = {
      id: uid(), v0: e.v0, v1: mid, nodes: Math.max(2, Math.round(e.nodes * t)),
      path: pts.slice(1, i + 1).filter((q) => Math.hypot(q.x - m.x, q.y - m.y) > 1e-9).map((q) => ({ ...q })), ...keep,
      ...(e.spacing1 ? { spacing1: e.spacing1 } : {}),
    };
    const h1: BlockEdge = {
      id: uid(), v0: mid, v1: e.v1, nodes: Math.max(2, Math.round(e.nodes * (1 - t))),
      path: pts.slice(i + 1, -1).filter((q) => Math.hypot(q.x - m.x, q.y - m.y) > 1e-9).map((q) => ({ ...q })), ...keep,
      ...(e.spacing2 ? { spacing2: e.spacing2 } : {}),
    };
    out.edges.push(h0, h1);
    em.set(h0.id, h0); em.set(h1.id, h1);
    const res = { h0: h0.id, h1: h1.id, mid };
    halves.set(e.id, res);
    return res;
  };

  const start = em.get(edgeId);
  if (!start) return null;
  const t0 = fracOf(start, p);
  if (t0 <= 1e-6 || t0 >= 1 - 1e-6) return null;
  // Walk away from the starting edge through every block on it (both sides,
  // unless one is skipped), each walk ending at the boundary.
  const firsts = out.blocks.filter((b) => !skipped(b.id) && b.edges.includes(start.id)).map((b) => b.id);
  splitAt(start, t0);
  for (const firstId of firsts) {
    let cur: BlockEdge = start, t = t0, blkId: string | undefined = firstId;
    for (let guard = 0; guard < 1000 && blkId; guard++) {
      const eCur = cur;
      const sp = splitAt(eCur, t);
      const blk = out.blocks.find((b) => b.id === blkId);
      if (!blk) break;
      const c = blockCornerIds(out, blk);
      if (c.length !== 4) return null;
      const k = blk.edges.indexOf(eCur.id);
      if (k < 0) return null;
      const ck = c[k], ck3 = c[(k + 3) % 4];
      const tFromCk = eCur.v0 === ck ? t : 1 - t;
      const opp = em.get(blk.edges[(k + 2) % 4])!;
      // matching fraction on the opposite edge, measured from ck3 (which faces ck)
      const tOpp = opp.v0 === ck3 ? tFromCk : 1 - tFromCk;
      const spO = splitAt(opp, tOpp);
      const kA = eCur.v0 === ck ? sp.h0 : sp.h1, kB = kA === sp.h0 ? sp.h1 : sp.h0;
      const oA = opp.v0 === ck3 ? spO.h0 : spO.h1, oB = oA === spO.h0 ? spO.h1 : spO.h0;
      const internal: BlockEdge = { id: uid(), v0: sp.mid, v1: spO.mid, path: [], nodes: 2, law: 'uniform', ratio: 1 };
      out.edges.push(internal);
      em.set(internal.id, internal);
      const side1 = orderBlockEdges(out, [kA, internal.id, oA, blk.edges[(k + 3) % 4]]);
      const side2 = orderBlockEdges(out, [kB, blk.edges[(k + 1) % 4], oB, internal.id]);
      if (!side1 || !side2) return null;
      out.blocks = out.blocks.filter((b) => b.id !== blk.id);
      out.blocks.push({ id: uid(), edges: side1 }, { id: uid(), edges: side2 });
      cur = opp;
      t = tOpp;
      blkId = out.blocks.find((b) => !skipped(b.id) && b.edges.includes(opp.id))?.id;
    }
  }
  // A split edge stays only if a block still uses it: the skipped block keeps
  // the original starting edge until the caller replaces it.
  const used = new Set(out.blocks.flatMap((b) => b.edges));
  out.edges = out.edges.filter((e) => !halves.has(e.id) || used.has(e.id));
  return cleanBlocking(out);
}
