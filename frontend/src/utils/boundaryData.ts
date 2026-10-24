// Per-boundary numbers for the Results tab: averages and flow rates on each
// patch (a post-processor's surface integrals), and a field's values along a
// patch in order, for a plot such as Cp along a wall.

import { boundaryEdges, patchChains } from './meshLocator';

export interface PatchReport {
  patch: string;
  /** Total length of the patch, m (per metre of depth in 2D it is the area). */
  length: number;
  /** Length-weighted average, min and max of the field on the patch. */
  avg: number;
  min: number;
  max: number;
  /** Volume flow out through the patch per metre of depth, m3/s per m
   *  (negative = in). Null without velocity components. */
  flow: number | null;
}

interface MeshLike {
  nodes: number[][];
  elements: number[][];
  boundaries?: Record<string, number[]>;
}

/** Boundary edges with their cell, computed once per mesh. */
const edgeCache = new WeakMap<number[][], [number, number, number][]>();
function edgesOf(mesh: MeshLike) {
  let e = edgeCache.get(mesh.elements);
  if (!e) {
    e = boundaryEdges(mesh.elements);
    edgeCache.set(mesh.elements, e);
  }
  return e;
}

/**
 * A run snapshot's patch node lists. Runs stored before snapshots kept them
 * have none; the project mesh's lists stand in when it is the same mesh
 * (same node count), which it is unless the mesh was regenerated since.
 */
export function snapshotBoundaries(
  snap: { nodes: ArrayLike<unknown>; boundaries?: Record<string, number[]> },
  current: { nodes?: ArrayLike<unknown>; boundaries?: Record<string, number[]> } | null | undefined,
): Record<string, number[]> {
  if (snap.boundaries && Object.keys(snap.boundaries).length) return snap.boundaries;
  if (current?.boundaries && current.nodes?.length === snap.nodes.length) return current.boundaries;
  return {};
}

export function patchReports(
  mesh: MeshLike,
  vals: ArrayLike<number>,
  ux?: ArrayLike<number>,
  uy?: ArrayLike<number>,
): PatchReport[] {
  const out: PatchReport[] = [];
  const edges = edgesOf(mesh);
  const N = mesh.nodes;
  for (const [patch, ids] of Object.entries(mesh.boundaries ?? {})) {
    if (patch === 'frontAndBack' || !ids?.length) continue;
    const inPatch = new Set(ids);
    let L = 0,
      sum = 0,
      flow = 0,
      min = Infinity,
      max = -Infinity;
    for (const [a, b, cell] of edges) {
      if (!inPatch.has(a) || !inPatch.has(b)) continue;
      const dx = N[b][0] - N[a][0],
        dy = N[b][1] - N[a][1];
      const len = Math.hypot(dx, dy);
      L += len;
      sum += (len * (vals[a] + vals[b])) / 2;
      if (ux && uy) {
        // Outward normal: away from the cell's centre.
        let nx = dy,
          ny = -dx;
        const el = mesh.elements[cell];
        let cx = 0,
          cy = 0;
        for (const ni of el) {
          cx += N[ni][0];
          cy += N[ni][1];
        }
        cx /= el.length;
        cy /= el.length;
        if (nx * ((N[a][0] + N[b][0]) / 2 - cx) + ny * ((N[a][1] + N[b][1]) / 2 - cy) < 0) {
          nx = -nx;
          ny = -ny;
        }
        flow += ((ux[a] + ux[b]) / 2) * nx + ((uy[a] + uy[b]) / 2) * ny;
      }
    }
    for (const i of ids) {
      if (vals[i] < min) min = vals[i];
      if (vals[i] > max) max = vals[i];
    }
    if (L > 0)
      out.push({
        patch,
        length: L,
        avg: sum / L,
        min,
        max,
        flow: ux && uy ? flow : null,
      });
  }
  return out;
}

/** Sampled fields along a patch, in order: `distance` is the plot's x (the
 *  x or y coordinate, or arc length) and each field holds the node values.
 *  A closed wall starts at its point furthest downstream (a trailing edge),
 *  so a Cp plot reads as the familiar loop; separate pieces are split by a
 *  gap. */
export function patchSamples(
  mesh: MeshLike,
  fields: Record<string, ArrayLike<number> | undefined>,
  patch: string,
  axis: 'x' | 'y' | 's',
): { distance: number[]; fields: Record<string, number[]> } | null {
  const ids = mesh.boundaries?.[patch];
  if (!ids?.length) return null;
  const N = mesh.nodes;
  const chains = patchChains(edgesOf(mesh), ids).map((c) => {
    if (c.length > 2 && c[0] === c[c.length - 1]) {
      // Closed: rotate to start at the largest x.
      const ring = c.slice(0, -1);
      let k = 0;
      ring.forEach((ni, i) => {
        if (N[ni][0] > N[ring[k]][0]) k = i;
      });
      const r = [...ring.slice(k), ...ring.slice(0, k)];
      return [...r, r[0]];
    }
    return c;
  });
  if (!chains.length) return null;
  // Coordinates ride along, for calculator fields that read x and y.
  fields = { x: N.map((n) => n[0]), y: N.map((n) => n[1]), ...fields };
  const names = Object.keys(fields).filter((k) => fields[k]);
  const out: { distance: number[]; fields: Record<string, number[]> } = {
    distance: [],
    fields: Object.fromEntries(names.map((k) => [k, [] as number[]])),
  };
  let s = 0;
  chains.forEach((chain, ci) => {
    if (ci > 0) {
      // A gap between pieces: same x, no value.
      out.distance.push(out.distance[out.distance.length - 1]);
      for (const k of names) out.fields[k].push(NaN);
    }
    chain.forEach((ni, i) => {
      if (i > 0) {
        const p = N[chain[i - 1]];
        s += Math.hypot(N[ni][0] - p[0], N[ni][1] - p[1]);
      }
      out.distance.push(axis === 'x' ? N[ni][0] : axis === 'y' ? N[ni][1] : s);
      for (const k of names) out.fields[k].push(fields[k]![ni]);
    });
  });
  return out;
}
