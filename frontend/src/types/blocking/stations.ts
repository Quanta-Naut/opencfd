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
 *  cells come back, picked so a clustered end stays clustered. `len` is the
 *  edge's length, needed by 'tanh' and 'bigeometric' (their spacings are absolute). */
export function lawStations(e: BlockEdge, keep = Infinity, len = 0): number[] {
  const n = Math.max(1, e.nodes - 1);
  if (e.law === 'tanh') {
    const d0 = e.spacing1 && len > 0 ? e.spacing1 / len : undefined;
    const d1 = e.spacing2 && len > 0 ? e.spacing2 / len : undefined;
    return subsample(tanhStations(n, d0, d1), keep);
  }
  if (e.law === 'bigeometric') {
    const f = (x?: number) => (x && len > 0 ? x / len : undefined);
    return subsample(
      biGeometricStations(
        n,
        f(e.spacing1),
        e.ratio1 ?? 1.2,
        f(e.spacing2),
        e.ratio2 ?? 1.2,
        f(e.maxSpace),
      ),
      keep,
    );
  }
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

// ── Hyperbolic tangent law (Vinokur 1983), as Pointwise distributes ─────────
//
// Two-sided: x(xi) = u / (A + (1 - A) u), u = (1 + tanh(d (xi - 1/2)) / tanh(d/2)) / 2,
// with A = sqrt(ds1 / ds0) and sinh(d) / d = 1 / (n sqrt(ds0 ds1)). One-sided
// uses x = 1 + tanh(d/2 (xi - 1)) / tanh(d/2) with sinh(d) / d = 1 / (n ds0).
// When the request is coarser than uniform the sin / tan forms take over. The
// formulas match end slopes, so a few corrections make the first cell exact.

/** Solve sinh(d)/d = b (b > 1) or sin(d)/d = b (b < 1) for d > 0. */
function solveDelta(b: number): number {
  if (b > 1) {
    let d = b < 2.7 ? Math.sqrt(6 * (b - 1)) : Math.log(2 * b * Math.log(2 * b)) + 1;
    if (!(d > 0)) d = 1;
    for (let i = 0; i < 60; i++) {
      const f = Math.sinh(d) / d - b;
      const fp = (Math.cosh(d) * d - Math.sinh(d)) / (d * d);
      const nd = d - f / fp;
      d = nd > 0 ? nd : d / 2;
      if (Math.abs(f) < 1e-12 * b) break;
    }
    return d;
  }
  let lo = 1e-9;
  let hi = Math.PI - 1e-9;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (Math.sin(m) / m > b) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

function tanhRaw(n: number, d0?: number, d1?: number): number[] {
  const xs = Array.from({ length: n + 1 }, (_, k) => k / n);
  if (d0 && d1) {
    const A = Math.sqrt(d1 / d0);
    const b = 1 / (n * Math.sqrt(d0 * d1));
    const d = Math.abs(b - 1) < 1e-3 ? 0 : solveDelta(b);
    return xs.map((x) => {
      const u = !d
        ? x
        : b > 1
          ? 0.5 * (1 + Math.tanh(d * (x - 0.5)) / Math.tanh(d / 2))
          : 0.5 * (1 + Math.tan(d * (x - 0.5)) / Math.tan(d / 2));
      return u / (A + (1 - A) * u);
    });
  }
  const one = (ds: number) => {
    const b = 1 / (n * ds);
    if (Math.abs(b - 1) < 1e-3) return xs;
    const d = solveDelta(b);
    return xs.map((x) =>
      b > 1
        ? 1 + Math.tanh((d / 2) * (x - 1)) / Math.tanh(d / 2)
        : 1 + Math.tan((d / 2) * (x - 1)) / Math.tan(d / 2),
    );
  };
  if (d0) return one(d0);
  if (d1)
    return one(d1)
      .map((x) => 1 - x)
      .reverse();
  return xs;
}

/** Stations for `n` cells with first cell `d0` at the start and `d1` at the
 *  end (fractions of the length; either may be omitted). */
export function tanhStations(n: number, d0?: number, d1?: number): number[] {
  // A spacing at or above a whole cell's share cannot cluster: drop it.
  const ok = (d?: number) => (d && d > 0 && d < 1 ? d : undefined);
  d0 = ok(d0);
  d1 = ok(d1);
  let a = d0;
  let b = d1;
  let s = tanhRaw(n, a, b);
  for (let it = 0; it < 30; it++) {
    const e0 = d0 ? d0 / (s[1] - s[0]) : 1;
    const e1 = d1 ? d1 / (s[n] - s[n - 1]) : 1;
    if (Math.abs(e0 - 1) < 1e-6 && Math.abs(e1 - 1) < 1e-6) break;
    if (a) a *= e0;
    if (b) b *= e1;
    const next = tanhRaw(n, a, b);
    if (next.some((x, k) => !Number.isFinite(x) || (k > 0 && !(x > next[k - 1])))) break;
    s = next;
  }
  s[0] = 0;
  s[n] = 1;
  return s;
}

// ── Bi-geometric law, as ICEM CFD's edge params ─────────────────────────────
//
// Cells start at the end spacings and grow by their ratios toward the middle,
// where they level off at a common size (at most Max space) that makes the
// node count fill the edge. When the ratios cannot fill it in that many cells
// they are raised, the way ICEM reports a larger "actual" ratio.

/** Stations for `n` cells; spacings and max space are fractions of the length. */
export function biGeometricStations(
  n: number,
  d0: number | undefined,
  r0: number,
  d1: number | undefined,
  r1: number,
  cap?: number,
): number[] {
  const ok = (d?: number) => (d && d > 0 && d < 1 ? d : undefined);
  d0 = ok(d0);
  d1 = ok(d1);
  if (!d0 && !d1) return Array.from({ length: n + 1 }, (_, k) => k / n);
  const sizes = (g0: number, g1: number, c: number) =>
    Array.from({ length: n }, (_, i) =>
      Math.min(d0 ? d0 * g0 ** i : Infinity, d1 ? d1 * g1 ** (n - 1 - i) : Infinity, c),
    );
  const total = (g0: number, g1: number, c: number) => sizes(g0, g1, c).reduce((a, b) => a + b, 0);
  let g0 = Math.max(1, r0);
  let g1 = Math.max(1, r1);
  const top = cap && cap > 0 ? cap : Infinity;
  // Too few cells to fill the edge at these ratios: steepen both.
  if (total(g0, g1, top) < 1) {
    const at = (k: number) => [
      1 + (Math.max(g0, 1.001) - 1) * k,
      1 + (Math.max(g1, 1.001) - 1) * k,
    ];
    let lo = 1;
    let hi = 2;
    while (total(...(at(hi) as [number, number]), top) < 1 && hi < 1e6) hi *= 2;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (total(...(at(mid) as [number, number]), top) < 1) lo = mid;
      else hi = mid;
    }
    [g0, g1] = at(hi);
  }
  // Level-off size that makes the cells add up to the length.
  let lo = 0;
  let hi = Math.min(top, 1);
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (total(g0, g1, mid) < 1) lo = mid;
    else hi = mid;
  }
  const w = sizes(g0, g1, hi);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const cum = [0];
  for (const x of w) cum.push(cum[cum.length - 1] + x / sum);
  cum[n] = 1;
  return cum;
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
  const st = curvedStations(src, S, cs);
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
  if (proj) return subsample(proj, keep);
  const chain = chainOf(e, vm);
  return subsample(curvedStations(e, chain, cumLen(chain)), keep);
}

