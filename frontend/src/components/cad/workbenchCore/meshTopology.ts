// Mesh topology helpers that run once per mesh on hundreds of thousands of
// cells, so they avoid per-cell allocation, BigInt keys and JS Maps/Sets
// (each several times slower than a typed-array hash at this size).

export interface MeshEdgeSets {
  /** Every unique undirected edge, as flat (a, b) pairs. */
  all: Uint32Array;
  /** Edges used by exactly one cell: the domain outline and any holes. */
  boundary: Uint32Array;
}

/** Unique and boundary edges of a polygon mesh in one pass. */
export function meshEdgeSets(elems: number[][], nNodes: number): MeshEdgeSets {
  let total = 0;
  for (let e = 0; e < elems.length; e++) total += elems[e].length;
  // Open-addressing hash keyed by the (min, max) node pair.
  let cap = 1;
  while (cap < total * 2) cap <<= 1;
  const mask = cap - 1;
  const ka = new Int32Array(cap).fill(-1);
  const kb = new Int32Array(cap);
  const count = new Uint8Array(cap);
  const order = new Int32Array(total);
  let nUnique = 0;

  for (let e = 0; e < elems.length; e++) {
    const el = elems[e];
    const len = el.length;
    for (let i = 0; i < len; i++) {
      let a = el[i];
      let b = el[i + 1 === len ? 0 : i + 1];
      if (a >= nNodes || b >= nNodes || a === b) continue;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77)) & mask;
      while (ka[h] !== -1 && (ka[h] !== a || kb[h] !== b)) h = (h + 1) & mask;
      if (ka[h] === -1) {
        ka[h] = a;
        kb[h] = b;
        order[nUnique++] = h;
      }
      if (count[h] < 255) count[h]++;
    }
  }

  const all = new Uint32Array(nUnique * 2);
  let nBoundary = 0;
  for (let i = 0; i < nUnique; i++) {
    const h = order[i];
    all[i * 2] = ka[h];
    all[i * 2 + 1] = kb[h];
    if (count[h] === 1) nBoundary++;
  }
  const boundary = new Uint32Array(nBoundary * 2);
  let o = 0;
  for (let i = 0; i < nUnique; i++) {
    const h = order[i];
    if (count[h] === 1) {
      boundary[o++] = ka[h];
      boundary[o++] = kb[h];
    }
  }
  return { all, boundary };
}

/** Equiangle skewness of every cell (0 = ideal, 1 = degenerate), the same
 *  measure as `cellSkewness`, computed in place without per-cell arrays. */
export function meshSkewness(nodes: number[][], elems: number[][]): Float32Array {
  const out = new Float32Array(elems.length);
  const RAD = 180 / Math.PI;
  for (let e = 0; e < elems.length; e++) {
    const el = elems[e];
    const n = el.length;
    if (n < 3) {
      out[e] = 1;
      continue;
    }
    let ok = true;
    for (let i = 0; i < n; i++) if (!nodes[el[i]]) ok = false;
    if (!ok) continue;
    const ideal = n === 3 ? 60 : 90;
    let mn = 180;
    let mx = 0;
    let degenerate = false;
    for (let i = 0; i < n; i++) {
      const p0 = nodes[el[(i - 1 + n) % n]];
      const p1 = nodes[el[i]];
      const p2 = nodes[el[(i + 1) % n]];
      const v1x = p0[0] - p1[0];
      const v1y = p0[1] - p1[1];
      const v2x = p2[0] - p1[0];
      const v2y = p2[1] - p1[1];
      const d = Math.sqrt((v1x * v1x + v1y * v1y) * (v2x * v2x + v2y * v2y));
      if (d < 1e-15) {
        degenerate = true;
        break;
      }
      const c = (v1x * v2x + v1y * v2y) / d;
      const ang = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c) * RAD;
      if (ang < mn) mn = ang;
      if (ang > mx) mx = ang;
    }
    out[e] = degenerate
      ? 1
      : Math.max(0, Math.min(1, Math.max((mx - ideal) / (180 - ideal), (ideal - mn) / ideal)));
  }
  return out;
}
