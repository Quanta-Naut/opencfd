import { Point2D } from '../cadWorkflow';
import { Block, BlockEdge, Blocking } from './types';
import { blockCornerIds } from './blockEdit';
import { edgeStations } from './stations';

// Mesh quality of a blocking, measured on the grid it would actually produce:
// each block is filled by transfinite interpolation (what the backend does
// before smoothing) and every cell is scored by its equiangle skewness
//
//   EAS = max((θmax - 90) / 90, (90 - θmin) / 90)     0 = square, 1 = degenerate
//
// A cell that folds over (corner turning the wrong way) makes the block invalid.

export interface BlockScore {
  /** Mean EAS over the block's cells. */
  mean: number;
  /** Worst EAS in the block. */
  worst: number;
  /** Worst EAS of the cells touching a wall edge (0 when there is none):
   *  the first layer off a wall is where skew costs accuracy. */
  wallWorst: number;
  /** A cell folded over: the block would not mesh. */
  invalid: boolean;
  /** The block's objective contribution (lower is better). */
  cost: number;
}

export interface BlockingScore {
  cost: number;
  mean: number;
  worst: number;
  wallWorst: number;
  invalid: number;
  blocks: Map<string, BlockScore>;
}

/** Cells per block side used for scoring (capped so the search stays fast). */
const SAMPLE_MIN = 6;
const SAMPLE_MAX = 40;

function chainOf(e: BlockEdge, from: string, vm: Map<string, Point2D>): Point2D[] {
  const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
  return e.v0 === from ? pts : pts.reverse();
}

/** Points along a polyline at the given arc-length fractions. */
function atStations(pts: Point2D[], st: number[]): Point2D[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[cum.length - 1] || 1;
  const out: Point2D[] = [];
  let j = 0;
  for (const f of st) {
    const s = L * f;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    out.push({
      x: pts[j].x + t * (pts[j + 1].x - pts[j].x),
      y: pts[j].y + t * (pts[j + 1].y - pts[j].y),
    });
  }
  return out;
}

/** `n + 1` points evenly spaced by arc length along a polyline. */
function resampleArc(pts: Point2D[], n: number): Point2D[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[cum.length - 1] || 1;
  const out: Point2D[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    out.push({
      x: pts[j].x + t * (pts[j + 1].x - pts[j].x),
      y: pts[j].y + t * (pts[j + 1].y - pts[j].y),
    });
  }
  return out;
}

const sideCount = (a: BlockEdge, b: BlockEdge) =>
  Math.max(SAMPLE_MIN, Math.min(SAMPLE_MAX, Math.max(a.nodes, b.nodes) - 1));

