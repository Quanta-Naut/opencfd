// Integrals over a boundary or a straight line through the flow, per metre of
// depth (the mesh is 2D): flow rate, mass flow, the integral and the area-
// and flux-weighted averages of a field. What a post-processor offers as
// surface integrals and reports.

import { buildMeshLocator, type MeshLocator } from './meshLocator';
import { patchSegments } from './boundaryData';

export type SurfaceRef =
  | { kind: 'patch'; patch: string }
  | { kind: 'line'; p1: [number, number]; p2: [number, number] };

export interface SurfaceMesh {
  nodes: number[][];
  elements: number[][];
  boundaries?: Record<string, number[]>;
}

export interface SurfaceResult {
  /** Length of the surface, m (its area per metre of depth). */
  length: number;
  /** Unit normal the flow is counted along: out of the domain for a
   *  boundary; to the right of the line from point 1 to point 2. */
  normal: [number, number] | null;
  /** Volume flow through it along the normal, m2/s per metre of depth. */
  flow: number;
  /** Flow times the density, kg/s per metre of depth. */
  massFlow: number;
  /** The integral of the field over the surface (field unit times m). */
  integral: number;
  /** Plain (area-weighted) average of the field. */
  avg: number;
  /** Average weighted by the flow through each part, null when no net
   *  flow passes. */
  fluxAvg: number | null;
}

const locators = new WeakMap<number[][], MeshLocator>();
function locatorOf(mesh: SurfaceMesh): MeshLocator {
  let l = locators.get(mesh.elements);
  if (!l) {
    l = buildMeshLocator(mesh.nodes, mesh.elements);
    locators.set(mesh.elements, l);
  }
  return l;
}

interface Piece {
  len: number;
  nx: number;
  ny: number;
  /** Value of any per-node field here. */
  at: (v: ArrayLike<number>) => number;
}

const LINE_SAMPLES = 400;

function pieces(
  mesh: SurfaceMesh,
  s: SurfaceRef,
): { list: Piece[]; normal: [number, number] | null } {
  if (s.kind === 'patch') {
    const segs = patchSegments(mesh, s.patch);
    return {
      list: segs.map((g) => ({
        len: g.len,
        nx: g.nx,
        ny: g.ny,
        at: (v) => (v[g.a] + v[g.b]) / 2,
      })),
      normal: null,
    };
  }
  const [x1, y1] = s.p1;
  const [x2, y2] = s.p2;
  const L = Math.hypot(x2 - x1, y2 - y1);
  if (!(L > 0)) return { list: [], normal: null };
  const nx = (y2 - y1) / L,
    ny = -(x2 - x1) / L;
  const loc = locatorOf(mesh);
  const len = L / LINE_SAMPLES;
  const list: Piece[] = [];
  for (let i = 0; i < LINE_SAMPLES; i++) {
    const t = (i + 0.5) / LINE_SAMPLES;
    const x = x1 + t * (x2 - x1),
      y = y1 + t * (y2 - y1);
    const hit = loc.locate(x, y);
    // Parts of the line outside the mesh count for nothing.
    if (!hit) continue;
    list.push({
      len,
      nx,
      ny,
      at: (v) =>
        hit.w[0] * v[hit.nodes[0]] + hit.w[1] * v[hit.nodes[1]] + hit.w[2] * v[hit.nodes[2]],
    });
  }
  return { list, normal: [nx, ny] };
}

/** Integrate `vals` (per node) over the surface; `ux` and `uy` give the
 *  flow through it, `rho` turns that into mass flow. Null when there is
 *  nothing to integrate. */
export function integrateSurface(
  mesh: SurfaceMesh,
  s: SurfaceRef,
  vals: ArrayLike<number>,
  ux: ArrayLike<number>,
  uy: ArrayLike<number>,
  rho: number,
): SurfaceResult | null {
  const { list, normal } = pieces(mesh, s);
  if (!list.length) return null;
  let length = 0,
    flow = 0,
    integral = 0,
    flux = 0;
  for (const p of list) {
    const f = p.at(vals);
    const q = (p.at(ux) * p.nx + p.at(uy) * p.ny) * p.len;
    length += p.len;
    flow += q;
    integral += f * p.len;
    flux += f * q;
  }
  return {
    length,
    normal,
    flow,
    massFlow: flow * rho,
    integral,
    avg: integral / length,
    // Mass-weighted: the density cancels when it is uniform.
    fluxAvg: Math.abs(flow) > 1e-12 * length ? flux / flow + 0 : null,
  };
}
