import { Point2D, CadEntity, BoundaryTag } from '../cadWorkflow';
import { Blocking, Block, BlockEdge } from './types';
import { boundsOf, dedupeClose, ekey, entityRing, near, pointInRing, uid } from './geometry';
import { outlineRing } from './autoBlock';
import { blockPolygon } from './blockEdit';
import { propagateNodeCounts } from './sizing';

// Hand editing of a blocking on the canvas: drawing a block from four clicked
// corners, picking edges / blocks under the cursor, and keeping block edges
// glued to the geometry outline while a corner is dragged.

/** A closed outline block edges can run along: the fluid domain or a body. */
export interface Outline {
  pts: Point2D[];
  /** The single closed CadEntity this outline comes from, if there is one. */
  entityId?: string;
  body: boolean;
}

const isClosedEntity = (e: CadEntity) =>
  e.isClosed || e.type === 'rectangle' || e.type === 'circle' || e.type === 'ellipse';

/** The domain outline plus every closed body inside it. */
export function outlinesFor(entities: CadEntity[]): Outline[] {
  const out: Outline[] = [];
  const live = entities.filter((e) => e.layer !== 'construction');
  const hasDomainRole = live.some((e) => e.role === 'domain_boundary');
  const domainPts = dedupeClose(outlineRing(entities));
  // outlineRing takes the first closed candidate when there is one; mirror that
  // so the same entity is not also treated as a body.
  const candidates = live.filter((e) => (hasDomainRole ? e.role === 'domain_boundary' : !e.role));
  const domainEnt = candidates.length === 1 || candidates.some(isClosedEntity) ? candidates.find(isClosedEntity) : undefined;
  if (domainPts.length >= 3) out.push({ pts: domainPts, entityId: domainEnt?.id, body: false });
  for (const e of live) {
    if (e === domainEnt || e.role === 'domain_boundary' || !isClosedEntity(e)) continue;
    const pts = dedupeClose(entityRing(e));
    if (pts.length >= 3) out.push({ pts, entityId: e.id, body: true });
  }
  return out;
}

interface Proj { pt: Point2D; seg: number; t: number; d: number }

export function projectOnRing(ring: Point2D[], p: Point2D): Proj {
  let best: Proj = { pt: ring[0], seg: 0, t: 0, d: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-18)));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.d) best = { pt: q, seg: i, t, d };
  }
  return best;
}

const scaleOf = (pts: Point2D[]) => {
  const b = boundsOf(pts);
  return Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
};

/** Nearest point on any outline within `radius`, or null. */
export function snapToOutline(p: Point2D, outlines: Outline[], radius: number): { pt: Point2D; outline: number } | null {
  let best: { pt: Point2D; outline: number } | null = null;
  let bd = radius;
  outlines.forEach((o, k) => {
    const pr = projectOnRing(o.pts, p);
    if (pr.d < bd) { bd = pr.d; best = { pt: pr.pt, outline: k }; }
  });
  return best;
}

/** Ring vertices strictly between two projected points, walking `dir`. */
function ringArc(ring: Point2D[], a: Proj, b: Proj, dir: 1 | -1): Point2D[] {
  const n = ring.length;
  const out: Point2D[] = [];
  if (a.seg === b.seg && (dir === 1 ? a.t <= b.t : a.t >= b.t)) return out;
  if (dir === 1) {
    for (let i = (a.seg + 1) % n, g = 0; g < n; i = (i + 1) % n, g++) {
      out.push({ ...ring[i] });
      if (i === b.seg) break;
    }
  } else {
    for (let i = a.seg, g = 0; g < n; i = (i - 1 + n) % n, g++) {
      out.push({ ...ring[i] });
      if (i === (b.seg + 1) % n) break;
    }
  }
  return out.filter((q) => !near(q, a.pt, 1e-12) && !near(q, b.pt, 1e-12));
}

const polyLen = (pts: Point2D[]) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
};

/**
 * The outline between two points on it (interior points only), or null if
 * either point is off the outline. With `hint`, takes whichever way round
 * passes closest to it (so an edge keeps running along the side it was on);
 * without one, the shorter way.
 */
