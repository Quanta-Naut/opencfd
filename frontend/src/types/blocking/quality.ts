import { Point2D } from '../cadWorkflow';
import { Block, BlockEdge, Blocking } from './types';
import { blockCornerIds } from './blockEdit';
import { edgeStations } from './stations';

// ICEM CFD "Pre-Mesh": the grid each block will produce, filled by transfinite
// interpolation from its four edges (what the mesher does before smoothing),
// with ICEM's two headline quality checks per cell:
//
//   determinant  smallest / largest corner Jacobian of the quad. 1 is a
//                parallelogram, 0 or less is folded. Solvers accept > 0.1,
//                aim for > 0.2.
//   angle        smallest interior angle. Aim for > 18 degrees.

/** ICEM's targets. */
export const PREMESH_MIN_DET = 0.2;
export const PREMESH_MIN_ANGLE = 18;

export interface BlockPremesh {
  blockId: string;
  /** Grid points, rows by columns: grid[j][i]. */
  grid: Point2D[][];
  /** Per cell, row-major (m rows of n): determinant ratio and min angle (deg). */
  det: Float32Array;
  angle: Float32Array;
  minDet: number;
  minAngle: number;
  /** Longest over shortest side of the most stretched cell. */
  maxAspect: number;
}

export interface PremeshQuality {
  cells: number;
  maxAspect: number;
  minDet: number;
  minAngle: number;
  /** Cells under the ICEM targets. */
  lowDet: number;
  lowAngle: number;
  /** Cells that fold (determinant <= 0): the mesh would be invalid. */
  folded: number;
  /** Block holding the worst cell. */
  worstBlockId: string | null;
}

function chainOf(e: BlockEdge, from: string, vm: Map<string, Point2D>): Point2D[] {
  const pts = [vm.get(e.v0)!, ...e.path, vm.get(e.v1)!];
  return e.v0 === from ? pts : pts.reverse();
}

