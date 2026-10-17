import { Point2D, CadEntity, BoundaryTag } from '../cadWorkflow';
import { Blocking, Block, BlockEdge, BlockVertex } from './types';
import { boundsOf, ekey, entityRing, near, pointInRing, uid } from './geometry';
import { blockCornerIds, blockPolygon } from './blockEdit';
import { cleanBlocking, propagateNodeCounts } from './sizing';
import { Outline } from './editor';

// ICEM CFD Hexa style blocking operations (2D planar): initialize one block
// around the geometry, associate block edges / vertices to geometry curves,
// snap-project vertices, merge vertices, merge blocks, O-grid a block, and
// check the blocking. The canvas tools and the Manual blocking panel call these.

// ── Geometry curves ─────────────────────────────────────────────────────────

/** A curve as a polyline: an entity's points (arcs and circles sampled). */
export interface Curve {
  pts: Point2D[];
  closed: boolean;
}

export function curveOf(e: CadEntity): Curve | null {
  if (e.type === 'circle' || e.type === 'ellipse') return { pts: entityRing(e), closed: true };
  if (e.type === 'arc' && e.pts.length >= 3) {
    const c = e.pts[0];
    const r = Math.hypot(e.pts[1].x - c.x, e.pts[1].y - c.y);
    const sa = e.startAngle ?? Math.atan2(e.pts[1].y - c.y, e.pts[1].x - c.x);
    let ea = e.endAngle ?? Math.atan2(e.pts[2].y - c.y, e.pts[2].x - c.x);
    while (ea <= sa) ea += Math.PI * 2;
    const n = Math.max(8, Math.ceil(((ea - sa) / (Math.PI * 2)) * 64));
    return {
      pts: Array.from({ length: n + 1 }, (_, i) => {
        const a = sa + ((ea - sa) * i) / n;
        return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
      }),
      closed: false,
    };
  }
  if (e.pts.length < 2) return null;
  const closed = !!e.isClosed || e.type === 'rectangle';
  return { pts: e.pts.map((p) => ({ ...p })), closed: closed && e.pts.length >= 3 };
}

/** Several entities joined end to end into one curve (ICEM treats an edge
 *  associated to several curves as their union). */
export function curveChain(ids: string[], entities: CadEntity[]): Curve | null {
  const curves = ids
    .map((id) => entities.find((e) => e.id === id))
    .filter((e): e is CadEntity => !!e)
    .map(curveOf)
    .filter((c): c is Curve => !!c);
  if (!curves.length) return null;
  if (curves.length === 1) return curves[0];
  const closedOne = curves.find((c) => c.closed);
  if (closedOne) return closedOne;
  const scale = Math.max(
    ...curves.map((c) => {
      const b = boundsOf(c.pts);
      return Math.max(b.maxX - b.minX, b.maxY - b.minY);
    }),
    1e-9,
  );
  const tol = scale * 1e-4;
  const pool = curves.map((c) => c.pts);
  let chain = pool.shift()!;
  for (let guard = 0; pool.length && guard < 1000; guard++) {
    const head = chain[0],
      tail = chain[chain.length - 1];
    const k = pool.findIndex(
      (p) =>
        near(p[0], tail, tol) ||
        near(p[p.length - 1], tail, tol) ||
        near(p[0], head, tol) ||
        near(p[p.length - 1], head, tol),
    );
    if (k < 0) break; // disjoint pieces: keep what joins up
    const p = pool.splice(k, 1)[0];
    if (near(p[0], tail, tol)) chain = [...chain, ...p.slice(1)];
    else if (near(p[p.length - 1], tail, tol)) chain = [...chain, ...[...p].reverse().slice(1)];
    else if (near(p[p.length - 1], head, tol)) chain = [...p.slice(0, -1), ...chain];
    else chain = [...[...p].reverse().slice(0, -1), ...chain];
  }
  const closed = chain.length > 3 && near(chain[0], chain[chain.length - 1], tol);
  return { pts: closed ? chain.slice(0, -1) : chain, closed };
}

interface CurveProj {
  pt: Point2D;
  s: number;
  d: number;
}

