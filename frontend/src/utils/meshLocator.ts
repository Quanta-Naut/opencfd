// Point location on a 2D mesh: which cell holds (x, y), and the weights that
// interpolate per-node values there. A uniform grid of cell bounding boxes
// keeps a lookup to a handful of cells, so probing and drawing vectors over
// tens of thousands of cells stays instant.

export interface MeshHit {
  cell: number;
  nodes: [number, number, number];
  w: [number, number, number];
}

export interface MeshLocator {
  locate(x: number, y: number): MeshHit | null;
  /** The value of a per-node field at (x, y), or null outside the mesh. */
  sample(vals: ArrayLike<number>, x: number, y: number): number | null;
}

export function buildMeshLocator(nodes: number[][], elements: number[][]): MeshLocator {
  const n = elements.length;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const box = new Float64Array(n * 4);
  for (let e = 0; e < n; e++) {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const ni of elements[e]) {
      const p = nodes[ni];
      if (!p) continue;
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
    box.set([x0, y0, x1, y1], e * 4);
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  }
  // About one cell per grid bucket on average.
  const side = Math.max(1, Math.round(Math.sqrt(n)));
  const gx = side,
    gy = side;
  const sx = (maxX - minX) / gx || 1,
    sy = (maxY - minY) / gy || 1;
  const buckets: number[][] = Array.from({ length: gx * gy }, () => []);
  const bi = (v: number, lo: number, s: number, g: number) =>
    Math.max(0, Math.min(g - 1, Math.floor((v - lo) / s)));
  for (let e = 0; e < n; e++) {
    const i0 = bi(box[e * 4], minX, sx, gx),
      i1 = bi(box[e * 4 + 2], minX, sx, gx);
    const j0 = bi(box[e * 4 + 1], minY, sy, gy),
      j1 = bi(box[e * 4 + 3], minY, sy, gy);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * gx + i].push(e);
  }

  // Barycentric weights of (x, y) in triangle a-b-c, or null when outside.
  const tri = (x: number, y: number, a: number, b: number, c: number) => {
    const A = nodes[a],
      B = nodes[b],
      C = nodes[c];
    const d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(d) < 1e-300) return null;
    const wa = ((B[1] - C[1]) * (x - C[0]) + (C[0] - B[0]) * (y - C[1])) / d;
    const wb = ((C[1] - A[1]) * (x - C[0]) + (A[0] - C[0]) * (y - C[1])) / d;
    const wc = 1 - wa - wb;
    const eps = -1e-9;
    return wa >= eps && wb >= eps && wc >= eps ? ([wa, wb, wc] as [number, number, number]) : null;
  };

  const locate = (x: number, y: number): MeshHit | null => {
    if (x < minX || x > maxX || y < minY || y > maxY) return null;
    const cand = buckets[bi(y, minY, sy, gy) * gx + bi(x, minX, sx, gx)];
    for (const e of cand) {
      if (x < box[e * 4] || x > box[e * 4 + 2] || y < box[e * 4 + 1] || y > box[e * 4 + 3])
        continue;
      const el = elements[e];
      // Fan the cell into triangles from its first node.
      for (let k = 1; k + 1 < el.length; k++) {
        const w = tri(x, y, el[0], el[k], el[k + 1]);
        if (w) return { cell: e, nodes: [el[0], el[k], el[k + 1]], w };
      }
    }
    return null;
  };

  return {
    locate,
    sample(vals, x, y) {
      const h = locate(x, y);
      if (!h) return null;
      return h.w[0] * vals[h.nodes[0]] + h.w[1] * vals[h.nodes[1]] + h.w[2] * vals[h.nodes[2]];
    },
  };
}

/** Boundary edges of a mesh (edges used by one cell): the two nodes, in
 *  the order the cell lists them, and that cell. */
export function boundaryEdges(elements: number[][]): [number, number, number][] {
  const count = new Map<string, [number, number, number, number]>();
  elements.forEach((el, e) => {
    for (let k = 0; k < el.length; k++) {
      const a = el[k],
        b = el[(k + 1) % el.length];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const c = count.get(key);
      if (c) c[3]++;
      else count.set(key, [a, b, e, 1]);
    }
  });
  const out: [number, number, number][] = [];
  count.forEach(([a, b, e, c]) => {
    if (c === 1) out.push([a, b, e]);
  });
  return out;
}

/** The boundary edges of one patch, joined into chains in order along the
 *  boundary (a closed wall is one chain that ends where it starts). */
export function patchChains(edges: [number, number, number][], patchNodes: number[]): number[][] {
  const inPatch = new Set(patchNodes);
  const adj = new Map<number, number[]>();
  for (const [a, b] of edges) {
    if (!inPatch.has(a) || !inPatch.has(b)) continue;
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const chains: number[][] = [];
  // Open chains start at an end (one neighbour); closed loops anywhere.
  const starts = [...[...adj.keys()].filter((v) => adj.get(v)!.length === 1), ...[...adj.keys()]];
  for (const s of starts) {
    for (const first of adj.get(s) ?? []) {
      if (used.has(key(s, first))) continue;
      const chain = [s];
      let prev = s,
        cur = first;
      used.add(key(s, first));
      while (true) {
        chain.push(cur);
        const next = (adj.get(cur) ?? []).find((v) => v !== prev && !used.has(key(cur, v)));
        if (next === undefined) break;
        used.add(key(cur, next));
        prev = cur;
        cur = next;
      }
      chains.push(chain);
    }
  }
  return chains;
}