function cumLen(pts: Point2D[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return cum;
}

/** Points along a polyline at the given arc-length fractions. */
function atStations(pts: Point2D[], st: number[]): Point2D[] {
  const cum = cumLen(pts);
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

/**
 * The pre-mesh of one block, or null if malformed. Each side carries its real
 * node distribution; a side with more than `maxCells` cells is thinned (ends
 * kept dense) so a fine mesh still previews fast.
 */
export function blockGrid(
  bk: Blocking,
  blk: Block,
  maxCells = 120,
  vm: Map<string, Point2D> = new Map(bk.vertices.map((v) => [v.id, v.pt] as const)),
  em: Map<string, BlockEdge> = new Map(bk.edges.map((e) => [e.id, e] as const)),
): Point2D[][] | null {
  const c = blockCornerIds(bk, blk);
  if (c.length !== 4) return null;
  const E = blk.edges.map((id) => em.get(id));
  if (E.some((e) => !e)) return null;
  const [e0, e1, e2, e3] = E as BlockEdge[];
  const count = (a: BlockEdge, b: BlockEdge) =>
    Math.max(1, Math.min(maxCells, Math.max(a.nodes, b.nodes) - 1));
  const n = count(e0, e2);
  const m = count(e1, e3);
  const side = (e: BlockEdge, from: string, cells: number) => {
    let st = edgeStations(bk, e, cells, vm, em);
    // A side with fewer nodes than its opposite (unbalanced) is spread evenly.
    if (st.length !== cells + 1) st = Array.from({ length: cells + 1 }, (_, k) => k / cells);
    return atStations(chainOf(e, from, vm), e.v0 === from ? st : st.map((f) => 1 - f).reverse());
  };
  // bottom c0->c1, right c1->c2, top c3->c2, left c0->c3
  const B = side(e0, c[0], n);
  const R = side(e1, c[1], m);
  const T = side(e2, c[3], n);
  const Lf = side(e3, c[0], m);
  const P00 = B[0];
  const P10 = B[n];
  const P11 = T[n];
  const P01 = T[0];
  // Blend weights are arc-length fractions along the bottom and right sides,
  // as Gmsh's transfinite surface does.
  const frac = (pts: Point2D[]) => {
    const cum = cumLen(pts);
    const L = cum[cum.length - 1] || 1;
    return cum.map((x) => x / L);
  };
  const U = frac(B);
  const V = frac(R);
  const grid: Point2D[][] = [];
  for (let j = 0; j <= m; j++) {
    const v = V[j];
    const row: Point2D[] = [];
    for (let i = 0; i <= n; i++) {
      const u = U[i];
      row.push({
        x:
          (1 - v) * B[i].x +
          v * T[i].x +
          (1 - u) * Lf[j].x +
          u * R[j].x -
          ((1 - u) * (1 - v) * P00.x + u * (1 - v) * P10.x + u * v * P11.x + (1 - u) * v * P01.x),
        y:
          (1 - v) * B[i].y +
          v * T[i].y +
          (1 - u) * Lf[j].y +
          u * R[j].y -
          ((1 - u) * (1 - v) * P00.y + u * (1 - v) * P10.y + u * v * P11.y + (1 - u) * v * P01.y),
      });
    }
    grid.push(row);
  }
  return grid;
}

const DEG = 180 / Math.PI;

/** Pre-mesh one block and score its cells. */
export function premeshBlock(
  bk: Blocking,
  blk: Block,
  maxCells = 120,
  vm?: Map<string, Point2D>,
  em?: Map<string, BlockEdge>,
): BlockPremesh | null {
  const grid = blockGrid(bk, blk, maxCells, vm, em);
  if (!grid) return null;
  const m = grid.length - 1;
  const n = grid[0].length - 1;
  // Orientation of the whole block (shoelace over its boundary rows), so a
  // block wound clockwise is not reported as folded.
  const ring = [
    ...grid[0],
    ...grid.slice(1).map((r) => r[n]),
    ...[...grid[m]].reverse().slice(1),
    ...grid
      .slice(1, -1)
      .map((r) => r[0])
      .reverse(),
  ];
  let area = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    area += p.x * q.y - q.x * p.y;
  }
  const sgn = area >= 0 ? 1 : -1;
  const det = new Float32Array(m * n);
  const angle = new Float32Array(m * n);
  let minDet = Infinity;
  let minAngle = Infinity;
  let maxAspect = 1;
  const q: Point2D[] = [grid[0][0], grid[0][0], grid[0][0], grid[0][0]];
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < n; i++) {
      q[0] = grid[j][i];
      q[1] = grid[j][i + 1];
      q[2] = grid[j + 1][i + 1];
      q[3] = grid[j + 1][i];
      let jmin = Infinity;
      let jmax = -Infinity;
      let amin = Math.PI;
      let smin = Infinity;
      let smax = 0;
      for (let k = 0; k < 4; k++) {
        const a = q[(k + 3) % 4];
        const p = q[k];
        const b = q[(k + 1) % 4];
        const ux = b.x - p.x;
        const uy = b.y - p.y;
        const vx = a.x - p.x;
        const vy = a.y - p.y;
        const cross = (ux * vy - uy * vx) * sgn;
        if (cross < jmin) jmin = cross;
        if (cross > jmax) jmax = cross;
        const ang = Math.atan2(Math.abs(cross), ux * vx + uy * vy);
        if (ang < amin) amin = ang;
        const side = Math.hypot(ux, uy);
        if (side < smin) smin = side;
        if (side > smax) smax = side;
      }
      if (smin > 0 && smax / smin > maxAspect) maxAspect = smax / smin;
      const d = jmax > 0 ? jmin / jmax : -1;
      const a = jmin > 0 ? amin * DEG : 0;
      det[j * n + i] = d;
      angle[j * n + i] = a;
      if (d < minDet) minDet = d;
      if (a < minAngle) minAngle = a;
    }
  }
  return { blockId: blk.id, grid, det, angle, minDet, minAngle, maxAspect };
}

/** Pre-mesh every block. */
export function premesh(bk: Blocking, maxCells = 120): BlockPremesh[] {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const em = new Map(bk.edges.map((e) => [e.id, e] as const));
  const out: BlockPremesh[] = [];
  for (const blk of bk.blocks) {
    const p = premeshBlock(bk, blk, maxCells, vm, em);
    if (p) out.push(p);
  }
  return out;
}

/** Summary of a pre-mesh against the ICEM targets. */
export function premeshQuality(blocks: BlockPremesh[]): PremeshQuality {
  let cells = 0;
  let minDet = Infinity;
  let minAngle = Infinity;
  let lowDet = 0;
  let lowAngle = 0;
  let folded = 0;
  let maxAspect = 1;
  let worst = Infinity;
  let worstBlockId: string | null = null;
  for (const b of blocks) {
    cells += b.det.length;
    for (let k = 0; k < b.det.length; k++) {
      const d = b.det[k];
      if (d <= 0) folded++;
      else if (d < PREMESH_MIN_DET) lowDet++;
      if (b.angle[k] < PREMESH_MIN_ANGLE) lowAngle++;
    }
    if (b.minDet < minDet) minDet = b.minDet;
    if (b.minAngle < minAngle) minAngle = b.minAngle;
    if (b.maxAspect > maxAspect) maxAspect = b.maxAspect;
    const s = Math.min(b.minDet / PREMESH_MIN_DET, b.minAngle / PREMESH_MIN_ANGLE);
    if (s < worst) {
      worst = s;
      worstBlockId = b.blockId;
    }
  }
  return {
    cells,
    maxAspect,
    minDet: cells ? minDet : 1,
    minAngle: cells ? minAngle : 90,
    lowDet,
    lowAngle,
    folded,
    worstBlockId,
  };
}
