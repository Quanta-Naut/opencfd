import { Point2D, CadEntity, BoundaryTag } from '../cadWorkflow';
import { Blocking, Block, BlockEdge, BlockVertex } from './types';
import {
  boundsOf, centroidOf, entityRing, near, pointInRing, rayPolygonHit, resampleClosed,
  signedArea, uid,
} from './geometry';
import { blockCornerIds, blockPolygon, orderBlockEdges, splitAllAt } from './blockEdit';
import { cleanBlocking } from './sizing';

/** Closed non-domain geometry entities and the block that currently contains each. */
export function bodiesForOgrid(
  entities: CadEntity[],
  bk: Blocking,
): { index: number; name: string; blockId: string | null; wrapped: boolean }[] {
  const out: { index: number; name: string; blockId: string | null; wrapped: boolean }[] = [];
  entities.forEach((e, index) => {
    if (e.layer === 'construction' || e.role === 'domain_boundary') return;
    const closed = e.isClosed || e.type === 'rectangle' || e.type === 'circle' || e.type === 'ellipse';
    if (!closed) return;
    const ring = resampleClosed(entityRing(e), 72);
    if (ring.length < 8) return;
    const g = centroidOf(ring);
    const span = Math.max(boundsOf(ring).maxX - boundsOf(ring).minX, boundsOf(ring).maxY - boundsOf(ring).minY);
    const host = bk.blocks.find((b) => {
      const poly = blockPolygon(bk, b);
      return poly.length >= 3 && pointInRing(g.x, g.y, poly);
    });
    // wrapped = an edge path already traces this body outline
    const wrapped = bk.edges.some(
      (ed) => ed.path.length > 0 && ed.path.some((pp) => ring.some((rp) => near(pp, rp, span * 0.02 + 1e-6))),
    );
    out.push({ index, name: (e as any).name || `Body ${index + 1}`, blockId: host?.id ?? null, wrapped });
  });
  return out;
}

/**
 * Replace the block containing a body with a 4-block O-grid ring: the body
 * outline is the inner boundary, the block edges are the outer boundary, and
 * four radial cuts join them. If the body is not already inside a single block,
 * the host block is first split at the body's padded bounding box.
 */
