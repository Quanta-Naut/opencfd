import { Point2D, CadEntity, BoundaryTag } from '../cadWorkflow';
import { Blocking, Block, BlockEdge, BlockVertex, EdgeLaw } from './types';
import { boundsOf, centroidOf, dedupeClose, ekey, entityRing, lerp, pointInRing, resampleClosed, signedArea, uid, vkey } from './geometry';
import { blockCornerIds, blockPolygon, orderBlockEdges, splitAllAt, splitSheet } from './blockEdit';
import { cleanBlocking, propagateNodeCounts } from './sizing';

/** Closed non-domain bodies that look airfoil-like (elongated), for a C-grid. */
export function airfoilsForCGrid(
  entities: CadEntity[],
): { index: number; name: string; aspect: number }[] {
  const out: { index: number; name: string; aspect: number }[] = [];
  entities.forEach((e, index) => {
    if (e.layer === 'construction' || e.role === 'domain_boundary') return;
    if (e.type === 'circle' || e.type === 'ellipse') return;
    if (!(e.isClosed || e.type === 'rectangle')) return;
    const ring = resampleClosed(entityRing(e), 64);
    if (ring.length < 8) return;
    const b = boundsOf(ring);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (w < 1e-6 || h < 1e-6) return;
    out.push({ index, name: (e as any).name || `Body ${index + 1}`, aspect: w / h });
  });
  return out;
}

/**
 * First intersection of ray o->target with OPEN polyline `poly` (unlike
 * `rayPolygonHit`, does not wrap poly[last] back to poly[0] - the outer C
 * boundary is an open arc, not a closed ring, and treating it as closed would
 * let the hit test match the wrong, nonexistent "closing" segment). Returns
 * the hit point and which segment it fell on, so the caller can split the
 * boundary's own point array at the right place.
 */
function rayOpenPolylineHit(
  o: Point2D, target: Point2D, poly: Point2D[],
): { pt: Point2D; segIdx: number } | null {
  const dx = target.x - o.x, dy = target.y - o.y;
  let best: { s: number; pt: Point2D; segIdx: number } | null = null;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i], b = poly[i + 1];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-12) continue;
    const s = ((a.x - o.x) * ey - (a.y - o.y) * ex) / denom;
    const u = ((a.x - o.x) * dy - (a.y - o.y) * dx) / denom;
    if (s > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
      if (!best || s < best.s) best = { s, pt: { x: o.x + s * dx, y: o.y + s * dy }, segIdx: i };
    }
  }
  return best ? { pt: best.pt, segIdx: best.segIdx } : null;
}

/** Index in `poly` at arc-length fraction `t` (0=poly[0], 1=poly[last]). */
function indexAtFraction(poly: Point2D[], t: number): number {
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const d = Math.hypot(poly[i + 1].x - poly[i].x, poly[i + 1].y - poly[i].y);
    segLens.push(d);
    total += d;
  }
  if (total < 1e-9) return Math.max(1, Math.min(poly.length - 2, Math.round(t * (poly.length - 1))));
  const target = t * total;
  let acc = 0;
  for (let i = 0; i < segLens.length; i++) {
    acc += segLens[i];
    if (acc >= target) return Math.max(1, Math.min(poly.length - 2, i + 1));
  }
  return poly.length - 2;
}

/**
 * True wrap C-grid on a C-shaped far-field (semicircle front + straight wake):
 * a nose block and a body block on each of the upper/lower surface (the nose
 * pair meets in a "V" at the leading edge, forward radial shared with the
 * far-field semicircle), plus a conformal pair of wake blocks. Grid lines
 * curve around the leading edge. 6 blocks.
 */
