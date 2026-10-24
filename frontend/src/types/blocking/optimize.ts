import { BoundaryTag, CadEntity, Point2D } from '../cadWorkflow';
import { Blocking, BlockEdge } from './types';
import { blockCornerIds } from './blockEdit';
import { Outline, outlinesFor, outlineUnder } from './editor';
import { outlineBreaks } from './vertexHome';
import { propagateNodeCounts } from './sizing';
import { boundsOf } from './geometry';
import { edgeStations } from './stations';

// Block shape optimization: the "check it, move it, check again" loop.
//
// The blocking's topology stays as it is; the optimizer decides where the
// block corners go and how the edges between blocks bend (GridPro and the
// floating-boundary elliptic solvers in Pointwise work the same way):
//
//   1. Every block is filled with a coarse transfinite grid and the blocks are
//      stitched into one quad mesh, so a block interface is just another grid
//      line and a block corner is just a grid node with 3, 4 or 5 cells.
//   2. Interior nodes move freely. A block vertex on the geometry slides along
//      it (stopping at corners and patch changes, which stay pinned), and the
//      nodes of a wall edge are spread along the real curve between its ends.
//   3. Every cell corner is scored with the target-matrix condition number
//      (Knupp): 1 when the corner has its target angle and aspect, growing
//      without bound as the corner collapses or folds. The target angle is 90
//      degrees on ordinary nodes, 360/n at a block corner shared by n cells and
//      the fluid angle / n on the geometry, so grid lines leave walls at right
//      angles and cross block interfaces without kinks.
//   4. Gauss-Seidel sweeps move one node at a time downhill, sweep after sweep,
//      until the largest move is a negligible fraction of the local cell size.
//
// A small regularisation of the determinant (Escobar et al.) lets the same
// loop untangle a start that is already folded.

export interface OptimizeOptions {
  /** Boundary-patch lookup, so a patch change pins a vertex like a corner. */
  tag?: (a: Point2D, b: Point2D) => BoundaryTag | undefined;
  /** Upper bound on sweeps. */
  maxSweeps?: number;
  /** Converged when no node moves more than this fraction of its cell size,
   *  or the cost changes by less than this (relative) over 10 sweeps. */
  tol?: number;
  /** Emit a snapshot every this many sweeps (0 = only the final result). */
  yieldEvery?: number;
  /** Rough size of the working mesh in cells. */
  targetCells?: number;
}

export interface OptimizeStep {
  sweep: number;
  /** Mean corner condition number (1 is ideal). */
  quality: number;
  /** Largest node move this sweep, relative to its cell size. */
  moved: number;
  converged: boolean;
  blocking: Blocking;
  /** The working mesh (for debugging and previews). */
  mesh?: { x: number[]; y: number[]; cells: number[][] };
}

interface Ring {
  pts: Point2D[];
  cum: number[];
  L: number;
  /** Arc positions of the corners and patch changes. */
  breaks: number[];
  /** +1 when the fluid is inside the ring (domain), -1 outside (body). */
  inside: boolean;
  ccw: boolean;
  /** Larger side of the bounding box (sets the on-outline tolerance). */
  size: number;
}

const mod = (a: number, L: number) => ((a % L) + L) % L;

function makeRing(o: Outline, tag: OptimizeOptions['tag']): Ring {
  const pts = o.pts;
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return {
    pts,
    cum,
    L: cum[pts.length],
    breaks: outlineBreaks(pts, tag).map((i) => cum[i]),
    inside: !o.body,
    ccw: area > 0,
    size: (() => {
      const b = boundsOf(pts);
      return Math.max(b.maxX - b.minX, b.maxY - b.minY, 1e-9);
    })(),
  };
}