const segCount = (c: Curve) => (c.closed ? c.pts.length : c.pts.length - 1);

/** Nearest point on the curve; `s` = segment index + fraction along it. */
export function projectOnCurve(c: Curve, p: Point2D): CurveProj {
  let best: CurveProj = { pt: c.pts[0], s: 0, d: Infinity };
  const n = c.pts.length;
  for (let i = 0; i < segCount(c); i++) {
    const a = c.pts[i],
      b = c.pts[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-18)),
    );
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.d) best = { pt: q, s: i + t, d };
  }
  return best;
}

/** Curve vertices strictly between parameters sa and sb, walking forward
 *  (dir 1) or backward (dir -1); an open curve only has the direct way. */
function between(c: Curve, sa: number, sb: number, dir: 1 | -1): Point2D[] {
  const n = c.pts.length;
  const out: Point2D[] = [];
  if (!c.closed) {
    const lo = Math.min(sa, sb),
      hi = Math.max(sa, sb);
    for (let i = Math.floor(lo) + 1; i <= Math.ceil(hi) - 1 && i < n; i++)
      if (i > lo + 1e-9 && i < hi - 1e-9) out.push({ ...c.pts[i] });
    return sa <= sb ? out : out.reverse();
  }
  const L = n;
  const norm = (s: number) => ((s % L) + L) % L;
  let a = norm(sa),
    b = norm(sb);
  if (dir === -1) {
    const r = between(c, b, a, 1);
    return r.reverse();
  }
  if (b < a) b += L;
  for (let i = Math.floor(a) + 1; i < b - 1e-9; i++) out.push({ ...c.pts[i % L] });
  return out;
}

const chainLen = (pts: Point2D[]) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++)
    L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
};

/** Interior path of an edge from p0 to p1 along the curve. On a closed curve
 *  the way round passing closest to `hint` wins (else the shorter way). */
export function pathAlongCurve(c: Curve, p0: Point2D, p1: Point2D, hint?: Point2D): Point2D[] {
  const a = projectOnCurve(c, p0),
    b = projectOnCurve(c, p1);
  const fwd = between(c, a.s, b.s, 1);
  if (!c.closed) return fwd;
  const bwd = between(c, a.s, b.s, -1);
  const pick = (arc: Point2D[]) => {
    const pts = [a.pt, ...arc, b.pt];
    if (!hint) return chainLen(pts);
    let d = Infinity;
    for (let i = 0; i + 1 < pts.length; i++)
      d = Math.min(d, projectOnCurve({ pts: [pts[i], pts[i + 1]], closed: false }, hint).d);
    return d;
  };
  return pick(fwd) <= pick(bwd) ? fwd : bwd;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const clone = (bk: Blocking): Blocking => ({
  vertices: bk.vertices.map((v) => ({
    ...v,
    pt: { ...v.pt },
    curves: v.curves ? [...v.curves] : undefined,
  })),
  edges: bk.edges.map((e) => ({
    ...e,
    path: e.path.map((q) => ({ ...q })),
    curves: e.curves ? [...e.curves] : undefined,
  })),
  blocks: bk.blocks.map((b) => ({ id: b.id, edges: [...b.edges] as Block['edges'] })),
  links: (bk.links ?? []).map((g) => [...g]),
});

const scaleOfBk = (bk: Blocking) => {
  if (!bk.vertices.length) return 1;
  const b = boundsOf(bk.vertices.map((v) => v.pt));
  return Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
};

/** Block corners and edges in counter-clockwise loop order. */
function loopOf(bk: Blocking, blk: Block): { c: string[]; e: string[] } | null {
  const c = blockCornerIds(bk, blk);
  if (c.length !== 4) return null;
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  let area = 0;
  const poly = blockPolygon(bk, blk);
  for (let i = 0; i < poly.length; i++)
    area += poly[i].x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * poly[i].y;
  void vm;
  if (area >= 0) return { c, e: [...blk.edges] };
  // reversed: corner k starts edge k, so walk backwards
  return {
    c: [c[1], c[0], c[3], c[2]],
    e: [blk.edges[0], blk.edges[3], blk.edges[2], blk.edges[1]],
  };
}

/** Full point chain of an edge starting from vertex `from`. */
function chainFrom(bk: Blocking, e: BlockEdge, from: string): Point2D[] {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
  return e.v0 === from ? pts : pts.reverse();
}

// ── Initialize ──────────────────────────────────────────────────────────────

/** ICEM "Initialize Blocks, 2D Planar": one block enclosing all the geometry. */
export function initializeBlocking(entities: CadEntity[], cellSize?: number): Blocking | null {
  const pts = entities
    .filter((e) => e.layer !== 'construction')
    .flatMap((e) => curveOf(e)?.pts ?? []);
  if (pts.length < 2) return null;
  const b = boundsOf(pts);
  if (b.maxX - b.minX < 1e-9 || b.maxY - b.minY < 1e-9) return null;
  const size = cellSize ?? Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 90;
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ];
  const vertices: BlockVertex[] = corners.map((pt) => ({ id: uid(), pt }));
  const edges: BlockEdge[] = [0, 1, 2, 3].map((k) => {
    const a = corners[k],
      c = corners[(k + 1) % 4];
    return {
      id: uid(),
      v0: vertices[k].id,
      v1: vertices[(k + 1) % 4].id,
      path: [],
      nodes: Math.max(4, Math.round(Math.hypot(c.x - a.x, c.y - a.y) / size) + 1),
      law: 'uniform',
      ratio: 1,
    };
  });
  return propagateNodeCounts({
    vertices,
    edges,
    blocks: [{ id: uid(), edges: edges.map((e) => e.id) as Block['edges'] }],
    links: [],
  });
}

