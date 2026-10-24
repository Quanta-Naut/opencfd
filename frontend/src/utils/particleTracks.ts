// Particle tracks: massless particles released at seed points and carried
// by the (steady) velocity field, the way a post-processor draws pathlines.
// Midpoint (RK2) steps sized to the local cell, so a track takes a few steps
// per cell however fine or coarse the mesh is there.

import type { MeshLocator } from './meshLocator';

export interface TrackSeedLike {
  kind: 'point' | 'line';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Particles along a line. */
  count: number;
}

export interface Track {
  /** World points [x0, y0, x1, y1, ...]. */
  pts: Float32Array;
  /** Time since release at each point, s. */
  time: Float32Array;
}

/** Where a seed releases its particles. */
export function seedPoints(s: TrackSeedLike): [number, number][] {
  if (s.kind === 'point') return [[s.x0, s.y0]];
  const n = Math.max(2, Math.round(s.count));
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [s.x0 + t * (s.x1 - s.x0), s.y0 + t * (s.y1 - s.y0)] as [number, number];
  });
}

/** Trace one particle from (x, y) until it leaves the mesh, stalls, or runs
 *  past `maxLength` (it may be caught circling a vortex). */
export function traceTrack(
  loc: MeshLocator,
  nodes: number[][],
  ux: ArrayLike<number>,
  uy: ArrayLike<number>,
  x: number,
  y: number,
  maxLength: number,
  maxSteps = 6000,
): Track | null {
  const vel = (px: number, py: number) => {
    const h = loc.locate(px, py);
    if (!h) return null;
    const [a, b, c] = h.nodes;
    const vx = h.w[0] * ux[a] + h.w[1] * ux[b] + h.w[2] * ux[c];
    const vy = h.w[0] * uy[a] + h.w[1] * uy[b] + h.w[2] * uy[c];
    // Local size: the side of a square with the triangle's area, doubled.
    const A = nodes[a],
      B = nodes[b],
      C = nodes[c];
    const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]));
    return { vx, vy, size: Math.sqrt(area) };
  };

  const pts = [x, y];
  const time = [0];
  let t = 0,
    length = 0;
  let v = vel(x, y);
  if (!v) return null;
  for (let step = 0; step < maxSteps && length < maxLength; step++) {
    const speed = Math.hypot(v.vx, v.vy);
    if (!(speed > 1e-12) || !(v.size > 0)) break;
    // About three steps per cell.
    const dt = (0.3 * v.size) / speed;
    const mid = vel(x + 0.5 * dt * v.vx, y + 0.5 * dt * v.vy);
    if (!mid) break;
    const nx = x + dt * mid.vx,
      ny = y + dt * mid.vy;
    const next = vel(nx, ny);
    if (!next) break;
    length += Math.hypot(nx - x, ny - y);
    t += dt;
    x = nx;
    y = ny;
    v = next;
    pts.push(x, y);
    time.push(t);
  }
  return pts.length >= 4 ? { pts: new Float32Array(pts), time: new Float32Array(time) } : null;
}
