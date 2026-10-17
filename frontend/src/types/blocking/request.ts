import { Blocking, StructuredMeshRequest } from './types';
import { resampleOpen } from './geometry';

export function toStructuredRequest(bk: Blocking): StructuredMeshRequest {
  const vmap = new Map(bk.vertices.map((v) => [v.id, v.pt]));
  const emap = new Map(bk.edges.map((e, i) => [e.id, i]));
  return {
    edges: bk.edges.map((e) => {
      const a = vmap.get(e.v0)!;
      const b = vmap.get(e.v1)!;
      let pathPts = e.path;
      if (e.curveId && e.path.length > 0) {
        const fullChain = [a, ...e.path, b];
        const resampled = resampleOpen(fullChain, 50);
        pathPts = resampled.slice(1, -1);
      }
      return {
        p0: [a.x, a.y] as [number, number],
        p1: [b.x, b.y] as [number, number],
        path: pathPts.map((p) => [p.x, p.y] as [number, number]),
        nodes: Math.max(2, Math.round(e.nodes)),
        law: e.law,
        ratio: e.ratio,
        patch: e.patch,
      };
    }),
    blocks: bk.blocks.map((blk) => blk.edges.map((id) => emap.get(id)!) as [number, number, number, number]),
  };
}
