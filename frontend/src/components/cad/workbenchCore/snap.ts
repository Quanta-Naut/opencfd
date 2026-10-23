// Sketch snap / inference engine.
//
// Everything here is pure: given the cursor position in world units and the
// current sketch, decide which point the cursor should actually be at and which
// guide lines to draw. It lives beside the other `workbenchCore` modules so the
// 6k-line interactive component only has to call `computeSnapPoint` - the
// Onshape/Fusion-style inferencing is testable and readable on its own.
import { CadEntity, Point2D } from '../../../types/cadWorkflow';
import { GuideLine, Snap } from './types';
import { ALIGN_TOL_PX, POLAR_TOL_DEG, PROXIMITY_PX, SNAP_RADIUS_PX } from './constants';
import { dist, distToSegment, midpt, normalizeAngle } from './geometry';
import { segSegIntersect } from './intersections';

// ─── Settings ────────────────────────────────────────────────────────────────

/** Which inference modes are armed. Persisted per browser (not per project) so
 *  a user's drafting habits survive a reload. */
export interface SnapSettings {
  endpoint: boolean;
  midpoint: boolean;
  center: boolean;
  quadrant: boolean;
  intersection: boolean;
  perpendicular: boolean;
  parallel: boolean;
  /** Nearest point anywhere along an edge, not just a key vertex. */
  onCurve: boolean;
  /** Full-length guide lines when the cursor shares an X/Y with another vertex
   *  (or an axis) - Onshape/Fusion "align to a vertex on the same axis". */
  alignment: boolean;
  /** Snap the direction from the last point to a fixed angle (15deg, ...). */
  polar: boolean;
  polarStepDeg: number;
  /** Snap to the adaptive grid. */
  grid: boolean;
}

/** Boolean snap modes - everything in SnapSettings except the polar step. */
export type SnapBoolKey = Exclude<keyof SnapSettings, 'polarStepDeg'>;

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  endpoint: true,
  midpoint: true,
  center: true,
  quadrant: true,
  intersection: true,
  perpendicular: true,
  parallel: true,
  // Hover a line and it snaps onto the line - like every CAD's nearest snap.
  onCurve: true,
  // Alignment guides to nearby vertices (proximity-gated, not global).
  alignment: true,
  // Angle tracking is opt-in: an always-on 15deg grid fights free drawing.
  polar: false,
  polarStepDeg: 15,
  grid: true,
};

export const POLAR_STEP_CHOICES = [5, 15, 30, 45, 90];

const SNAP_LS_KEY = 'opencfd.cad.snapSettings';
/** Bump when the defaults change meaningfully, so a previously-stored profile
 *  doesn't keep forcing inferences the user just asked us to stop forcing. */
const SNAP_LS_VERSION = 2;

export function loadSnapSettings(): SnapSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAP_LS_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || raw.v !== SNAP_LS_VERSION) {
      return { ...DEFAULT_SNAP_SETTINGS };
    }
    const merged = { ...DEFAULT_SNAP_SETTINGS, ...raw };
    if (!POLAR_STEP_CHOICES.includes(merged.polarStepDeg)) {
      merged.polarStepDeg = DEFAULT_SNAP_SETTINGS.polarStepDeg;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SNAP_SETTINGS };
  }
}

export function saveSnapSettings(settings: SnapSettings): void {
  try {
    localStorage.setItem(SNAP_LS_KEY, JSON.stringify({ v: SNAP_LS_VERSION, ...settings }));
  } catch {
    /* private mode / quota - the setting just won't persist */
  }
}

// ─── Labels for the on-canvas markers ────────────────────────────────────────

export const SNAP_LABELS: Record<Snap['type'], string> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Center',
  quadrant: 'Quadrant',
  origin: 'Origin',
  grid: 'Grid',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  alignment: 'Alignment',
  polar: 'Angle',
  tangent: 'Tangent',
  intersection: 'Intersection',
  nearest: 'On edge',
};

