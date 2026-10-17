import { Point2D, CadEntity } from '../cadWorkflow';

export const uid = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const RKEY = (v: number) => Math.round(v * 1e5) / 1e5;
export const vkey = (p: Point2D) => `${RKEY(p.x)}:${RKEY(p.y)}`;
export const ekey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const near = (a: Point2D, b: Point2D, tol = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
export const lerp = (a: Point2D, b: Point2D, t: number): Point2D => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const signedArea = (poly: Point2D[]): number => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
};
export const centroidOf = (poly: Point2D[]): Point2D => ({
  x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
  y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
});
export const boundsOf = (poly: Point2D[]) => {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};
export const dedupeClose = (poly: Point2D[]): Point2D[] => {
  const out: Point2D[] = [];
  for (const p of poly) if (!out.length || !near(p, out[out.length - 1], 1e-7)) out.push({ x: p.x, y: p.y });
  if (out.length >= 2 && near(out[0], out[out.length - 1], 1e-7)) out.pop();
  return out;
};

/** Resample a closed polygon to `n` points spaced evenly by arc length. */
export function resampleClosed(poly: Point2D[], n: number): Point2D[] {
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

/** Resample an open polyline to `n` points spaced evenly by arc length. */
export function resampleOpen(pts: Point2D[], n: number): Point2D[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    seg.push(d);
    total += d;
  }
  if (total < 1e-9) return pts.map((p) => ({ ...p }));
  const out: Point2D[] = [];
  for (let k = 0; k < n; k++) {
    let target = (k / (n - 1)) * total;
    let si = 0;
    let accumulated = 0;
    while (si < seg.length - 1 && accumulated + seg[si] < target) {
      accumulated += seg[si];
      si += 1;
    }
    const a = pts[si], b = pts[si + 1];
    const rem = target - accumulated;
    const f = seg[si] > 1e-9 ? Math.max(0, Math.min(1, rem / seg[si])) : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

/** First intersection of the ray o -> target with polygon poly. */
export function rayPolygonHit(o: Point2D, target: Point2D, poly: Point2D[]): Point2D | null {
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

export function pointInRing(x: number, y: number, ring: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function poly(entity: CadEntity): Point2D[] {
  if (entity.type === 'circle' && entity.radius != null) {
    const c = entity.pts[0];
    return Array.from({ length: 64 }, (_, i) => ({
      x: c.x + entity.radius! * Math.cos((2 * Math.PI * i) / 64),
      y: c.y + entity.radius! * Math.sin((2 * Math.PI * i) / 64),
    }));
  }
  if (entity.type === 'ellipse' && entity.rx != null && entity.ry != null && entity.pts[0]) {
    const c = entity.pts[0];
    const rx = entity.rx;
    const ry = entity.ry;
    const rot = entity.rotation || 0;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    return Array.from({ length: 64 }, (_, i) => {
      const a = (2 * Math.PI * i) / 64;
      const lx = rx * Math.cos(a);
      const ly = ry * Math.sin(a);
      return {
        x: c.x + lx * cosR - ly * sinR,
        y: c.y + lx * sinR + ly * cosR,
      };
    });
  }
  return entity.pts.map((p) => ({ ...p }));
}

/** Point ring for any closed entity (circle sampled, polyline/rect as-is). */
export const entityRing = (entity: CadEntity): Point2D[] => poly(entity);