// ── Association ─────────────────────────────────────────────────────────────

/** Recompute the path of every edge that carries an explicit association. */
function reprojectAssociated(bk: Blocking, entities: CadEntity[], only?: Set<string>): void {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  for (const e of bk.edges) {
    if (!e.curves?.length || (only && !only.has(e.id))) continue;
    const c = curveChain(e.curves, entities);
    if (!c) continue;
    const p0 = vm.get(e.v0)!,
      p1 = vm.get(e.v1)!;
    const hint = e.path.length ? e.path[Math.floor(e.path.length / 2)] : undefined;
    e.path = pathAlongCurve(c, p0, p1, hint);
  }
}

/**
 * ICEM "Associate Edge to Curve": the edges follow the chosen curves. Their
 * vertices are projected onto the curves (ICEM's "project vertices" option)
 * unless already on them, and remember the association so a later drag slides
 * along the curve. A boundary edge takes the patch of the geometry it now lies on.
 */
export function associateEdges(
  bk: Blocking,
  edgeIds: string[],
  curveIds: string[],
  entities: CadEntity[],
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
  /** Patch for the curves themselves when the segment lookup finds none
   *  (circles and ellipses carry no per-segment tags). */
  curvePatch?: (curveIds: string[]) => BoundaryTag | undefined,
): Blocking | { error: string } {
  const c = curveChain(curveIds, entities);
  if (!c) return { error: 'Pick a geometry curve to associate to.' };
  const out = clone(bk);
  const ids = new Set(edgeIds);
  const tol = scaleOfBk(out) * 1e-6;
  const uses = new Map<string, number>();
  for (const b of out.blocks) for (const id of b.edges) uses.set(id, (uses.get(id) ?? 0) + 1);
  for (const e of out.edges) {
    if (!ids.has(e.id)) continue;
    e.curves = [...curveIds];
    e.curveId = undefined;
    for (const vid of [e.v0, e.v1]) {
      const v = out.vertices.find((x) => x.id === vid)!;
      const pr = projectOnCurve(c, v.pt);
      if (pr.d > tol) v.pt = pr.pt;
      v.curves = [...new Set([...(v.curves ?? []), ...curveIds])];
    }
  }
  // Vertices moved: every edge touching one follows (associated ones re-project).
  reprojectAssociated(out, entities);
  const vm = new Map(out.vertices.map((v) => [v.id, v.pt] as const));
  for (const e of out.edges) {
    if (!ids.has(e.id) || (uses.get(e.id) ?? 0) >= 2) continue;
    const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
    const tally = new Map<BoundaryTag, number>();
    for (let i = 0; i + 1 < pts.length; i++) {
      const t = tag(pts[i], pts[i + 1]);
      if (t)
        tally.set(
          t,
          (tally.get(t) ?? 0) + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y),
        );
    }
    let best: BoundaryTag | undefined,
      bl = 0;
    tally.forEach((l, t) => {
      if (l > bl) {
        bl = l;
        best = t;
      }
    });
    const patch = best ?? curvePatch?.(curveIds);
    if (patch) e.patch = patch;
  }
  return propagateNodeCounts(out);
}

