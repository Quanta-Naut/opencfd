import { Point2D, CadEntity, BoundaryTag } from '../cadWorkflow';
import { Blocking, Block, BlockEdge, BlockVertex } from './types';
import { RKEY, ekey, lerp, near, poly, uid, vkey } from './geometry';

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

/**
 * Multi-block auto-blocking by vertical-strip decomposition.
 *
 * Splits the outline into a lower and an upper chain (both left to right), cuts
 * the domain at every vertex x-coordinate, and makes one block per strip. A ramp
 * comes out as a strip with a slanted floor (still a quad, no corner rounding).
 * Where two flat strips meet at a step in the floor or ceiling, the taller strip
 * is split horizontally so every block stays near-rectangular (backward-facing
 * step -> 3 blocks). Shared edges are de-duplicated so node counts couple across
 * blocks automatically.
 *
 * Falls back to a single 4-sided block when the domain is not x-monotone.
 */
export function autoBlockingFromOutline(
  entities: CadEntity[],
  edgeTagMap: Record<string, BoundaryTag>,
): Blocking | null {
  const src = entities.filter((e) => e.layer !== 'construction' && (e.role === 'domain_boundary' || !e.role));
  const domain = src.filter((e) => e.role === 'domain_boundary');
  const use = domain.length ? domain : src;

  // Single closed entity - just use its points.
  const closed = use.find((e) => (e.isClosed || e.type === 'rectangle' || e.type === 'circle' || e.type === 'ellipse') && (e.pts.length >= 3 || e.type === 'circle' || e.type === 'ellipse'));
  const singleEntityId = closed ? closed.id : undefined;

  const ring = outlineRing(entities);
  if (ring.length < 4) return null;
  const tag = makeTagLookup(entities, edgeTagMap);

  const strips = stripDecomposition(ring, tag, singleEntityId);
  if (strips) return strips;
  return singleBlockFromOutline(ring, tag, singleEntityId);
}

/** One block, four bounding-box corners, sides follow the outline. */
export function singleBlockFromOutline(
  ring: Point2D[],
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
  curveId?: string,
): Blocking | null {
  const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bbox: Point2D[] = [
    { x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY },
  ];
  const cornerIdx = bbox.map((c) => {
    let best = 0, bd = Infinity;
    ring.forEach((p, i) => { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < bd) { bd = d; best = i; } });
    return best;
  });
  const uniq = Array.from(new Set(cornerIdx)).sort((a, b) => a - b);
  if (uniq.length !== 4) return null;

  const verts: BlockVertex[] = uniq.map((ri) => ({ id: uid(), pt: { ...ring[ri] } }));
  const edges: BlockEdge[] = [];
  for (let k = 0; k < 4; k++) {
    const a = uniq[k], b = uniq[(k + 1) % 4];
    const path: Point2D[] = [];
    let i = a;
    while (i !== b) { i = (i + 1) % ring.length; if (i !== b) path.push({ ...ring[i] }); }
    const va = verts[k], vb = verts[(k + 1) % 4];
    const counts = new Map<BoundaryTag, number>();
    let prev = va.pt;
    for (const p of [...path, vb.pt]) { const t = tag(prev, p); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); prev = p; }
    let patch: BoundaryTag | undefined; let pc = 0;
    counts.forEach((c, t) => { if (c > pc) { pc = c; patch = t; } });
    edges.push({ id: uid(), v0: va.id, v1: vb.id, path, patch, nodes: 40, law: 'uniform', ratio: 1, curveId });
  }
  return { vertices: verts, edges, blocks: [{ id: uid(), edges: [edges[0].id, edges[1].id, edges[2].id, edges[3].id] }] };
}


