import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import { sampleSpline } from './spline';

// Move, Scale, Rotate and Mirror as one affine map, x' = M x + t, applied to
// any sketch entity. An entity keeps its kind when the map allows it: a
// circle under uneven scaling becomes an ellipse, a rotated rectangle a
// closed polyline, an unevenly scaled arc a polyline, so nothing is ever
// silently distorted.

export interface Affine {
  a: number; // M = [[a, b], [c, d]]
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const apply = (m: Affine, p: Point2D): Point2D => ({
  x: m.a * p.x + m.b * p.y + m.tx,
  y: m.c * p.x + m.d * p.y + m.ty,
});

export const translation = (dx: number, dy: number): Affine => ({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: dx,
  ty: dy,
});

/** Linear part about a fixed point. */
const about = (o: Point2D, a: number, b: number, c: number, d: number): Affine => ({
  a,
  b,
  c,
  d,
  tx: o.x - (a * o.x + b * o.y),
  ty: o.y - (c * o.x + d * o.y),
});

export const scaling = (o: Point2D, sx: number, sy: number) => about(o, sx, 0, 0, sy);

export const rotation = (o: Point2D, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return about(o, Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r));
};

/** Reflection in the line through p and q. */
export function mirroring(p: Point2D, q: Point2D): Affine | null {
  const ang = Math.atan2(q.y - p.y, q.x - p.x);
  if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-12) return null;
  const c2 = Math.cos(2 * ang),
    s2 = Math.sin(2 * ang);
  return about(p, c2, s2, s2, -c2);
}

const det = (m: Affine) => m.a * m.d - m.b * m.c;

/** True when M is a rotation or reflection times one scale (shapes keep
 *  their kind: circles stay circles). */
function isSimilarity(m: Affine): boolean {
  const s = Math.abs(det(m));
  const k = m.a * m.a + m.c * m.c;
  return (
    s > 0 &&
    Math.abs(k - (m.b * m.b + m.d * m.d)) <= 1e-9 * k &&
    Math.abs(m.a * m.b + m.c * m.d) <= 1e-9 * k
  );
}

/** M keeps the axes as axes (scales, mirrors and quarter turns). */
const keepsAxes = (m: Affine) => {
  const tol = 1e-9 * (Math.abs(m.a) + Math.abs(m.b) + Math.abs(m.c) + Math.abs(m.d));
  return (
    (Math.abs(m.b) < tol && Math.abs(m.c) < tol) || (Math.abs(m.a) < tol && Math.abs(m.d) < tol)
  );
};

/** Semi-axes and angle of the ellipse that `lin` maps the unit circle to
 *  (2x2 SVD in closed form). */
function ellipseOf(p: number, q: number, r: number, s: number) {
  const E = (p + s) / 2,
    F = (p - s) / 2,
    G = (r + q) / 2,
    H = (r - q) / 2;
  const Q = Math.hypot(E, H),
    R = Math.hypot(F, G);
  const a1 = Math.atan2(G, F),
    a2 = Math.atan2(H, E);
  return { rx: Q + R, ry: Math.abs(Q - R), rot: (a2 + a1) / 2 };
}

function arcPoints(e: CadEntity, n = 48): Point2D[] {
  const c = e.pts[0];
  const r = Math.hypot(e.pts[1].x - c.x, e.pts[1].y - c.y);
  const sa = e.startAngle ?? Math.atan2(e.pts[1].y - c.y, e.pts[1].x - c.x);
  let ea = e.endAngle ?? Math.atan2(e.pts[2].y - c.y, e.pts[2].x - c.x);
  while (ea <= sa) ea += Math.PI * 2;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = sa + ((ea - sa) * i) / n;
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
}