/** Remove the explicit association from edges (they go straight again). */
export function disassociateEdges(bk: Blocking, edgeIds: string[]): Blocking {
  const out = clone(bk);
  const ids = new Set(edgeIds);
  for (const e of out.edges)
    if (ids.has(e.id)) {
      e.curves = undefined;
      e.curveId = undefined;
      e.path = [];
    }
  // A vertex keeps only curves that some still-associated edge of it uses.
  for (const v of out.vertices) {
    const keep = new Set(
      out.edges
        .filter((e) => (e.v0 === v.id || e.v1 === v.id) && e.curves)
        .flatMap((e) => e.curves!),
    );
    v.curves = keep.size ? [...keep] : undefined;
  }
  return out;
}

/** ICEM "Snap Project Vertices": every associated vertex onto its curve, then
 *  every associated edge re-projected. */
export function snapProjectVertices(bk: Blocking, entities: CadEntity[]): Blocking {
  const out = clone(bk);
  for (const v of out.vertices) {
    if (!v.curves?.length) continue;
    let best: CurveProj | null = null;
    for (const id of v.curves) {
      const c = curveChain([id], entities);
      if (!c) continue;
      const pr = projectOnCurve(c, v.pt);
      if (!best || pr.d < best.d) best = pr;
    }
    if (best) v.pt = best.pt;
  }
  reprojectAssociated(out, entities);
  return out;
}

/** Where a dragged associated vertex may go: the nearest point on its curves. */
export function constrainToCurves(
  p: Point2D,
  curves: string[] | undefined,
  entities: CadEntity[],
): Point2D | null {
  if (!curves?.length) return null;
  let best: CurveProj | null = null;
  for (const id of curves) {
    const c = curveChain([id], entities);
    if (!c) continue;
    const pr = projectOnCurve(c, p);
    if (!best || pr.d < best.d) best = pr;
  }
  return best ? best.pt : null;
}

/** Path of an explicitly associated edge after its ends moved. */
export function associatedEdgePath(
  e: BlockEdge,
  p0: Point2D,
  p1: Point2D,
  entities: CadEntity[],
): Point2D[] | null {
  if (!e.curves?.length) return null;
  const c = curveChain(e.curves, entities);
  if (!c) return null;
  const hint = e.path.length ? e.path[Math.floor(e.path.length / 2)] : undefined;
  return pathAlongCurve(c, p0, p1, hint);
}

// ── Merge vertices ──────────────────────────────────────────────────────────

/** ICEM "Merge Vertices": `dropId` is replaced by `keepId` everywhere. */
export function mergeVertices(
  bk: Blocking,
  keepId: string,
  dropId: string,
): Blocking | { error: string } {
  if (keepId === dropId) return { error: 'Pick two different vertices.' };
  const out = clone(bk);
  const keep = out.vertices.find((v) => v.id === keepId);
  if (!keep) return { error: 'Vertex not found.' };
  for (const e of out.edges) {
    if (e.v0 === dropId) e.v0 = keepId;
    if (e.v1 === dropId) e.v1 = keepId;
  }
  if (out.edges.some((e) => e.v0 === e.v1 && out.blocks.some((b) => b.edges.includes(e.id)))) {
    return { error: 'Those two vertices share an edge; merging them would collapse a block.' };
  }
  // Two edges now joining the same pair of vertices become one.
  const byKey = new Map<string, string>();
  const remap = new Map<string, string>();
  for (const e of out.edges) {
    const k = ekey(e.v0, e.v1);
    const first = byKey.get(k);
    if (first) remap.set(e.id, first);
    else byKey.set(k, e.id);
  }
  out.blocks = out.blocks.map((b) => ({
    id: b.id,
    edges: b.edges.map((id) => remap.get(id) ?? id) as Block['edges'],
  }));
  out.edges = out.edges.filter((e) => !remap.has(e.id));
  for (const b of out.blocks) {
    if (new Set(b.edges).size !== 4 || blockCornerIds(out, b).length !== 4)
      return { error: 'Merging those vertices would break a block.' };
  }
  const drop = bk.vertices.find((v) => v.id === dropId);
  if (drop?.curves) keep.curves = [...new Set([...(keep.curves ?? []), ...drop.curves])];
  // A merged pair of edges is shared by two blocks: internal, so no patch.
  const uses = new Map<string, number>();
  for (const b of out.blocks) for (const id of b.edges) uses.set(id, (uses.get(id) ?? 0) + 1);
  for (const e of out.edges) if ((uses.get(e.id) ?? 0) >= 2) e.patch = undefined;
  return propagateNodeCounts(cleanBlocking(out));
}