export function traceAlong(ring: Point2D[], pa: Point2D, pb: Point2D, hint?: Point2D): Point2D[] | null {
  const tol = scaleOf(ring) * 1e-4;
  const a = projectOnRing(ring, pa), b = projectOnRing(ring, pb);
  if (a.d > tol || b.d > tol) return null;
  const fwd = ringArc(ring, a, b, 1), bwd = ringArc(ring, a, b, -1);
  if (hint) {
    const closest = (arc: Point2D[]) => {
      const chain = [a.pt, ...arc, b.pt];
      let d = Infinity;
      for (let i = 0; i + 1 < chain.length; i++) {
        const s = projectOnRing([chain[i], chain[i + 1]], hint);
        d = Math.min(d, s.d);
      }
      return d;
    };
    return closest(fwd) <= closest(bwd) ? fwd : bwd;
  }
  return polyLen([a.pt, ...fwd, b.pt]) <= polyLen([a.pt, ...bwd, b.pt]) ? fwd : bwd;
}

/** The outline an edge chain lies on (every point within tolerance), if any. */
export function outlineUnder(chain: Point2D[], outlines: Outline[]): number {
  for (let k = 0; k < outlines.length; k++) {
    const tol = scaleOf(outlines[k].pts) * 1e-4;
    // Segment midpoints too: an internal edge can have both ENDS on the outline
    // (a cut from floor to ceiling) without running along it. Such a cut's
    // midpoint is about half a chord off the outline; a chord of a curved
    // edge that straddles an outline vertex only sags by a sliver of its
    // length, so the midpoint tolerance scales with the chord.
    const ring = outlines[k].pts;
    const on = chain.every((p, i) => {
      if (projectOnRing(ring, p).d > tol) return false;
      if (!i) return true;
      const q = chain[i - 1];
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      return projectOnRing(ring, mid).d <= tol + 0.1 * Math.hypot(p.x - q.x, p.y - q.y);
    });
    if (on) return k;
  }
  return -1;
}

/**
 * New interior path for an edge whose endpoints moved from (o0, o1) to (n0, n1).
 * An edge that ran along an outline (or is associated with its entity through
 * `curveId`) and still has both ends on it is re-traced along it, the same
 * way round as before. Anything else keeps its shape: each
 * interior point moves by a blend of the two end displacements.
 */
export function movedEdgePath(
  path: Point2D[], o0: Point2D, o1: Point2D, n0: Point2D, n1: Point2D, outlines: Outline[],
  curveId?: string,
): Point2D[] {
  const chain = [o0, ...path, o1];
  // An edge associated with an outline's entity follows it even where its
  // stored samples cut a corner (a coarse edge across a trailing edge).
  const assoc = curveId ? outlines.findIndex((o) => o.entityId === curveId) : -1;
  const k = assoc >= 0 ? assoc : outlineUnder(chain, outlines);
  if (k >= 0) {
    const mid = chain[Math.floor(chain.length / 2)];
    const hint = path.length ? mid : { x: (o0.x + o1.x) / 2, y: (o0.y + o1.y) / 2 };
    const traced = traceAlong(outlines[k].pts, n0, n1, hint);
    if (traced) return traced;
  }
  if (!path.length) return [];
  const total = polyLen(chain) || 1;
  const d0 = { x: n0.x - o0.x, y: n0.y - o0.y }, d1 = { x: n1.x - o1.x, y: n1.y - o1.y };
  let run = 0;
  return path.map((p, i) => {
    run += Math.hypot(p.x - chain[i].x, p.y - chain[i].y);
    const t = run / total;
    return { x: p.x + (1 - t) * d0.x + t * d1.x, y: p.y + (1 - t) * d0.y + t * d1.y };
  });
}

// ── Picking ─────────────────────────────────────────────────────────────────

const edgeChain = (bk: Blocking, e: BlockEdge): Point2D[] => {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  return [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
};

/** Nearest block edge within `radius` of p, and the nearest point on it. */
export function pickEdge(bk: Blocking, p: Point2D, radius: number): { edgeId: string; pt: Point2D; t: number } | null {
  let best: { edgeId: string; pt: Point2D; t: number } | null = null;
  let bd = radius;
  for (const e of bk.edges) {
    const chain = edgeChain(bk, e);
    const total = polyLen(chain) || 1;
    let run = 0;
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const pr = projectOnRing([a, b], p);
      if (pr.d < bd) {
        bd = pr.d;
        best = { edgeId: e.id, pt: pr.pt, t: (run + pr.t * L) / total };
      }
      run += L;
    }
  }
  return best;
}

