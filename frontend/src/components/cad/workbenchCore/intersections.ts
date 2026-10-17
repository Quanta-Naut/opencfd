import { Point2D } from '../../../types/cadWorkflow';

/** Parameter t ∈ [0,1] at which segment a→b is closest to p (-1 if beyond ends) */
export function segParam(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
}

/**
 * Intersection of segment a→b with segment c→d.
 * Returns intersection point or null if parallel/non-intersecting.
 */
export function segSegIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return { x: a.x + Math.max(0, Math.min(1, t)) * r.x, y: a.y + Math.max(0, Math.min(1, t)) * r.y };
  }
  return null;
}

/** Intersection of finite segment a→b with infinite line passing through p1 and p2 */
export function segInfLineIntersect(a: Point2D, b: Point2D, p1: Point2D, p2: Point2D): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: p2.x - p1.x, y: p2.y - p1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p1.x - a.x) * s.y - (p1.y - a.y) * s.x) / denom;
  if (t >= -1e-6 && t <= 1 + 1e-6) {
    return { x: a.x + Math.max(0, Math.min(1, t)) * r.x, y: a.y + Math.max(0, Math.min(1, t)) * r.y };
  }
  return null;
}

/** Intersections of finite segment a→b with circle (center, radius) */
export function segCircleIntersect(a: Point2D, b: Point2D, center: Point2D, radius: number): Point2D[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [];
  const fx = a.x - center.x, fy = a.y - center.y;
  const A = lenSq;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sqrtD = Math.sqrt(disc);
  const t1 = (-B - sqrtD) / (2 * A);
  const t2 = (-B + sqrtD) / (2 * A);
  const res: Point2D[] = [];
  if (t1 >= -1e-6 && t1 <= 1 + 1e-6) res.push({ x: a.x + Math.max(0, Math.min(1, t1)) * dx, y: a.y + Math.max(0, Math.min(1, t1)) * dy });
  if (t2 >= -1e-6 && t2 <= 1 + 1e-6 && Math.abs(t2 - t1) > 1e-5) res.push({ x: a.x + Math.max(0, Math.min(1, t2)) * dx, y: a.y + Math.max(0, Math.min(1, t2)) * dy });
  return res;
}

/** Intersections of finite segment a→b with rotated ellipse (center, rx, ry, rotation) */
export function segEllipseIntersect(
  a: Point2D,
  b: Point2D,
  center: Point2D,
  rx: number,
  ry: number,
  rotation: number = 0
): Point2D[] {
  if (rx <= 1e-9 || ry <= 1e-9) return [];
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const toUnit = (p: Point2D): Point2D => {
    const tx = p.x - center.x;
    const ty = p.y - center.y;
    const rxRot = tx * cosR + ty * sinR;
    const ryRot = -tx * sinR + ty * cosR;
    return { x: rxRot / rx, y: ryRot / ry };
  };
  const fromUnit = (p: Point2D): Point2D => {
    const sx = p.x * rx;
    const sy = p.y * ry;
    return {
      x: center.x + sx * cosR - sy * sinR,
      y: center.y + sx * sinR + sy * cosR,
    };
  };

  const aUnit = toUnit(a);
  const bUnit = toUnit(b);
  const hitsUnit = segCircleIntersect(aUnit, bUnit, { x: 0, y: 0 }, 1);
  return hitsUnit.map(fromUnit);
}