// ── Curvature refinement ───────────────────────────────────────────────────
//
// Nodes gather where an edge turns: round a nose, into a bend, along a
// fillet. The law's stations are remapped through the cumulative weight
// w(s) = 1 + strength * rho(s), where rho is the turning per unit length
// relative to the edge's average (smoothed so a polyline's corners count as
// a bend). A circular arc turns evenly, so it stays as the law has it.

/** Map from law fraction to arc fraction, and the stretch it puts on the
 *  end cells (w at the end over the mean). Null for a straight edge. */
export function curvatureWarp(
  chain: Point2D[],
  cum: number[],
  strength: number,
): { inv: (t: number) => number; end0: number; end1: number } | null {
  const L = cum[cum.length - 1];
  if (!(strength > 0) || !(L > 0) || chain.length < 3) return null;
  const M = 400;
  const pts = Array.from({ length: M + 1 }, (_, i) => at(chain, cum, (L * i) / M).p);
  const turn = new Array(M).fill(0);
  let total = 0;
  for (let i = 1; i < M; i++) {
    const ax = pts[i].x - pts[i - 1].x,
      ay = pts[i].y - pts[i - 1].y;
    const bx = pts[i + 1].x - pts[i].x,
      by = pts[i + 1].y - pts[i].y;
    const a = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    // Half to the interval each side of the sample.
    turn[i - 1] += a / 2;
    turn[i] += a / 2;
    total += a;
  }
  if (total < 0.05) return null;
  // Box smoothing over 4% of the edge each side.
  const W = 16;
  const sm = turn.map((_, i) => {
    let s = 0,
      c = 0;
    for (let j = Math.max(0, i - W); j <= Math.min(M - 1, i + W); j++) {
      s += turn[j];
      c++;
    }
    return s / c;
  });
  const mean = total / M;
  const w = sm.map((x) => 1 + strength * (x / mean));
  const cw = [0];
  for (const x of w) cw.push(cw[cw.length - 1] + x);
  const tot = cw[M];
  const wMean = tot / M;
  const inv = (t: number) => {
    const target = t * tot;
    let i = 0;
    while (i < M - 1 && cw[i + 1] < target) i++;
    const u = (target - cw[i]) / (cw[i + 1] - cw[i] || 1);
    return Math.min(1, Math.max(0, (i + u) / M));
  };
  return { inv, end0: w[0] / wMean, end1: w[M - 1] / wMean };
}

/** The law's stations, refined by curvature when the edge asks for it. End
 *  spacings still come out as set: the law is asked for the end cells the
 *  remap will stretch into them. */
function curvedStations(e: BlockEdge, chain: Point2D[], cum: number[]): number[] {
  const L = cum[cum.length - 1];
  const warp = e.curvature ? curvatureWarp(chain, cum, e.curvature) : null;
  if (!warp) return lawStations(e, Infinity, L);
  const adj = {
    ...e,
    spacing1: e.spacing1 ? e.spacing1 * warp.end0 : e.spacing1,
    spacing2: e.spacing2 ? e.spacing2 * warp.end1 : e.spacing2,
  };
  const st = lawStations(adj, Infinity, L).map(warp.inv);
  st[0] = 0;
  st[st.length - 1] = 1;
  return st;
}
