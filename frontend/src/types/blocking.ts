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
  /** Edge-id groups forced to share a node count (O-grid rings, C-grid cuts). */
  links?: string[][];
}

export const emptyBlocking = (): Blocking => ({ vertices: [], edges: [], blocks: [], links: [] });

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

const signedArea = (poly: Point2D[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};
const centroidOf = (poly: Point2D[]): Point2D => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});
const boundsOf = (poly: Point2D[]) => {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
const dedupeClose = (poly: Point2D[]): Point2D[] => {
  const out: Point2D[] = [];
  for (const p of poly) if (!out.length || !near(p, out[out.length - 1], 1e-7)) out.push({ x: p.x, y: p.y });
  if (out.length >= 2 && near(out[0], out[out.length - 1], 1e-7)) out.pop();
  return out;
};

/** Resample a closed polygon to `n` points spaced evenly by arc length. */
function resampleClosed(poly: Point2D[], n: number): Point2D[] {
  const P = dedupeClose(poly);
  if (P.length < 3) return P;
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < P.length; i++) {
    const d = Math.hypot(P[(i + 1) % P.length].x - P[i].x, P[(i + 1) % P.length].y - P[i].y);
    seg.push(d);
    total += d;
  }
  if (total < 1e-9) return P;
  const out: Point2D[] = [];
  for (let k = 0; k < n; k++) {
    let target = (k / n) * total;
    let si = 0;
    while (si < seg.length && target > seg[si]) { target -= seg[si]; si += 1; }
    si = Math.min(si, P.length - 1);
    const a = P[si], b = P[(si + 1) % P.length];
    const f = seg[si] ? target / seg[si] : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

/** First intersection of the ray o -> target with polygon poly. */
function rayPolygonHit(o: Point2D, target: Point2D, poly: Point2D[]): Point2D | null {
  const dx = target.x - o.x, dy = target.y - o.y;
  let best: { s: number; pt: Point2D } | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const s = ((a.x - o.x) * ey - (a.y - o.y) * ex) / denom;
    const u = ((a.x - o.x) * dy - (a.y - o.y) * dx) / denom;
    if (s > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
      if (!best || s < best.s) best = { s, pt: { x: o.x + s * dx, y: o.y + s * dy } };
    }
  }
  return best ? best.pt : null;
}

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

/** Point ring for any closed entity (circle sampled, polyline/rect as-is). */
export const entityRing = (entity: CadEntity): Point2D[] => poly(entity);

/** Merge every domain-boundary / geometry outline entity into one ordered ring. */
export function outlineRing(entities: CadEntity[]): Point2D[] {
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
      if (e.layer === 'construction' || e.type === 'circle') continue;
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

// ── O-grid (Phase 2) ───────────────────────────────────────────────────────

/** Closed non-domain geometry entities and the block that currently contains each. */
export function bodiesForOgrid(
  entities: CadEntity[],
  bk: Blocking,
): { index: number; name: string; blockId: string | null; wrapped: boolean }[] {
  const out: { index: number; name: string; blockId: string | null; wrapped: boolean }[] = [];
  entities.forEach((e, index) => {
    if (e.layer === 'construction' || e.role === 'domain_boundary') return;
    const closed = e.isClosed || e.type === 'rectangle' || e.type === 'circle';
    if (!closed) return;
    const ring = resampleClosed(entityRing(e), 72);
    if (ring.length < 8) return;
    const g = centroidOf(ring);
    const span = Math.max(boundsOf(ring).maxX - boundsOf(ring).minX, boundsOf(ring).maxY - boundsOf(ring).minY);
    const host = bk.blocks.find((b) => {
      const poly = blockPolygon(bk, b);
      return poly.length >= 3 && pointInRing(g.x, g.y, poly);
    });
    // wrapped = an edge path already traces this body outline
    const wrapped = bk.edges.some(
      (ed) => ed.path.length > 0 && ed.path.some((pp) => ring.some((rp) => near(pp, rp, span * 0.02 + 1e-6))),
    );
    out.push({ index, name: (e as any).name || `Body ${index + 1}`, blockId: host?.id ?? null, wrapped });
  });
  return out;
}

/**
 * Replace the block containing a body with a 4-block O-grid ring: the body
 * outline is the inner boundary, the block edges are the outer boundary, and
 * four radial cuts join them. If the body is not already inside a single block,
 * the host block is first split at the body's padded bounding box.
 */
export function wrapBodyOgrid(
  bk: Blocking,
  bodyRaw: Point2D[],
  patch?: BoundaryTag,
): Blocking | null {
  let body = resampleClosed(bodyRaw.map((p) => ({ x: p.x, y: p.y })), 72);
  if (body.length < 8) return null;
  if (signedArea(body) < 0) body.reverse();
  const g = centroidOf(body);
  const bb = boundsOf(body);

  let work: Blocking = bk;
  const fullyInside = (b: Block, w: Blocking) => {
    const poly = blockPolygon(w, b);
    return poly.length >= 3 && body.every((p) => pointInRing(p.x, p.y, poly));
  };
  const containing = (w: Blocking) => w.blocks.find((b) => pointInRing(g.x, g.y, blockPolygon(w, b)));
  let host = containing(work);
  if (!host) return null;

  // Carve a SNUG box around the body so the O-ring stays thin and orthogonal and
  // the rest of the domain is a clean Cartesian H-grid. A thick O-ring is what
  // makes the four corner wedge blocks skew badly, so keep the offset small.
  const bw = bb.maxX - bb.minX, bh = bb.maxY - bb.minY;
  const hb0 = boundsOf(blockPolygon(work, host));
  const gapL = bb.minX - hb0.minX, gapR = hb0.maxX - bb.maxX;
  const gapB = bb.minY - hb0.minY, gapT = hb0.maxY - bb.maxY;
  const minGap = Math.min(gapL, gapR, gapB, gapT);
  const hostTooBig = hb0.maxX - hb0.minX > bw * 1.7 || hb0.maxY - hb0.minY > bh * 1.7;
  if (minGap > bw * 0.04 && hostTooBig) {
    // ring reaches ~0.3 * body size out from the wall
    const off = Math.max(bw, bh) * 0.3;
    const padX = Math.max(Math.min(off, gapL * 0.9, gapR * 0.9), bw * 0.05);
    const padY = Math.max(Math.min(off, gapB * 0.9, gapT * 0.9), bh * 0.05);
    for (const [ax, v] of [
      ['x', bb.minX - padX], ['x', bb.maxX + padX],
      ['y', bb.minY - padY], ['y', bb.maxY + padY],
    ] as [('x' | 'y'), number][]) {
      work = splitAllAt(work, ax, v);
    }
    host = containing(work);
  }
  if (!host || !fullyInside(host, work)) return null;

  const norm = (a: number) => { while (a <= -Math.PI) a += 2 * Math.PI; while (a > Math.PI) a -= 2 * Math.PI; return a; };
  const angG = (p: Point2D) => Math.atan2(p.y - g.y, p.x - g.x);

  // Build a ring of `N` blocks around the body. `attach` are the outer vertex ids
  // (in angular order about g); `outerEdge(k)` is the block edge from attach[k] to
  // attach[k+1]. N=8 halves the arc each block spans (less corner skew, seams on
  // the flow axes); we fall back to N=4 if the centre split fails.
  const buildRing = (
    w: Blocking,
    attachIds: string[],
    outerEdge: (k: number) => string | null,
    removeIds: Set<string>,
  ): Blocking | null => {
    const N = attachIds.length;
    const vm = new Map(w.vertices.map((v) => [v.id, v.pt] as const));
    const I = attachIds.map((id) => rayPolygonHit(g, vm.get(id)!, body));
    if (I.some((p) => !p)) return null;
    const IP = I as Point2D[];
    const theta = IP.map(angG);
    const arcs: Point2D[][] = [];
    for (let k = 0; k < N; k++) {
      const gap = norm(theta[(k + 1) % N] - theta[k]);
      const dir = Math.sign(gap) || 1;
      const off = (t: number) => dir * norm(t - theta[k]);
      const mids = body
        .filter((p) => { const o = off(angG(p)); return o > 1e-6 && o < Math.abs(gap) - 1e-6; })
        .sort((p, q) => off(angG(p)) - off(angG(q)));
      arcs.push([IP[k], ...mids, IP[(k + 1) % N]]);
    }
    const verts = w.vertices.map((v) => ({ id: v.id, pt: { ...v.pt } }));
    const innerIds = IP.map((p) => { const id = uid(); verts.push({ id, pt: { ...p } }); return id; });
    const edges = w.edges.map((e) => ({ ...e, path: e.path.map((p) => ({ ...p })) }));
    const radialIds: string[] = [];
    const arcIds: string[] = [];
    for (let k = 0; k < N; k++) {
      // strong wall clustering by default - visibly fine right at the body,
      // coarsening out to the H-grid. Count is kept by applyTargetCellSize.
      const rad: BlockEdge = { id: uid(), v0: innerIds[k], v1: attachIds[k], path: [], nodes: 26, law: 'geometric', ratio: 10 };
      const arc: BlockEdge = {
        id: uid(), v0: innerIds[k], v1: innerIds[(k + 1) % N],
        path: arcs[k].slice(1, -1).map((p) => ({ ...p })),
        patch, nodes: N === 8 ? 18 : 30, law: 'uniform', ratio: 1,
      };
      edges.push(rad, arc);
      radialIds.push(rad.id);
      arcIds.push(arc.id);
    }
    const scratch: Blocking = { vertices: verts, edges, blocks: [], links: w.links };
    const ringBlocks: Block[] = [];
    for (let k = 0; k < N; k++) {
      const outer = outerEdge(k);
      if (!outer) return null;
      const ord = orderBlockEdges(scratch, [outer, radialIds[(k + 1) % N], arcIds[k], radialIds[k]]);
      if (!ord) return null;
      ringBlocks.push({ id: uid(), edges: ord });
    }
    return cleanBlocking({
      vertices: verts,
      edges,
      blocks: [...w.blocks.filter((b) => !removeIds.has(b.id)), ...ringBlocks],
      links: [...(w.links ?? []), [...arcIds], [...radialIds]],
    });
  };

  // ── attempt the 8-cut ring ──
  const gx = (bb.minX + bb.maxX) / 2, gy = (bb.minY + bb.maxY) / 2;
  let split = splitAllAt(splitAllAt(work, 'x', gx), 'y', gy);
  const atCentre = (p: Point2D) => Math.abs(p.x - gx) < 1e-5 && Math.abs(p.y - gy) < 1e-5;
  const svm = new Map(split.vertices.map((v) => [v.id, v.pt] as const));
  const quads = split.blocks.filter((b) => {
    const ids = blockCornerIds(split, b);
    return ids.length === 4 && ids.some((id) => atCentre(svm.get(id)!));
  });
  if (quads.length === 4) {
    const byAngG = (id: string) => angG(svm.get(id)!);
    // outer corners (farthest from g) and the box-edge mids (not at g, not a far corner)
    const farCorners: string[] = [];
    const edgeMids = new Set<string>();
    for (const q of quads) {
      const ids = blockCornerIds(split, q);
      let far = ids[0], fd = -1;
      for (const id of ids) {
        const d = Math.hypot(svm.get(id)!.x - gx, svm.get(id)!.y - gy);
        if (d > fd) { fd = d; far = id; }
      }
      farCorners.push(far);
      for (const id of ids) if (!atCentre(svm.get(id)!) && id !== far) edgeMids.add(id);
    }
    const corners = [...new Set(farCorners)].sort((a, b) => byAngG(a) - byAngG(b));
    const mids = [...edgeMids].sort((a, b) => byAngG(a) - byAngG(b));
    if (corners.length === 4 && mids.length === 4) {
      const attach: string[] = [];
      let ok = true;
      for (let k = 0; k < 4; k++) {
        attach.push(corners[k]);
        const a0 = byAngG(corners[k]);
        let a1 = byAngG(corners[(k + 1) % 4]);
        if (a1 <= a0) a1 += 2 * Math.PI;
        const mid = mids.find((m) => {
          let am = byAngG(m);
          if (am <= a0) am += 2 * Math.PI;
          return am > a0 + 1e-6 && am < a1 - 1e-6;
        });
        if (!mid) { ok = false; break; }
        attach.push(mid);
      }
      if (ok) {
        const findEdge = (a: string, b: string) =>
          split.edges.find((e) => (e.v0 === a && e.v1 === b) || (e.v0 === b && e.v1 === a))?.id ?? null;
        const res = buildRing(
          split,
          attach,
          (k) => findEdge(attach[k], attach[(k + 1) % 8]),
          new Set(quads.map((q) => q.id)),
        );
        if (res) return res;
      }
    }
  }

  // ── fall back to the 4-cut ring on the un-split box ──
  const cornerIds = blockCornerIds(work, host);
  if (cornerIds.length !== 4) return null;
  const hostBlk = host;
  return (
    buildRing(work, cornerIds, (k) => hostBlk.edges[k] ?? null, new Set([hostBlk.id])) ?? null
  );
}

// ── C-grid (Phase 3) ───────────────────────────────────────────────────────

/** Closed non-domain bodies that look airfoil-like (elongated), for a C-grid. */
export function airfoilsForCGrid(
  entities: CadEntity[],
): { index: number; name: string; aspect: number }[] {
  const out: { index: number; name: string; aspect: number }[] = [];
  entities.forEach((e, index) => {
    if (e.layer === 'construction' || e.role === 'domain_boundary') return;
    if (e.type === 'circle') return;
    if (!(e.isClosed || e.type === 'rectangle')) return;
    const ring = resampleClosed(entityRing(e), 64);
    if (ring.length < 8) return;
    const b = boundsOf(ring);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (w < 1e-6 || h < 1e-6) return;
    out.push({ index, name: (e as any).name || `Body ${index + 1}`, aspect: w / h });
  });
  return out;
}

/**
 * True wrap C-grid on a C-shaped far-field (semicircle front + straight wake):
 * an upper and a lower wrap block hugging the airfoil surface out to the
 * semicircle, meeting on a radial forward of the nose, plus a conformal pair of
 * wake blocks. Grid lines curve around the leading edge. 4 blocks.
 */
function cGridWrap(
  A: Point2D[],
  iTE: number,
  dom: Point2D[],
  patch?: BoundaryTag,
): Blocking | null {
  const TE = { ...A[iTE] };
  let iLE = 0;
  A.forEach((p, i) => { if (p.x < A[iLE].x) iLE = i; });
  const LE = { ...A[iLE] };
  const chord = TE.x - LE.x;
  if (chord < 1e-6) return null;

  const walk = (from: number, to: number) => {
    const s: Point2D[] = [{ ...A[from] }];
    let i = from, guard = 0;
    while (i !== to && guard++ < A.length + 2) { i = (i + 1) % A.length; s.push({ ...A[i] }); }
    return s;
  };
  const w1 = walk(iLE, iTE), w2 = walk(iTE, iLE).reverse();
  const meanY = (s: Point2D[]) => s.reduce((a, p) => a + p.y, 0) / s.length;
  const upper = meanY(w1) >= meanY(w2) ? w1 : w2;   // LE -> TE, top
  const lower = upper === w1 ? w2 : w1;             // LE -> TE, bottom
  if (upper.length < 3 || lower.length < 3) return null;

  const R = dom.map((p) => ({ ...p }));
  const db = boundsOf(R);
  const xR = db.maxX;
  const tol = Math.max(1e-6, (xR - db.minX) * 3e-3);

  // The C far-field is an open polyline: two ends at x = xR (the outlet), the
  // rest running around the front. Rotate the ring so it starts at one outlet
  // end and finishes at the other, walking the long way round.
  const endIdx = R.map((p, i) => ({ p, i })).filter((o) => o.p.x >= xR - tol).map((o) => o.i);
  if (endIdx.length < 2) return null;
  const a = endIdx[0], b = endIdx[endIdx.length - 1];
  const arcFwd = (b - a + R.length) % R.length;
  const [s0, s1] = arcFwd >= R.length - arcFwd ? [a, b] : [b, a];  // start on the longer arc
  const outer: Point2D[] = [];
  for (let k = 0; ; k++) {
    const idx = (s0 + k) % R.length;
    outer.push({ ...R[idx] });
    if (idx === s1) break;
    if (k > R.length) return null;
  }
  if (outer.length < 4) return null;
  if (outer[0].y > outer[outer.length - 1].y) outer.reverse();      // outer[0] is the lower end
  const lo0 = { ...outer[0] }, hi0 = { ...outer[outer.length - 1] };

  // front point (leftmost) of the outer C
  let fi = 0;
  outer.forEach((p, i) => { if (p.x < outer[fi].x) fi = i; });
  const oFront = { ...outer[fi] };

  // the tails run roughly horizontal at x >= TE.x; find where each crosses x = TE.x
  const crossY = (a: Point2D, b: Point2D, x: number) => a.y + (b.y - a.y) * (x - a.x) / ((b.x - a.x) || 1e-9);
  let iWB = 0;
  for (let i = 0; i + 1 <= fi; i++) {
    if ((outer[i].x - TE.x) * (outer[i + 1].x - TE.x) <= 0) { iWB = i; break; }
  }
  let iWT = outer.length - 1;
  for (let i = outer.length - 1; i - 1 >= fi; i--) {
    if ((outer[i].x - TE.x) * (outer[i - 1].x - TE.x) <= 0) { iWT = i; break; }
  }
  const WB = { x: TE.x, y: crossY(outer[iWB], outer[iWB + 1], TE.x) };
  const WT = { x: TE.x, y: crossY(outer[iWT], outer[iWT - 1], TE.x) };
  const wakeOut = { x: xR, y: TE.y };
  // lo0 / hi0 are the domain's back corners at x = xR; they double as the
  // outlet corners (the wake lines are horizontal, so hi0.y == WT.y).

  // interior path points for each far-field edge, in that edge's v0 -> v1 order
  const loWrapOuter = outer.slice(iWB + 1, fi).reverse();   // Front -> WB
  const upWrapOuter = outer.slice(fi + 1, iWT);             // Front -> WT
  const loTailMid = outer.slice(1, iWB + 1).reverse();      // WB -> lo0
  const upTailMid = outer.slice(iWT, outer.length - 1);     // WT -> hi0

  const verts: BlockVertex[] = [];
  const vById = new Map<string, string>();
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vById.get(k);
    if (!id) { id = uid(); vById.set(k, id); verts.push({ id, pt: { x: p.x, y: p.y } }); }
    return id;
  };
  const edges: BlockEdge[] = [];
  const mk = (v0: string, v1: string, path: Point2D[], p: BoundaryTag | undefined, nodes: number, law: EdgeLaw = 'uniform', ratio = 1): string => {
    edges.push({ id: uid(), v0, v1, path: path.map((q) => ({ x: q.x, y: q.y })), patch: p, nodes, law, ratio });
    return edges[edges.length - 1].id;
  };
  const vLE = vid(LE), vTE = vid(TE), vFront = vid(oFront), vWB = vid(WB), vWT = vid(WT);
  const vLo0 = vid(lo0), vHi0 = vid(hi0), vWakeOut = vid(wakeOut);

  const AROUND = 60, NORMAL = 26, WAKE = 34;
  const leRad = mk(vLE, vFront, [], undefined, NORMAL, 'geometric', 2.2);   // radial forward of the nose (shared)
  const teRadU = mk(vTE, vWT, [], undefined, NORMAL, 'geometric', 2.2);
  const teRadL = mk(vTE, vWB, [], undefined, NORMAL, 'geometric', 2.2);
  // circumferential edges cluster nodes toward the leading and trailing edges
  const afU = mk(vLE, vTE, upper.slice(1, -1), patch ?? 'wall', AROUND, 'bump', 0.22);
  const afL = mk(vLE, vTE, lower.slice(1, -1), patch ?? 'wall', AROUND, 'bump', 0.22);
  const ocU = mk(vFront, vWT, upWrapOuter, 'farfield', AROUND, 'bump', 0.35);
  const ocL = mk(vFront, vWB, loWrapOuter, 'farfield', AROUND, 'bump', 0.35);
  const wcut = mk(vTE, vWakeOut, [], undefined, WAKE, 'geometric', 3);     // shared wake cut
  const wlU = mk(vWT, vHi0, upTailMid, 'farfield', WAKE, 'geometric', 3);
  const wlL = mk(vWB, vLo0, loTailMid, 'farfield', WAKE, 'geometric', 3);
  const outEU = mk(vWakeOut, vHi0, [], 'outlet', NORMAL, 'geometric', 4);
  const outEL = mk(vWakeOut, vLo0, [], 'outlet', NORMAL, 'geometric', 4);

  const scratch: Blocking = { vertices: verts, edges, blocks: [], links: [] };
  const O = (ids: string[]) => orderBlockEdges(scratch, ids);
  const bUW = O([afU, teRadU, ocU, leRad]);   // upper wrap
  const bLW = O([afL, teRadL, ocL, leRad]);   // lower wrap
  const bWU = O([wcut, outEU, wlU, teRadU]);  // upper wake
  const bWL = O([wcut, outEL, wlL, teRadL]);  // lower wake

  const ok = [bUW, bLW, bWU, bWL];
  if (ok.some((o) => !o)) return null;

  const blocks: Block[] = ok.map((o) => ({ id: uid(), edges: o as Block['edges'] }));
  const links: string[][] = [[afU, afL], [leRad, teRadU, teRadL]];
  return propagateNodeCounts(cleanBlocking({ vertices: verts, edges, blocks, links }));
}

/**
 * Airfoil topology that fills the whole (rectangular) domain: a C-H grid of six
 * blocks. Two wrap blocks hug the upper and lower airfoil surface; a full-height
 * pair fills the region upstream of the leading edge, split by the forward
 * stagnation cut; and a pair fills the wake, split by the wake cut. Every
 * interface is conformal. Replaces any existing blocking.
 *
 * Domain perimeter: left edge -> inlet, right edge -> outlet, top / bottom ->
 * farfield. The airfoil surface takes `patch` (default wall).
 */
export function cGridFromAirfoil(
  airfoilRaw: Point2D[],
  domainRing: Point2D[],
  patch?: BoundaryTag,
): Blocking | null {
  let A = resampleClosed(airfoilRaw.map((p) => ({ x: p.x, y: p.y })), 220);
  if (A.length < 20) return null;
  if (signedArea(A) < 0) A.reverse();

  let iLE = 0, iTE = 0;
  A.forEach((p, i) => { if (p.x < A[iLE].x) iLE = i; if (p.x > A[iTE].x) iTE = i; });
  const LE = { ...A[iLE] }, TE = { ...A[iTE] };
  const chord = TE.x - LE.x;
  if (chord < 1e-6) return null;

  const dom = dedupeClose(domainRing);
  const db = boundsOf(dom);
  const ab = boundsOf(A);
  const eps = chord * 0.02;
  // the airfoil must sit clear of every domain edge with room for a block
  if (!(db.minX < LE.x - eps && db.maxX > TE.x + chord * 0.3
        && db.minY < ab.minY - eps && db.maxY > ab.maxY + eps)) return null;

  const xL = db.minX, xR = db.maxX, yB = db.minY, yT = db.maxY;
  const yF = LE.y;  // forward stagnation cut level
  const yW = TE.y;  // wake cut level

  // A non-rectangular far-field (the C-grid domain shape: semicircle front +
  // straight wake) gets a true wrap C-grid whose grid lines follow the nose.
  const bboxArea = (xR - xL) * (yT - yB);
  const ringArea = Math.abs(signedArea(dom));
  if (bboxArea > 0 && ringArea < 0.95 * bboxArea) {
    const wrap = cGridWrap(A, iTE, dom, patch);
    if (wrap) return wrap;
    // fall through to the rectangular H-C grid if the wrap could not be built
  }
  // put the nose vertical cut ahead of the LE so the over-airfoil blocks start
  // clear of the near-vertical nose (avoids sliver cells at the leading edge)
  const xFront = Math.max(LE.x - Math.max(chord * 0.35, eps * 4), (xL + LE.x) / 2);

  const walk = (from: number, to: number) => {
    const s: Point2D[] = [{ ...A[from] }];
    let i = from, guard = 0;
    while (i !== to && guard++ < A.length + 2) { i = (i + 1) % A.length; s.push({ ...A[i] }); }
    return s;
  };
  const w1 = walk(iLE, iTE);            // LE -> TE one way
  const w2 = walk(iTE, iLE).reverse();  // LE -> TE the other way
  const meanY = (s: Point2D[]) => s.reduce((a, p) => a + p.y, 0) / s.length;
  const upper = meanY(w1) >= meanY(w2) ? w1 : w2;   // LE -> TE, top surface
  const lower = upper === w1 ? w2 : w1;             // LE -> TE, bottom surface
  if (upper.length < 3 || lower.length < 3) return null;

  const verts: BlockVertex[] = [];
  const vById = new Map<string, string>();
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vById.get(k);
    if (!id) { id = uid(); vById.set(k, id); verts.push({ id, pt: { x: p.x, y: p.y } }); }
    return id;
  };
  const edges: BlockEdge[] = [];
  const eKey = new Map<string, string>();
  const straight = (a: Point2D, b: Point2D, p: BoundaryTag | undefined, law: EdgeLaw = 'uniform', ratio = 1): string => {
    const ia = vid(a), ib = vid(b);
    const k = ekey(ia, ib);
    const hit = eKey.get(k);
    if (hit) return hit;
    const e: BlockEdge = { id: uid(), v0: ia, v1: ib, path: [], patch: p, nodes: 40, law, ratio };
    edges.push(e); eKey.set(k, e.id); return e.id;
  };
  const curved = (a: Point2D, b: Point2D, mid: Point2D[], p: BoundaryTag | undefined): string => {
    const e: BlockEdge = { id: uid(), v0: vid(a), v1: vid(b), path: mid.map((q) => ({ x: q.x, y: q.y })), patch: p, nodes: 40, law: 'uniform', ratio: 1 };
    edges.push(e); return e.id;
  };

  // key points
  const FL = { x: xL, y: yF };                 // forward cut meets the left edge
  const Fm = { x: xFront, y: yF };             // forward cut meets the nose cut
  const WR = { x: xR, y: yW };                 // wake cut meets the right edge
  const nF_T = { x: xFront, y: yT }, nF_B = { x: xFront, y: yB };
  const nLE_T = { x: LE.x, y: yT }, nLE_B = { x: LE.x, y: yB };
  const nTE_T = { x: TE.x, y: yT }, nTE_B = { x: TE.x, y: yB };
  const TLc = { x: xL, y: yT }, BLc = { x: xL, y: yB };
  const TRc = { x: xR, y: yT }, BRc = { x: xR, y: yB };

  // shared interior cuts - the mesh is continuous across the stagnation and
  // wake lines (they are grid lines, not boundaries)
  const sc1 = straight(FL, Fm, undefined);                     // stagnation cut, upstream part
  const sc2 = straight(Fm, LE, undefined);                     // stagnation cut, nose part
  const wcut = straight(TE, WR, undefined, 'geometric', 3);    // wake cut (cluster at TE)
  const fvU = straight(Fm, nF_T, undefined);                   // nose vertical, upper
  const fvL = straight(nF_B, Fm, undefined);                   // nose vertical, lower
  const lvU = straight(LE, nLE_T, undefined);                  // LE vertical, upper
  const lvL = straight(nLE_B, LE, undefined);                  // LE vertical, lower
  const tvU = straight(TE, nTE_T, undefined);                  // TE vertical, upper
  const tvL = straight(nTE_B, TE, undefined);                  // TE vertical, lower
  // airfoil surface (wall) - the two halves share LE and TE but different paths
  const afU = curved(LE, TE, upper.slice(1, -1), patch ?? 'wall');
  const afL = curved(LE, TE, lower.slice(1, -1), patch ?? 'wall');

  const scratch: Blocking = { vertices: verts, edges, blocks: [], links: [] };
  const B = (ids: string[]) => orderBlockEdges(scratch, ids);

  const bUF = B([sc1, fvU, straight(TLc, nF_T, 'farfield'), straight(FL, TLc, 'inlet', 'geometric', 3)]);
  const bLF = B([straight(BLc, nF_B, 'farfield'), fvL, sc1, straight(BLc, FL, 'inlet', 'geometric', 3)]);
  const bNU = B([sc2, lvU, straight(nF_T, nLE_T, 'farfield'), fvU]);
  const bNL = B([straight(nF_B, nLE_B, 'farfield'), lvL, sc2, fvL]);
  const bUA = B([afU, tvU, straight(nLE_T, nTE_T, 'farfield'), lvU]);
  const bLA = B([straight(nLE_B, nTE_B, 'farfield'), tvL, afL, lvL]);
  const bUW = B([wcut, straight(WR, TRc, 'outlet', 'geometric', 3), straight(nTE_T, TRc, 'farfield'), tvU]);
  const bLW = B([straight(nTE_B, BRc, 'farfield'), straight(BRc, WR, 'outlet', 'geometric', 3), wcut, tvL]);

  const ord = [bUF, bLF, bNU, bNL, bUA, bLA, bUW, bLW];
  if (ord.some((o) => !o)) return null;

  const blocks: Block[] = ord.map((o) => ({ id: uid(), edges: o as Block['edges'] }));
  // keep the wall-normal counts consistent along and across the airfoil
  const links: string[][] = [[afU, afL], [fvU, lvU, tvU], [fvL, lvL, tvL]];

  return propagateNodeCounts(cleanBlocking({ vertices: verts, edges, blocks, links }));
}