/**
 * Split an x-monotone domain into vertical strips, then split each strip into
 * layers so every block edge is conformal with its neighbours.
 *
 * Strips: the outline is split into a lower and an upper chain (both left to
 * right). A strip boundary exists only where something real changes: the patch
 * tag changes on a chain, or a chain has a vertical jump (a step). A pure shape
 * corner (a ramp starting, a bump) is NOT a cut; it stays an interior point on
 * the block edge's `path`, the same way a circle's outline is one curved edge.
 *
 * Layers: a step leaves the taller neighbour with a vertex partway up its shared
 * edge, so the taller strip needs a split there. Each split is stored as a
 * FRACTION of the strip's local height and drawn as the curve
 * `floor(x) + f * (ceiling(x) - floor(x))`. It therefore bends with the floor
 * and ceiling instead of running dead flat. A flat split is what used to hit a
 * bump or ramp further along and squeeze the cells between them to nothing,
 * and every fix layered on top of it (taper cuts, carried levels) only moved
 * where that happened. A split level carries on through each following strip
 * until the domain end, keeping every shared edge conformal.
 *
 * Rounded ends: a domain whose left or right end is a single point (a C-grid
 * semicircle, a rounded nose) has no inlet cap. The end block instead takes the
 * curved end of the outline, from the point where the outline is 45deg on each
 * chain, as its own side, so no block is squeezed into a triangle there.
 */