/** `e` mapped by `m`. Ids and layers are kept. */
export function transformEntity(e: CadEntity, m: Affine): CadEntity {
  const map = (ps: Point2D[]) => ps.map((p) => apply(m, p));
  switch (e.type) {
    case 'spline': {
      const ctrl = map(e.ctrl ?? e.pts);
      return { ...e, ctrl, pts: e.ctrl ? sampleSpline(ctrl, !!e.isClosed) : ctrl };
    }
    case 'rectangle': {
      const pts = map(e.pts);
      if (!keepsAxes(m)) return { ...e, type: 'polyline', isClosed: true, pts };
      const xs = pts.map((p) => p.x),
        ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys),
        y1 = Math.max(...ys);
      return {
        ...e,
        pts: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      };
    }
    case 'circle': {
      const c = e.pts[0];
      const r = e.radius ?? Math.hypot(e.pts[1].x - c.x, e.pts[1].y - c.y);
      const nc = apply(m, c);
      if (isSimilarity(m)) {
        const nr = r * Math.sqrt(Math.abs(det(m)));
        return { ...e, radius: nr, pts: [nc, { x: nc.x + nr, y: nc.y }] };
      }
      const el = ellipseOf(m.a * r, m.b * r, m.c * r, m.d * r);
      return {
        ...e,
        type: 'ellipse',
        radius: undefined,
        rx: el.rx,
        ry: el.ry,
        rotation: el.rot,
        pts: [nc, { x: nc.x + el.rx * Math.cos(el.rot), y: nc.y + el.rx * Math.sin(el.rot) }],
      };
    }
    case 'ellipse': {
      const c = e.pts[0];
      const rx = e.rx ?? 1,
        ry = e.ry ?? 1,
        t = e.rotation ?? 0;
      // Image of the unit circle: M * R(t) * diag(rx, ry).
      const p = rx * Math.cos(t),
        q = -ry * Math.sin(t),
        r = rx * Math.sin(t),
        s = ry * Math.cos(t);
      const el = ellipseOf(
        m.a * p + m.b * r,
        m.a * q + m.b * s,
        m.c * p + m.d * r,
        m.c * q + m.d * s,
      );
      const nc = apply(m, c);
      return {
        ...e,
        rx: el.rx,
        ry: el.ry,
        rotation: el.rot,
        pts: [nc, { x: nc.x + el.rx * Math.cos(el.rot), y: nc.y + el.rx * Math.sin(el.rot) }],
      };
    }
    case 'arc': {
      if (e.pts.length < 3) return { ...e, pts: map(e.pts) };
      if (!isSimilarity(m))
        return {
          ...e,
          type: 'polyline',
          isClosed: false,
          startAngle: undefined,
          endAngle: undefined,
          pts: map(arcPoints(e)),
        };
      const ring = arcPoints(e, 2);
      const [c, s, en] = [apply(m, e.pts[0]), apply(m, ring[0]), apply(m, ring[2])];
      const ang = (p: Point2D) => Math.atan2(p.y - c.y, p.x - c.x);
      // A mirror turns the sweep the other way, so start and end swap.
      const [a, b] = det(m) < 0 ? [en, s] : [s, en];
      return { ...e, pts: [c, a, b], startAngle: ang(a), endAngle: ang(b) };
    }
    default:
      return { ...e, pts: map(e.pts) };
  }
}

/** Circles, ellipses and arcs move as a whole; every other shape can have
 *  single vertices picked and transformed. */
export const pointwise = (e: CadEntity) =>
  e.type !== 'circle' && e.type !== 'ellipse' && e.type !== 'arc';

/** `e` with only the grips in `idxs` (see editPoints) mapped by `m`. A
 *  rectangle with some corners moved is no longer a rectangle, so it becomes
 *  a closed polyline. */
export function transformVertices(e: CadEntity, idxs: Set<number>, m: Affine): CadEntity {
  const map = (ps: Point2D[]) => ps.map((p, i) => (idxs.has(i) ? apply(m, p) : { ...p }));
  if (!pointwise(e) || !idxs.size) return e;
  if (e.type === 'spline' && e.ctrl) {
    const ctrl = map(e.ctrl);
    return { ...e, ctrl, pts: sampleSpline(ctrl, !!e.isClosed) };
  }
  if (e.type === 'rectangle') return { ...e, type: 'polyline', isClosed: true, pts: map(e.pts) };
  return { ...e, pts: map(e.pts) };
}

/** Centre of the bounding box of some entities (circles and ellipses by
 *  their full extent) and some loose points. */
export function entitiesCenter(es: CadEntity[], extra: Point2D[] = []): Point2D | null {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const add = (p: Point2D) => {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  };
  for (const e of es) {
    if (!e.pts.length) continue;
    if (e.type === 'circle' || e.type === 'ellipse') {
      const c = e.pts[0];
      const r =
        e.type === 'circle'
          ? (e.radius ?? Math.hypot(e.pts[1].x - c.x, e.pts[1].y - c.y))
          : Math.max(e.rx ?? 0, e.ry ?? 0);
      add({ x: c.x - r, y: c.y - r });
      add({ x: c.x + r, y: c.y + r });
    } else e.pts.forEach(add);
  }
  extra.forEach(add);
  return x0 <= x1 ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null;
}
