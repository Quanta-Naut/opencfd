import { Point2D } from '../../../types/cadWorkflow';

// The on-canvas manipulator of Move, Scale and Rotate (Fusion 360 style):
// arrows along X and Y and a centre square to drag freely (Move), square-tipped
// arms per axis and a centre square for an even scale (Scale), a ring to turn
// (Rotate). Sizes are in screen pixels so it looks the same at any zoom.

export type GizmoKind = 'move' | 'scale' | 'rotate';
export type GizmoHandle = 'x' | 'y' | 'xy' | 'rot';

export const GIZMO = { arm: 76, head: 10, box: 7, ring: 62, pick: 7 };

const segDist = (p: Point2D, a: Point2D, b: Point2D) => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
};

/** The handle under screen point `m`, for a gizmo whose origin is at screen
 *  point `o` (screen y points down, so +Y is up the screen). */
export function hitGizmo(kind: GizmoKind, o: Point2D, m: Point2D): GizmoHandle | null {
  const { arm, box, ring, pick } = GIZMO;
  if (kind === 'rotate')
    return Math.abs(Math.hypot(m.x - o.x, m.y - o.y) - ring) < pick ? 'rot' : null;
  if (Math.abs(m.x - o.x) <= box + 2 && Math.abs(m.y - o.y) <= box + 2) return 'xy';
  if (segDist(m, { x: o.x + box, y: o.y }, { x: o.x + arm + 4, y: o.y }) < pick) return 'x';
  if (segDist(m, { x: o.x, y: o.y - box }, { x: o.x, y: o.y - arm - 4 }) < pick) return 'y';
  return null;
}
