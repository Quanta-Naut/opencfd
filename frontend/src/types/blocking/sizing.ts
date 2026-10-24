import { Blocking, BlockEdge } from './types';
import { boundsOf } from './geometry';

/** Colors for the "grid direction" groups (opposite block edges + links), in
 * Direction A / B / C / ... order. Shared between the mesh-sizing panel and
 * the canvas overlay so a direction reads as the same color in both places. */
export const DIRECTION_COLORS = [
  '#2563EB',
  '#DC2626',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#DB2777',
  '#0891B2',
  '#65A30D',
];

/** Group block edges into "grid directions": opposite edges within a block and
 * any linked edges share a group. Groups are numbered in first-seen order
 * (matching the Direction A/B/C.. labels shown in the mesh-sizing panel). */
export function edgeDirectionGroups(bk: Blocking): Map<string, number> {
  const parent = new Map<string, string>();
  bk.edges.forEach((e) => parent.set(e.id, e.id));
  const find = (x: string): string =>
    parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!);
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };
  for (const blk of bk.blocks) {
    union(blk.edges[0], blk.edges[2]);
    union(blk.edges[1], blk.edges[3]);
  }
  for (const grp of bk.links ?? []) for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);
  const order: string[] = [];
  const seen = new Set<string>();
  for (const e of bk.edges) {
    const r = find(e.id);
    if (!seen.has(r)) {
      seen.add(r);
      order.push(r);
    }
  }
  const index = new Map(order.map((r, i) => [r, i]));
  const result = new Map<string, number>();
  for (const e of bk.edges) result.set(e.id, index.get(find(e.id))!);
  return result;
}

/** Drop orphan edges and vertices; prune stale link groups. */
export function cleanBlocking(bk: Blocking): Blocking {
  const usedEdges = new Set<string>();
  bk.blocks.forEach((b) => b.edges.forEach((e) => usedEdges.add(e)));
  const edges = bk.edges.filter((e) => usedEdges.has(e.id));
  const usedVerts = new Set<string>();
  edges.forEach((e) => {
    usedVerts.add(e.v0);
    usedVerts.add(e.v1);
  });
  const vertices = bk.vertices.filter((v) => usedVerts.has(v.id));
  const links = (bk.links ?? [])
    .map((grp) => grp.filter((id) => usedEdges.has(id)))
    .filter((grp) => grp.length >= 2);
  return { vertices, edges, blocks: bk.blocks, links };
}

/** Enforce opposite-edge equal node counts within each block (propagation). */
export function propagateNodeCounts(bk: Blocking): Blocking {
  const parent = new Map<string, string>();
  bk.edges.forEach((e) => parent.set(e.id, e.id));
  const find = (x: string): string =>
    parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!);
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    parent.set(find(a), find(b));
  };
  for (const blk of bk.blocks) {
    union(blk.edges[0], blk.edges[2]);
    union(blk.edges[1], blk.edges[3]);
  }
  for (const grp of bk.links ?? []) for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);
  // Per group, take the max node count that was set - but never fewer than the
  // node count a polyline side needs (one cell per segment, so path.length + 2).
  const groupNodes = new Map<string, number>();
  for (const e of bk.edges) {
    const g = find(e.id);
    const floor = e.path.length + 2;
    groupNodes.set(g, Math.max(groupNodes.get(g) ?? 0, e.nodes, floor));
  }
  return {
    ...bk,
    edges: bk.edges.map((e) => ({ ...e, nodes: groupNodes.get(find(e.id)) ?? e.nodes })),
  };
}

/** Arc length of a block edge (through its path points). */
export function edgeLength(bk: Blocking, e: BlockEdge): number {
  const vm = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const a = vm.get(e.v0),
    b = vm.get(e.v1);
  if (!a || !b) return 0;
  const chain = [a, ...e.path, b];
  let L = 0;
  for (let i = 0; i + 1 < chain.length; i++)
    L += Math.hypot(chain[i + 1].x - chain[i].x, chain[i + 1].y - chain[i].y);
  return L;
}

/** A sensible default target cell size: roughly the domain diagonal over ~90. */
export function autoCellSize(bk: Blocking): number {
  if (!bk.vertices.length) return 1;
  const b = boundsOf(bk.vertices.map((v) => v.pt));
  const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
  return diag > 0 ? diag / 90 : 1;
}

/** The cell size the current node counts imply (median edge length / cells). */
export function currentCellSize(bk: Blocking): number {
  const sizes = bk.edges
    .map((e) => edgeLength(bk, e) / Math.max(1, e.nodes - 1))
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  return sizes.length ? sizes[Math.floor(sizes.length / 2)] : autoCellSize(bk);
}

/**
 * Size every grid direction from a target cell edge length instead of a fixed
 * node count. A short block edge then gets few nodes and a long one gets many,
 * so the mesh reads as uniform - no dense band where a small block's count was
 * forced onto a narrow neighbour. Per-direction overrides set later still win
 * (this only seeds them).
 */
export function applyTargetCellSize(bk: Blocking, cellSize: number): Blocking {
  if (!(cellSize > 0)) return bk;
  const parent = new Map<string, string>();
  bk.edges.forEach((e) => parent.set(e.id, e.id));
  const find = (x: string): string =>
    parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!);
  const union = (a: string, c: string) => {
    if (parent.has(a) && parent.has(c)) parent.set(find(a), find(c));
  };
  for (const blk of bk.blocks) {
    union(blk.edges[0], blk.edges[2]);
    union(blk.edges[1], blk.edges[3]);
  }
  for (const grp of bk.links ?? []) for (let i = 1; i < grp.length; i++) union(grp[0], grp[i]);

  const groupLens = new Map<string, number[]>();
  for (const e of bk.edges) {
    const g = find(e.id);
    const arr = groupLens.get(g) ?? [];
    arr.push(edgeLength(bk, e));
    groupLens.set(g, arr);
  }
  // Groups that carry a wall-clustering law (geometric / bump) are wall-normal -
  // their layer count is deliberate (near-wall resolution / y+), so keep the
  // count already set rather than deriving it from the target cell size.
  const wallNormal = new Set<string>();
  for (const e of bk.edges)
    if (e.law === 'geometric' || e.law === 'bump' || e.law === 'tanh' || e.law === 'bigeometric')
      wallNormal.add(find(e.id));

  const groupNodes = new Map<string, number>();
  groupLens.forEach((lens, g) => {
    if (wallNormal.has(g)) return;
    lens.sort((a, b) => a - b);
    const rep = lens[Math.floor(lens.length / 2)] || 0; // median edge length in the group
    groupNodes.set(g, Math.max(4, Math.min(500, Math.round(rep / cellSize) + 1)));
  });

  return propagateNodeCounts({
    ...bk,
    edges: bk.edges.map((e) => ({ ...e, nodes: groupNodes.get(find(e.id)) ?? e.nodes })),
  });
}