// ── Merge blocks ────────────────────────────────────────────────────────────

/** ICEM "Merge Blocks": two blocks sharing one full edge become one block. */
export function mergeBlocks(bk: Blocking, idA: string, idB: string): Blocking | { error: string } {
  if (idA === idB) return { error: 'Pick two different blocks.' };
  const A = bk.blocks.find((b) => b.id === idA),
    B = bk.blocks.find((b) => b.id === idB);
  if (!A || !B) return { error: 'Block not found.' };
  const la = loopOf(bk, A),
    lb = loopOf(bk, B);
  if (!la || !lb) return { error: 'Only clean 4-sided blocks can be merged.' };
  const shared = la.e.filter((id) => lb.e.includes(id));
  if (shared.length !== 1) return { error: 'The two blocks must share exactly one side.' };
  const i = la.e.indexOf(shared[0]),
    j = lb.e.indexOf(shared[0]);
  const m = (k: number) => ((k % 4) + 4) % 4;
  const s0 = la.c[i],
    s1 = la.c[m(i + 1)]; // shared edge runs s0 -> s1 in A
  // No third block may touch the shared edge's vertices (it would be left with a hanging node).
  for (const b of bk.blocks) {
    if (b.id === idA || b.id === idB) continue;
    const c = blockCornerIds(bk, b);
    if (c.includes(s0) || c.includes(s1))
      return { error: 'Another block meets that side; merging would leave a hanging vertex.' };
  }
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  // Refuse a merge that would silently drop a boundary-condition tag (e.g. one
  // side is `inlet`, the spliced side is `wall`) instead of merging into an
  // unpatched interior edge with no link back to why the BC disappeared.
  const patchClash = (aId: string, bId: string): boolean => {
    const pa = em.get(aId)?.patch,
      pb = em.get(bId)?.patch;
    return !!pa && !!pb && pa !== pb;
  };
  if (patchClash(la.e[m(i - 1)], lb.e[m(j + 1)]) || patchClash(lb.e[m(j - 1)], la.e[m(i + 1)])) {
    return {
      error: 'Those sides carry different boundary patches; merging would silently drop one.',
    };
  }
  const out = clone(bk);
  const join = (first: string, firstFrom: string, second: string, via: string): BlockEdge => {
    const e1 = em.get(first)!,
      e2 = em.get(second)!;
    const p1 = chainFrom(bk, e1, firstFrom);
    const p2 = chainFrom(bk, e2, via);
    const end = e2.v0 === via ? e2.v1 : e2.v0;
    return {
      id: uid(),
      v0: firstFrom,
      v1: end,
      path: [...p1.slice(1), ...p2.slice(1, -1)],
      nodes: e1.nodes + e2.nodes - 1,
      law: 'uniform',
      ratio: 1,
      patch: e1.patch === e2.patch ? e1.patch : undefined,
      curves: e1.curves && e2.curves ? [...new Set([...e1.curves, ...e2.curves])] : undefined,
      curveId: e1.curveId && e1.curveId === e2.curveId ? e1.curveId : undefined,
    };
  };
  // A: corners la.c, edge k runs c[k] -> c[k+1]. B is CCW too, so it runs the shared edge s1 -> s0.
  const M1 = join(la.e[m(i - 1)], la.c[m(i - 1)], lb.e[m(j + 1)], s0); // ... -> s0 -> ...
  const M2 = join(lb.e[m(j - 1)], lb.c[m(j - 1)], la.e[m(i + 1)], s1); // ... -> s1 -> ...
  out.edges = out.edges.filter(
    (e) =>
      ![shared[0], la.e[m(i - 1)], lb.e[m(j + 1)], lb.e[m(j - 1)], la.e[m(i + 1)]].includes(e.id),
  );
  out.edges.push(M1, M2);
  out.blocks = out.blocks.filter((b) => b.id !== idA && b.id !== idB);
  out.blocks.push({
    id: uid(),
    edges: [la.e[m(i + 2)], M1.id, lb.e[m(j + 2)], M2.id] as Block['edges'],
  });
  const merged = out.blocks[out.blocks.length - 1];
  if (blockCornerIds(out, merged).length !== 4)
    return { error: 'Those blocks do not form a 4-sided block together.' };
  return propagateNodeCounts(cleanBlocking(out));
}