/** The TFI grid of a block as rows of points (grid[j][i]), or null if malformed. */
export function blockGrid(
  bk: Blocking,
  blk: Block,
  vm: Map<string, Point2D> = new Map(bk.vertices.map((v) => [v.id, v.pt] as const)),
  em: Map<string, BlockEdge> = new Map(bk.edges.map((e) => [e.id, e] as const)),
): Point2D[][] | null {
  const c = blockCornerIds(bk, blk);
  if (c.length !== 4) return null;
  const E = blk.edges.map((id) => em.get(id));
  if (E.some((e) => !e)) return null;
  const [e0, e1, e2, e3] = E as BlockEdge[];
  const n = sideCount(e0, e2);
  const m = sideCount(e1, e3);
  // Each side sampled with its own grading law, read from the corner it starts at.
  const side = (e: BlockEdge, from: string, cells: number) => {
    const st = e.nodes - 1 >= cells ? edgeStations(bk, e, cells, vm, em) : null;
    const pts = chainOf(e, from, vm);
    if (!st || st.length !== cells + 1) return resampleArc(pts, cells);
    return atStations(pts, e.v0 === from ? st : st.map((f) => 1 - f).reverse());
  };
  // bottom c0->c1, right c1->c2, top c3->c2, left c0->c3
  const B = side(e0, c[0], n);
  const R = side(e1, c[1], m);
  const T = side(e2, c[3], n);
  const Lf = side(e3, c[0], m);
  const P00 = B[0],
    P10 = B[n],
    P11 = T[n],
    P01 = T[0];
  // Blend weights are arc-length fractions along the bottom and right sides,
  // as Gmsh's transfinite surface does (index fractions fold thin cells
  // under strong grading).
  const frac = (pts: Point2D[]) => {
    const c = [0];
    for (let k = 1; k < pts.length; k++)
      c.push(c[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const L = c[c.length - 1] || 1;
    return c.map((x) => x / L);
  };
  const U = frac(B),
    V = frac(R);
  const grid: Point2D[][] = [];
  for (let j = 0; j <= m; j++) {
    const v = V[j];
    const row: Point2D[] = [];
    for (let i = 0; i <= n; i++) {
      const u = U[i];
      const x =
        (1 - v) * B[i].x +
        v * T[i].x +
        (1 - u) * Lf[j].x +
        u * R[j].x -
        ((1 - u) * (1 - v) * P00.x + u * (1 - v) * P10.x + u * v * P11.x + (1 - u) * v * P01.x);
      const y =
        (1 - v) * B[i].y +
        v * T[i].y +
        (1 - u) * Lf[j].y +
        u * R[j].y -
        ((1 - u) * (1 - v) * P00.y + u * (1 - v) * P10.y + u * v * P11.y + (1 - u) * v * P01.y);
      row.push({ x, y });
    }
    grid.push(row);
  }
  return grid;
}

const HALF_PI = Math.PI / 2;

/** Score one block's TFI grid. */
export function scoreBlock(
  bk: Blocking,
  blk: Block,
  vm?: Map<string, Point2D>,
  em?: Map<string, BlockEdge>,
): BlockScore {
  const g = blockGrid(bk, blk, vm, em);
  if (!g) return { mean: 1, worst: 1, wallWorst: 1, invalid: true, cost: 1e3 };
  // Orientation from the whole block (shoelace over the boundary rows).
  const m = g.length - 1,
    n = g[0].length - 1;
  let area = 0;
  const ring = [
    ...g[0],
    ...g.slice(1).map((r) => r[n]),
    ...[...g[m]].reverse().slice(1),
    ...g
      .slice(1, -1)
      .map((r) => r[0])
      .reverse(),
  ];
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k],
      q = ring[(k + 1) % ring.length];
    area += p.x * q.y - q.x * p.y;
  }
  const sgn = area >= 0 ? 1 : -1;
  const edges = em ?? new Map(bk.edges.map((e) => [e.id, e] as const));
  const wall = blk.edges.map((id) => edges.get(id)?.patch === 'wall');
  const atWall = (i: number, j: number) =>
    (wall[0] && j === 0) ||
    (wall[1] && i === n - 1) ||
    (wall[2] && j === m - 1) ||
    (wall[3] && i === 0);
  let sum = 0,
    sumHi = 0,
    worst = 0,
    wallWorst = 0,
    invalid = false;
  const quad = [0, 0, 0, 0].map(() => ({ x: 0, y: 0 }));
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      quad[0] = g[j][i];
      quad[1] = g[j][i + 1];
      quad[2] = g[j + 1][i + 1];
      quad[3] = g[j + 1][i];
      let amin = Math.PI,
        amax = 0;
      for (let k = 0; k < 4; k++) {
        const a = quad[(k + 3) % 4],
          p = quad[k],
          b = quad[(k + 1) % 4];
        const ux = a.x - p.x,
          uy = a.y - p.y,
          vx = b.x - p.x,
          vy = b.y - p.y;
        const cross = (vx * uy - vy * ux) * sgn; // > 0 for a convex corner of a positively oriented quad
        const dot = ux * vx + uy * vy;
        if (!(cross > 0)) invalid = true;
        const ang = Math.atan2(Math.abs(cross), dot);
        if (ang < amin) amin = ang;
        if (ang > amax) amax = ang;
      }
      const eas = Math.max((amax - HALF_PI) / HALF_PI, (HALF_PI - amin) / HALF_PI);
      sum += eas * eas;
      sumHi += eas ** 8;
      if (eas > worst) worst = eas;
      if (eas > wallWorst && atWall(i, j)) wallWorst = eas;
    }
  }
  const cells = m * n;
  const mean = Math.sqrt(sum / cells);
  // Mean square skew keeps the whole block good; the 8th-power term and the
  // worst cell keep any single cell from being sacrificed for the average.
  const cost = invalid ? 1e3 : sum / cells + (4 * sumHi) / cells + worst * worst;
  return { mean, worst, wallWorst, invalid, cost };
}

/** Score every block of a blocking. */
export function scoreBlocking(bk: Blocking): BlockingScore {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const blocks = new Map<string, BlockScore>();
  let cost = 0,
    mean = 0,
    worst = 0,
    wallWorst = 0,
    invalid = 0;
  for (const blk of bk.blocks) {
    const s = scoreBlock(bk, blk, vm, em);
    blocks.set(blk.id, s);
    cost += s.cost;
    mean += s.mean;
    worst = Math.max(worst, s.worst);
    wallWorst = Math.max(wallWorst, s.wallWorst);
    if (s.invalid) invalid++;
  }
  return {
    cost,
    mean: bk.blocks.length ? mean / bk.blocks.length : 0,
    worst,
    wallWorst,
    invalid,
    blocks,
  };
}