function cGridWrap(
  A: Point2D[],
  iTE: number,
  dom: Point2D[],
  patch?: BoundaryTag,
  airfoilEntityId?: string,
  domainEntityId?: string,
): Blocking | null {
  const TE = { ...A[iTE] };
  let iLE = 0;
  A.forEach((p, i) => { if (p.x < A[iLE].x) iLE = i; });
  const LE = { ...A[iLE] };
  const chord = TE.x - LE.x;
  if (chord < 1e-6) return null;

  const walk = (from: number, to: number) => {
    const s: Point2D[] = [{ ...A[from] }];
    let i = from, guard = 0;
    while (i !== to && guard++ < A.length + 2) { i = (i + 1) % A.length; s.push({ ...A[i] }); }
    return s;
  };
  const w1 = walk(iLE, iTE), w2 = walk(iTE, iLE).reverse();
  const meanY = (s: Point2D[]) => s.reduce((a, p) => a + p.y, 0) / s.length;
  const upper = meanY(w1) >= meanY(w2) ? w1 : w2;   // LE -> TE, top
  const lower = upper === w1 ? w2 : w1;             // LE -> TE, bottom
  if (upper.length < 3 || lower.length < 3) return null;

  const R = dom.map((p) => ({ ...p }));
  const db = boundsOf(R);
  const xR = db.maxX;
  const tol = Math.max(1e-6, (xR - db.minX) * 3e-3);

  // The C far-field is an open polyline: two ends at x = xR (the outlet), the
  // rest running around the front. Rotate the ring so it starts at one outlet
  // end and finishes at the other, walking the long way round.
  const endIdx = R.map((p, i) => ({ p, i })).filter((o) => o.p.x >= xR - tol).map((o) => o.i);
  if (endIdx.length < 2) return null;
  const a = endIdx[0], b = endIdx[endIdx.length - 1];
  const arcFwd = (b - a + R.length) % R.length;
  const [s0, s1] = arcFwd >= R.length - arcFwd ? [a, b] : [b, a];  // start on the longer arc
  const outer: Point2D[] = [];
  for (let k = 0; ; k++) {
    const idx = (s0 + k) % R.length;
    outer.push({ ...R[idx] });
    if (idx === s1) break;
    if (k > R.length) return null;
  }
  if (outer.length < 4) return null;
  if (outer[0].y > outer[outer.length - 1].y) outer.reverse();      // outer[0] is the lower end
  const lo0 = { ...outer[0] }, hi0 = { ...outer[outer.length - 1] };

  // front point (leftmost) of the outer C
  let fi = 0;
  outer.forEach((p, i) => { if (p.x < outer[fi].x) fi = i; });
  const oFront = { ...outer[fi] };

  // the tails run roughly horizontal at x >= TE.x; find where each crosses x = TE.x
  const crossY = (a: Point2D, b: Point2D, x: number) => a.y + (b.y - a.y) * (x - a.x) / ((b.x - a.x) || 1e-9);
  let iWB = 0;
  for (let i = 0; i + 1 <= fi; i++) {
    if ((outer[i].x - TE.x) * (outer[i + 1].x - TE.x) <= 0) { iWB = i; break; }
  }
  let iWT = outer.length - 1;
  for (let i = outer.length - 1; i - 1 >= fi; i--) {
    if ((outer[i].x - TE.x) * (outer[i - 1].x - TE.x) <= 0) { iWT = i; break; }
  }
  const WB = { x: TE.x, y: crossY(outer[iWB], outer[iWB + 1], TE.x) };
  const WT = { x: TE.x, y: crossY(outer[iWT], outer[iWT - 1], TE.x) };
  const wakeOut = { x: xR, y: TE.y };
  // lo0 / hi0 are the domain's back corners at x = xR; they double as the
  // outlet corners (the wake lines are horizontal, so hi0.y == WT.y).

  // interior path points for each far-field edge, in that edge's v0 -> v1 order
  const loWrapOuter = outer.slice(iWB + 1, fi).reverse();   // Front -> WB
  const upWrapOuter = outer.slice(fi + 1, iWT);             // Front -> WT
  const loTailMid = outer.slice(1, iWB + 1).reverse();      // WB -> lo0
  const upTailMid = outer.slice(iWT, outer.length - 1);     // WT -> hi0

  const verts: BlockVertex[] = [];
  const vById = new Map<string, string>();
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vById.get(k);
    if (!id) { id = uid(); vById.set(k, id); verts.push({ id, pt: { x: p.x, y: p.y } }); }
    return id;
  };
  const edges: BlockEdge[] = [];
  const mk = (
    v0: string,
    v1: string,
    path: Point2D[],
    p: BoundaryTag | undefined,
    nodes: number,
    law: EdgeLaw = 'uniform',
    ratio = 1,
    curveId?: string,
  ): string => {
    edges.push({ id: uid(), v0, v1, path: path.map((q) => ({ x: q.x, y: q.y })), patch: p, nodes, law, ratio, curveId });
    return edges[edges.length - 1].id;
  };
  const vLE = vid(LE), vTE = vid(TE), vFront = vid(oFront), vWB = vid(WB), vWT = vid(WT);
  const vLo0 = vid(lo0), vHi0 = vid(hi0), vWakeOut = vid(wakeOut);

  const AROUND = 60, NORMAL = 26, WAKE = 34;
  const teRadU = mk(vTE, vWT, [], undefined, NORMAL, 'geometric', 2.2);
  const teRadL = mk(vTE, vWB, [], undefined, NORMAL, 'geometric', 2.2);

  // Split each wrap block into a NOSE block (the "V" ahead of/around the
  // leading edge, its two sides meeting at LE) and a BODY block (LE-split
  // point out to the trailing edge), the classic multi-block C-grid topology
  // - was one merged wrap block per side, matching a much coarser reference
  // topology than users expect from this kind of mesh.
  //
  // The nose/body split point on the airfoil is picked by arc-length
  // fraction (a small, tight nose region), but its PARTNER on the outer arc
  // is found by casting a ray from the airfoil's own centroid through that
  // surface point out to the far-field boundary - NOT the same arc-length
  // fraction on the outer curve. Tried TWO other approaches first, both
  // wrong in instructive ways:
  //   1. Same arc-length fraction on the outer curve too - assumes both
  //      curves sweep through comparable ANGLES per unit arc length. Fails
  //      badly: the nose is a tight, highly curved region (a lot of angle
  //      per unit length), the far field is a huge gentle semicircle (very
  //      little angle per unit length) - the outer point landed barely round
  //      the corner from straight ahead while the inner point was already
  //      well round the nose. 4-6deg minimum angle, worse than the single
  //      merged block this replaced.
  //   2. Ray-casting from the AIRFOIL'S OWN CENTROID through the surface
  //      point (the technique `wrapBodyOgrid` uses for round/compact
  //      bodies). Fails for a thin, elongated airfoil: the centroid sits
  //      mid-chord, so centroid -> "15% chord on the upper surface" and
  //      centroid -> "18% chord on the lower surface" point in nearly the
  //      SAME direction (both close to "straight toward the nose") instead
  //      of usefully different ones - one ray landed almost exactly on
  //      `oFront` itself, collapsing that block to ~0deg.
  // What actually works: cast from the SURFACE POINT ITSELF along its own
  // local outward normal (standard practice for radial grid lines on a thin
  // body - a centroid-based ray is only meaningful when the body is compact
  // enough that centroid-to-surface approximates surface-normal, which an
  // airfoil is not). The centroid is used only to pick which of the two
  // perpendicular directions counts as "outward".
  const noseFrac = 0.18;
  const ocUFull = [oFront, ...upWrapOuter, WT];
  const ocLFull = [oFront, ...loWrapOuter, WB];
  const iUmid = indexAtFraction(upper, noseFrac);
  const iLmid = indexAtFraction(lower, noseFrac);
  const midU = upper[iUmid], midL = lower[iLmid];
  const gAirfoil = centroidOf(A);
  const outwardNormal = (curve: Point2D[], i: number): Point2D => {
    const a = curve[Math.max(0, i - 1)], b = curve[Math.min(curve.length - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    let nx = -ty / len, ny = tx / len;
    const away = { x: curve[i].x - gAirfoil.x, y: curve[i].y - gAirfoil.y };
    if (nx * away.x + ny * away.y < 0) { nx = -nx; ny = -ny; }
    return { x: nx, y: ny };
  };
  const farReach = Math.max(boundsOf(ocUFull.concat(ocLFull)).maxX - boundsOf(ocUFull.concat(ocLFull)).minX, 1) * 4;
  const nU = outwardNormal(upper, iUmid), nL = outwardNormal(lower, iLmid);
  const hitU = rayOpenPolylineHit(midU, { x: midU.x + nU.x * farReach, y: midU.y + nU.y * farReach }, ocUFull);
  const hitL = rayOpenPolylineHit(midL, { x: midL.x + nL.x * farReach, y: midL.y + nL.y * farReach }, ocLFull);
  if (!hitU || !hitL) return null;
  const iOUmid = hitU.segIdx + 1, iOLmid = hitL.segIdx + 1;  // insert index within ocUFull/ocLFull
  const ocMidU = hitU.pt, ocMidL = hitL.pt;
  const vMidU = vid(midU), vMidL = vid(midL);
  const vOcMidU = vid(ocMidU), vOcMidL = vid(ocMidL);

  const leRad = mk(vLE, vFront, [], undefined, NORMAL, 'geometric', 2.2);   // nose radial, forward of the LE (shared)
  const radMidU = mk(vMidU, vOcMidU, [], undefined, NORMAL, 'geometric', 2.2);  // nose/body split, upper
  const radMidL = mk(vMidL, vOcMidL, [], undefined, NORMAL, 'geometric', 2.2);  // nose/body split, lower

  // circumferential edges cluster nodes toward the leading and trailing edges
  const afNoseU = mk(vLE, vMidU, upper.slice(1, iUmid), patch ?? 'wall', AROUND, 'bump', 0.22, airfoilEntityId);
  const afBodyU = mk(vMidU, vTE, upper.slice(iUmid + 1, -1), patch ?? 'wall', AROUND, 'bump', 0.22, airfoilEntityId);
  const afNoseL = mk(vLE, vMidL, lower.slice(1, iLmid), patch ?? 'wall', AROUND, 'bump', 0.22, airfoilEntityId);
  const afBodyL = mk(vMidL, vTE, lower.slice(iLmid + 1, -1), patch ?? 'wall', AROUND, 'bump', 0.22, airfoilEntityId);
  const ocNoseU = mk(vFront, vOcMidU, ocUFull.slice(1, iOUmid), 'farfield', AROUND, 'bump', 0.35, domainEntityId);
  const ocBodyU = mk(vOcMidU, vWT, ocUFull.slice(iOUmid, -1), 'farfield', AROUND, 'bump', 0.35, domainEntityId);
  const ocNoseL = mk(vFront, vOcMidL, ocLFull.slice(1, iOLmid), 'farfield', AROUND, 'bump', 0.35, domainEntityId);
  const ocBodyL = mk(vOcMidL, vWB, ocLFull.slice(iOLmid, -1), 'farfield', AROUND, 'bump', 0.35, domainEntityId);

  const wcut = mk(vTE, vWakeOut, [], undefined, WAKE, 'geometric', 3);     // shared wake cut
  const wlU = mk(vWT, vHi0, upTailMid, 'farfield', WAKE, 'geometric', 3, domainEntityId);
  const wlL = mk(vWB, vLo0, loTailMid, 'farfield', WAKE, 'geometric', 3, domainEntityId);
  const outEU = mk(vWakeOut, vHi0, [], 'outlet', NORMAL, 'geometric', 4);
  const outEL = mk(vWakeOut, vLo0, [], 'outlet', NORMAL, 'geometric', 4);

  const scratch: Blocking = { vertices: verts, edges, blocks: [], links: [] };
  const O = (ids: string[]) => orderBlockEdges(scratch, ids);
  const bNoseU = O([afNoseU, radMidU, ocNoseU, leRad]);      // nose, upper (the "V" upper half)
  const bNoseL = O([afNoseL, radMidL, ocNoseL, leRad]);      // nose, lower (the "V" lower half)
  const bBodyU = O([afBodyU, teRadU, ocBodyU, radMidU]);     // over-airfoil, upper
  const bBodyL = O([afBodyL, teRadL, ocBodyL, radMidL]);     // over-airfoil, lower
  const bWU = O([wcut, outEU, wlU, teRadU]);  // upper wake
  const bWL = O([wcut, outEL, wlL, teRadL]);  // lower wake

  const ok = [bNoseU, bNoseL, bBodyU, bBodyL, bWU, bWL];
  if (ok.some((o) => !o)) return null;

  const blocks: Block[] = ok.map((o) => ({ id: uid(), edges: o as Block['edges'] }));
  const links: string[][] = [
    [afNoseU, afNoseL], [afBodyU, afBodyL],
    [leRad, radMidU, radMidL, teRadU, teRadL],
  ];
  return propagateNodeCounts(cleanBlocking({ vertices: verts, edges, blocks, links }));
}

/**
 * Closed O-grid around a sharp-trailing-edge airfoil, set into an existing
 * H-grid `bk`: a ring of six blocks (nose, body and wake, per side)
 * that closes behind the trailing edge in a short wake cut, with the rest of
 * the domain left as the background grid.
 *
 * The ring fills the "box": the H-grid block that already holds the airfoil.
 * A side of that block is only cut closer when it sits much further from the
 * airfoil than the ring wants (`offsetFactor` chords, `wakeFactor` behind the
 * trailing edge). The ring's outer corners are exactly the box's four corners
 * plus a front point (at the leading edge's height, upstream side), a wake
 * point (at the trailing edge's height, downstream side) and the points
 * straight above and below the trailing edge, where the radials leave its
 * sharp corner at 90deg. Those four points are carried out to the domain
 * boundary by `splitSheet`, so
 * every box side is shared edge for edge with the grid outside and the mesh
 * stays conformal.
 *
 * (The previous version wrapped `cGridWrap` around a free-standing box and cut
 * the box sides with `splitAllAt` across the whole domain. The ring's outer
 * edges then matched nothing outside: the box came out as an internal
 * boundary wall exported as a `farfield` patch.)
 */
export function wrapAirfoilOgrid(
  bk: Blocking,
  airfoilRaw: Point2D[],
  patch?: BoundaryTag,
  opts?: { airfoilEntityId?: string; wakeFactor?: number; offsetFactor?: number },
): Blocking | null {
  let A = resampleClosed(airfoilRaw.map((p) => ({ x: p.x, y: p.y })), 220);
  if (A.length < 20) return null;
  if (signedArea(A) < 0) A.reverse();
  let iLE = 0, iTE = 0;
  A.forEach((p, i) => { if (p.x < A[iLE].x) iLE = i; if (p.x > A[iTE].x) iTE = i; });
  const LE = { ...A[iLE] }, TE = { ...A[iTE] };
  const chord = TE.x - LE.x;
  if (chord < 1e-6) return null;

  const walk = (from: number, to: number) => {
    const s: Point2D[] = [{ ...A[from] }];
    let i = from, guard = 0;
    while (i !== to && guard++ < A.length + 2) { i = (i + 1) % A.length; s.push({ ...A[i] }); }
    return s;
  };
  const w1 = walk(iLE, iTE), w2 = walk(iTE, iLE).reverse();
  const meanY = (s: Point2D[]) => s.reduce((a, p) => a + p.y, 0) / s.length;
  const upper = meanY(w1) >= meanY(w2) ? w1 : w2; // LE -> TE, top
  const lower = upper === w1 ? w2 : w1; // LE -> TE, bottom

  const wakeFactor = Math.max(0.05, Math.min(1, opts?.wakeFactor ?? 0.15));
  const offsetFactor = Math.max(0.2, Math.min(2, opts?.offsetFactor ?? 0.6));
  const ab = boundsOf(A);
  // Pads scale with chord in every direction, not thickness: a thin airfoil
  // would otherwise get a box many times wider than tall and a badly tapered
  // nose block.
  const pad = offsetFactor * chord;
  const wantGap = { left: pad, right: chord * wakeFactor + pad * 0.5, bottom: pad, top: pad };

  const g = centroidOf(A);
  const hostOf = (w: Blocking) => w.blocks.find((b) => {
    const poly = blockPolygon(w, b);
    return poly.length >= 3 && pointInRing(g.x, g.y, poly);
  });
  let work = bk;
  let host = hostOf(work);
  if (!host) return null;

  // Keep a host side as the box side if it is within 3x of the wanted gap;
  // otherwise cut the host there (the cut runs through that one sheet of
  // blocks to the boundary, nothing else).
  const TOO_FAR = 3;
  const hb = boundsOf(blockPolygon(work, host));
  if (hb.minX > ab.minX || hb.maxX < ab.maxX || hb.minY > ab.minY || hb.maxY < ab.maxY) return null;
  const gaps = { left: ab.minX - hb.minX, right: hb.maxX - ab.maxX, bottom: ab.minY - hb.minY, top: hb.maxY - ab.maxY };
  const sidesToCut = (Object.keys(gaps) as (keyof typeof gaps)[]).filter((k) => gaps[k] > TOO_FAR * wantGap[k]);
  // A side that is cut matches the proportions of the sides that were kept, so
  // a box whose kept sides sit 2x further out than wanted does not get one
  // side pulled in tight (a thin sliver of a column along that side).
  const kept = (Object.keys(gaps) as (keyof typeof gaps)[]).filter((k) => !sidesToCut.includes(k));
  const keptRatios = kept.map((k) => gaps[k] / wantGap[k]).sort((a, b) => a - b);
  const scale = keptRatios.length ? Math.max(1, keptRatios[Math.floor((keptRatios.length - 1) / 2)]) : 1;
  const cuts: ['x' | 'y', number][] = sidesToCut.map((k) => {
    const g = wantGap[k] * scale;
    if (k === 'left') return ['x', ab.minX - g];
    if (k === 'right') return ['x', ab.maxX + g];
    if (k === 'bottom') return ['y', ab.minY - g];
    return ['y', ab.maxY + g];
  });
  for (const [ax, v] of cuts) {
    host = hostOf(work);
    if (!host) return null;
    const next = cutAcross(work, host, ax, v);
    if (!next) return null;
    work = next;
  }
  host = hostOf(work);
  if (!host) return null;

  // Name the host's sides and corners.
  const vm = new Map(work.vertices.map((v) => [v.id, v.pt] as const));
  const em = new Map(work.edges.map((e) => [e.id, e] as const));
  if (blockCornerIds(work, host).length !== 4) return null;
  const sides = host.edges.map((id) => em.get(id)!);
  const polyOf = (e: BlockEdge) => [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
  const mid = (e: BlockEdge) => centroidOf(polyOf(e));
  const kL = [0, 1, 2, 3].reduce((a, k) => (mid(sides[k]).x < mid(sides[a]).x ? k : a), 0);
  const kR = (kL + 2) % 4;
  const kT = mid(sides[(kL + 1) % 4]).y > mid(sides[(kL + 3) % 4]).y ? (kL + 1) % 4 : (kL + 3) % 4;
  const kB = (kT + 2) % 4;
  if (mid(sides[kR]).x <= mid(sides[kL]).x) return null;
  const shared = (a: BlockEdge, b: BlockEdge) => [a.v0, a.v1].find((v) => v === b.v0 || v === b.v1);
  const vTL = shared(sides[kL], sides[kT]), vTR = shared(sides[kR], sides[kT]);
  const vBL = shared(sides[kL], sides[kB]), vBR = shared(sides[kR], sides[kB]);
  if (!vTL || !vTR || !vBL || !vBR) return null;

  // Front point F on the upstream side at the LE's height, wake point W on the
  // downstream side at the TE's height.
  const hitY = (e: BlockEdge, y: number): Point2D | undefined => {
    const pts = polyOf(e);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if ((a.y - y) * (b.y - y) <= 0 && Math.abs(b.y - a.y) > 1e-12) {
        return { x: a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x), y };
      }
    }
    return undefined;
  };
  const hitX = (e: BlockEdge, x: number): Point2D | undefined => {
    const pts = polyOf(e);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if ((a.x - x) * (b.x - x) <= 0 && Math.abs(b.x - a.x) > 1e-12) {
        return { x, y: a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y) };
      }
    }
    return undefined;
  };
  // Box points: F on the upstream side at the LE's height, W on the downstream
  // side at the TE's height, and TT / TB straight above / below the TE, where
  // the radials that leave the sharp trailing edge at 90deg meet the box.
  const F = hitY(sides[kL], LE.y), W = hitY(sides[kR], TE.y);
  const TT = hitX(sides[kT], TE.x), TB = hitX(sides[kB], TE.x);
  if (!F || !W || !TT || !TB) return null;
  const leftE = sides[kL], rightE = sides[kR], topE = sides[kT], botE = sides[kB];
  const hostId = host.id;
  for (const [e, p] of [[leftE, F], [rightE, W], [topE, TT], [botE, TB]] as [BlockEdge, Point2D][]) {
    const next = splitSheet(work, e.id, p, hostId);
    if (!next) return null;
    work = next;
  }

  // Assemble the ring on top of `work`, reusing its vertices and edges.
  const verts = work.vertices.map((v) => ({ id: v.id, pt: { ...v.pt } }));
  const edges = work.edges.map((e) => ({ ...e }));
  const vByKey = new Map(verts.map((v) => [vkey(v.pt), v.id] as const));
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vByKey.get(k);
    if (!id) { id = uid(); vByKey.set(k, id); verts.push({ id, pt: { x: p.x, y: p.y } }); }
    return id;
  };
  const mk = (v0: string, v1: string, path: Point2D[], p: BoundaryTag | undefined, law: EdgeLaw = 'uniform', ratio = 1, curveId?: string): string => {
    const existing = edges.find((e) => ekey(e.v0, e.v1) === ekey(v0, v1));
    if (existing) return existing.id;
    edges.push({ id: uid(), v0, v1, path: path.map((q) => ({ x: q.x, y: q.y })), patch: p, nodes: 30, law, ratio, curveId });
    return edges[edges.length - 1].id;
  };
  // A box side between two of its points, following the host edge's own path.
  const boxPiece = (e: BlockEdge, a: Point2D, b: Point2D): string => {
    const pts = polyOf(e);
    const along = (q: Point2D) => {
      let best = 0, bd = Infinity, acc = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const s = pts[i], t = pts[i + 1];
        const dx = t.x - s.x, dy = t.y - s.y, L = Math.hypot(dx, dy) || 1e-12;
        const u = Math.max(0, Math.min(1, ((q.x - s.x) * dx + (q.y - s.y) * dy) / (L * L)));
        const d = Math.hypot(s.x + u * dx - q.x, s.y + u * dy - q.y);
        if (d < bd) { bd = d; best = acc + u * L; }
        acc += L;
      }
      return best;
    };
    const sa = along(a), sb = along(b);
    const lo = Math.min(sa, sb), hi = Math.max(sa, sb);
    let acc = 0;
    const inner: Point2D[] = [];
    for (let i = 1; i + 1 < pts.length; i++) {
      acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (acc > lo + 1e-9 && acc < hi - 1e-9) inner.push(pts[i]);
    }
    if (sa > sb) inner.reverse();
    return mk(vid(a), vid(b), inner, e.patch, 'uniform', 1, e.curveId);
  };
  const P = (id: string) => vm.get(id)!;

  // Nose split point on each surface: the one whose radial to the box corner
  // makes the best worst-corner angle, at the surface and at the box corner.
  const ang = (o: Point2D, a: Point2D, b: Point2D) => {
    const ax = a.x - o.x, ay = a.y - o.y, bx = b.x - o.x, by = b.y - o.y;
    return Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  };
  const noseSplit = (c: Point2D[], corner: Point2D, f: Point2D, t: Point2D) => {
    let best = -1, bs = -Infinity;
    const i0 = Math.max(2, Math.round(0.03 * (c.length - 1))), i1 = Math.round(0.5 * (c.length - 1));
    for (let i = i0; i <= i1; i++) {
      const score = Math.min(
        ang(c[i], c[i - 2], corner), ang(c[i], c[i + 2], corner),
        ang(corner, c[i], f), ang(corner, c[i], t),
      );
      if (score > bs) { bs = score; best = i; }
    }
    return best;
  };
  const iU1 = noseSplit(upper, P(vTL), F, TT), iL1 = noseSplit(lower, P(vBL), F, TB);
  if (iU1 < 0 || iL1 < 0) return null;

  const vLE = vid(LE), vTE = vid(TE), vF = vid(F), vW = vid(W), vTT = vid(TT), vTB = vid(TB);
  const vU1 = vid(upper[iU1]), vL1 = vid(lower[iL1]);
  const wall = patch ?? 'wall', af = opts?.airfoilEntityId;
  // surface: clustered toward the leading and trailing edges
  const sU1 = mk(vLE, vU1, upper.slice(1, iU1), wall, 'geometric', 4, af);
  const sU2 = mk(vU1, vTE, upper.slice(iU1 + 1, -1), wall, 'bump', 0.4, af);
  const sL1 = mk(vLE, vL1, lower.slice(1, iL1), wall, 'geometric', 4, af);
  const sL2 = mk(vL1, vTE, lower.slice(iL1 + 1, -1), wall, 'bump', 0.4, af);
  // radials: fine at the airfoil (v0), coarsening out to the box
  const RAD = 6;
  const rF = mk(vLE, vF, [], undefined, 'geometric', RAD);
  const rTL = mk(vU1, vTL, [], undefined, 'geometric', RAD);
  const rBL = mk(vL1, vBL, [], undefined, 'geometric', RAD);
  const rTT = mk(vTE, vTT, [], undefined, 'geometric', RAD);
  const rTB = mk(vTE, vTB, [], undefined, 'geometric', RAD);
  const rW = mk(vTE, vW, [], undefined, 'geometric', RAD);
  // box pieces (existing edges where the grid outside already has them)
  const bTLF = boxPiece(leftE, P(vTL), F), bFBL = boxPiece(leftE, F, P(vBL));
  const bTop1 = boxPiece(topE, P(vTL), TT), bTop2 = boxPiece(topE, TT, P(vTR));
  const bBot1 = boxPiece(botE, P(vBL), TB), bBot2 = boxPiece(botE, TB, P(vBR));
  const bTRW = boxPiece(rightE, P(vTR), W), bWBR = boxPiece(rightE, W, P(vBR));

  const scratch: Blocking = { vertices: verts, edges, blocks: [], links: [] };
  const O = (ids: string[]) => orderBlockEdges(scratch, ids);
  const ring = [
    O([sU1, rTL, bTLF, rF]), // nose, upper
    O([sL1, rBL, bFBL, rF]), // nose, lower
    O([sU2, rTT, bTop1, rTL]), // body, upper
    O([sL2, rTB, bBot1, rBL]), // body, lower
    O([rW, bTRW, bTop2, rTT]), // wake, upper
    O([rW, bWBR, bBot2, rTB]), // wake, lower
  ];
  if (ring.some((o) => !o)) return null;

  return cleanBlocking({
    vertices: verts,
    edges,
    blocks: [...work.blocks.filter((b) => b.id !== hostId), ...ring.map((o) => ({ id: uid(), edges: o as Block['edges'] }))],
    links: work.links ?? [],
  });
}

