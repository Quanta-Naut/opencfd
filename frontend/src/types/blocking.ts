import { Point2D, CadEntity, BoundaryTag } from './cadWorkflow';

export type EdgeLaw = 'uniform' | 'geometric' | 'bump';

export interface BlockVertex {
  id: string;
  pt: Point2D;
}

export interface BlockEdge {
  id: string;
  v0: string;
  v1: string;
  /** Interior points the edge passes through (follows the geometry outline). */
  path: Point2D[];
  /** Patch name inherited from the geometry edges this block edge lies on. */
  patch?: BoundaryTag;
  nodes: number;
  law: EdgeLaw;
  /** Growth ratio: last cell / first cell along the edge. 1 = uniform. */
  ratio: number;
}

export interface Block {
  id: string;
  /** Exactly four edge ids, ordered around the block (0-1-2-3, 3 closes to 0). */
  edges: [string, string, string, string];
}

export interface Blocking {
  vertices: BlockVertex[];
  edges: BlockEdge[];
  blocks: Block[];
}

export const emptyBlocking = (): Blocking => ({ vertices: [], edges: [], blocks: [] });

/** Flat per-edge payload the backend meshes. Blocks reference indices into it. */
export interface StructuredMeshRequest {
  edges: {
    p0: [number, number];
    p1: [number, number];
    path: [number, number][];
    nodes: number;
    law: EdgeLaw;
    ratio: number;
    patch?: string;
  }[];
  blocks: [number, number, number, number][];
}

const uid = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const RKEY = (v: number) => Math.round(v * 1e5) / 1e5;
const vkey = (p: Point2D) => `${RKEY(p.x)}:${RKEY(p.y)}`;
const ekey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const near = (a: Point2D, b: Point2D, tol = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
const lerp = (a: Point2D, b: Point2D, t: number): Point2D => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function pointInRing(x: number, y: number, ring: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function poly(entity: CadEntity): Point2D[] {
  if (entity.type === 'circle' && entity.radius != null) {
    const c = entity.pts[0];
    return Array.from({ length: 64 }, (_, i) => ({
      x: c.x + entity.radius! * Math.cos((2 * Math.PI * i) / 64),
      y: c.y + entity.radius! * Math.sin((2 * Math.PI * i) / 64),
    }));
  }
  return entity.pts.map((p) => ({ ...p }));
}

/** Merge every domain-boundary / geometry outline entity into one ordered ring. */
function outlineRing(entities: CadEntity[]): Point2D[] {
  const src = entities.filter((e) => e.layer !== 'construction' && (e.role === 'domain_boundary' || !e.role));
  const domain = src.filter((e) => e.role === 'domain_boundary');
  const use = domain.length ? domain : src;

  // Single closed entity - just use its points.
  const closed = use.find((e) => (e.isClosed || e.type === 'rectangle') && e.pts.length >= 3);
  if (closed) return poly(closed);

  // Stitch loose segments end to end.
  const segs = use.filter((e) => e.pts.length === 2).map((e) => [{ ...e.pts[0] }, { ...e.pts[1] }] as [Point2D, Point2D]);
  if (segs.length < 3) return [];
  const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-4;
  const chain: Point2D[] = [segs[0][0], segs[0][1]];
  const used = new Set([0]);
  while (used.size < segs.length) {
    const tail = chain[chain.length - 1];
    let advanced = false;
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      if (near(segs[i][0], tail)) { chain.push(segs[i][1]); used.add(i); advanced = true; break; }
      if (near(segs[i][1], tail)) { chain.push(segs[i][0]); used.add(i); advanced = true; break; }
    }
    if (!advanced) break;
  }
  if (chain.length >= 4 && near(chain[0], chain[chain.length - 1])) chain.pop();
  return chain;
}

/** Build a "tag at this segment midpoint" lookup from the tagged geometry edges. */
function makeTagLookup(entities: CadEntity[], edgeTagMap: Record<string, BoundaryTag>) {
  const xs: number[] = [], ys: number[] = [];
  for (const e of entities) for (const p of e.pts) { xs.push(p.x); ys.push(p.y); }
  const span = Math.max(
    (Math.max(...xs) || 0) - (Math.min(...xs) || 0),
    (Math.max(...ys) || 0) - (Math.min(...ys) || 0),
    1,
  );
  return (a: Point2D, b: Point2D): BoundaryTag | undefined => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let best: BoundaryTag | undefined;
    let bd = span * 0.06 + 1e-6;
    for (const e of entities) {
      if (e.layer === 'construction') continue;
      const n = e.pts.length;
      const count = e.isClosed || e.type === 'rectangle' ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const p0 = e.pts[i], p1 = e.pts[(i + 1) % n];
        const t = edgeTagMap[`${e.id}_${i}`];
        if (!t) continue;
        // distance from the block-edge midpoint to this geometry segment
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const L2 = dx * dx + dy * dy || 1e-12;
        let u = ((mx - p0.x) * dx + (my - p0.y) * dy) / L2;
        u = Math.max(0, Math.min(1, u));
        const d = Math.hypot(p0.x + u * dx - mx, p0.y + u * dy - my);
        if (d < bd) { bd = d; best = t; }
      }
    }
    return best;
  };
}

