import { Point2D } from '../cadWorkflow';
import { Blocking, BlockEdge, ShapePoint } from './types';

// The shape of a block edge that is not on the geometry (ICEM "Split Edge"
// spline points and "Link Edge Shape"). Both are kept in the edge's own frame
// (fraction along the chord, offset across it in chord lengths), so when a
// vertex moves the bend moves, stretches and turns with the edge. The edge's
// `path` is rebuilt from them by refreshShapes after every change.

type Vm = Map<string, Point2D>;

const vmOf = (bk: Blocking): Vm => new Map(bk.vertices.map((v) => [v.id, v.pt] as const));

/** Edge frame point -> world. */
export function fromFrame(a: Point2D, b: Point2D, q: ShapePoint): Point2D {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  return { x: a.x + q.s * dx - q.n * dy, y: a.y + q.s * dy + q.n * dx };
}

/** World -> edge frame (s along a->b, n to its left, both in chord lengths). */
export function toFrame(a: Point2D, b: Point2D, p: Point2D): ShapePoint {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1e-30;
  const qx = p.x - a.x,
    qy = p.y - a.y;
  return { s: (qx * dx + qy * dy) / L2, n: (dx * qy - dy * qx) / L2 };
}

/** Interior points of a centripetal Catmull-Rom spline through `pts`. */
export function splineThrough(pts: Point2D[], perSpan = 12): Point2D[] {
  if (pts.length < 3) return [];
  const ext = [
    { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y },
    ...pts,
    {
      x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x,
      y: 2 * pts[pts.length - 1].y - pts[pts.length - 2].y,
    },
  ];
  const out: Point2D[] = [];
  const knot = (p: Point2D, q: Point2D) => Math.sqrt(Math.hypot(q.x - p.x, q.y - p.y)) || 1e-9;
  for (let i = 1; i + 2 < ext.length; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const t1 = knot(p0, p1),
      t2 = t1 + knot(p1, p2),
      t3 = t2 + knot(p2, p3);
    for (let k = i === 1 ? 1 : 0; k < perSpan; k++) {
      const t = t1 + ((t2 - t1) * k) / perSpan;
      const lerp = (p: Point2D, q: Point2D, ta: number, tb: number) => {
        const w = tb - ta || 1e-9;
        return {
          x: ((tb - t) / w) * p.x + ((t - ta) / w) * q.x,
          y: ((tb - t) / w) * p.y + ((t - ta) / w) * q.y,
        };
      };
      const a1 = lerp(p0, p1, 0, t1),
        a2 = lerp(p1, p2, t1, t2),
        a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, 0, t2),
        b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  // Span 1 skips k = 0 (pts[0]); no span reaches its far end, so the last
  // point is left out too.
  return out;
}

/** Shape points of an edge in world coordinates. */
export function shapePointsWorld(bk: Blocking, e: BlockEdge, vm: Vm = vmOf(bk)): Point2D[] {
  if (!e.shape?.length) return [];
  const a = vm.get(e.v0)!,
    b = vm.get(e.v1)!;
  return e.shape.map((q) => fromFrame(a, b, q));
}

const chainOf = (e: BlockEdge, vm: Vm) => [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];

/** Path of an edge linked to `src`: the source's bend, in this edge's frame,
 *  scaled by the link factor. The two run the same way round. */
function linkedPath(e: BlockEdge, src: BlockEdge, vm: Vm, factor: number): Point2D[] {
  let chain = chainOf(src, vm);
  const a = vm.get(e.v0)!,
    b = vm.get(e.v1)!;
  const ds = {
    x: chain[chain.length - 1].x - chain[0].x,
    y: chain[chain.length - 1].y - chain[0].y,
  };
  if (ds.x * (b.x - a.x) + ds.y * (b.y - a.y) < 0) chain = [...chain].reverse();
  const s0 = chain[0],
    s1 = chain[chain.length - 1];
  return chain
    .slice(1, -1)
    .map((p) => toFrame(s0, s1, p))
    .map((q) => fromFrame(a, b, { s: q.s, n: q.n * factor }));
}

/** Rebuild the path of every shaped or linked edge from its vertices. An
 *  edge on the geometry follows its curve instead, so it is left alone. */
export function refreshShapes(bk: Blocking): Blocking {
  if (!bk.edges.some((e) => e.shape?.length || e.link)) return bk;
  const byId = new Map(bk.edges.map((e) => [e.id, { ...e }] as const));
  const vm = vmOf(bk);
  const done = new Set<string>();
  const build = (e: BlockEdge, depth: number) => {
    if (done.has(e.id)) return;
    done.add(e.id);
    if (e.curves?.length) return;
    if (e.link) {
      const src = byId.get(e.link.edge);
      if (!src || src.id === e.id || depth > 32) {
        e.link = undefined;
        return;
      }
      build(src, depth + 1);
      e.path = linkedPath(e, src, vm, e.link.factor);
    } else if (e.shape?.length) {
      const a = vm.get(e.v0)!,
        b = vm.get(e.v1)!;
      e.path = splineThrough([a, ...e.shape.map((q) => fromFrame(a, b, q)), b]);
    }
  };
  for (const e of byId.values()) build(e, 0);
  return { ...bk, edges: bk.edges.map((e) => byId.get(e.id)!) };
}

/** Arc length along `chain` of the point on it nearest to p. */
function arcAt(chain: Point2D[], p: Point2D): number {
  let best = Infinity,
    at = 0,
    run = 0;
  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i],
      b = chain[i + 1];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (L * L || 1e-30)));
    const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    if (d < best) {
      best = d;
      at = run + t * L;
    }
    run += L;
  }
  return at;
}

