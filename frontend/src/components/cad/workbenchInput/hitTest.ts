import type { Outline } from '../../../types/blocking';
import { Point2D, CadEntity } from '../../../types/cadWorkflow';
import { Blocking, entityRing, snapToOutline, constrainToCurves } from '../../../types/blocking';
import { SNAP_RADIUS_PX, dist, pointInPolygon, distToSegment } from '../workbenchCore';
import type { SnapSettings } from '../workbenchCore';

/** Snap a dragged block vertex to geometry, other vertices and alignment guides. */
export function snapBlockVertexImpl(
  raw: Point2D,
  draggedVid: string,
  wb: SnapBlockVertexContext,
): { pt: Point2D; guides: { a: Point2D; b: Point2D }[] } {
  const { zoom, blocking, cadState, blockOutlines, snapSettings, domainRing } = wb;
  const R = SNAP_RADIUS_PX / zoom;
  const guides: { a: Point2D; b: Point2D }[] = [];
  // An associated vertex (ICEM) is constrained to its curves.
  const dragged = draggedVid ? blocking?.vertices.find((v) => v.id === draggedVid) : undefined;
  const onAssoc = constrainToCurves(raw, dragged?.curves, cadState.entities);
  if (onAssoc) return { pt: onAssoc, guides: [] };
  const siblings = blocking?.vertices.filter((v) => v.id !== draggedVid).map((v) => v.pt) ?? [];
  const corners: Point2D[] = [];
  for (const e of cadState.entities) {
    if (e.layer === 'construction') continue;
    for (const q of e.type === 'circle' || e.type === 'ellipse' ? entityRing(e) : e.pts)
      corners.push(q);
  }

  // 1. exact snap to a corner or sibling vertex
  let hit: Point2D | null = null;
  let hd = R;
  for (const c of [...siblings, ...corners]) {
    const d = Math.hypot(c.x - raw.x, c.y - raw.y);
    if (d < hd) {
      hd = d;
      hit = c;
    }
  }
  if (hit) return { pt: { x: hit.x, y: hit.y }, guides: [] };

  // 1b. slide along the domain outline or a body, so a boundary corner
  // stays on the geometry instead of drifting off it
  const onCurve = snapToOutline(raw, blockOutlines, R * 0.8);
  if (onCurve) return { pt: onCurve.pt, guides: [] };

  // 2. axis alignment with a sibling vertex
  const pt = { x: raw.x, y: raw.y };
  let ax: number | null = null;
  let ay: number | null = null;
  let axd = R;
  let ayd = R;
  for (const c of siblings) {
    if (Math.abs(c.x - raw.x) < axd) {
      axd = Math.abs(c.x - raw.x);
      ax = c.x;
    }
    if (Math.abs(c.y - raw.y) < ayd) {
      ayd = Math.abs(c.y - raw.y);
      ay = c.y;
    }
  }
  if (ax !== null) pt.x = ax;
  if (ay !== null) pt.y = ay;

  // 3. grid snap when not otherwise constrained
  if (snapSettings.grid && ax === null && ay === null) {
    const raw40 = 40 / Math.max(zoom, 1e-6);
    const mag = Math.pow(10, Math.floor(Math.log10(raw40)));
    const n = raw40 / mag;
    let g = n >= 5 ? 5 * mag : n >= 2 ? 2 * mag : mag;
    g = Math.max(0.0002, g);
    pt.x = Math.round(pt.x / g) * g;
    pt.y = Math.round(pt.y / g) * g;
  }

  // 4. clamp inside the fluid domain
  if (domainRing.length >= 3 && !pointInPolygon(pt, domainRing)) {
    let best = domainRing[0];
    let bd = Infinity;
    for (let i = 0; i < domainRing.length; i += 1) {
      const a = domainRing[i];
      const b = domainRing[(i + 1) % domainRing.length];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1;
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * abx + (pt.y - a.y) * aby) / len2));
      const q = { x: a.x + t * abx, y: a.y + t * aby };
      const d = Math.hypot(pt.x - q.x, pt.y - q.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    pt.x = best.x;
    pt.y = best.y;
    ax = ay = null;
  }

  const BIG = 1e6;
  if (ax !== null) guides.push({ a: { x: ax, y: pt.y - BIG }, b: { x: ax, y: pt.y + BIG } });
  if (ay !== null) guides.push({ a: { x: pt.x - BIG, y: ay }, b: { x: pt.x + BIG, y: ay } });
  return { pt, guides };
}

/** What snapBlockVertexImpl reads from the workbench component. */
export interface SnapBlockVertexContext {
  zoom: number;
  blocking: Blocking;
  cadState: { entities: CadEntity[] };
  blockOutlines: Outline[];
  snapSettings: SnapSettings;
  domainRing: Point2D[];
}

/** The entity under a world point, within the pick radius, or null. */
export function findEntityAtImpl(rawPt: Point2D, wb: FindEntityAtContext): string | null {
  const { zoom, cadState } = wb;
  const hitR = 14 / zoom;
  let bestId: string | null = null;
  let bestD = Infinity;
  for (const ent of cadState.entities) {
    if (ent.pts.length === 0) continue;
    for (let i = 0; i < ent.pts.length - 1; i++) {
      const d = distToSegment(rawPt, ent.pts[i], ent.pts[i + 1]);
      if (d < hitR && d < bestD) {
        bestD = d;
        bestId = ent.id;
      }
    }
    if (ent.isClosed && ent.pts.length >= 3) {
      const d = distToSegment(rawPt, ent.pts[ent.pts.length - 1], ent.pts[0]);
      if (d < hitR && d < bestD) {
        bestD = d;
        bestId = ent.id;
      }
    }
    if (ent.type === 'circle' && ent.pts.length >= 2) {
      const r = ent.radius ?? dist(ent.pts[0], ent.pts[1]);
      const radialD = Math.abs(dist(rawPt, ent.pts[0]) - r);
      if (radialD < hitR && radialD < bestD) {
        bestD = radialD;
        bestId = ent.id;
      }
    }
    if (ent.type === 'ellipse' && ent.pts.length >= 2 && ent.rx != null && ent.ry != null) {
      const c = ent.pts[0];
      const rx = ent.rx;
      const ry = ent.ry;
      const rot = ent.rotation || 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const N = 32;
      let minD = Infinity;
      let prevP = {
        x: c.x + rx * cosR,
        y: c.y + rx * sinR,
      };
      for (let j = 1; j <= N; j++) {
        const a = (2 * Math.PI * j) / N;
        const lx = rx * Math.cos(a);
        const ly = ry * Math.sin(a);
        const curP = {
          x: c.x + lx * cosR - ly * sinR,
          y: c.y + lx * sinR + ly * cosR,
        };
        const d = distToSegment(rawPt, prevP, curP);
        if (d < minD) minD = d;
        prevP = curP;
      }
      if (minD < hitR && minD < bestD) {
        bestD = minD;
        bestId = ent.id;
      }
    }
    for (const p of ent.pts) {
      const d = dist(rawPt, p);
      if (d < hitR && d < bestD) {
        bestD = d;
        bestId = ent.id;
      }
    }
  }
  return bestId;
}

/** What findEntityAtImpl reads from the workbench component. */
export interface FindEntityAtContext {
  zoom: number;
  cadState: { entities: CadEntity[] };
}