/**
 * Multi-block auto-blocking by vertical-strip decomposition.
 *
 * Splits the outline into a lower and an upper chain (both left to right), cuts
 * the domain at every vertex x-coordinate, and makes one block per strip. A ramp
 * comes out as a strip with a slanted floor (still a quad, no corner rounding).
 * Where two flat strips meet at a step in the floor or ceiling, the taller strip
 * is split horizontally so every block stays near-rectangular (backward-facing
 * step -> 3 blocks). Shared edges are de-duplicated so node counts couple across
 * blocks automatically.
 *
 * Falls back to a single 4-sided block when the domain is not x-monotone.
 */
export function autoBlockingFromOutline(
  entities: CadEntity[],
  edgeTagMap: Record<string, BoundaryTag>,
): Blocking | null {
  const ring = outlineRing(entities);
  if (ring.length < 4) return null;
  const tag = makeTagLookup(entities, edgeTagMap);

  const strips = stripDecomposition(ring, tag);
  if (strips) return strips;
  return singleBlockFromOutline(ring, tag);
}

/** Old behaviour: one block, four bounding-box corners, sides follow the outline. */
function singleBlockFromOutline(
  ring: Point2D[],
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
): Blocking | null {
  const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bbox: Point2D[] = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
  ];
  const cornerIdx = bbox.map((c) => {
    let best = 0, bd = Infinity;
    ring.forEach((p, i) => { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < bd) { bd = d; best = i; } });
    return best;
  });
  const uniq = Array.from(new Set(cornerIdx)).sort((a, b) => a - b);
  if (uniq.length !== 4) return null;

  const verts: BlockVertex[] = uniq.map((ri) => ({ id: uid(), pt: { ...ring[ri] } }));
  const edges: BlockEdge[] = [];
  for (let k = 0; k < 4; k++) {
    const a = uniq[k], b = uniq[(k + 1) % 4];
    const path: Point2D[] = [];
    let i = a;
    while (i !== b) { i = (i + 1) % ring.length; if (i !== b) path.push({ ...ring[i] }); }
    const va = verts[k], vb = verts[(k + 1) % 4];
    const counts = new Map<BoundaryTag, number>();
    let prev = va.pt;
    for (const p of [...path, vb.pt]) { const t = tag(prev, p); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); prev = p; }
    let patch: BoundaryTag | undefined; let pc = 0;
    counts.forEach((c, t) => { if (c > pc) { pc = c; patch = t; } });
    edges.push({ id: uid(), v0: va.id, v1: vb.id, path, patch, nodes: 40, law: 'uniform', ratio: 1 });
  }
  return { vertices: verts, edges, blocks: [{ id: uid(), edges: [edges[0].id, edges[1].id, edges[2].id, edges[3].id] }] };
}