/** Cut `host` along the straight line `axis = value`, and carry the cut out
 * through the blocks on either side to the boundary (one sheet of blocks). */
function cutAcross(bk: Blocking, host: Block, axis: 'x' | 'y', value: number): Blocking | null {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  for (const id of host.edges) {
    const e = bk.edges.find((x) => x.id === id)!;
    const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const va = axis === 'x' ? a.x : a.y, vb = axis === 'x' ? b.x : b.y;
      if (Math.min(va, vb) < value - 1e-9 && Math.max(va, vb) > value + 1e-9) {
        return splitSheet(bk, id, lerp(a, b, (value - va) / (vb - va)));
      }
    }
  }
  return null;
}

/**
 * Airfoil topology that fills the whole (rectangular) domain: a C-H grid of six
 * blocks. Two wrap blocks hug the upper and lower airfoil surface; a full-height
 * pair fills the region upstream of the leading edge, split by the forward
 * stagnation cut; and a pair fills the wake, split by the wake cut. Every
 * interface is conformal. Replaces any existing blocking.
 *
 * Domain perimeter: left edge -> inlet, right edge -> outlet, top / bottom ->
 * farfield. The airfoil surface takes `patch` (default wall).
 */
export function cGridFromAirfoil(
  airfoilRaw: Point2D[],
  domainRing: Point2D[],
  patch?: BoundaryTag,
  airfoilEntityId?: string,
  domainEntityId?: string,
): Blocking | null {
  let A = resampleClosed(airfoilRaw.map((p) => ({ x: p.x, y: p.y })), 220);
  if (A.length < 20) return null;
  if (signedArea(A) < 0) A.reverse();

  let iLE = 0, iTE = 0;
  A.forEach((p, i) => { if (p.x < A[iLE].x) iLE = i; if (p.x > A[iTE].x) iTE = i; });
  const LE = { ...A[iLE] }, TE = { ...A[iTE] };
  const chord = TE.x - LE.x;
  if (chord < 1e-6) return null;

  const dom = dedupeClose(domainRing);
  const db = boundsOf(dom);
  const ab = boundsOf(A);
  const eps = chord * 0.02;
  // the airfoil must sit clear of every domain edge with room for a block
  if (!(db.minX < LE.x - eps && db.maxX > TE.x + chord * 0.3
        && db.minY < ab.minY - eps && db.maxY > ab.maxY + eps)) return null;

  const xL = db.minX, xR = db.maxX, yB = db.minY, yT = db.maxY;
  const yF = LE.y;  // forward stagnation cut level
  const yW = TE.y;  // wake cut level

  // A non-rectangular far-field (the C-grid domain shape: semicircle front +
  // straight wake) gets a true wrap C-grid whose grid lines follow the nose.
  const bboxArea = (xR - xL) * (yT - yB);
  const ringArea = Math.abs(signedArea(dom));
  if (bboxArea > 0 && ringArea < 0.95 * bboxArea) {
    const wrap = cGridWrap(A, iTE, dom, patch, airfoilEntityId, domainEntityId);
    if (wrap) return wrap;
    // fall through to the rectangular H-C grid if the wrap could not be built
  }
  // put the nose vertical cut ahead of the LE so the over-airfoil blocks start
  // clear of the near-vertical nose (avoids sliver cells at the leading edge)
  const xFront = Math.max(LE.x - Math.max(chord * 0.35, eps * 4), (xL + LE.x) / 2);

  const walk = (from: number, to: number) => {
    const s: Point2D[] = [{ ...A[from] }];
    let i = from, guard = 0;
    while (i !== to && guard++ < A.length + 2) { i = (i + 1) % A.length; s.push({ ...A[i] }); }
    return s;
  };
  const w1 = walk(iLE, iTE);            // LE -> TE one way
  const w2 = walk(iTE, iLE).reverse();  // LE -> TE the other way
  const meanY = (s: Point2D[]) => s.reduce((a, p) => a + p.y, 0) / s.length;
  const upper = meanY(w1) >= meanY(w2) ? w1 : w2;   // LE -> TE, top surface
  const lower = upper === w1 ? w2 : w1;             // LE -> TE, bottom surface
  if (upper.length < 3 || lower.length < 3) return null;

  const verts: BlockVertex[] = [];
  const vById = new Map<string, string>();
  const vid = (p: Point2D): string => {
    const k = vkey(p);
    let id = vById.get(k);
    if (!id) { id = uid(); vById.set(k, id); verts.push({ id, pt: { x: p.x, y: p.y } }); }
    return id;
  };
  const edges: BlockEdge[] = [];
  const eKey = new Map<string, string>();
  const straight = (a: Point2D, b: Point2D, p: BoundaryTag | undefined, law: EdgeLaw = 'uniform', ratio = 1): string => {
    const ia = vid(a), ib = vid(b);
    const k = ekey(ia, ib);
    const hit = eKey.get(k);
    if (hit) return hit;
    const e: BlockEdge = { id: uid(), v0: ia, v1: ib, path: [], patch: p, nodes: 40, law, ratio };
    edges.push(e); eKey.set(k, e.id); return e.id;
  };
  const curved = (a: Point2D, b: Point2D, mid: Point2D[], p: BoundaryTag | undefined, curveId?: string): string => {
    const e: BlockEdge = { id: uid(), v0: vid(a), v1: vid(b), path: mid.map((q) => ({ x: q.x, y: q.y })), patch: p, nodes: 40, law: 'uniform', ratio: 1, curveId };
    edges.push(e); return e.id;
  };

  // key points
  const FL = { x: xL, y: yF };                 // forward cut meets the left edge
  const Fm = { x: xFront, y: yF };             // forward cut meets the nose cut
  const WR = { x: xR, y: yW };                 // wake cut meets the right edge
  const nF_T = { x: xFront, y: yT }, nF_B = { x: xFront, y: yB };
  const nLE_T = { x: LE.x, y: yT }, nLE_B = { x: LE.x, y: yB };
  const nTE_T = { x: TE.x, y: yT }, nTE_B = { x: TE.x, y: yB };
  const TLc = { x: xL, y: yT }, BLc = { x: xL, y: yB };
  const TRc = { x: xR, y: yT }, BRc = { x: xR, y: yB };

  // shared interior cuts - the mesh is continuous across the stagnation and
  // wake lines (they are grid lines, not boundaries)
  const sc1 = straight(FL, Fm, undefined);                     // stagnation cut, upstream part
  const sc2 = straight(Fm, LE, undefined);                     // stagnation cut, nose part
  const wcut = straight(TE, WR, undefined, 'geometric', 3);    // wake cut (cluster at TE)
  const fvU = straight(Fm, nF_T, undefined);                   // nose vertical, upper
  const fvL = straight(nF_B, Fm, undefined);                   // nose vertical, lower
  const lvU = straight(LE, nLE_T, undefined);                  // LE vertical, upper
  const lvL = straight(nLE_B, LE, undefined);                  // LE vertical, lower
  const tvU = straight(TE, nTE_T, undefined);                  // TE vertical, upper
  const tvL = straight(nTE_B, TE, undefined);                  // TE vertical, lower
  // airfoil surface (wall) - the two halves share LE and TE but different paths
  const afU = curved(LE, TE, upper.slice(1, -1), patch ?? 'wall', airfoilEntityId);
  const afL = curved(LE, TE, lower.slice(1, -1), patch ?? 'wall', airfoilEntityId);

  const scratch: Blocking = { vertices: verts, edges, blocks: [], links: [] };
  const B = (ids: string[]) => orderBlockEdges(scratch, ids);

  const bUF = B([sc1, fvU, straight(TLc, nF_T, 'farfield'), straight(FL, TLc, 'inlet', 'geometric', 3)]);
  const bLF = B([straight(BLc, nF_B, 'farfield'), fvL, sc1, straight(BLc, FL, 'inlet', 'geometric', 3)]);
  const bNU = B([sc2, lvU, straight(nF_T, nLE_T, 'farfield'), fvU]);
  const bNL = B([straight(nF_B, nLE_B, 'farfield'), lvL, sc2, fvL]);
  const bUA = B([afU, tvU, straight(nLE_T, nTE_T, 'farfield'), lvU]);
  const bLA = B([straight(nLE_B, nTE_B, 'farfield'), tvL, afL, lvL]);
  const bUW = B([wcut, straight(WR, TRc, 'outlet', 'geometric', 3), straight(nTE_T, TRc, 'farfield'), tvU]);
  const bLW = B([straight(nTE_B, BRc, 'farfield'), straight(BRc, WR, 'outlet', 'geometric', 3), wcut, tvL]);

  const ord = [bUF, bLF, bNU, bNL, bUA, bLA, bUW, bLW];
  if (ord.some((o) => !o)) return null;

  const blocks: Block[] = ord.map((o) => ({ id: uid(), edges: o as Block['edges'] }));
  // keep the wall-normal counts consistent along and across the airfoil
  const links: string[][] = [[afU, afL], [fvU, lvU, tvU], [fvL, lvL, tvL]];

  return propagateNodeCounts(cleanBlocking({ vertices: verts, edges, blocks, links }));
}