// ── O-grid ──────────────────────────────────────────────────────────────────

/**
 * ICEM "Split Block > O-grid Block" for one block: an inner block (the block
 * shrunk toward its centre by `scale`) plus four ring blocks joining it to the
 * original sides. The original sides are kept, so neighbours stay conformal.
 * Delete the inner block and associate its edges to a body to wrap that body.
 */
export function ogridBlock(
  bk: Blocking,
  blockId: string,
  scale = 0.5,
  cellSize?: number,
): Blocking | { error: string } {
  const blk = bk.blocks.find((b) => b.id === blockId);
  if (!blk) return { error: 'Block not found.' };
  const lp = loopOf(bk, blk);
  if (!lp) return { error: 'Only a clean 4-sided block can be O-gridded.' };
  const s = Math.max(0.05, Math.min(0.95, scale));
  const out = clone(bk);
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const poly = blockPolygon(bk, blk);
  const ctr = {
    x: poly.reduce((a, p) => a + p.x, 0) / poly.length,
    y: poly.reduce((a, p) => a + p.y, 0) / poly.length,
  };
  if (!pointInRing(ctr.x, ctr.y, poly))
    return { error: 'The block is too bent to O-grid (its centre is outside it).' };
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const size = cellSize ?? scaleOfBk(bk) / 90;
  const inner = lp.c.map((cid) => {
    const p = vm.get(cid)!;
    const v: BlockVertex = {
      id: uid(),
      pt: { x: ctr.x + s * (p.x - ctr.x), y: ctr.y + s * (p.y - ctr.y) },
    };
    out.vertices.push(v);
    return v;
  });
  const radial = lp.c.map((cid, k) => {
    const p = vm.get(cid)!;
    const q = inner[k].pt;
    const e: BlockEdge = {
      id: uid(),
      v0: cid,
      v1: inner[k].id,
      path: [],
      law: 'uniform',
      ratio: 1,
      nodes: Math.max(4, Math.round(Math.hypot(q.x - p.x, q.y - p.y) / size) + 1),
    };
    out.edges.push(e);
    return e;
  });
  const innerEdges = [0, 1, 2, 3].map((k) => {
    const e: BlockEdge = {
      id: uid(),
      v0: inner[k].id,
      v1: inner[(k + 1) % 4].id,
      path: [],
      law: 'uniform',
      ratio: 1,
      nodes: em.get(lp.e[k])!.nodes,
    };
    out.edges.push(e);
    return e;
  });
  out.blocks = out.blocks.filter((b) => b.id !== blockId);
  for (let k = 0; k < 4; k++) {
    out.blocks.push({
      id: uid(),
      edges: [lp.e[k], radial[(k + 1) % 4].id, innerEdges[k].id, radial[k].id] as Block['edges'],
    });
  }
  out.blocks.push({ id: uid(), edges: innerEdges.map((e) => e.id) as Block['edges'] });
  return propagateNodeCounts(out);
}

// ── Check ───────────────────────────────────────────────────────────────────

