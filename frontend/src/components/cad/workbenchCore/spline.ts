import { Point2D, CadEntity } from '../../../types/cadWorkflow';

// Splines are stored by their fit points (`ctrl`): the curve passes through
// each one (centripetal Catmull-Rom, which never loops or overshoots between
// close points). `pts` holds the sampled curve, so everything downstream
// (meshing, blocking, snapping to the curve) reads it like a polyline.

const SAMPLES_PER_SPAN = 16;

/** The curve through `ctrl`, as a polyline that starts and ends on it. A
 *  closed spline runs back round to its first point (not repeated). */
export function sampleSpline(ctrl: Point2D[], closed = false): Point2D[] {
  const n = ctrl.length;
  if (n < 3) return ctrl.map((p) => ({ ...p }));
  const at = (i: number): Point2D => {
    if (closed) return ctrl[((i % n) + n) % n];
    if (i < 0) return { x: 2 * ctrl[0].x - ctrl[1].x, y: 2 * ctrl[0].y - ctrl[1].y };
    if (i >= n)
      return { x: 2 * ctrl[n - 1].x - ctrl[n - 2].x, y: 2 * ctrl[n - 1].y - ctrl[n - 2].y };
    return ctrl[i];
  };
  const knot = (p: Point2D, q: Point2D) => Math.sqrt(Math.hypot(q.x - p.x, q.y - p.y)) || 1e-9;
  const spans = closed ? n : n - 1;
  const out: Point2D[] = [];
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1),
      p1 = at(i),
      p2 = at(i + 1),
      p3 = at(i + 2);
    const t1 = knot(p0, p1),
      t2 = t1 + knot(p1, p2),
      t3 = t2 + knot(p2, p3);
    for (let k = 0; k < SAMPLES_PER_SPAN; k++) {
      const t = t1 + ((t2 - t1) * k) / SAMPLES_PER_SPAN;
      const lerp = (a: Point2D, b: Point2D, ta: number, tb: number) => {
        const w = tb - ta || 1e-9;
        return {
          x: ((tb - t) / w) * a.x + ((t - ta) / w) * b.x,
          y: ((tb - t) / w) * a.y + ((t - ta) / w) * b.y,
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
  if (!closed) out.push({ ...ctrl[n - 1] });
  return out;
}

/** A spline entity from its fit points. */
export function splineEntity(
  base: Omit<CadEntity, 'pts' | 'type'>,
  ctrl: Point2D[],
  closed: boolean,
): CadEntity {
  return {
    ...base,
    type: 'spline',
    ctrl: ctrl.map((p) => ({ ...p })),
    isClosed: closed,
    pts: sampleSpline(ctrl, closed),
  };
}

/** The points a user grabs to edit an entity: a spline's fit points, else
 *  its stored points. */
export const editPoints = (e: CadEntity): Point2D[] =>
  e.type === 'spline' && e.ctrl?.length ? e.ctrl : e.pts;