export function stripDecomposition(
  ringRaw: Point2D[],
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
  curveId?: string,
): Blocking | null {
  // clean: drop repeats and a duplicated closing point
  const R: Point2D[] = [];
  for (const p of ringRaw) if (!R.length || !near(p, R[R.length - 1], 1e-7)) R.push({ x: p.x, y: p.y });
  if (R.length >= 2 && near(R[0], R[R.length - 1], 1e-7)) R.pop();
  const m = R.length;
  if (m < 4) return null;

  // leftmost / rightmost vertices
  const findExtrema = (): [number, number] => {
    let bl = 0, br = 0;
    for (let i = 1; i < m; i++) {
      if (R[i].x < R[bl].x - 1e-9 || (Math.abs(R[i].x - R[bl].x) < 1e-9 && R[i].y < R[bl].y)) bl = i;
      if (R[i].x > R[br].x + 1e-9 || (Math.abs(R[i].x - R[br].x) < 1e-9 && R[i].y > R[br].y)) br = i;
    }
    return [bl, br];
  };
  let [iL, iR] = findExtrema();

  // A hand-drawn inlet/outlet cap is meant to be vertical, but a mouse-drawn edge is
  // rarely pixel-perfect. Snap a cap edge that is close to vertical (small dx
  // relative to its dy) onto its extremal neighbour's x first, so it ties cleanly
  // like a truly vertical cap and splits through the tie-break above. The cap's
  // far end must be a real corner, though: on a smooth rounded end (a C-grid
  // semicircle) the two segments beside the tip are also nearly vertical, and
  // snapping them flattens the nose into a kinked cap that skews every cell there.
  const snapNearVerticalCap = (idx: number) => {
    for (const [nb, beyond] of [[(idx + 1) % m, (idx + 2) % m], [(idx - 1 + m) % m, (idx - 2 + m) % m]]) {
      const a = R[idx], b = R[nb], c = R[beyond];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      const turn = Math.abs(Math.atan2(
        (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x),
        (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y),
      ));
      if (dx > 1e-9 && dx < dy * 0.1 && turn > Math.PI / 4) b.x = a.x;
    }
  };
  snapNearVerticalCap(iL);
  snapNearVerticalCap(iR);
  [iL, iR] = findExtrema();

  if (Math.abs(R[iL].x - R[iR].x) < 1e-6) return null;

  const walk = (from: number, to: number) => {
    const out: Point2D[] = [R[from]];
    let i = from, guard = 0;
    while (i !== to && guard++ < m + 2) { i = (i + 1) % m; out.push(R[i]); }
    return out;
  };
  const arcA = walk(iL, iR);
  const arcB = walk(iR, iL).reverse();
  const meanY = (a: Point2D[]) => a.reduce((s, p) => s + p.y, 0) / a.length;
  // Snap chain x-coords to the RKEY grid FIRST. Two "coincident" hand-drawn
  // points (e.g. a nozzle exit lip and the far-field inflow that meet there)
  // can differ by a micron; without this the lip vertex is invisible to the
  // strip boundary at that x.
  const snapChain = (a: Point2D[]): Point2D[] => {
    const out: Point2D[] = [];
    for (const p of a) {
      const q = { x: RKEY(p.x), y: p.y };
      if (!out.length || Math.hypot(out[out.length - 1].x - q.x, out[out.length - 1].y - q.y) > 1e-7) out.push(q);
    }
    return out;
  };
  const lower = snapChain(meanY(arcA) <= meanY(arcB) ? arcA : arcB);
  const upper = snapChain(meanY(arcA) <= meanY(arcB) ? arcB : arcA);

  const mono = (a: Point2D[]) => a.every((p, i) => i === 0 || p.x >= a[i - 1].x - 1e-6);
  if (!mono(lower) || !mono(upper)) return null;

  const ys = R.map((p) => p.y);
  const H = Math.max(...ys) - Math.min(...ys) || 1;
  // A hand-closed axis is almost never exactly flat or exactly level with a
  // neighbouring step, so "same height" is judged relative to the domain.
  const tol = H * 1e-4;

  // Strip boundaries: patch tag changes or vertical jumps only (see above).
  const cutXsOf = (chain: Point2D[]): number[] => {
    const xs: number[] = [];
    for (let i = 1; i + 1 < chain.length; i++) {
      const dxPrev = Math.abs(chain[i].x - chain[i - 1].x);
      const dxNext = Math.abs(chain[i + 1].x - chain[i].x);
      if (dxPrev < 1e-6 || dxNext < 1e-6) xs.push(chain[i].x);
      else if (tag(chain[i - 1], chain[i]) !== tag(chain[i], chain[i + 1])) xs.push(chain[i].x);
    }
    return xs;
  };
  const xSet = new Set<number>();
  for (const x of [lower[0].x, lower[lower.length - 1].x, ...cutXsOf(lower), ...cutXsOf(upper)]) xSet.add(RKEY(x));
  const X = [...xSet].sort((a, b) => a - b);
  if (X.length < 2) return null;

  const chainYAt = (chain: Point2D[], x: number, dir: 1 | -1): number => {
    const at = chain.map((p, i) => ({ p, i })).filter((o) => Math.abs(o.p.x - x) < 1e-6);
    if (at.length === 1) return at[0].p.y;
    if (at.length > 1) {
      for (const o of at) {
        if (dir === 1 && o.i + 1 < chain.length && chain[o.i + 1].x > x + 1e-6) return o.p.y;
        if (dir === -1 && o.i - 1 >= 0 && chain[o.i - 1].x < x - 1e-6) return o.p.y;
      }
      const ys = at.map((o) => o.p.y);
      return dir === 1 ? Math.min(...ys) : Math.max(...ys);
    }
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i], b = chain[i + 1];
      if (a.x - 1e-9 <= x && x <= b.x + 1e-9 && b.x - a.x > 1e-12) {
        const t = (x - a.x) / (b.x - a.x);
        return a.y + t * (b.y - a.y);
      }
    }
    return chain[chain.length - 1].y;
  };

  // Optional cuts at sharp shape corners (a converging wall starting, a throat,
  // the ends of a bump). One block spanning several of them has to shear its
  // grid lines to follow the corners, so a cut there straightens them. A corner
  // cut is never required, though: it is made only if every strip it creates
  // stays at least CORNER_MIN_ASPECT times as wide as it is tall. Otherwise the
  // corner stays a path point, so two unrelated corners landing close together
  // can never make a sliver. Sharpest corners are tried first.
  const CORNER_MIN_TURN = (15 * Math.PI) / 180;
  const CORNER_MIN_ASPECT = 0.5;
  // Height of the domain at x, seen from the strip on side `dir` (a step at x
  // has a different height on each side).
  const heightAt = (x: number, dir: 1 | -1) => chainYAt(upper, x, dir) - chainYAt(lower, x, dir);
  const corners: { x: number; turn: number }[] = [];
  for (const c of [lower, upper]) {
    for (let i = 1; i + 1 < c.length; i++) {
      const ax = c[i].x - c[i - 1].x, ay = c[i].y - c[i - 1].y;
      const bx = c[i + 1].x - c[i].x, by = c[i + 1].y - c[i].y;
      const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
      if (turn >= CORNER_MIN_TURN) corners.push({ x: RKEY(c[i].x), turn });
    }
  }
  corners.sort((a, b) => b.turn - a.turn);
  for (const { x } of corners) {
    const k = X.findIndex((v) => v > x - 1e-6);
    if (k <= 0 || Math.abs(X[k] - x) < 1e-6) continue;
    const xl = X[k - 1], xr = X[k], h = heightAt(x, 1);
    if (x - xl < CORNER_MIN_ASPECT * Math.max(heightAt(xl, 1), h)) continue;
    if (xr - x < CORNER_MIN_ASPECT * Math.max(heightAt(xr, -1), h)) continue;
    X.splice(k, 0, x);
  }

  interface QuadSpec {
    bl: Point2D; br: Point2D; tr: Point2D; tl: Point2D;
    bottomPath?: Point2D[]; topPath?: Point2D[]; leftPath?: Point2D[]; rightPath?: Point2D[];
  }
  const dedupe = (pts: Point2D[]): Point2D[] =>
    pts.filter((p, i) => i === 0 || !near(p, pts[i - 1], 1e-9)).map((p) => ({ ...p }));

  // A domain end that closes to a single point (a C-grid semicircle, a rounded
  // nose) rather than a flat cap.
  const isTip = (fromLeft: boolean): boolean => {
    const x = fromLeft ? X[0] : X[X.length - 1];
    const d = fromLeft ? 1 : -1;
    return chainYAt(upper, x, d) - chainYAt(lower, x, d) <= tol * 10;
  };

  // Rounded end as a ring of blocks around a core, written for the LEFT end
  // (the right end mirrors it). Any block corner placed ON a smooth curve is a
  // 180deg corner, which crushes the cells beside it, so the only corners on
  // the curve are where a grid line leaves it along its normal:
  //
  //        A_hi ___ C_hi         nose  = A_lo, B_lo, B_hi, A_hi (its left side is the curve)
  //       /  |      |            core  = B_lo, D_lo, D_hi, B_hi
  //      /  B_hi__D_hi           upper = B_hi, D_hi, C_hi, A_hi
  // tip (    |      |            lower = A_lo, C_lo, D_lo, B_lo
  //      \  B_lo__D_lo
  //       \  |      |            C/D sit on the chord x = xc, where the end has
  //        A_lo ___ C_lo         straightened out (or the first strip boundary).
  //
  // B is a corner of the core; A is the foot of the perpendicular from B onto
  // the outline, so A-B leaves the curve at 90deg. The core's two levels (D)
  // become split levels of the first strip and carry on down the domain.
  const RING_CORE_X = 0.45; // core's left side, as a fraction of tip -> chord
  const RING_CORE_Y = 0.3; // core inset from floor/ceiling, as a fraction of height
  const ringCap = (lo: Point2D[], up: Point2D[], xNext: number) => {
    const tip = lo[0];
    const flatFrom = (c: Point2D[]): number | undefined => {
      for (let i = 0; i + 1 < c.length; i++) {
        const dx = c[i + 1].x - c[i].x, dy = Math.abs(c[i + 1].y - c[i].y);
        if (dx > 1e-9 && dy <= dx * Math.tan(Math.PI / 9)) return c[i].x;
      }
      return undefined;
    };
    let xc = xNext;
    for (const f of [flatFrom(lo), flatFrom(up)]) if (f !== undefined && f > tip.x + 1e-6 && f < xc) xc = f;
    xc = RKEY(xc);
    if (xc - tip.x < 1e-6) return undefined;
    // A step exactly at the chord would need its own split there; not handled.
    if (Math.abs(chainYAt(lo, xc, -1) - chainYAt(lo, xc, 1)) > tol) return undefined;
    if (Math.abs(chainYAt(up, xc, -1) - chainYAt(up, xc, 1)) > tol) return undefined;
    const yl = chainYAt(lo, xc, -1), yu = chainYAt(up, xc, -1), h = yu - yl;
    if (h <= tol * 10) return undefined;

    const bx = tip.x + RING_CORE_X * (xc - tip.x);
    const dLo = yl + RING_CORE_Y * h, dHi = yu - RING_CORE_Y * h;
    const Blo = { x: bx, y: dLo }, Bhi = { x: bx, y: dHi };
    const Dlo = { x: xc, y: dLo }, Dhi = { x: xc, y: dHi };
    const Clo = { x: xc, y: yl }, Chi = { x: xc, y: yu };

    // Foot of the perpendicular from p onto the chain, before the chord.
    const foot = (c: Point2D[], p: Point2D) => {
      let best: { pt: Point2D; i: number; d: number } | undefined;
      for (let i = 0; i + 1 < c.length && c[i].x < xc - 1e-9; i++) {
        const a = c[i], b = { x: Math.min(c[i + 1].x, xc), y: c[i + 1].x > xc ? chainYAt(c, xc, -1) : c[i + 1].y };
        const dx = b.x - a.x, dy = b.y - a.y;
        const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1e-12)));
        const q = { x: a.x + u * dx, y: a.y + u * dy };
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || d < best.d) best = { pt: q, i, d };
      }
      return best;
    };
    const Alo = foot(lo, Blo), Ahi = foot(up, Bhi);
    if (!Alo || !Ahi) return undefined;
    for (const A of [Alo, Ahi]) if (A.pt.x <= tip.x + 1e-6 || A.pt.x >= xc - 1e-6) return undefined;

    const before = (c: Point2D[], A: { i: number }) => c.slice(1, A.i + 1);
    const after = (c: Point2D[], A: { pt: Point2D; i: number }) =>
      c.slice(A.i + 1).filter((p) => p.x < xc - 1e-7 && !near(p, A.pt, 1e-9));
    const nosePath = dedupe([...before(lo, Alo).reverse(), tip, ...before(up, Ahi)])
      .filter((p) => !near(p, Alo.pt, 1e-9) && !near(p, Ahi.pt, 1e-9));
    const quads: QuadSpec[] = [
      { bl: Alo.pt, br: Blo, tr: Bhi, tl: Ahi.pt, leftPath: nosePath },
      { bl: Blo, br: Dlo, tr: Dhi, tl: Bhi },
      { bl: Bhi, br: Dhi, tr: Chi, tl: Ahi.pt, topPath: after(up, Ahi) },
      { bl: Alo.pt, br: Clo, tr: Dlo, tl: Blo, bottomPath: after(lo, Alo) },
    ];
    return { xc, levels: [yl, dLo, dHi, yu], fracs: [RING_CORE_Y, 1 - RING_CORE_Y], quads };
  };
  const mirrorPt = (p: Point2D): Point2D => ({ x: -p.x, y: p.y });
  const mirrorChain = (c: Point2D[]) => [...c].reverse().map(mirrorPt);
  const mirrorQuad = (q: QuadSpec): QuadSpec => ({
    bl: mirrorPt(q.br), br: mirrorPt(q.bl), tr: mirrorPt(q.tl), tl: mirrorPt(q.tr),
    bottomPath: q.bottomPath?.map(mirrorPt).reverse(),
    topPath: q.topPath?.map(mirrorPt).reverse(),
    leftPath: q.rightPath?.map(mirrorPt),
    rightPath: q.leftPath?.map(mirrorPt),
  });

  // Fallback rounded end: one block whose side is the curve between the points
  // where the outline is 45deg on each chain. Used only when the ring can't be
  // made conformal (a split level from elsewhere reaches the end).
  const capX = (fromLeft: boolean): number | undefined => {
    const reach = (chain: Point2D[]) => {
      const c = fromLeft ? chain : [...chain].reverse();
      for (let i = 0; i + 1 < c.length; i++) {
        if (Math.abs(c[i + 1].y - c[i].y) <= Math.abs(c[i + 1].x - c[i].x)) return c[Math.max(i, 1)].x;
      }
      return undefined;
    };
    const a = reach(lower), b = reach(upper);
    if (a === undefined || b === undefined) return undefined;
    const x = fromLeft ? Math.max(a, b) : Math.min(a, b);
    // No strip boundary may fall inside the cap, and at least some strip must remain.
    if (fromLeft ? x >= X[1] - 1e-6 : x <= X[X.length - 2] + 1e-6) return undefined;
    return RKEY(x);
  };
  // The outline between the tip and `x`, running bottom -> tip -> top.
  const capPath = (x: number, fromLeft: boolean): Point2D[] => {
    const inside = (p: Point2D) => (fromLeft ? p.x < x - 1e-7 : p.x > x + 1e-7);
    const lo = lower.filter(inside).map((p) => ({ ...p }));
    const up = upper.filter(inside).map((p) => ({ ...p }));
    return fromLeft ? [...lo.reverse(), ...up.slice(1)] : [...lo, ...up.reverse().slice(1)];
  };

  // Every real vertex strictly between x0 and x1 becomes a path point.
  const pathBetween = (chain: Point2D[], x0: number, x1: number): Point2D[] =>
    chain.filter((p) => p.x > x0 + 1e-7 && p.x < x1 - 1e-7).map((p) => ({ ...p }));

  // Point at arc-length fraction `f` along an open polyline, plus the vertices
  // strictly between fractions `f0` and `f1` (used to split a rounded end).
  const arcSplit = (pts: Point2D[]) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const total = cum[cum.length - 1] || 1;
    const at = (f: number): Point2D => {
      const d = f * total;
      for (let i = 1; i < pts.length; i++) {
        if (d <= cum[i] + 1e-12) return lerp(pts[i - 1], pts[i], (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1));
      }
      return { ...pts[pts.length - 1] };
    };
    const between = (f0: number, f1: number) =>
      pts.filter((_, i) => cum[i] > f0 * total + 1e-9 && cum[i] < f1 * total - 1e-9).map((p) => ({ ...p }));
    return { at, between };
  };

  type Strip = {
    x0: number; x1: number; b0: number; b1: number; t0: number; t1: number;
    bottomPath: Point2D[]; topPath: Point2D[];
    /** Interior split levels as fractions of local height, strictly in (0, 1). */
    fracs: number[];
  };

  const assemble = (useRing: boolean): Blocking | null => {
    const Xs = [...X];
    const quads: QuadSpec[] = [];
    const tipL = isTip(true), tipR = isTip(false);
    const ringL = useRing && tipL && Xs.length >= 2 ? ringCap(lower, upper, Xs[1]) : undefined;
    const ringRm = useRing && tipR && Xs.length >= 2 ? ringCap(mirrorChain(lower), mirrorChain(upper), -Xs[Xs.length - 2]) : undefined;
    const ringR = ringRm ? { ...ringRm, xc: -ringRm.xc, quads: ringRm.quads.map(mirrorQuad) } : undefined;
    // A ring whose chord falls short of the next cut adds a strip boundary there.
    if (ringL) Xs[0] = ringL.xc;
    if (ringR) Xs[Xs.length - 1] = ringR.xc;
    if (Xs[0] >= Xs[Xs.length - 1] - 1e-7) return null;
    const leftCapX = !ringL && tipL ? capX(true) : undefined;
    const rightCapX = !ringR && tipR ? capX(false) : undefined;
    const leftCap = leftCapX !== undefined ? capPath(leftCapX, true) : undefined;
    const rightCap = rightCapX !== undefined ? capPath(rightCapX, false) : undefined;
    if (leftCapX !== undefined) Xs[0] = leftCapX;
    if (rightCapX !== undefined) Xs[Xs.length - 1] = rightCapX;

    const strips: Strip[] = [];
    for (let i = 0; i + 1 < Xs.length; i++) {
      const x0 = Xs[i], x1 = Xs[i + 1];
      if (x1 - x0 < 1e-7) continue;
      strips.push({
        x0, x1,
        b0: chainYAt(lower, x0, 1), b1: chainYAt(lower, x1, -1),
        t0: chainYAt(upper, x0, 1), t1: chainYAt(upper, x1, -1),
        bottomPath: pathBetween(lower, x0, x1),
        topPath: pathBetween(upper, x0, x1),
        fracs: [],
      });
    }
    if (!strips.length) return null;
    const first = strips[0], last = strips[strips.length - 1];

    // Every level at a strip boundary (floor, ceiling, splits) that lies strictly
    // inside the neighbour's own span there must be a level of the neighbour too.
    // Seeding with the floor/ceiling is what makes a step split its taller
    // neighbour; the split then travels strip to strip until it ends.
    const levelsAt = (s: Strip, right: boolean): number[] => {
      const b = right ? s.b1 : s.b0, t = right ? s.t1 : s.t0;
      return [b, ...s.fracs.map((f) => b + f * (t - b)), t];
    };
    const require = (s: Strip, right: boolean, y: number): boolean => {
      const b = right ? s.b1 : s.b0, t = right ? s.t1 : s.t0;
      if (y <= b + tol || y >= t - tol) return false;
      if (levelsAt(s, right).some((l) => Math.abs(l - y) <= tol)) return false;
      s.fracs.push((y - b) / (t - b));
      s.fracs.sort((a, b2) => a - b2);
      return true;
    };
    if (ringL) for (const y of ringL.levels) require(first, false, y);
    if (ringR) for (const y of ringR.levels) require(last, true, y);
    for (let changed = true, guard = 0; changed && guard < 500; guard++) {
      changed = false;
      for (let i = 0; i + 1 < strips.length; i++) {
        const L = strips[i], Rs = strips[i + 1];
        for (const y of levelsAt(L, true)) changed = require(Rs, false, y) || changed;
        for (const y of levelsAt(Rs, false)) changed = require(L, true, y) || changed;
      }
    }
    // The ring's chord carries exactly its own two core levels; any other split
    // reaching it would leave a hanging vertex, so fall back to the plain cap.
    const onlyRing = (s: Strip, right: boolean, ring: { levels: number[] }) =>
      levelsAt(s, right).length === ring.levels.length &&
      levelsAt(s, right).every((y, k) => Math.abs(y - ring.levels[k]) <= tol);
    if (ringL && !onlyRing(first, false, ringL)) return null;
    if (ringR && !onlyRing(last, true, ringR)) return null;

    // One canonical height per level at each strip boundary, so both sides that
    // share it land on the exact same vertex (float noise would otherwise split
    // one vertex into two a hair apart).
    const canon: number[][] = strips.map(() => []);
    canon.push([]);
    if (ringL) canon[0] = [...ringL.levels];
    if (ringR) canon[strips.length] = [...ringR.levels];
    for (let i = 1; i < strips.length; i++) {
      const all = [...levelsAt(strips[i - 1], true), ...levelsAt(strips[i], false)].sort((a, b) => a - b);
      for (const y of all) if (!canon[i].length || y - canon[i][canon[i].length - 1] > tol) canon[i].push(y);
    }
    const snapY = (boundary: number, y: number): number => {
      for (const c of canon[boundary] ?? []) if (Math.abs(c - y) <= tol) return c;
      return y;
    };

    if (ringL) quads.push(...ringL.quads);
    if (ringR) quads.push(...ringR.quads);
    strips.forEach((s, i) => {
      const fr = [0, ...s.fracs, 1];
      // x stations the split curves pass through: every floor/ceiling vertex.
      const xs = [...new Set([...s.bottomPath, ...s.topPath].map((p) => p.x))].sort((a, b) => a - b);
      const splitCurve = (f: number): Point2D[] =>
        xs.map((x) => {
          const b = chainYAt(lower, x, 1), t = chainYAt(upper, x, 1);
          return { x, y: b + f * (t - b) };
        });
      const leftEnd = i === 0 && leftCap ? arcSplit([{ x: s.x0, y: s.b0 }, ...leftCap, { x: s.x0, y: s.t0 }]) : undefined;
      const rightEnd = i === strips.length - 1 && rightCap ? arcSplit([{ x: s.x1, y: s.b1 }, ...rightCap, { x: s.x1, y: s.t1 }]) : undefined;
      const cornerL = (f: number): Point2D => (leftEnd ? leftEnd.at(f) : { x: s.x0, y: snapY(i, s.b0 + f * (s.t0 - s.b0)) });
      const cornerR = (f: number): Point2D => (rightEnd ? rightEnd.at(f) : { x: s.x1, y: snapY(i + 1, s.b1 + f * (s.t1 - s.b1)) });
      for (let k = 0; k + 1 < fr.length; k++) {
        const top = k + 2 === fr.length;
        quads.push({
          bl: cornerL(fr[k]), br: cornerR(fr[k]), tr: cornerR(fr[k + 1]), tl: cornerL(fr[k + 1]),
          bottomPath: k === 0 ? s.bottomPath : splitCurve(fr[k]),
          topPath: top ? s.topPath : splitCurve(fr[k + 1]),
          leftPath: leftEnd?.between(fr[k], fr[k + 1]),
          rightPath: rightEnd?.between(fr[k], fr[k + 1]),
        });
      }
    });

    return blockingFromQuads(quads, tag, curveId);
  };

  return assemble(true) ?? assemble(false);
}