// ─── Key points ──────────────────────────────────────────────────────────────

export interface SnapKeyPoint {
  pt: Point2D;
  type: Snap['type'];
}

const key = (pt: Point2D) => `${pt.x.toFixed(5)},${pt.y.toFixed(5)}`;
const r5 = (n: number) => +n.toFixed(5);

/** Every point the cursor may latch onto, filtered by the armed modes. The
 *  origin is always present - it is a normal candidate, not a magnet. */
export function collectSnapKeyPoints(
  entities: CadEntity[],
  settings: SnapSettings,
): SnapKeyPoint[] {
  const out: SnapKeyPoint[] = [{ pt: { x: 0, y: 0 }, type: 'origin' }];
  const seen = new Set<string>([key({ x: 0, y: 0 })]);
  const push = (pt: Point2D, type: Snap['type']) => {
    const k = key(pt);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ pt, type });
  };

  for (const e of entities) {
    const pts = e.pts;
    if (!pts.length) continue;

    if (settings.endpoint) {
      for (const p of pts) push(p, 'endpoint');
    }
    if (settings.midpoint) {
      for (let i = 0; i < pts.length - 1; i++) push(midpt(pts[i], pts[i + 1]), 'midpoint');
    }

    const isRound = e.type === 'circle' || e.type === 'ellipse' || e.type === 'arc';
    if (settings.center && isRound) push(pts[0], 'center');

    if (settings.quadrant) {
      if (e.type === 'circle') {
        const c = pts[0];
        const r = e.radius ?? (pts[1] ? dist(c, pts[1]) : 0);
        if (r > 0) {
          push({ x: c.x + r, y: c.y }, 'quadrant');
          push({ x: c.x - r, y: c.y }, 'quadrant');
          push({ x: c.x, y: c.y + r }, 'quadrant');
          push({ x: c.x, y: c.y - r }, 'quadrant');
        }
      } else if (e.type === 'ellipse' && typeof e.rx === 'number' && typeof e.ry === 'number') {
        const c = pts[0];
        const rot = e.rotation || 0;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);
        const evalE = (t: number): Point2D => ({
          x: r5(c.x + e.rx! * Math.cos(t) * cosR - e.ry! * Math.sin(t) * sinR),
          y: r5(c.y + e.rx! * Math.cos(t) * sinR + e.ry! * Math.sin(t) * cosR),
        });
        const tx = Math.atan2(-e.ry * sinR, e.rx * cosR);
        const ty = Math.atan2(e.ry * cosR, e.rx * sinR);
        push(evalE(tx), 'quadrant');
        push(evalE(tx + Math.PI), 'quadrant');
        push(evalE(ty), 'quadrant');
        push(evalE(ty + Math.PI), 'quadrant');
      }
    }
  }
  return out;
}

// ─── Entity intersections (cached per entity-list identity) ──────────────────

const intersectionCache = new WeakMap<CadEntity[], Point2D[]>();

/** Crossing points of the sketch's edges. Memoised on the entities array so the
 *  O(n^2) pass runs once per committed edit, not on every mouse move. */
export function entityIntersections(entities: CadEntity[]): Point2D[] {
  const cached = intersectionCache.get(entities);
  if (cached) return cached;

  const segs: { a: Point2D; b: Point2D }[] = [];
  for (const e of entities) {
    for (let i = 0; i < e.pts.length - 1; i++) segs.push({ a: e.pts[i], b: e.pts[i + 1] });
  }

  const pts: Point2D[] = [];
  // Guard: a dense imported airfoil can be thousands of edges - quadratic pair
  // testing there would be pointless (and janky), so we just don't offer
  // intersection snap on huge sketches.
  if (segs.length <= 260) {
    const near = (p: Point2D, q: Point2D) => Math.abs(p.x - q.x) < 1e-7 && Math.abs(p.y - q.y) < 1e-7;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const ip = segSegIntersect(segs[i].a, segs[i].b, segs[j].a, segs[j].b);
        if (!ip) continue;
        // Ignore the shared endpoint of two adjoining edges - that is already an
        // endpoint snap, not a meaningful intersection.
        if (
          near(ip, segs[i].a) || near(ip, segs[i].b) ||
          near(ip, segs[j].a) || near(ip, segs[j].b)
        ) {
          continue;
        }
        pts.push(ip);
      }
    }
  }
  intersectionCache.set(entities, pts);
  return pts;
}

