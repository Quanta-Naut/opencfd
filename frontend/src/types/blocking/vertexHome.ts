import { Point2D, BoundaryTag } from '../cadWorkflow';
import { Blocking } from './types';
import { boundsOf } from './geometry';
import { blockPolygon } from './blockEdit';
import { Outline } from './editor';

// Where a block vertex is allowed to go while it is dragged (ICEM CFD calls
// this association). A vertex sitting on the geometry keeps sitting on it:
//
//   point  at a sharp corner of an outline (domain corner, trailing edge),
//          or where the boundary patch changes: it stays put
//   curve  on a smooth stretch of an outline: it slides along that stretch,
//          stopping at the corners / patch changes at either end
//   ring   on a closed outline with no corners (circle, smooth body): it
//          slides all the way round
//   free   anywhere else
//
// So dragging a wall vertex can never pull the block edge off the wall, which
// is what made the mesh boundary stop matching the geometry.

export type VertexHome =
  | { kind: 'free' }
  | { kind: 'point'; pt: Point2D }
  | { kind: 'curve'; pts: Point2D[] }
  | { kind: 'ring'; pts: Point2D[] };

/** A block-vertex drag in progress (held in a ref by the workbench). */
export interface BlockDragState {
  vid: string;
  origin: Point2D;
  /** Set once the drag has pushed its undo entry. */
  recorded?: boolean;
  /** What the vertex is attached to for this drag; free when Alt was held. */
  home?: VertexHome;
}

/** Turning angle above which an outline point is a corner. */
const CORNER_DEG = 40;

const scaleOf = (pts: Point2D[]) => {
  const b = boundsOf(pts);
  return Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
};

function nearestOnPolyline(pts: Point2D[], closed: boolean, p: Point2D) {
  let best = { pt: pts[0], seg: 0, t: 0, d: Infinity };
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-18)),
    );
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < best.d) best = { pt: q, seg: i, t, d };
  }
  return best;
}

/** Indices of ring points that end a curve: sharp corners and patch changes. */
export function outlineBreaks(
  ring: Point2D[],
  tag?: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
): number[] {
  const n = ring.length;
  const cos = Math.cos((CORNER_DEG * Math.PI) / 180);
  const segTag = tag ? ring.map((p, i) => tag(p, ring[(i + 1) % n])) : null;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const p = ring[i];
    const b = ring[(i + 1) % n];
    const ux = p.x - a.x;
    const uy = p.y - a.y;
    const vx = b.x - p.x;
    const vy = b.y - p.y;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    const sharp = lu > 0 && lv > 0 && (ux * vx + uy * vy) / (lu * lv) < cos;
    const patchChange = segTag ? segTag[(i - 1 + n) % n] !== segTag[i] : false;
    if (sharp || patchChange) out.push(i);
  }
  return out;
}

/** What a vertex at `p` is attached to, given the outlines it could lie on. */
export function vertexHome(
  p: Point2D,
  outlines: Outline[],
  tag?: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
): VertexHome {
  for (const o of outlines) {
    const ring = o.pts;
    const tol = scaleOf(ring) * 1e-4;
    const pr = nearestOnPolyline(ring, true, p);
    if (pr.d > tol) continue;
    const breaks = outlineBreaks(ring, tag);
    for (const k of breaks) {
      if (Math.hypot(ring[k].x - p.x, ring[k].y - p.y) <= tol)
        return { kind: 'point', pt: { ...ring[k] } };
    }
    if (!breaks.length) return { kind: 'ring', pts: ring };
    // The stretch between the breaks either side of the projected segment.
    const n = ring.length;
    const start = [...breaks].reverse().find((k) => k <= pr.seg) ?? breaks[breaks.length - 1];
    const pts: Point2D[] = [];
    for (let i = start, guard = 0; guard <= n; i = (i + 1) % n, guard++) {
      pts.push(ring[i]);
      if (guard > 0 && breaks.includes(i)) break;
    }
    return { kind: 'curve', pts };
  }
  return { kind: 'free' };
}

/** How a vertex moves when dragged, for its canvas marker. */
export type VertexKind = 'pinned' | 'slide' | 'free';

/** The drag behaviour of every vertex of a blocking. */
export function vertexKinds(
  bk: Blocking,
  outlines: Outline[],
  tag?: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
): Map<string, VertexKind> {
  const out = new Map<string, VertexKind>();
  for (const v of bk.vertices) {
    if (v.curves?.length) {
      out.set(v.id, 'slide');
      continue;
    }
    const h = vertexHome(v.pt, outlines, tag);
    out.set(v.id, h.kind === 'point' ? 'pinned' : h.kind === 'free' ? 'free' : 'slide');
  }
  return out;
}

/** The nearest allowed position for a dragged vertex, or null if it is free. */
export function constrainToHome(home: VertexHome, raw: Point2D): Point2D | null {
  switch (home.kind) {
    case 'point':
      return { ...home.pt };
    case 'curve':
      return nearestOnPolyline(home.pts, false, raw).pt;
    case 'ring':
      return nearestOnPolyline(home.pts, true, raw).pt;
    default:
      return null;
  }
}

function signedArea(poly: Point2D[]) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function segmentsCross(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  const o = (p: Point2D, q: Point2D, r: Point2D) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function selfIntersects(poly: Point2D[]) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent through the wrap
      if (segmentsCross(a, b, poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * True when moving to `next` keeps every block around the vertex a valid
 * quad: same orientation as before and no edge crossing another. A move that
 * folds a block inside out is refused instead of producing a broken mesh.
 */
export function vertexMoveKeepsBlocksValid(
  before: Blocking,
  next: Blocking,
  vertexId: string,
): boolean {
  const touched = new Set(
    next.edges.filter((e) => e.v0 === vertexId || e.v1 === vertexId).map((e) => e.id),
  );
  for (const blk of next.blocks) {
    if (!blk.edges.some((id) => touched.has(id))) continue;
    const prev = before.blocks.find((b) => b.id === blk.id);
    const polyNext = blockPolygon(next, blk);
    if (polyNext.length < 3) return false;
    const aNext = signedArea(polyNext);
    const aPrev = prev ? signedArea(blockPolygon(before, prev)) : aNext;
    if (aNext === 0 || Math.sign(aNext) !== Math.sign(aPrev)) return false;
    if (polyNext.length <= 400 && selfIntersects(polyNext)) return false;
  }
  return true;
}