/** Id of the block under p, or null. */
export function blockAt(bk: Blocking, p: Point2D): string | null {
  for (const b of bk.blocks) {
    const poly = blockPolygon(bk, b);
    if (poly.length >= 3 && pointInRing(p.x, p.y, poly)) return b.id;
  }
  return null;
}

/** Ids of blocks that cover part of a solid body (they would mesh inside it). */
export function blocksOverBodies(bk: Blocking, outlines: Outline[]): string[] {
  const bodies = outlines.filter((o) => o.body);
  if (!bodies.length) return [];
  return bk.blocks
    .filter((b) => {
      const poly = blockPolygon(bk, b);
      return poly.length >= 3 && bodies.some((o) => polysOverlap(poly, o.pts));
    })
    .map((b) => b.id);
}

// ── Geometry tests ──────────────────────────────────────────────────────────

const cross = (o: Point2D, a: Point2D, b: Point2D) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Segments ab and cd cross at a point interior to both (touching doesn't count). */
function segsCross(a: Point2D, b: Point2D, c: Point2D, d: Point2D, eps: number): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
}

/** Two closed polygons share interior area (not just a boundary). */
function polysOverlap(P: Point2D[], Q: Point2D[]): boolean {
  const s = Math.max(scaleOf(P), scaleOf(Q));
  const eps = s * s * 1e-9;
  for (let i = 0; i < P.length; i++) {
    for (let j = 0; j < Q.length; j++) {
      if (segsCross(P[i], P[(i + 1) % P.length], Q[j], Q[(j + 1) % Q.length], eps)) return true;
    }
  }
  // No crossings: one is inside the other, or they only touch. Test a point
  // strictly inside each (pulled in from a vertex toward the centroid).
  const inner = (R: Point2D[]) => {
    const c = { x: R.reduce((a, p) => a + p.x, 0) / R.length, y: R.reduce((a, p) => a + p.y, 0) / R.length };
    return pointInRing(c.x, c.y, R) ? c : { x: R[0].x + (c.x - R[0].x) * 1e-3, y: R[0].y + (c.y - R[0].y) * 1e-3 };
  };
  const p = inner(P), q = inner(Q);
  return pointInRing(p.x, p.y, Q) || pointInRing(q.x, q.y, P);
}

// ── Drawing a block ─────────────────────────────────────────────────────────

export interface AddBlockOptions {
  outlines: Outline[];
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined;
  /** Target cell size for the node count of any newly created edge. */
  cellSize: number;
}

/**
 * Add one block from four corners (any winding). Corners that sit on an
 * existing block vertex reuse it, sides that match an existing edge reuse it
 * (so the new block is conformal with its neighbours), and a side between two
 * points on the same outline follows the outline. Refuses a self-crossing
 * quad, a block that overlaps another block or a body, or one outside the
 * domain.
 */