// ─── Main engine ─────────────────────────────────────────────────────────────

export interface SnapContext {
  entities: CadEntity[];
  /** Points already placed for the shape in progress (empty when nothing yet). */
  tempPts: Point2D[];
  zoom: number;
  /** Ortho lock: constrain from the last point to the nearest axis. */
  ortho: boolean;
  settings: SnapSettings;
  /** Half-extent of a viewport-spanning guide line, in world units. */
  guideExtent: number;
  /** Master OSNAP switch (F3). */
  enabled: boolean;
}

function axisGuide(from: Point2D, to: Point2D, tol: number): GuideLine[] {
  if (dist(from, to) < 1e-4) return [];
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx < tol) return [{ type: 'vertical', from, to }];
  if (dy < tol) return [{ type: 'horizontal', from, to }];
  return [];
}

/** Thin tracking lines through a hovered point - the "guide line" a CAD shows
 *  so you can see which vertex/intersection you are about to snap to. */
function extensionGuides(pt: Point2D, extent: number): GuideLine[] {
  return [
    { type: 'extension', from: { x: pt.x - extent, y: pt.y }, to: { x: pt.x + extent, y: pt.y } },
    { type: 'extension', from: { x: pt.x, y: pt.y - extent }, to: { x: pt.x, y: pt.y + extent } },
  ];
}

/** Perpendicular / parallel inference against a nearby edge. Only edges the
 *  cursor is actually close to may influence the direction - otherwise a match
 *  anywhere in a dense sketch (an imported airfoil, say) would grab the line. */
function directionalInference(
  raw: Point2D,
  start: Point2D,
  entities: CadEntity[],
  settings: SnapSettings,
  proximity: number,
): Snap | null {
  const dx = raw.x - start.x;
  const dy = raw.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ang = Math.atan2(dy, dx);

  for (const e of entities) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const segA = e.pts[i];
      const segB = e.pts[i + 1];
      if (distToSegment(raw, segA, segB) > proximity) continue;
      const segAng = Math.atan2(segB.y - segA.y, segB.x - segA.x);

      if (settings.perpendicular) {
        const perp1 = segAng + Math.PI / 2;
        const perp2 = segAng - Math.PI / 2;
        const d1 = Math.abs(normalizeAngle(ang - perp1));
        const d2 = Math.abs(normalizeAngle(ang - perp2));
        if (d1 < 0.05 || d2 < 0.05) {
          const target = d1 < d2 ? perp1 : perp2;
          const pt = { x: r5(start.x + len * Math.cos(target)), y: r5(start.y + len * Math.sin(target)) };
          return { pt, type: 'perpendicular', guides: [{ type: 'perpendicular', from: start, to: pt }] };
        }
      }
      if (settings.parallel) {
        const d = Math.abs(normalizeAngle(ang - segAng));
        const dOpp = Math.abs(normalizeAngle(ang - (segAng + Math.PI)));
        if (d < 0.05 || dOpp < 0.05) {
          const target = d < dOpp ? segAng : segAng + Math.PI;
          const pt = { x: r5(start.x + len * Math.cos(target)), y: r5(start.y + len * Math.sin(target)) };
          return { pt, type: 'parallel', guides: [{ type: 'parallel', from: start, to: pt }] };
        }
      }
    }
  }
  return null;
}