function stripDecomposition(
  ringRaw: Point2D[],
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
): Blocking | null {
  // clean: drop repeats and a duplicated closing point
  const R: Point2D[] = [];
  for (const p of ringRaw) if (!R.length || !near(p, R[R.length - 1], 1e-7)) R.push({ x: p.x, y: p.y });
  if (R.length >= 2 && near(R[0], R[R.length - 1], 1e-7)) R.pop();
  const m = R.length;
  if (m < 4) return null;

  // leftmost / rightmost vertices
  let iL = 0, iR = 0;
  for (let i = 1; i < m; i++) {
    if (R[i].x < R[iL].x - 1e-9 || (Math.abs(R[i].x - R[iL].x) < 1e-9 && R[i].y < R[iL].y)) iL = i;
    if (R[i].x > R[iR].x + 1e-9 || (Math.abs(R[i].x - R[iR].x) < 1e-9 && R[i].y > R[iR].y)) iR = i;
  }
  if (Math.abs(R[iL].x - R[iR].x) < 1e-6) return null;

  const walk = (from: number, to: number) => {
    const out: Point2D[] = [R[from]];
    let i = from, guard = 0;
    while (i !== to && guard++ < m + 2) { i = (i + 1) % m; out.push(R[i]); }
    return out;
  };
  const arcA = walk(iL, iR);
  const arcB = walk(iR, iL).reverse();
  const meanY = (a: Point2D[]) => a.reduce((s, p) => s + p.y, 0) / a.length;
  const lower = meanY(arcA) <= meanY(arcB) ? arcA : arcB;
  const upper = lower === arcA ? arcB : arcA;

  const mono = (a: Point2D[]) => a.every((p, i) => i === 0 || p.x >= a[i - 1].x - 1e-6);
  if (!mono(lower) || !mono(upper)) return null;

  const xmap = new Map<number, number>();
  for (const p of [...lower, ...upper]) xmap.set(RKEY(p.x), p.x);
  const X = [...xmap.values()].sort((a, b) => a - b);
  if (X.length < 2) return null;

  const chainYAt = (chain: Point2D[], x: number, dir: 1 | -1): number => {
    const at = chain.map((p, i) => ({ p, i })).filter((o) => Math.abs(o.p.x - x) < 1e-6);
    if (at.length === 1) return at[0].p.y;
    if (at.length > 1) {
      for (const o of at) {
        if (dir === 1 && o.i + 1 < chain.length && chain[o.i + 1].x > x + 1e-6) return o.p.y;
        if (dir === -1 && o.i - 1 >= 0 && chain[o.i - 1].x < x - 1e-6) return o.p.y;
      }
      const ys = at.map((o) => o.p.y);
      return dir === 1 ? Math.min(...ys) : Math.max(...ys);
    }
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1];
      if (a.x - 1e-9 <= x && x <= b.x + 1e-9 && b.x - a.x > 1e-12) {
        const t = (x - a.x) / (b.x - a.x);
        return a.y + t * (b.y - a.y);
      }
    }
    return chain[chain.length - 1].y;
  };

  type Strip = { x0: number; x1: number; b0: number; b1: number; t0: number; t1: number };
  const strips: Strip[] = [];
  for (let i = 0; i + 1 < X.length; i++) {
    const x0 = X[i], x1 = X[i + 1];
    if (x1 - x0 < 1e-7) continue;
    strips.push({
      x0, x1,
      b0: chainYAt(lower, x0, 1), b1: chainYAt(lower, x1, -1),
      t0: chainYAt(upper, x0, 1), t1: chainYAt(upper, x1, -1),
    });
  }
  if (!strips.length) return null;
  const flat = (s: Strip) => Math.abs(s.b0 - s.b1) < 1e-6 && Math.abs(s.t0 - s.t1) < 1e-6;

  // build sub-block corner quads, splitting flat strips at neighbour step levels
  const quads: [Point2D, Point2D, Point2D, Point2D][] = [];
  strips.forEach((s, i) => {
    if (flat(s)) {
      const lo = s.b0, hi = s.t0;
      const levels = new Set<number>();
      const add = (y: number) => { if (y > lo + 1e-6 && y < hi - 1e-6) levels.add(RKEY(y)); };
      const L = strips[i - 1], Rn = strips[i + 1];
      if (L && flat(L)) { add(L.b0); add(L.t0); }
      if (Rn && flat(Rn)) { add(Rn.b0); add(Rn.t0); }
      const ys = [lo, ...[...levels].sort((a, b) => a - b), hi];
      for (let k = 0; k + 1 < ys.length; k++) {
        quads.push([
          { x: s.x0, y: ys[k] }, { x: s.x1, y: ys[k] },
          { x: s.x1, y: ys[k + 1] }, { x: s.x0, y: ys[k + 1] },
        ]);
      }
    } else {
      // ramp / non-flat strip: one trapezoid, floor and ceiling follow the outline
      quads.push([
        { x: s.x0, y: s.b0 }, { x: s.x1, y: s.b1 },
        { x: s.x1, y: s.t1 }, { x: s.x0, y: s.t0 },
      ]);
    }
  });

  return blockingFromQuads(quads, tag);
}