function ringAt(r: Ring, s: number): Point2D {
  const t = mod(s, r.L);
  let lo = 0,
    hi = r.pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.cum[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = r.pts[lo],
    b = r.pts[(lo + 1) % r.pts.length];
  const seg = r.cum[lo + 1] - r.cum[lo] || 1;
  const u = (t - r.cum[lo]) / seg;
  return { x: a.x + u * (b.x - a.x), y: a.y + u * (b.y - a.y) };
}

function ringParam(r: Ring, p: Point2D): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  const n = r.pts.length;
  for (let i = 0; i < n; i++) {
    const a = r.pts[i],
      b = r.pts[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1e-18;
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(a.x + u * dx - p.x, a.y + u * dy - p.y);
    if (d < best.d) best = { s: r.cum[i] + u * Math.sqrt(l2), d };
  }
  return best;
}

/** Angle on the fluid side of the ring at arc position s. */
function fluidAngle(r: Ring, s: number): number {
  const h = r.L * 1e-4;
  const p = ringAt(r, s),
    a = ringAt(r, s - h),
    b = ringAt(r, s + h);
  const turn = Math.atan2(
    (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x),
    (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y),
  );
  const left = r.ccw ? turn : -turn; // turning towards the ring's inside
  return r.inside ? Math.PI - left : Math.PI + left;
}

/** Ring points strictly inside the arc from s0 running `len` in direction dir. */
function arcPoints(r: Ring, s0: number, len: number, dir: number): Point2D[] {
  const eps = r.L * 1e-7;
  const out: { d: number; p: Point2D }[] = [];
  for (let i = 0; i < r.pts.length; i++) {
    const d = dir > 0 ? mod(r.cum[i] - s0, r.L) : mod(s0 - r.cum[i], r.L);
    if (d > eps && d < len - eps) out.push({ d, p: { ...r.pts[i] } });
  }
  return out.sort((a, b) => a.d - b.d).map((o) => o.p);
}

/** Centripetal-ish Catmull-Rom through pts; returns the interior points. */
function smoothInterior(pts: Point2D[], sub: number): Point2D[] {
  if (pts.length < 3) return [];
  const out: Point2D[] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = P(i - 1),
      p1 = P(i),
      p2 = P(i + 1),
      p3 = P(i + 2);
    for (let k = i === 0 ? 1 : 0; k < sub; k++) {
      const t = k / sub,
        t2 = t * t,
        t3 = t2 * t;
      if (k === 0) {
        out.push({ ...p1 });
        continue;
      }
      out.push({
        x:
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

const FREE = 0,
  FIXED = 1,
  SLIDE = 2,
  DEPENDENT = 3;
/** Interior node of a block edge: moves only across the edge (bending it),
 *  because the mesher spaces an edge's nodes by its law, not where they sit. */
const ALONG_EDGE = 4;

interface WallEdge {
  ring: number;
  a: number;
  b: number;
  dir: number;
  /** Arc position of an end that never moves (NaN when it slides). */
  sa: number;
  sb: number;
  inner: number[];
  /** Node stations along the edge from a (its grading law). */
  fr: number[];
}

/**
 * Optimize the vertex positions and interior edge shapes of a blocking.
 * A generator: it yields snapshots while it works and returns the result, so
 * the caller can animate the blocks settling and stop at any time.
 */
export function* optimizeBlocking(
  input: Blocking,
  entities: CadEntity[],
  opts: OptimizeOptions = {},
): Generator<OptimizeStep, OptimizeStep | null> {
  const maxSweeps = opts.maxSweeps ?? 400;
  const tol = opts.tol ?? 1e-5;
  const yieldEvery = opts.yieldEvery ?? 0;
  const bk = propagateNodeCounts(input);
  const outlines = outlinesFor(entities);
  const rings = outlines.map((o) => makeRing(o, opts.tag));
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));

  // ── Working-mesh resolution: one scale for every edge keeps counts conforming.
  let fine = 0;
  for (const blk of bk.blocks) {
    const [e0, e1] = [em.get(blk.edges[0]), em.get(blk.edges[1])];
    if (!e0 || !e1) return null;
    fine += Math.max(1, e0.nodes - 1) * Math.max(1, e1.nodes - 1);
  }
  const f = Math.min(1, Math.sqrt((opts.targetCells ?? 800) / Math.max(1, fine)));
  const cellsOf = (e: BlockEdge) => Math.max(3, Math.round(Math.max(1, e.nodes - 1) * f));

  // ── Nodes.
  const X: number[] = [],
    Y: number[] = [],
    kind: number[] = [];
  const addNode = (p: Point2D, k: number) => (X.push(p.x), Y.push(p.y), kind.push(k), X.length - 1);
  const vNode = new Map<string, number>();
  const slideRing: number[] = [],
    slideS: number[] = [],
    slideLo: number[] = [],
    slideHi: number[] = [];
  const nodeRingS = new Map<number, { ring: number; s: number }>();
  for (const v of bk.vertices) {
    let k = v.curves?.length ? FIXED : FREE;
    let onRing = -1,
      s = 0;
    for (let r = 0; r < rings.length && onRing < 0; r++) {
      const pr = ringParam(rings[r], v.pt);
      if (pr.d <= rings[r].size * 1e-4) (onRing = r), (s = pr.s);
    }
    const id = addNode(v.pt, k);
    vNode.set(v.id, id);
    if (onRing >= 0) {
      const R = rings[onRing];
      const tolS = R.L * 5e-5;
      const atBreak = R.breaks.some((b) => Math.abs(mod(s - b + R.L / 2, R.L) - R.L / 2) <= tolS);
      nodeRingS.set(id, { ring: onRing, s });
      if (atBreak || v.curves?.length) kind[id] = FIXED;
      else {
        kind[id] = SLIDE;
        let lo = -Infinity,
          hi = Infinity;
        if (R.breaks.length) {
          const ahead = R.breaks.map((b) => mod(b - s, R.L));
          const behind = R.breaks.map((b) => mod(s - b, R.L));
          hi = s + Math.min(...ahead);
          lo = s - Math.min(...behind);
        }
        slideRing[id] = onRing;
        slideS[id] = s;
        slideLo[id] = lo;
        slideHi[id] = hi;
      }
    }
  }

  // ── Edge nodes, v0 -> v1 inclusive.
  const edgeNodes = new Map<string, number[]>();
  const walls: WallEdge[] = [];
  /** Node chains (v0 .. v1) of the edges the optimizer may bend. */
  const bendable: number[][] = [];
  const edgeNeighbours = new Map<number, [number, number]>();
  const wallsOfNode = new Map<number, number[]>();
  const placeWall = (w: WallEdge) => {
    const R = rings[w.ring];
    const sa = Number.isNaN(w.sa) ? slideS[w.a] : w.sa;
    const sb = Number.isNaN(w.sb) ? slideS[w.b] : w.sb;
    const len = w.dir > 0 ? mod(sb - sa, R.L) : mod(sa - sb, R.L);
    for (let i = 0; i < w.inner.length; i++) {
      const p = ringAt(R, sa + w.dir * len * w.fr[i + 1]);
      X[w.inner[i]] = p.x;
      Y[w.inner[i]] = p.y;
    }
  };
  // Working-mesh nodes sit where the mesher will put them: the edge's grading
  // law, or its projection off the wall it matches, thinned to c cells.
  const stationsFor = (e: BlockEdge, c: number) => {
    const st = edgeStations(bk, e, c, vm, em);
    return st.length === c + 1 ? st : Array.from({ length: c + 1 }, (_, k) => k / c);
  };
  for (const e of bk.edges) {
    const a = vNode.get(e.v0),
      b = vNode.get(e.v1);
    if (a === undefined || b === undefined) return null;
    const c = cellsOf(e);
    const fr = stationsFor(e, c);
    const chain = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
    const ra = nodeRingS.get(a),
      rb = nodeRingS.get(b);
    let wallRing = -1;
    if (ra && rb && ra.ring === rb.ring && e.v0 !== e.v1) {
      const assoc = e.curveId ? outlines.findIndex((o) => o.entityId === e.curveId) : -1;
      const k = assoc === ra.ring ? assoc : outlineUnder(chain, outlines);
      if (k === ra.ring) wallRing = k;
    }
    const ids = [a];
    if (wallRing >= 0) {
      const R = rings[wallRing];
      const mid =
        chain.length > 2
          ? chain[Math.floor(chain.length / 2)]
          : { x: (chain[0].x + chain[1].x) / 2, y: (chain[0].y + chain[1].y) / 2 };
      const sm = ringParam(R, mid).s;
      const dir = mod(sm - ra!.s, R.L) <= mod(rb!.s - ra!.s, R.L) ? 1 : -1;
      const w: WallEdge = {
        ring: wallRing,
        a,
        b,
        dir,
        sa: kind[a] === SLIDE ? NaN : ra!.s,
        sb: kind[b] === SLIDE ? NaN : rb!.s,
        inner: [],
        fr,
      };
      for (let i = 1; i < c; i++) w.inner.push(addNode({ x: 0, y: 0 }, DEPENDENT));
      placeWall(w);
      walls.push(w);
      for (const n of [a, b]) wallsOfNode.set(n, [...(wallsOfNode.get(n) ?? []), walls.length - 1]);
      ids.push(...w.inner);
    } else {
      const pts = atFractions(chain, fr);
      const k = e.curves?.length ? FIXED : ALONG_EDGE;
      for (let i = 1; i < c; i++) ids.push(addNode(pts[i], k));
      if (k === ALONG_EDGE) bendable.push([a, ...ids.slice(1), b]);
    }
    ids.push(b);
    edgeNodes.set(e.id, ids);
  }

  for (const ch of bendable)
    for (let i = 1; i + 1 < ch.length; i++) edgeNeighbours.set(ch[i], [ch[i - 1], ch[i + 1]]);
  // ── Cells.
  const cells: number[][] = [];
  const cellR: number[] = [];
  for (const blk of bk.blocks) {
    const c = blockCornerIds(bk, blk);
    if (c.length !== 4) return null;
    const side = (k: number) => {
      const e = em.get(blk.edges[k])!;
      const ids = edgeNodes.get(e.id)!;
      return e.v0 === c[k] ? [...ids] : [...ids].reverse(); // copies: sides 2 and 3 get reversed below
    };
    const S0 = side(0),
      S1 = side(1),
      S2 = side(2).reverse(),
      S3 = side(3).reverse();
    const n = S0.length - 1,
      m = S1.length - 1;
    if (S2.length - 1 !== n || S3.length - 1 !== m) return null;
    // Blend weights: arc-length fractions along the bottom and right sides,
    // as Gmsh's transfinite surface does.
    const fracOf = (ids: number[]) => {
      const c = [0];
      for (let k = 1; k < ids.length; k++)
        c.push(c[k - 1] + Math.hypot(X[ids[k]] - X[ids[k - 1]], Y[ids[k]] - Y[ids[k - 1]]));
      return c.map((x) => x / (c[c.length - 1] || 1));
    };
    const Uw = fracOf(S0),
      Vw = fracOf(S1);
    const g: number[][] = [];
    for (let j = 0; j <= m; j++) {
      const row: number[] = [];
      for (let i = 0; i <= n; i++) {
        if (j === 0) row.push(S0[i]);
        else if (j === m) row.push(S2[i]);
        else if (i === 0) row.push(S3[j]);
        else if (i === n) row.push(S1[j]);
        else {
          const u = Uw[i],
            v = Vw[j];
          const bx = X[S0[i]],
            by = Y[S0[i]],
            tx = X[S2[i]],
            ty = Y[S2[i]];
          const lx = X[S3[j]],
            ly = Y[S3[j]],
            rx = X[S1[j]],
            ry = Y[S1[j]];
          const x =
            (1 - v) * bx +
            v * tx +
            (1 - u) * lx +
            u * rx -
            ((1 - u) * (1 - v) * X[S0[0]] +
              u * (1 - v) * X[S0[n]] +
              u * v * X[S2[n]] +
              (1 - u) * v * X[S2[0]]);
          const y =
            (1 - v) * by +
            v * ty +
            (1 - u) * ly +
            u * ry -
            ((1 - u) * (1 - v) * Y[S0[0]] +
              u * (1 - v) * Y[S0[n]] +
              u * v * Y[S2[n]] +
              (1 - u) * v * Y[S2[0]]);
          row.push(addNode({ x, y }, FREE));
        }
      }
      g.push(row);
    }
    let area = 0;
    const ring = [
      ...S0,
      ...S1.slice(1),
      ...[...S2].reverse().slice(1),
      ...[...S3].reverse().slice(1, -1),
    ];
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k],
        q = ring[(k + 1) % ring.length];
      area += X[p] * Y[q] - X[q] * Y[p];
    }
    const flip = area < 0;
    const d = (a: number, b: number) => Math.hypot(X[a] - X[b], Y[a] - Y[b]);
    for (let j = 0; j < m; j++)
      for (let i = 0; i < n; i++) {
        const q = [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]];
        cells.push(flip ? [q[0], q[3], q[2], q[1]] : q);
        // Target aspect: the starting cell's own (across / along), so graded
        // layers stay graded and only the angles are optimized.
        const along = d(q[0], q[1]) + d(q[3], q[2]);
        const across = d(q[0], q[3]) + d(q[1], q[2]);
        const r = across / (along || 1) || 1;
        cellR.push(flip ? 1 / r : r);
      }
  }

  const N = X.length;
  const nodeCells: number[][] = Array.from({ length: N }, () => []);
  cells.forEach((q, ci) => q.forEach((nd) => nodeCells[nd].push(ci)));

  // ── Target corner angle per node.
  const cotT = new Float64Array(N),
    invSinT = new Float64Array(N).fill(1);
  for (let nd = 0; nd < N; nd++) {
    const val = nodeCells[nd].length;
    if (!val) continue;
    let total = 2 * Math.PI;
    if (kind[nd] === DEPENDENT) total = Math.PI;
    else if (nodeRingS.has(nd)) {
      const { ring, s } = nodeRingS.get(nd)!;
      total = kind[nd] === FIXED ? fluidAngle(rings[ring], s) : Math.PI;
    }
    const th = Math.min(Math.PI * 0.95, Math.max(Math.PI * 0.05, total / val));
    cotT[nd] = Math.cos(th) / Math.sin(th);
    invSinT[nd] = 1 / Math.sin(th);
  }

  // ── Objective.
  const cellCost = (ci: number) => {
    const q = cells[ci];
    const r = cellR[ci];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const p = q[k],
        nx = q[(k + 1) & 3],
        pv = q[(k + 3) & 3];
      const e1x = X[nx] - X[p],
        e1y = Y[nx] - Y[p];
      const e2x = X[pv] - X[p],
        e2y = Y[pv] - Y[p];
      const rr = k & 1 ? 1 / r : r;
      const ct = cotT[p],
        is = invSinT[p] / rr;
      const t2x = -ct * e1x + e2x * is,
        t2y = -ct * e1y + e2y * is;
      const fro = e1x * e1x + e1y * e1y + t2x * t2x + t2y * t2y;
      if (!(fro > 0)) return 1e12;
      const det = (e1x * e2y - e1y * e2x) * is;
      const dl = 1e-3 * fro;
      const dEff = 0.5 * (det + Math.sqrt(det * det + 4 * dl * dl));
      sum += fro / (2 * dEff);
    }
    return sum;
  };
  const costOver = (cs: number[]) => {
    let s = 0;
    for (const c of cs) s += cellCost(c);
    return s;
  };

  // ── Per-node working data.
  const localLen = new Float64Array(N);
  for (let nd = 0; nd < N; nd++) {
    const nb = new Set<number>();
    for (const ci of nodeCells[nd]) {
      const q = cells[ci];
      const k = q.indexOf(nd);
      nb.add(q[(k + 1) & 3]);
      nb.add(q[(k + 3) & 3]);
    }
    let s = 0;
    nb.forEach((o) => (s += Math.hypot(X[o] - X[nd], Y[o] - Y[nd])));
    localLen[nd] = nb.size ? s / nb.size : 1;
  }
  const step = Float64Array.from(localLen, (l) => 0.25 * l);
  const slideCells = new Map<number, number[]>();
  for (let nd = 0; nd < N; nd++) {
    if (kind[nd] !== SLIDE) continue;
    const set = new Set(nodeCells[nd]);
    for (const wi of wallsOfNode.get(nd) ?? [])
      for (const d of walls[wi].inner) nodeCells[d].forEach((c) => set.add(c));
    slideCells.set(nd, [...set]);
  }

  const movable: number[] = [];
  for (let nd = 0; nd < N; nd++)
    if (
      (kind[nd] === FREE || kind[nd] === SLIDE || kind[nd] === ALONG_EDGE) &&
      nodeCells[nd].length
    )
      movable.push(nd);

  const totalCost = () => {
    let s = 0;
    for (let c = 0; c < cells.length; c++) s += cellCost(c);
    return s / (4 * Math.max(1, cells.length));
  };

  const extract = (): Blocking => {
    const vertices = bk.vertices.map((v) => {
      const nd = vNode.get(v.id)!;
      return { ...v, pt: { x: X[nd], y: Y[nd] }, curves: v.curves ? [...v.curves] : undefined };
    });
    const edges = bk.edges.map((e) => {
      const ids = edgeNodes.get(e.id)!;
      const w = walls.find(
        (x) => x.a === ids[0] && x.b === ids[ids.length - 1] && x.inner[0] === ids[1],
      );
      let path: Point2D[];
      if (w) {
        const R = rings[w.ring];
        const sa = Number.isNaN(w.sa) ? slideS[w.a] : w.sa;
        const sb = Number.isNaN(w.sb) ? slideS[w.b] : w.sb;
        path = arcPoints(R, sa, w.dir > 0 ? mod(sb - sa, R.L) : mod(sa - sb, R.L), w.dir);
      } else if (e.curves?.length) {
        path = e.path.map((p) => ({ ...p }));
      } else {
        path = smoothInterior(
          ids.map((nd) => ({ x: X[nd], y: Y[nd] })),
          3,
        );
      }
      return { ...e, path };
    });
    return {
      vertices,
      edges,
      blocks: input.blocks.map((b) => ({ id: b.id, edges: [...b.edges] as typeof b.edges })),
      links: input.links?.map((g) => [...g]),
    };
  };

  // ── Sweeps.
  let quiet = 0;
  let checkpoint = totalCost();
  let last: OptimizeStep | null = null;
  for (let sweep = 1; sweep <= maxSweeps; sweep++) {
    let moved = 0;
    for (const nd of movable) {
      if (kind[nd] === FREE) {
        const cs = nodeCells[nd];
        const x0 = X[nd],
          y0 = Y[nd];
        const f0 = costOver(cs);
        const h = 1e-3 * step[nd] + 1e-12;
        X[nd] = x0 + h;
        const fxp = costOver(cs);
        X[nd] = x0 - h;
        const fxm = costOver(cs);
        X[nd] = x0;
        Y[nd] = y0 + h;
        const fyp = costOver(cs);
        Y[nd] = y0 - h;
        const fym = costOver(cs);
        Y[nd] = y0;
        const gx = (fxp - fxm) / (2 * h),
          gy = (fyp - fym) / (2 * h);
        const g = Math.hypot(gx, gy);
        if (!(g > 0)) continue;
        let t = step[nd],
          ok = false;
        for (let tries = 0; tries < 6; tries++) {
          X[nd] = x0 - (t * gx) / g;
          Y[nd] = y0 - (t * gy) / g;
          if (costOver(cs) < f0 - 1e-14 * f0) {
            ok = true;
            break;
          }
          t *= 0.35;
        }
        if (ok) {
          moved = Math.max(moved, t / localLen[nd]);
          step[nd] = Math.min(t * 1.5, 0.5 * localLen[nd]);
        } else {
          X[nd] = x0;
          Y[nd] = y0;
          step[nd] = Math.max(t, 1e-9 * localLen[nd]);
        }
      } else if (kind[nd] === ALONG_EDGE) {
        const cs = nodeCells[nd];
        const [pa, pb] = edgeNeighbours.get(nd)!;
        const tx = X[pb] - X[pa],
          ty = Y[pb] - Y[pa];
        const tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl,
          ny = tx / tl;
        const x0 = X[nd],
          y0 = Y[nd];
        const f0 = costOver(cs);
        let best = 0,
          fb = f0;
        for (const sgn of [1, -1]) {
          X[nd] = x0 + sgn * step[nd] * nx;
          Y[nd] = y0 + sgn * step[nd] * ny;
          const fs = costOver(cs);
          if (fs < fb - 1e-14 * fb) (fb = fs), (best = sgn);
        }
        X[nd] = x0 + best * step[nd] * nx;
        Y[nd] = y0 + best * step[nd] * ny;
        if (best) {
          moved = Math.max(moved, step[nd] / localLen[nd]);
          step[nd] = Math.min(step[nd] * 1.5, 0.5 * localLen[nd]);
        } else step[nd] *= 0.5;
      } else {
        const cs = slideCells.get(nd)!;
        const R = rings[slideRing[nd]];
        const s0 = slideS[nd];
        const margin = 1e-3 * (slideHi[nd] - slideLo[nd] || R.L);
        const set = (s: number) => {
          slideS[nd] = s;
          const p = ringAt(R, s);
          X[nd] = p.x;
          Y[nd] = p.y;
          for (const wi of wallsOfNode.get(nd) ?? []) placeWall(walls[wi]);
        };
        const f0 = costOver(cs);
        let best = s0,
          fb = f0;
        for (const sgn of [1, -1]) {
          const s = Math.max(
            slideLo[nd] + margin,
            Math.min(slideHi[nd] - margin, s0 + sgn * step[nd]),
          );
          if (s === s0) continue;
          set(s);
          const fs = costOver(cs);
          if (fs < fb - 1e-14 * fb) (fb = fs), (best = s);
        }
        set(best);
        if (best !== s0) {
          moved = Math.max(moved, Math.abs(best - s0) / localLen[nd]);
          step[nd] = Math.min(step[nd] * 1.5, 0.5 * localLen[nd]);
        } else step[nd] *= 0.5;
      }
    }
    quiet = moved < tol ? quiet + 1 : 0;
    let converged = quiet >= 3;
    if (sweep % 10 === 0) {
      const c = totalCost();
      if (Math.abs(checkpoint - c) <= tol * c) converged = true;
      checkpoint = c;
    }
    if (converged || sweep === maxSweeps || (yieldEvery && sweep % yieldEvery === 0)) {
      last = {
        sweep,
        quality: totalCost(),
        moved,
        converged,
        blocking: extract(),
        mesh: { x: [...X], y: [...Y], cells },
      };
      if (converged || sweep === maxSweeps) return last;
      yield last;
    }
  }
  return last;
}

/** Run the optimizer to completion. */
export function optimizeBlockingSync(
  bk: Blocking,
  entities: CadEntity[],
  opts: OptimizeOptions = {},
): OptimizeStep | null {
  const it = optimizeBlocking(bk, entities, { ...opts, yieldEvery: 0 });
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

function atFractions(pts: Point2D[], st: number[]): Point2D[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[cum.length - 1] || 1;
  let j = 0;
  return st.map((f) => {
    const s = L * f;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    return {
      x: pts[j].x + t * (pts[j + 1].x - pts[j].x),
      y: pts[j].y + t * (pts[j + 1].y - pts[j].y),
    };
  });
}