/** Snap the direction from `start` to a multiple of the polar step. */
function polarInference(raw: Point2D, start: Point2D, stepDeg: number): Snap | null {
  const dx = raw.x - start.x;
  const dy = raw.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ang = Math.atan2(dy, dx);
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(normalizeAngle(ang - snapped)) > (POLAR_TOL_DEG * Math.PI) / 180) return null;
  const pt = { x: r5(start.x + len * Math.cos(snapped)), y: r5(start.y + len * Math.sin(snapped)) };
  const deg = ((Math.round((snapped * 180) / Math.PI) % 360) + 360) % 360;
  return { pt, type: 'polar', guides: [{ type: 'polar', from: start, to: pt, label: `${deg}°` }] };
}

/** Full-length guides when the cursor shares an X or Y with a *nearby* vertex.
 *  Proximity-gated: a vertex on the far side of the sketch never pulls the
 *  cursor. Both an X and a Y match snap to their crossing. */
function alignToVertices(
  raw: Point2D,
  start: Point2D | null,
  keyPoints: SnapKeyPoint[],
  tol: number,
  proximity: number,
  guideExtent: number,
): Snap | null {
  let lockX: number | null = null;
  let lockY: number | null = null;
  let bdx = tol;
  let bdy = tol;

  for (const kp of keyPoints) {
    if (start && dist(kp.pt, start) < 1e-6) continue;
    // Only vertices the cursor is hovering near may align it.
    if (dist(raw, kp.pt) > proximity) continue;
    const dxk = Math.abs(raw.x - kp.pt.x);
    if (dxk < bdx) {
      bdx = dxk;
      lockX = kp.pt.x;
    }
    const dyk = Math.abs(raw.y - kp.pt.y);
    if (dyk < bdy) {
      bdy = dyk;
      lockY = kp.pt.y;
    }
  }

  // Sketch axes: recognised only while the cursor is basically on the axis
  // line (so they behave like a hovered target, not a global magnet).
  if (lockX === null && Math.abs(raw.x) < tol) lockX = 0;
  if (lockY === null && Math.abs(raw.y) < tol) lockY = 0;

  if (lockX === null && lockY === null) return null;
  const pt = { x: lockX ?? raw.x, y: lockY ?? raw.y };
  const guides: GuideLine[] = [];
  if (lockX !== null) {
    guides.push({
      type: 'vertical',
      from: { x: lockX, y: pt.y - guideExtent },
      to: { x: lockX, y: pt.y + guideExtent },
    });
  }
  if (lockY !== null) {
    guides.push({
      type: 'horizontal',
      from: { x: pt.x - guideExtent, y: lockY },
      to: { x: pt.x + guideExtent, y: lockY },
    });
  }
  return { pt: { x: r5(pt.x), y: r5(pt.y) }, type: 'alignment', guides };
}

/** Nearest point lying on any edge (not just a key vertex). */
function nearestOnCurve(raw: Point2D, entities: CadEntity[], snapR: number): Snap | null {
  let best: Point2D | null = null;
  let bestD = snapR;
  for (const e of entities) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      const d = distToSegment(raw, a, b);
      if (d < bestD) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((raw.x - a.x) * dx + (raw.y - a.y) * dy) / lenSq));
        best = { x: r5(a.x + t * dx), y: r5(a.y + t * dy) };
        bestD = d;
      }
    }
    if (e.type === 'circle' && e.pts[0]) {
      const c = e.pts[0];
      const r = e.radius ?? (e.pts[1] ? dist(c, e.pts[1]) : 0);
      if (r > 0) {
        const vx = raw.x - c.x;
        const vy = raw.y - c.y;
        const vlen = Math.hypot(vx, vy) || 1;
        const proj = { x: r5(c.x + (vx / vlen) * r), y: r5(c.y + (vy / vlen) * r) };
        const d = dist(raw, proj);
        if (d < bestD) {
          best = proj;
          bestD = d;
        }
      }
    }
  }
  return best ? { pt: best, type: 'nearest' } : null;
}