/** Assemble a Blocking from a list of corner quads (BL, BR, TR, TL), de-duping shared edges. */
function blockingFromQuads(
  quads: [Point2D, Point2D, Point2D, Point2D][],
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
): Blocking | null {
  const vByKey = new Map<string, string>();
  const vertices: BlockVertex[] = [];
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vByKey.get(k);
    if (!id) { id = uid(); vByKey.set(k, id); vertices.push({ id, pt: { x: p.x, y: p.y } }); }
    return id;
  };
  const eByKey = new Map<string, BlockEdge>();
  const edges: BlockEdge[] = [];
  const refs = new Map<string, number>();
  const edgeBetween = (a: Point2D, b: Point2D): BlockEdge => {
    const ia = vid(a), ib = vid(b);
    const k = ekey(ia, ib);
    let e = eByKey.get(k);
    if (!e) {
      e = { id: uid(), v0: ia, v1: ib, path: [], patch: tag(a, b), nodes: 40, law: 'uniform', ratio: 1 };
      eByKey.set(k, e);
      edges.push(e);
    }
    return e;
  };

  const blocks: Block[] = [];
  for (const [bl, br, tr, tl] of quads) {
    if (near(bl, br) || near(bl, tl)) continue; // degenerate
    const eb = edgeBetween(bl, br);
    const er = edgeBetween(br, tr);
    const et = edgeBetween(tl, tr);
    const el = edgeBetween(bl, tl);
    for (const e of [eb, er, et, el]) refs.set(e.id, (refs.get(e.id) ?? 0) + 1);
    blocks.push({ id: uid(), edges: [eb.id, er.id, et.id, el.id] });
  }
  if (!blocks.length) return null;
  // an edge shared by two blocks is interior: it carries no patch
  for (const e of edges) if ((refs.get(e.id) ?? 0) >= 2) e.patch = undefined;

  return { vertices, edges, blocks };
}

// ── block editing ──────────────────────────────────────────────────────────

const edgeMap = (bk: Blocking) => new Map(bk.edges.map((e) => [e.id, e] as const));