/** Drop orphan edges and vertices; prune stale link groups. */
export function cleanBlocking(bk: Blocking): Blocking {
  const usedEdges = new Set<string>();
  bk.blocks.forEach((b) => b.edges.forEach((e) => usedEdges.add(e)));
  const edges = bk.edges.filter((e) => usedEdges.has(e.id));
  const usedVerts = new Set<string>();
  edges.forEach((e) => { usedVerts.add(e.v0); usedVerts.add(e.v1); });
  const vertices = bk.vertices.filter((v) => usedVerts.has(v.id));
  const links = (bk.links ?? [])
    .map((grp) => grp.filter((id) => usedEdges.has(id)))
    .filter((grp) => grp.length >= 2);
  return { vertices, edges, blocks: bk.blocks, links };
}

/** Enforce opposite-edge equal node counts within each block (propagation). */
export function propagateNodeCounts(bk: Blocking): Blocking {
  const parent = new Map<string, string>();
  bk.edges.forEach((e) => parent.set(e.id, e.id));
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    parent.set(find(a), find(b));
  };
  for (const blk of bk.blocks) {
    union(blk.edges[0], blk.edges[2]);
    union(blk.edges[1], blk.edges[3]);
  }
  for (const grp of bk.links ?? []) for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);
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

/** Arc length of a block edge (through its path points). */
function edgeLength(bk: Blocking, e: BlockEdge): number {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const a = vm.get(e.v0), b = vm.get(e.v1);
  if (!a || !b) return 0;
  const chain = [a, ...e.path, b];
  let L = 0;
  for (let i = 0; i + 1 < chain.length; i++) L += Math.hypot(chain[i + 1].x - chain[i].x, chain[i + 1].y - chain[i].y);
  return L;
}