export interface BlockingCheck {
  /** Blocks reaching outside the fluid domain (ICEM would put them in VORFN). */
  outside: string[];
  /** Boundary edges (used by one block) with no patch: associate them. */
  unpatched: string[];
}

export function checkBlocking(bk: Blocking, outlines: Outline[]): BlockingCheck {
  const domain = outlines.find((o) => !o.body);
  const outside: string[] = [];
  if (domain) {
    const b = boundsOf(domain.pts);
    const tol = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 1e-4;
    const onRing = (p: Point2D) => {
      for (let i = 0; i < domain.pts.length; i++) {
        const a = domain.pts[i],
          c = domain.pts[(i + 1) % domain.pts.length];
        const dx = c.x - a.x,
          dy = c.y - a.y;
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-18)),
        );
        if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= tol) return true;
      }
      return false;
    };
    for (const blk of bk.blocks) {
      const poly = blockPolygon(bk, blk);
      // probe the corners, edge midpoints and the centre
      const probes = [
        ...poly,
        ...poly.map((p, i) => ({
          x: (p.x + poly[(i + 1) % poly.length].x) / 2,
          y: (p.y + poly[(i + 1) % poly.length].y) / 2,
        })),
      ];
      probes.push({
        x: poly.reduce((a, p) => a + p.x, 0) / poly.length,
        y: poly.reduce((a, p) => a + p.y, 0) / poly.length,
      });
      if (probes.some((p) => !pointInRing(p.x, p.y, domain.pts) && !onRing(p)))
        outside.push(blk.id);
    }
  }
  const uses = new Map<string, number>();
  for (const b of bk.blocks) for (const id of b.edges) uses.set(id, (uses.get(id) ?? 0) + 1);
  const unpatched = bk.edges
    .filter((e) => (uses.get(e.id) ?? 0) === 1 && !e.patch)
    .map((e) => e.id);
  return { outside, unpatched };
}

// ── Edge parameters ─────────────────────────────────────────────────────────

/** Every edge that must carry the same node count as `edgeId` (opposite
 *  sides, chained through neighbouring blocks, plus explicit links). */
export function edgeGroup(bk: Blocking, edgeId: string): string[] {
  const parent = new Map<string, string>();
  bk.edges.forEach((e) => parent.set(e.id, e.id));
  const find = (x: string): string =>
    parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!);
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };
  for (const blk of bk.blocks) {
    union(blk.edges[0], blk.edges[2]);
    union(blk.edges[1], blk.edges[3]);
  }
  for (const grp of bk.links ?? []) for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);
  const g = find(edgeId);
  return bk.edges.filter((e) => find(e.id) === g).map((e) => e.id);
}

/**
 * ICEM "Pre-Mesh Params > Edge Params". Node count always applies to the whole
 * group (a structured grid needs it). Spacing law and ratio apply to this edge,
 * or with `copyParallel` to the whole group, flipping the ratio on edges that
 * run the other way so the fine end stays on the same side.
 */
export function setEdgeParams(
  bk: Blocking,
  edgeId: string,
  p: { nodes?: number; law?: BlockEdge['law']; ratio?: number; copyParallel?: boolean },
): Blocking {
  const out = clone(bk);
  const group = new Set(edgeGroup(out, edgeId));
  const vm = new Map(out.vertices.map((v) => [v.id, v.pt] as const));
  const src = out.edges.find((e) => e.id === edgeId);
  if (!src) return bk;
  const dir = (e: BlockEdge) => {
    const a = vm.get(e.v0)!,
      b = vm.get(e.v1)!;
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const sd = dir(src);
  for (const e of out.edges) {
    if (!group.has(e.id)) continue;
    if (p.nodes !== undefined) e.nodes = Math.max(2, Math.round(p.nodes));
    if (e.id === edgeId || p.copyParallel) {
      if (p.law !== undefined) e.law = p.law;
      if (p.ratio !== undefined && p.ratio > 0) {
        const d = dir(e);
        const same = e.id === edgeId || d.x * sd.x + d.y * sd.y >= 0;
        e.ratio = same ? p.ratio : 1 / p.ratio;
      }
    }
  }
  return out;
}