/** Reorder 4 edge ids into a walkable loop (edge k+1 continues from edge k's far end). */
function orderBlockEdges(bk: Blocking, ids: string[]): Block['edges'] | null {
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
function splitAllAt(bk: Blocking, axis: 'x' | 'y', value: number): Blocking {
  const out: Blocking = {
    vertices: bk.vertices.map((v) => ({ id: v.id, pt: { ...v.pt } })),
    edges: bk.edges.map((e) => ({ ...e, path: e.path.map((p) => ({ ...p })) })),
    blocks: bk.blocks.map((b) => ({ id: b.id, edges: [...b.edges] as Block['edges'] })),
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
  const splitCache = new Map<string, [string, string]>();
  const splitEdge = (edgeId: string, p: Point2D): [string, string] => {
    const cached = splitCache.get(edgeId);
    if (cached) return cached;
    const e = out.edges.find((x) => x.id === edgeId)!;
    const mid = vid(p);
    const e0: BlockEdge = { id: uid(), v0: e.v0, v1: mid, path: [], patch: e.patch, nodes: e.nodes, law: e.law, ratio: e.ratio };
    const e1: BlockEdge = { id: uid(), v0: mid, v1: e.v1, path: [], patch: e.patch, nodes: e.nodes, law: e.law, ratio: e.ratio };
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
      const a = vm.get(e.v0)!, b = vm.get(e.v1)!;
      const va = axis === 'x' ? a.x : a.y, vb = axis === 'x' ? b.x : b.y;
      return Math.min(va, vb) < value - 1e-6 && Math.max(va, vb) > value + 1e-6;
    };
    const crossIdx = [0, 1, 2, 3].filter((k) => crosses(be[k]));
    if (crossIdx.length !== 2) { newBlocks.push(blk); continue; }
    const [k0, k1] = crossIdx; // opposite edges (should be 0&2 or 1&3)

    const cutPoint = (eId: string): Point2D => {
      const e = out.edges.find((x) => x.id === eId)!;
      const a = vm.get(e.v0)!, b = vm.get(e.v1)!;
      const va = axis === 'x' ? a.x : a.y, vb = axis === 'x' ? b.x : b.y;
      const t = (value - va) / (vb - va || 1e-12);
      return lerp(a, b, t);
    };
    const p0 = cutPoint(be[k0]);
    const p1 = cutPoint(be[k1]);
    const [a0, b0] = splitEdge(be[k0], p0); // a0 touches edge.v0
    const [a1, b1] = splitEdge(be[k1], p1);
    removedEdges.add(be[k0]);
    removedEdges.add(be[k1]);
    const mid0 = vid(p0), mid1 = vid(p1);
    const internal: BlockEdge = { id: uid(), v0: mid0, v1: mid1, path: [], nodes: 40, law: 'uniform', ratio: 1 };
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

/** Drop orphan edges and vertices. */
export function cleanBlocking(bk: Blocking): Blocking {
  const usedEdges = new Set<string>();
  bk.blocks.forEach((b) => b.edges.forEach((e) => usedEdges.add(e)));
  const edges = bk.edges.filter((e) => usedEdges.has(e.id));
  const usedVerts = new Set<string>();
  edges.forEach((e) => { usedVerts.add(e.v0); usedVerts.add(e.v1); });
  const vertices = bk.vertices.filter((v) => usedVerts.has(v.id));
  return { vertices, edges, blocks: bk.blocks };
}

/** Enforce opposite-edge equal node counts within each block (propagation). */
export function propagateNodeCounts(bk: Blocking): Blocking {
  const parent = new Map<string, string>();
  bk.edges.forEach((e) => parent.set(e.id, e.id));
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (const blk of bk.blocks) {
    union(blk.edges[0], blk.edges[2]);
    union(blk.edges[1], blk.edges[3]);
  }
  // Per group, take the max node count that was set - but never fewer than the
  // node count a polyline side needs (one cell per segment, so path.length + 2).
  const groupNodes = new Map<string, number>();
  for (const e of bk.edges) {
    const g = find(e.id);
    const floor = e.path.length + 2;
    groupNodes.set(g, Math.max(groupNodes.get(g) ?? 0, e.nodes, floor));
  }
  return {
    ...bk,
    edges: bk.edges.map((e) => ({ ...e, nodes: groupNodes.get(find(e.id)) ?? e.nodes })),
  };
}

export function toStructuredRequest(bk: Blocking): StructuredMeshRequest {
  const vmap = new Map(bk.vertices.map((v) => [v.id, v.pt]));
  const emap = new Map(bk.edges.map((e, i) => [e.id, i]));
  return {
    edges: bk.edges.map((e) => {
      const a = vmap.get(e.v0)!;
      const b = vmap.get(e.v1)!;
      return {
        p0: [a.x, a.y] as [number, number],
        p1: [b.x, b.y] as [number, number],
        path: e.path.map((p) => [p.x, p.y] as [number, number]),
        nodes: Math.max(2, Math.round(e.nodes)),
        law: e.law,
        ratio: e.ratio,
        patch: e.patch,
      };
    }),
    blocks: bk.blocks.map((blk) => blk.edges.map((id) => emap.get(id)!) as [number, number, number, number]),
  };
}