export function wrapBodyOgrid(
  bk: Blocking,
  bodyRaw: Point2D[],
  patch?: BoundaryTag,
  opts?: {
    bodyEntityId?: string;
    offsetFactor?: number;
    radialNodes?: number;
    radialRatio?: number;
  },
): Blocking | null {
  const bodyEntityId = opts?.bodyEntityId;
  const offsetFactor = Math.max(0.06, Math.min(1.2, opts?.offsetFactor ?? 0.25));
  const radialNodes = Math.max(4, Math.min(400, Math.round(opts?.radialNodes ?? 26)));
  const radialRatio = Math.max(1, Math.min(100, opts?.radialRatio ?? 10));

  let body = resampleClosed(bodyRaw.map((p) => ({ x: p.x, y: p.y })), 72);
  if (body.length < 8) return null;
  if (signedArea(body) < 0) body.reverse();
  const g = centroidOf(body);
  const bb = boundsOf(body);

  let work: Blocking = bk;
  const fullyInside = (b: Block, w: Blocking) => {
    const poly = blockPolygon(w, b);
    return poly.length >= 3 && body.every((p) => pointInRing(p.x, p.y, poly));
  };
  const containing = (w: Blocking) => w.blocks.find((b) => pointInRing(g.x, g.y, blockPolygon(w, b)));
  let host = containing(work);
  if (!host) return null;

  // Carve a SNUG box around the body so the O-ring stays thin and orthogonal and
  // the rest of the domain is a clean Cartesian H-grid. A thick O-ring is what
  // makes the four corner wedge blocks skew badly, so keep the offset small.
  const bw = bb.maxX - bb.minX, bh = bb.maxY - bb.minY;
  const hb0 = boundsOf(blockPolygon(work, host));
  const gapL = bb.minX - hb0.minX, gapR = hb0.maxX - bb.maxX;
  const gapB = bb.minY - hb0.minY, gapT = hb0.maxY - bb.maxY;
  const minGap = Math.min(gapL, gapR, gapB, gapT);
  const hostTooBig =
    hb0.maxX - hb0.minX > bw * (1 + offsetFactor) ||
    hb0.maxY - hb0.minY > bh * (1 + offsetFactor);
  if (minGap > Math.min(bw, bh) * 0.04 && hostTooBig) {
    // ring reaches offsetFactor * body size out from the wall per-axis
    const clampPad = (val: number, minPad: number, maxPad: number) =>
      maxPad < minPad ? maxPad : Math.max(minPad, Math.min(val, maxPad));
    const padX = clampPad(offsetFactor * bw, bw * 0.05, Math.min(gapL * 0.9, gapR * 0.9));
    const padY = clampPad(offsetFactor * bh, bh * 0.05, Math.min(gapB * 0.9, gapT * 0.9));
    for (const [ax, v] of [
      ['x', bb.minX - padX], ['x', bb.maxX + padX],
      ['y', bb.minY - padY], ['y', bb.maxY + padY],
    ] as [('x' | 'y'), number][]) {
      work = splitAllAt(work, ax, v);
    }
    host = containing(work);
  }
  if (!host || !fullyInside(host, work)) return null;

  const norm = (a: number) => { while (a <= -Math.PI) a += 2 * Math.PI; while (a > Math.PI) a -= 2 * Math.PI; return a; };
  const angG = (p: Point2D) => Math.atan2(p.y - g.y, p.x - g.x);

  // Build a ring of `N` blocks around the body. `attach` are the outer vertex ids
  // (in angular order about g); `outerEdge(k)` is the block edge from attach[k] to
  // attach[k+1]. N=8 halves the arc each block spans (less corner skew, seams on
  // the flow axes); we fall back to N=4 if the centre split fails.
  const buildRing = (
    w: Blocking,
    attachIds: string[],
    outerEdge: (k: number) => string | null,
    removeIds: Set<string>,
  ): Blocking | null => {
    const N = attachIds.length;
    const vm = new Map(w.vertices.map((v) => [v.id, v.pt] as const));
    const I = attachIds.map((id) => rayPolygonHit(g, vm.get(id)!, body));
    if (I.some((p) => !p)) return null;
    const IP = I as Point2D[];
    const theta = IP.map(angG);
    const arcs: Point2D[][] = [];
    for (let k = 0; k < N; k++) {
      const gap = norm(theta[(k + 1) % N] - theta[k]);
      const dir = Math.sign(gap) || 1;
      const off = (t: number) => dir * norm(t - theta[k]);
      const mids = body
        .filter((p) => { const o = off(angG(p)); return o > 1e-6 && o < Math.abs(gap) - 1e-6; })
        .sort((p, q) => off(angG(p)) - off(angG(q)));
      arcs.push([IP[k], ...mids, IP[(k + 1) % N]]);
    }
    const verts = w.vertices.map((v) => ({ id: v.id, pt: { ...v.pt } }));
    const innerIds = IP.map((p) => { const id = uid(); verts.push({ id, pt: { ...p } }); return id; });
    const edges = w.edges.map((e) => ({ ...e, path: e.path.map((p) => ({ ...p })) }));
    const radialIds: string[] = [];
    const arcIds: string[] = [];
    for (let k = 0; k < N; k++) {
      // Wall clustering grading ratio: 1 = uniform, >1 = geometric
      const rad: BlockEdge = {
        id: uid(),
        v0: innerIds[k],
        v1: attachIds[k],
        path: [],
        nodes: radialNodes,
        law: radialRatio === 1 ? 'uniform' : 'geometric',
        ratio: radialRatio,
      };
      const arc: BlockEdge = {
        id: uid(), v0: innerIds[k], v1: innerIds[(k + 1) % N],
        path: arcs[k].slice(1, -1).map((p) => ({ ...p })),
        patch: patch ?? 'wall', nodes: N === 8 ? 18 : 30, law: 'uniform', ratio: 1,
        curveId: bodyEntityId,
      };
      edges.push(rad, arc);
      radialIds.push(rad.id);
      arcIds.push(arc.id);
    }
    const scratch: Blocking = { vertices: verts, edges, blocks: [], links: w.links };
    const ringBlocks: Block[] = [];
    for (let k = 0; k < N; k++) {
      const outer = outerEdge(k);
      if (!outer) return null;
      const ord = orderBlockEdges(scratch, [outer, radialIds[(k + 1) % N], arcIds[k], radialIds[k]]);
      if (!ord) return null;
      ringBlocks.push({ id: uid(), edges: ord });
    }
    return cleanBlocking({
      vertices: verts,
      edges,
      blocks: [...w.blocks.filter((b) => !removeIds.has(b.id)), ...ringBlocks],
      links: [...(w.links ?? []), [...arcIds], [...radialIds]],
    });
  };

  // ── attempt the 8-cut ring ──
  const gx = (bb.minX + bb.maxX) / 2, gy = (bb.minY + bb.maxY) / 2;
  let split = splitAllAt(splitAllAt(work, 'x', gx), 'y', gy);
  const atCentre = (p: Point2D) => Math.abs(p.x - gx) < 1e-5 && Math.abs(p.y - gy) < 1e-5;
  const svm = new Map(split.vertices.map((v) => [v.id, v.pt] as const));
  const quads = split.blocks.filter((b) => {
    const ids = blockCornerIds(split, b);
    return ids.length === 4 && ids.some((id) => atCentre(svm.get(id)!));
  });
  if (quads.length === 4) {
    const byAngG = (id: string) => angG(svm.get(id)!);
    // outer corners (farthest from g) and the box-edge mids (not at g, not a far corner)
    const farCorners: string[] = [];
    const edgeMids = new Set<string>();
    for (const q of quads) {
      const ids = blockCornerIds(split, q);
      let far = ids[0], fd = -1;
      for (const id of ids) {
        const d = Math.hypot(svm.get(id)!.x - gx, svm.get(id)!.y - gy);
        if (d > fd) { fd = d; far = id; }
      }
      farCorners.push(far);
      for (const id of ids) if (!atCentre(svm.get(id)!) && id !== far) edgeMids.add(id);
    }
    const corners = [...new Set(farCorners)].sort((a, b) => byAngG(a) - byAngG(b));
    const mids = [...edgeMids].sort((a, b) => byAngG(a) - byAngG(b));
    if (corners.length === 4 && mids.length === 4) {
      const attach: string[] = [];
      let ok = true;
      for (let k = 0; k < 4; k++) {
        attach.push(corners[k]);
        const a0 = byAngG(corners[k]);
        let a1 = byAngG(corners[(k + 1) % 4]);
        if (a1 <= a0) a1 += 2 * Math.PI;
        const mid = mids.find((m) => {
          let am = byAngG(m);
          if (am <= a0) am += 2 * Math.PI;
          return am > a0 + 1e-6 && am < a1 - 1e-6;
        });
        if (!mid) { ok = false; break; }
        attach.push(mid);
      }
      if (ok) {
        const findEdge = (a: string, b: string) =>
          split.edges.find((e) => (e.v0 === a && e.v1 === b) || (e.v0 === b && e.v1 === a))?.id ?? null;
        const res = buildRing(
          split,
          attach,
          (k) => findEdge(attach[k], attach[(k + 1) % 8]),
          new Set(quads.map((q) => q.id)),
        );
        if (res) return res;
      }
    }
  }

  // ── fall back to the 4-cut ring on the un-split box ──
  const cornerIds = blockCornerIds(work, host);
  if (cornerIds.length !== 4) return null;
  const hostBlk = host;
  return (
    buildRing(work, cornerIds, (k) => hostBlk.edges[k] ?? null, new Set([hostBlk.id])) ?? null
  );
}
