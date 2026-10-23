import { Point2D, CadEntity } from '../../../types/cadWorkflow';

export function uid(): string {
  return `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Move vertex `idx` of an entity to `np`, keeping the shape's kind sane
 *  (rectangles stay axis-aligned; a circle centre translates, its rim resizes). */
export function moveEntityVertex(ent: CadEntity, idx: number, np: Point2D): CadEntity {
  const pts = ent.pts.map(p => ({ ...p }));
  if (ent.type === 'rectangle' && pts.length === 4) {
    const opp = pts[(idx + 2) % 4];
    const x0 = Math.min(np.x, opp.x), x1 = Math.max(np.x, opp.x);
    const y0 = Math.min(np.y, opp.y), y1 = Math.max(np.y, opp.y);
    return { ...ent, pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
  }
  if (ent.type === 'circle' && pts.length >= 2) {
    if (idx === 0) {
      const dx = np.x - pts[0].x, dy = np.y - pts[0].y;
      return { ...ent, pts: pts.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    }
    const r = Math.hypot(np.x - pts[0].x, np.y - pts[0].y);
    return { ...ent, radius: r, pts: [pts[0], np] };
  }
  if (ent.type === 'ellipse' && pts.length >= 2) {
    if (idx === 0) {
      const dx = np.x - pts[0].x, dy = np.y - pts[0].y;
      return { ...ent, pts: pts.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    }
    if (idx === 1) {
      const rx = Math.hypot(np.x - pts[0].x, np.y - pts[0].y);
      const rotation = Math.atan2(np.y - pts[0].y, np.x - pts[0].x);
      return { ...ent, rx, rotation, pts: [pts[0], np] };
    }
    if (idx === 2) {
      const c = pts[0];
      const rot = ent.rotation || 0;
      const distMinor = Math.abs(-(np.x - c.x) * Math.sin(rot) + (np.y - c.y) * Math.cos(rot));
      return { ...ent, ry: distMinor };
    }
  }
  pts[idx] = np;
  return { ...ent, pts };
}

export function translateEntity(ent: CadEntity, dx: number, dy: number): CadEntity {
  return { ...ent, pts: ent.pts.map(p => ({ x: p.x + dx, y: p.y + dy })) };
}

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpt(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function pointInPolygon(p: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Closest distance from point p to segment a→b */
export function distToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Dynamic Google Maps style scale computation based on zoom (pixels per meter) */
export function getMapScaleInfo(zoom: number, targetPx = 75): {
  barWidthPx: number;
  label: string;
  worldDist: number;
} {
  const rawDist = targetPx / Math.max(zoom, 1e-6); // in meters
  const exponent = Math.floor(Math.log10(rawDist));
  const fraction = rawDist / Math.pow(10, exponent);

  let niceFraction = 1;
  if (fraction >= 5) niceFraction = 5;
  else if (fraction >= 2) niceFraction = 2;
  else niceFraction = 1;

  let niceDist = niceFraction * Math.pow(10, exponent); // in meters

  // Clamp minimum scale resolution to 0.2 mm (0.0002 m)
  if (niceDist < 0.0002) {
    niceDist = 0.0002;
  }

  const barWidthPx = Math.max(20, Math.round(niceDist * zoom));

  let label = '';
  if (niceDist >= 1000) {
    label = `${(niceDist / 1000).toLocaleString()} km`;
  } else if (niceDist >= 1) {
    label = `${niceDist >= 10 ? niceDist.toFixed(0) : niceDist.toFixed(niceDist % 1 === 0 ? 0 : 1)} m`;
  } else {
    // All sub-meter scales formatted in mm down to 0.2 mm (never micrometers)
    const mm = niceDist * 1000;
    if (mm >= 1) {
      label = `${mm >= 10 ? mm.toFixed(0) : mm.toFixed(mm % 1 === 0 ? 0 : 1)} mm`;
    } else {
      label = `${mm.toFixed(1)} mm`; // e.g. 0.5 mm, 0.2 mm
    }
  }

  return { barWidthPx, label, worldDist: niceDist };
}

/** Converts an imported point sequence into one closed CFD profile. */
export function pointsToLineSegments(pts: Point2D[], role?: 'geometry' | 'domain_boundary'): CadEntity[] {
  if (pts.length < 3) return [];
  const clean = pts.filter((point, index) => index === 0 || dist(point, pts[index - 1]) > 1e-8);
  if (clean.length > 1 && dist(clean[0], clean[clean.length - 1]) < 1e-5) clean.pop();
  return [{
    id: uid(),
    type: 'polyline',
    layer: 'geometry',
    role,
    pts: clean,
    isClosed: true,
  }];
}

export function normalizeAngle(a: number): number {

  let res = a % (2 * Math.PI);
  if (res > Math.PI) res -= 2 * Math.PI;
  if (res < -Math.PI) res += 2 * Math.PI;
  return res;
}

/** Bounding box of mesh nodes ([x, y, ...] rows). */
export function nodesBBox(nodes: number[][]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n[0] < minX) minX = n[0];
    if (n[0] > maxX) maxX = n[0];
    if (n[1] < minY) minY = n[1];
    if (n[1] > maxY) maxY = n[1];
  }
  return { minX, maxX, minY, maxY };
}