/** Assemble a Blocking from a list of corner quads (BL, BR, TR, TL). Each side
 * optionally carries a `path` of interior points between its corners (bottom and
 * top run left to right, left and right run bottom to top). Shared edges are
 * de-duplicated so node counts couple across blocks automatically. */
function blockingFromQuads(
  quads: {
    bl: Point2D; br: Point2D; tr: Point2D; tl: Point2D;
    bottomPath?: Point2D[]; topPath?: Point2D[]; leftPath?: Point2D[]; rightPath?: Point2D[];
  }[],
  tag: (a: Point2D, b: Point2D) => BoundaryTag | undefined,
  curveId?: string,
): Blocking | null {
  const vByKey = new Map<string, string>();
  const vertices: BlockVertex[] = [];
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vByKey.get(k);
    if (!id) { id = uid(); vByKey.set(k, id); vertices.push({ id, pt: { x: p.x, y: p.y } }); }
    return id;
  };
  // A curved edge (e.g. a rounded domain end) can have its chord midpoint far
  // from the outline, so take the patch that covers most of its length instead.
  const patchOf = (a: Point2D, b: Point2D, path: Point2D[]): BoundaryTag | undefined => {
    if (!path.length) return tag(a, b);
    const len = new Map<BoundaryTag, number>();
    const pts = [a, ...path, b];
    for (let i = 0; i + 1 < pts.length; i++) {
      const t = tag(pts[i], pts[i + 1]);
      if (t) len.set(t, (len.get(t) ?? 0) + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y));
    }
    let best: BoundaryTag | undefined, bl = 0;
    len.forEach((l, t) => { if (l > bl) { bl = l; best = t; } });
    return best;
  };
  const eByKey = new Map<string, BlockEdge>();
  const edges: BlockEdge[] = [];
  const refs = new Map<string, number>();
  const edgeBetween = (a: Point2D, b: Point2D, path?: Point2D[]): BlockEdge => {
    const ia = vid(a), ib = vid(b);
    const k = ekey(ia, ib);
    let e = eByKey.get(k);
    if (!e) {
      e = { id: uid(), v0: ia, v1: ib, path: path ?? [], patch: patchOf(a, b, path ?? []), nodes: 40, law: 'uniform', ratio: 1 };
      eByKey.set(k, e);
      edges.push(e);
    }
    return e;
  };

  const blocks: Block[] = [];
  for (const { bl, br, tr, tl, bottomPath, topPath, leftPath, rightPath } of quads) {
    if (near(bl, br) || near(bl, tl)) continue; // degenerate
    const eb = edgeBetween(bl, br, bottomPath);
    const er = edgeBetween(br, tr, rightPath);
    const et = edgeBetween(tl, tr, topPath);
    const el = edgeBetween(bl, tl, leftPath);
    for (const e of [eb, er, et, el]) refs.set(e.id, (refs.get(e.id) ?? 0) + 1);
    blocks.push({ id: uid(), edges: [eb.id, er.id, et.id, el.id] });
  }
  if (!blocks.length) return null;
  // an edge shared by two blocks is interior: it carries no patch
  for (const e of edges) {
    if ((refs.get(e.id) ?? 0) >= 2) {
      e.patch = undefined;
    } else if (curveId) {
      e.curveId = curveId;
    }
  }

  return { vertices, edges, blocks };
}
