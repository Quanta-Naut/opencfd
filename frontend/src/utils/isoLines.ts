/**
 * Lines of constant value through a per-node field: marching triangles over
 * each cell's fan triangulation. Returns segments as flat world coordinates
 * [x1, y1, x2, y2, ...], unordered.
 */
export function isoSegments(
  nodes: number[][],
  elements: number[][],
  vals: ArrayLike<number>,
  level: number,
): Float32Array {
  const out: number[] = [];
  const cross = (a: number, b: number) => {
    const va = vals[a],
      vb = vals[b];
    const t = (level - va) / (vb - va);
    out.push(
      nodes[a][0] + t * (nodes[b][0] - nodes[a][0]),
      nodes[a][1] + t * (nodes[b][1] - nodes[a][1]),
    );
  };
  for (const el of elements) {
    for (let k = 1; k + 1 < el.length; k++) {
      const tri = [el[0], el[k], el[k + 1]];
      // Which corners are above the level; a point exactly on it counts as
      // above, so a line through a node is drawn once.
      const above = tri.map((n) => vals[n] >= level);
      const nAbove = +above[0] + +above[1] + +above[2];
      if (nAbove === 0 || nAbove === 3) continue;
      if (!tri.every((n) => Number.isFinite(vals[n]) && nodes[n])) continue;
      // The odd corner out; the line crosses its two edges.
      const odd = above[0] === above[1] ? 2 : above[0] === above[2] ? 1 : 0;
      const a = tri[odd],
        b = tri[(odd + 1) % 3],
        c = tri[(odd + 2) % 3];
      cross(a, b);
      cross(a, c);
    }
  }
  return new Float32Array(out);
}
