import { Point2D, CadEntity, BoundaryTag } from '../cadWorkflow';
import { poly } from './geometry';

/** Merge every domain-boundary / geometry outline entity into one ordered ring. */
export function outlineRing(entities: CadEntity[]): Point2D[] {
  const src = entities.filter((e) => e.layer !== 'construction' && (e.role === 'domain_boundary' || !e.role));
  const domain = src.filter((e) => e.role === 'domain_boundary');
  const use = domain.length ? domain : src;

  // Single closed entity - just use its points.
  const closed = use.find((e) => (e.isClosed || e.type === 'rectangle' || e.type === 'circle' || e.type === 'ellipse') && (e.pts.length >= 3 || e.type === 'circle' || e.type === 'ellipse'));
  if (closed) return poly(closed);

  // Stitch loose segments end to end.
  const segs = use.filter((e) => e.pts.length === 2).map((e) => [{ ...e.pts[0] }, { ...e.pts[1] }] as [Point2D, Point2D]);
  if (segs.length < 3) return [];
  const near = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-4;
  const chain: Point2D[] = [segs[0][0], segs[0][1]];
  const used = new Set([0]);
  while (used.size < segs.length) {
    const tail = chain[chain.length - 1];
    let advanced = false;
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      if (near(segs[i][0], tail)) { chain.push(segs[i][1]); used.add(i); advanced = true; break; }
      if (near(segs[i][1], tail)) { chain.push(segs[i][0]); used.add(i); advanced = true; break; }
    }
    if (!advanced) break;
  }
  if (chain.length >= 4 && near(chain[0], chain[chain.length - 1])) chain.pop();
  return chain;
}

/** Build a "tag at this segment midpoint" lookup from the tagged geometry edges. */
export function makeTagLookup(entities: CadEntity[], edgeTagMap: Record<string, BoundaryTag>) {
  const xs: number[] = [], ys: number[] = [];
  for (const e of entities) for (const p of e.pts) { xs.push(p.x); ys.push(p.y); }
  const span = Math.max(
    (Math.max(...xs) || 0) - (Math.min(...xs) || 0),
    (Math.max(...ys) || 0) - (Math.min(...ys) || 0),
    1,
  );
  return (a: Point2D, b: Point2D): BoundaryTag | undefined => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let best: BoundaryTag | undefined;
    let bd = span * 0.06 + 1e-6;
    for (const e of entities) {
      if (e.layer === 'construction' || e.type === 'circle' || e.type === 'ellipse') continue;
      const n = e.pts.length;
      const count = e.isClosed || e.type === 'rectangle' ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const p0 = e.pts[i], p1 = e.pts[(i + 1) % n];
        const t = edgeTagMap[`${e.id}_${i}`];
        if (!t) continue;
        // distance from the block-edge midpoint to this geometry segment
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const L2 = dx * dx + dy * dy || 1e-12;
        let u = ((mx - p0.x) * dx + (my - p0.y) * dy) / L2;
        u = Math.max(0, Math.min(1, u));
        const d = Math.hypot(p0.x + u * dx - mx, p0.y + u * dy - my);
        if (d < bd) { bd = d; best = t; }
      }
    }
    return best;
  };
}