/** A sensible default target cell size: roughly the domain diagonal over ~90. */
export function autoCellSize(bk: Blocking): number {
  if (!bk.vertices.length) return 1;
  const b = boundsOf(bk.vertices.map((v) => v.pt));
  const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
  return diag > 0 ? diag / 90 : 1;
}

/** The cell size the current node counts imply (median edge length / cells). */
export function currentCellSize(bk: Blocking): number {
  const sizes = bk.edges
    .map((e) => edgeLength(bk, e) / Math.max(1, e.nodes - 1))
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor(sizes.length / 2)] : autoCellSize(bk);
}

/**
 * Size every grid direction from a target cell edge length instead of a fixed
 * node count. A short block edge then gets few nodes and a long one gets many,
 * so the mesh reads as uniform - no dense band where a small block's count was
 * forced onto a narrow neighbour. Per-direction overrides set later still win
 * (this only seeds them).
 */
export function applyTargetCellSize(bk: Blocking, cellSize: number): Blocking {
  if (!(cellSize > 0)) return bk;
  const parent = new Map<string, string>();
  bk.edges.forEach((e) => parent.set(e.id, e.id));
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  const union = (a: string, c: string) => { if (parent.has(a) && parent.has(c)) parent.set(find(a), find(c)); };
  for (const blk of bk.blocks) { union(blk.edges[0], blk.edges[2]); union(blk.edges[1], blk.edges[3]); }
  for (const grp of bk.links ?? []) for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);

  const groupLens = new Map<string, number[]>();
  for (const e of bk.edges) {
    const g = find(e.id);
    const arr = groupLens.get(g) ?? [];
    arr.push(edgeLength(bk, e));
    groupLens.set(g, arr);
  }
  // Groups that carry a wall-clustering law (geometric / bump) are wall-normal -
  // their layer count is deliberate (near-wall resolution / y+), so keep the
  // count already set rather than deriving it from the target cell size.
  const wallNormal = new Set<string>();
  for (const e of bk.edges) if (e.law === 'geometric' || e.law === 'bump') wallNormal.add(find(e.id));

  const groupNodes = new Map<string, number>();
  groupLens.forEach((lens, g) => {
    if (wallNormal.has(g)) return;
    lens.sort((a, b) => a - b);
    const rep = lens[Math.floor(lens.length / 2)] || 0; // median edge length in the group
    groupNodes.set(g, Math.max(4, Math.min(500, Math.round(rep / cellSize) + 1)));
  });

  return propagateNodeCounts({
    ...bk,
    edges: bk.edges.map((e) => ({ ...e, nodes: groupNodes.get(find(e.id)) ?? e.nodes })),
  });
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