function gridSnap(raw: Point2D, zoom: number): Snap {
  const rawStep = 40 / Math.max(zoom, 1e-6);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let g = mag;
  if (norm >= 5) g = 5 * mag;
  else if (norm >= 2) g = 2 * mag;
  g = Math.max(0.0002, g); // Min grid step: 0.2 mm

  const gx = Math.round(raw.x / g) * g;
  const gy = Math.round(raw.y / g) * g;
  return { pt: { x: +gx.toFixed(6), y: +gy.toFixed(6) }, type: 'grid', guides: [] };
}

/** Resolve the cursor to a snapped world point plus the guides to draw. */
export function computeSnapPoint(raw: Point2D, ctx: SnapContext): Snap {
  const { entities, tempPts, zoom, ortho, settings, guideExtent, enabled } = ctx;
  if (!enabled) return { pt: raw, type: 'grid', guides: [] };

  const snapR = SNAP_RADIUS_PX / zoom;
  const alignTol = ALIGN_TOL_PX / zoom;
  const proximity = PROXIMITY_PX / zoom;
  const start = tempPts.length ? tempPts[tempPts.length - 1] : null;
  const keyPoints = collectSnapKeyPoints(entities, settings);

  // 1. Direct vertex snap - the strongest inference, beats everything else.
  let direct: Snap | null = null;
  let bestD = snapR;
  for (const kp of keyPoints) {
    const d = dist(raw, kp.pt);
    if (d < bestD) {
      bestD = d;
      direct = { pt: kp.pt, type: kp.type };
    }
  }
  if (direct) {
    const guides = start ? axisGuide(start, direct.pt, alignTol) : [];
    // Show the tracking lines through the point being hovered.
    direct.guides = guides.concat(extensionGuides(direct.pt, guideExtent));
    return direct;
  }

  // 2. Edge crossings.
  if (settings.intersection) {
    let best: Point2D | null = null;
    let bd = snapR;
    for (const ip of entityIntersections(entities)) {
      const d = dist(raw, ip);
      if (d < bd) {
        bd = d;
        best = ip;
      }
    }
    if (best) {
      return { pt: best, type: 'intersection', guides: extensionGuides(best, guideExtent) };
    }
  }

  // 3. Ortho lock: nearest axis from the last placed point.
  if (ortho && start) {
    const dx = raw.x - start.x;
    const dy = raw.y - start.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const pt = horizontal ? { x: r5(raw.x), y: r5(start.y) } : { x: r5(start.x), y: r5(raw.y) };
    return {
      pt,
      type: 'alignment',
      guides: [{ type: horizontal ? 'horizontal' : 'vertical', from: start, to: pt }],
    };
  }

  // 4. Inference while a shape is being drawn. Nothing here moves the cursor
  //    unless it is near the geometry it references (or a constraint mode is on):
  //    free drawing is free, hovering a point/line snaps.
  if (start && dist(raw, start) > snapR) {
    if (settings.perpendicular || settings.parallel) {
      const r = directionalInference(raw, start, entities, settings, proximity);
      if (r) return r;
    }
    // Same-axis guides to nearby vertices beat the coarse polar grid.
    if (settings.alignment) {
      const r = alignToVertices(raw, start, keyPoints, alignTol, proximity, guideExtent);
      if (r) return r;
    }
    if (settings.polar) {
      const r = polarInference(raw, start, settings.polarStepDeg);
      if (r) return r;
    }
  } else if (settings.alignment) {
    // First point of a shape: still show same-axis guides, Onshape-style.
    const r = alignToVertices(raw, start, keyPoints, alignTol, proximity, guideExtent);
    if (r) return r;
  }

  // 5. Hover a line and snap onto it (nearest point on an edge).
  if (settings.onCurve) {
    const r = nearestOnCurve(raw, entities, snapR);
    if (r) return r;
  }

  // 6. Grid.
  if (settings.grid) return gridSnap(raw, zoom);

  return { pt: raw, type: 'grid', guides: [] };
}
