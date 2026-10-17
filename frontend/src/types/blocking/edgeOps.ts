import { Point2D, CadEntity } from '../cadWorkflow';
import { Blocking, BlockEdge } from './types';
import { dedupeClose, entityRing, near, resampleOpen } from './geometry';
import { movedEdgePath, outlinesFor } from './editor';
import { associatedEdgePath } from './hexa';

/**
 * Reproject a curved block edge onto its associated CAD entity outline
 * after an endpoint moved. Returns the new interior path points.
 */
export function reprojectEdgePath(
  edge: BlockEdge,
  v0pt: Point2D,
  v1pt: Point2D,
  entities: CadEntity[],
): Point2D[] {
  if (!edge.curveId) return [];
  const entity = entities.find((e) => e.id === edge.curveId);
  if (!entity) return [];
  const ring = entityRing(entity);
  const cleanRing = dedupeClose(ring);
  if (cleanRing.length < 3) return [];
  if (near(v0pt, v1pt, 1e-6)) return [];

  // Find the ring index nearest v0pt and nearest v1pt
  let i0 = 0, d0Min = Infinity;
  let i1 = 0, d1Min = Infinity;
  for (let i = 0; i < cleanRing.length; i++) {
    const p = cleanRing[i];
    const d0 = Math.hypot(p.x - v0pt.x, p.y - v0pt.y);
    if (d0 < d0Min) { d0Min = d0; i0 = i; }
    const d1 = Math.hypot(p.x - v1pt.x, p.y - v1pt.y);
    if (d1 < d1Min) { d1Min = d1; i1 = i; }
  }

  if (i0 === i1) return [];

  const N = cleanRing.length;
  // Walk the ring both ways between those indices
  const arcFwd: Point2D[] = [cleanRing[i0]];
  let cur = i0;
  while (cur !== i1) {
    cur = (cur + 1) % N;
    arcFwd.push(cleanRing[cur]);
  }

  const arcBwd: Point2D[] = [cleanRing[i0]];
  cur = i0;
  while (cur !== i1) {
    cur = (cur - 1 + N) % N;
    arcBwd.push(cleanRing[cur]);
  }

  const arcLen = (pts: Point2D[]) => {
    let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      len += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    }
    return len;
  };

  const lenFwd = arcLen(arcFwd);
  const lenBwd = arcLen(arcBwd);
  const chosenArc = lenFwd <= lenBwd ? arcFwd : arcBwd;
  if (Math.min(lenFwd, lenBwd) < 1e-6) return [];

  // Resample that arc to ~24 evenly spaced points and return interior points only
  const resampled = resampleOpen(chosenArc, 26);
  return resampled.slice(1, -1);
}

/**
 * Move a block vertex. Every edge touching it that ran along an outline (the
 * domain or a body) slides along that outline, the same way round as before;
 * any other curved edge keeps its shape and just follows its ends. (It used to
 * snap each end to the nearest outline VERTEX and take the shorter way round,
 * so a corner partway along a straight side could swing its edge round the
 * whole domain, and every uncurved-but-bent edge went straight.)
 */
export function applyVertexMove(
  bk: Blocking,
  vertexId: string,
  newPt: Point2D,
  entities: CadEntity[],
): Blocking {
  const outlines = outlinesFor(entities);
  const old = bk.vertices.find((v) => v.id === vertexId)?.pt;
  const vertices = bk.vertices.map((v) =>
    v.id === vertexId ? { ...v, pt: { ...newPt } } : { ...v, pt: { ...v.pt } },
  );
  const vmap = new Map(vertices.map((v) => [v.id, v.pt] as const));
  const omap = new Map(bk.vertices.map((v) => [v.id, v.pt] as const));
  const edges = bk.edges.map((e) => {
    if (old && (e.v0 === vertexId || e.v1 === vertexId)) {
      const path =
        associatedEdgePath(e, vmap.get(e.v0)!, vmap.get(e.v1)!, entities) ??
        movedEdgePath(e.path, omap.get(e.v0)!, omap.get(e.v1)!, vmap.get(e.v0)!, vmap.get(e.v1)!, outlines);
      return { ...e, path };
    }
    return { ...e, path: e.path.map((p) => ({ ...p })) };
  });
  return {
    vertices,
    edges,
    blocks: bk.blocks.map((b) => ({ id: b.id, edges: [...b.edges] })),
    links: bk.links ? bk.links.map((grp) => [...grp]) : undefined,
  };
}