export function addBlockFromCorners(
  bk: Blocking, cornersIn: Point2D[], opts: AddBlockOptions,
): { blocking: Blocking } | { error: string } {
  if (cornersIn.length !== 4) return { error: 'A block needs exactly 4 corners.' };
  const all = [...bk.vertices.map((v) => v.pt), ...cornersIn, ...opts.outlines.flatMap((o) => o.pts)];
  const tol = scaleOf(all) * 1e-6;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    if (near(cornersIn[i], cornersIn[j], tol)) return { error: 'Two corners are on the same point.' };
  }
  // counter-clockwise
  let area = 0;
  for (let i = 0; i < 4; i++) area += cornersIn[i].x * cornersIn[(i + 1) % 4].y - cornersIn[(i + 1) % 4].x * cornersIn[i].y;
  const corners = area < 0 ? [cornersIn[0], cornersIn[3], cornersIn[2], cornersIn[1]] : [...cornersIn];
  const eps = scaleOf(corners) ** 2 * 1e-9;
  if (segsCross(corners[0], corners[1], corners[2], corners[3], eps) || segsCross(corners[1], corners[2], corners[3], corners[0], eps)) {
    return { error: 'The block sides cross. Click the corners in order around the block.' };
  }

  // Vertex reuse
  const vertices = bk.vertices.map((v) => ({ id: v.id, pt: { ...v.pt } }));
  const vid = corners.map((c) => {
    const hit = vertices.find((v) => near(v.pt, c, tol));
    if (hit) return hit.id;
    const id = uid();
    vertices.push({ id, pt: { ...c } });
    return id;
  });
  const vpt = new Map(vertices.map((v) => [v.id, v.pt] as const));

  const edges = bk.edges.map((e) => ({ ...e, path: e.path.map((q) => ({ ...q })) }));
  const uses = new Map<string, number>();
  for (const b of bk.blocks) for (const id of b.edges) uses.set(id, (uses.get(id) ?? 0) + 1);

  const sideIds: string[] = [];
  for (let k = 0; k < 4; k++) {
    const ia = vid[k], ib = vid[(k + 1) % 4];
    const existing = edges.find((e) => ekey(e.v0, e.v1) === ekey(ia, ib));
    if (existing) {
      if ((uses.get(existing.id) ?? 0) >= 2) return { error: 'That side is already shared by two blocks.' };
      sideIds.push(existing.id);
      continue;
    }
    const a = vpt.get(ia)!, b = vpt.get(ib)!;
    // Follow an outline both corners sit on, the shorter way round.
    let path: Point2D[] = [];
    let onOutline = -1;
    for (let o = 0; o < opts.outlines.length; o++) {
      const tr = traceAlong(opts.outlines[o].pts, a, b);
      if (tr) {
        // Only if the traced run stays close to the side the user drew; two
        // corners on opposite faces of the same outline are an interior side.
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const chainLen = polyLen([a, ...tr, b]);
        if (chainLen <= Math.hypot(b.x - a.x, b.y - a.y) * 1.6 || tr.length === 0) {
          const ringMid = projectOnRing(opts.outlines[o].pts, mid);
          if (tr.length > 0 || ringMid.d <= scaleOf(opts.outlines[o].pts) * 1e-4) {
            path = tr;
            onOutline = o;
            break;
          }
        }
      }
    }
    const chain = [a, ...path, b];
    const len = polyLen(chain);
    let patch: BoundaryTag | undefined;
    if (onOutline >= 0) {
      const tally = new Map<BoundaryTag, number>();
      for (let i = 0; i + 1 < chain.length; i++) {
        const t = opts.tag(chain[i], chain[i + 1]);
        if (t) tally.set(t, (tally.get(t) ?? 0) + Math.hypot(chain[i + 1].x - chain[i].x, chain[i + 1].y - chain[i].y));
      }
      let bl = 0;
      tally.forEach((l, t) => { if (l > bl) { bl = l; patch = t; } });
    }
    const e: BlockEdge = {
      id: uid(), v0: ia, v1: ib, path, patch,
      nodes: Math.max(2, Math.round(len / Math.max(opts.cellSize, 1e-12)) + 1),
      law: 'uniform', ratio: 1,
      curveId: onOutline >= 0 && path.length ? opts.outlines[onOutline].entityId : undefined,
    };
    edges.push(e);
    sideIds.push(e.id);
  }

  const next: Blocking = {
    vertices, edges,
    blocks: [...bk.blocks.map((b) => ({ id: b.id, edges: [...b.edges] as Block['edges'] })),
      { id: uid(), edges: sideIds as Block['edges'] }],
    links: (bk.links ?? []).map((g) => [...g]),
  };
  const poly = blockPolygon(next, next.blocks[next.blocks.length - 1]);
  if (poly.length < 4) return { error: 'Could not build that block.' };

  for (const o of opts.outlines) {
    if (o.body && polysOverlap(poly, o.pts)) return { error: 'The block covers part of a body. Keep blocks in the fluid.' };
  }
  const domain = opts.outlines.find((o) => !o.body);
  if (domain) {
    const dtol = scaleOf(domain.pts) * 1e-4;
    const outside = poly.some((p) => !pointInRing(p.x, p.y, domain.pts) && projectOnRing(domain.pts, p).d > dtol);
    if (outside) return { error: 'The block reaches outside the domain.' };
  }
  for (const b of bk.blocks) {
    const other = blockPolygon(bk, b);
    if (other.length >= 3 && polysOverlap(poly, other)) return { error: 'The block overlaps an existing block.' };
  }

  // A side now used by two blocks is internal: no patch.
  const count = new Map<string, number>();
  for (const b of next.blocks) for (const id of b.edges) count.set(id, (count.get(id) ?? 0) + 1);
  for (const e of next.edges) if ((count.get(e.id) ?? 0) >= 2) e.patch = undefined;

  return { blocking: propagateNodeCounts(next) };
}