const withEdge = (bk: Blocking, id: string, f: (e: BlockEdge) => BlockEdge): Blocking =>
  refreshShapes({ ...bk, edges: bk.edges.map((e) => (e.id === id ? f(e) : e)) });

/** Why an edge cannot take a free shape: one on the geometry follows its
 *  curve, and one on the edge of the mesh (a single block) must stay on the
 *  geometry, so it is associated instead. Null when it can. */
export function notShapeable(bk: Blocking, e: BlockEdge | undefined): string | null {
  if (!e) return 'Edge not found.';
  if (e.curves?.length || e.curveId) return 'This edge is on the geometry and follows its curve.';
  if (bk.blocks.filter((b) => b.edges.includes(e.id)).length < 2)
    return 'This edge bounds the mesh. Associate it to a curve to bend it.';
  return null;
}

/** Add a shape point where `p` lies on the edge, in order along it. A linked
 *  edge keeps its current bend as points. Returns the new point's index. */
export function addShapePoint(
  bk: Blocking,
  edgeId: string,
  p: Point2D,
): { blocking: Blocking; index: number } | { error: string } {
  const e = bk.edges.find((x) => x.id === edgeId);
  const why = notShapeable(bk, e);
  if (why) return { error: why };
  const vm = vmOf(bk);
  const a = vm.get(e!.v0)!,
    b = vm.get(e!.v1)!;
  const chain = chainOf(e!, vm);
  const at = arcAt(chain, p);
  const pts = e!.shape?.length ? shapePointsWorld(bk, e!, vm) : [];
  const index = pts.filter((q) => arcAt(chain, q) < at).length;
  const shape = [...(e!.shape ?? [])];
  shape.splice(index, 0, toFrame(a, b, p));
  return {
    blocking: withEdge(bk, edgeId, (x) => ({ ...x, shape, link: undefined })),
    index,
  };
}

export function moveShapePoint(bk: Blocking, edgeId: string, index: number, p: Point2D): Blocking {
  const e = bk.edges.find((x) => x.id === edgeId);
  if (notShapeable(bk, e) || !e!.shape?.[index]) return bk;
  const vm = vmOf(bk);
  const q = toFrame(vm.get(e!.v0)!, vm.get(e!.v1)!, p);
  return withEdge(bk, edgeId, (x) => ({
    ...x,
    shape: x.shape!.map((old, i) => (i === index ? q : old)),
  }));
}

export function removeShapePoint(bk: Blocking, edgeId: string, index: number): Blocking {
  return withEdge(bk, edgeId, (x) => {
    const shape = (x.shape ?? []).filter((_, i) => i !== index);
    return { ...x, shape: shape.length ? shape : undefined, path: shape.length ? x.path : [] };
  });
}

/** Back to a straight edge: no shape points, no link. */
export function straightenEdges(bk: Blocking, edgeIds: string[]): Blocking {
  const ids = new Set(edgeIds);
  return refreshShapes({
    ...bk,
    edges: bk.edges.map((e) =>
      ids.has(e.id) && (e.shape || e.link)
        ? { ...e, shape: undefined, link: undefined, path: [] }
        : e,
    ),
  });
}

/** ICEM "Link Edge Shape": the targets take the bend of `sourceId`, scaled by
 *  `factor` (1 = the same bend relative to length, 0 = straight). */
export function linkEdgeShape(
  bk: Blocking,
  sourceId: string,
  targetIds: string[],
  factor: number,
): Blocking | { error: string } {
  if (!bk.edges.some((e) => e.id === sourceId)) return { error: 'Source edge not found.' };
  const targets = targetIds.filter((id) => id !== sourceId);
  if (!targets.length) return { error: 'Pick edges other than the source.' };
  // Following the source's links back must never reach a target (a loop).
  const byId = new Map(bk.edges.map((e) => [e.id, e] as const));
  for (let cur = byId.get(sourceId), guard = 0; cur?.link && guard < 64; guard++) {
    if (targets.includes(cur.link.edge)) return { error: 'That would link an edge to itself.' };
    cur = byId.get(cur.link.edge);
  }
  const ids = new Set(targets.filter((id) => !notShapeable(bk, byId.get(id))));
  if (!ids.size) return { error: 'Those edges bound the mesh or follow the geometry.' };
  return refreshShapes({
    ...bk,
    edges: bk.edges.map((e) =>
      ids.has(e.id) ? { ...e, shape: undefined, link: { edge: sourceId, factor } } : e,
    ),
  });
}
