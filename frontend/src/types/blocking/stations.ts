import { Point2D } from '../cadWorkflow';
import { BlockEdge, Blocking } from './types';

// Where an edge's nodes go, as cumulative arc-length fractions from v0.
//
// Normally the grading law decides (lawStations: the same formula the mesher
// uses). An edge that `match`es a wall edge instead puts each node where the
// wall node's normal lands on it, ICEM's copy-by-projection. Around a curved
// wall the arc-length spacing of two offset curves differs (a tight nose is
// short, its offset is long), so matching fractions pairs a wall point with
// an offset point well to one side and the grid line leaves the wall at a
// slant. Matching by projection keeps it square to the wall.

/** Node stations of an edge under its grading law, from v0. At most `keep`
 *  cells come back, picked so a clustered end stays clustered. */
export function lawStations(e: BlockEdge, keep = Infinity): number[] {
  const n = Math.max(1, e.nodes - 1);
  let w: number[];
  if (e.law === 'geometric' && Math.abs(e.ratio - 1) > 1e-6) {
    const q = Math.max(e.ratio, 1e-6) ** (1 / Math.max(1, n - 1));
    w = Array.from({ length: n }, (_, k) => q ** k);
  } else if (e.law === 'bump') {
    const r = Math.max(e.ratio, 0.02);
    w = Array.from({ length: n }, (_, k) => {
      const u = (k + 0.5) / n;
      return r ** (1 - 2 * Math.min(u, 1 - u));
    });
  } else w = Array(n).fill(1);
  w = w.map((x) => Math.max(x, 5e-4));
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const cum = [0];
  for (const x of w) cum.push(cum[cum.length - 1] + x / sum);
  cum[n] = 1;
  return subsample(cum, keep);
}

function subsample(cum: number[], keep: number): number[] {
  const n = cum.length - 1;
  if (n <= keep) return cum;
  return Array.from({ length: keep + 1 }, (_, k) => cum[Math.round((k * n) / keep)]);
}

const chainOf = (e: BlockEdge, vm: Map<string, Point2D>) => [
  vm.get(e.v0)!,
  ...e.path,
  vm.get(e.v1)!,
];

function cumLen(pts: Point2D[]): number[] {
  const c = [0];
  for (let i = 1; i < pts.length; i++)
    c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return c;
}

function at(pts: Point2D[], cum: number[], s: number): { p: Point2D; t: Point2D } {
  let j = 0;
  while (j < pts.length - 2 && cum[j + 1] < s) j++;
  const seg = cum[j + 1] - cum[j] || 1;
  const u = Math.min(1, Math.max(0, (s - cum[j]) / seg));
  const a = pts[j],
    b = pts[j + 1];
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return {
    p: { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) },
    t: { x: (b.x - a.x) / l, y: (b.y - a.y) / l },
  };
}

/** Arc position on `pts` of the nearest hit of ray o + t*d (t > 0), or null. */
function rayOnto(pts: Point2D[], cum: number[], o: Point2D, d: Point2D): number | null {
  let best: { t: number; s: number } | null = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = ((a.x - o.x) * ey - (a.y - o.y) * ex) / den;
    const u = ((a.x - o.x) * d.y - (a.y - o.y) * d.x) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9 && (!best || t < best.t))
      best = { t, s: cum[i] + u * (cum[i + 1] - cum[i]) };
  }
  return best?.s ?? null;
}

/**
 * Stations of `dst` mirroring `src` by projection along src's normals.
 * Null when the edges don't face each other cleanly (the caller falls back to
 * the law).
 */
export function projectedStations(
  src: BlockEdge,
  dst: BlockEdge,
  vm: Map<string, Point2D>,
): number[] | null {
  if (src.nodes !== dst.nodes) return null;
  const S = chainOf(src, vm),
    D = chainOf(dst, vm);
  const cs = cumLen(S),
    cd = cumLen(D);
  const Ls = cs[cs.length - 1],
    Ld = cd[cd.length - 1];
  if (!(Ls > 0 && Ld > 0)) return null;
  // Which end of dst sits across from src.v0.
  const d = (p: Point2D, q: Point2D) => Math.hypot(p.x - q.x, p.y - q.y);
  const same =
    d(S[0], D[0]) + d(S[S.length - 1], D[D.length - 1]) <=
    d(S[0], D[D.length - 1]) + d(S[S.length - 1], D[0]);
  const st = lawStations(src);
  // Normal side: the one that reaches dst at the middle.
  const mid = at(S, cs, Ls / 2);
  const nrm = { x: -mid.t.y, y: mid.t.x };
  const sgn =
    rayOnto(D, cd, mid.p, nrm) !== null
      ? 1
      : rayOnto(D, cd, mid.p, { x: -nrm.x, y: -nrm.y }) !== null
        ? -1
        : 0;
  if (!sgn) return null;
  const out: (number | null)[] = st.map((f, k) => {
    if (k === 0) return 0;
    if (k === st.length - 1) return 1;
    const { p, t } = at(S, cs, f * Ls);
    const s = rayOnto(D, cd, p, { x: -t.y * sgn, y: t.x * sgn });
    if (s === null) return null;
    return same ? s / Ld : 1 - s / Ld;
  });
  // Fill misses by interpolating between hits, then insist on increasing.
  for (let k = 1; k < out.length - 1; k++) {
    if (out[k] !== null) continue;
    let j = k + 1;
    while (out[j] === null) j++;
    const a = out[k - 1]!,
      b = out[j]!;
    out[k] = a + (b - a) / (j - k + 1);
  }
  const f = out as number[];
  for (let k = 1; k < f.length; k++) if (!(f[k] > f[k - 1])) return null;
  // Express from dst.v0.
  return same ? f : f.map((x) => 1 - x).reverse();
}

/** Node stations for an edge from its v0: projected when it matches a wall,
 *  otherwise its law. */
export function edgeStations(
  bk: Blocking,
  e: BlockEdge,
  keep = Infinity,
  vm: Map<string, Point2D> = new Map(bk.vertices.map((v) => [v.id, v.pt] as const)),
  em: Map<string, BlockEdge> = new Map(bk.edges.map((x) => [x.id, x] as const)),
): number[] {
  const src = e.match ? em.get(e.match) : undefined;
  const proj = src ? projectedStations(src, e, vm) : null;
  return proj ? subsample(proj, keep) : lawStations(e, keep);
}
