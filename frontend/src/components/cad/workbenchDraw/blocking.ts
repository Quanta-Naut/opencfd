import { BOUNDARY_COLORS } from '../../../types/cadWorkflow';
import { blockPolygon, curveOf } from '../../../types/blocking';
import type { DrawFrame, DrawScene } from './types';

/** Structured block topology overlay (Mesh stage). */
export function drawBlockTopology(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const {
    C,
    assocEdges,
    blockVertexKinds,
    badBlockIds,
    blockCursor,
    blockDrag,
    blocking,
    blockPick,
    blockSnapGuides,
    blockTool,
    canvasMode,
    directionColors,
    hoveredBlockIdx,
    hoveredBlockVtx,
    hoverEdgeId,
    outsideBlockIds,
    selectedBlockId,
    selectedEdgeId,
    showBlocking,
    showMesh,
    unpatchedEdgeIds,
  } = scene;
  if (
    showBlocking &&
    blocking &&
    blocking.edges.length > 0 &&
    !(showMesh && canvasMode === 'mesh')
  ) {
    ctx.save();

    // faint per-block fill so the multi-block layout reads at a glance
    blocking.blocks.forEach((blk, bi) => {
      const poly = blockPolygon(blocking, blk);
      if (poly.length < 3) return;
      const hot = hoveredBlockIdx === bi;
      const picked =
        canvasMode === 'cad' &&
        (selectedBlockId === blk.id || (blockTool === 'mergeB' && blockPick === blk.id));
      const bad = badBlockIds.has(blk.id) || outsideBlockIds.has(blk.id);
      const doomed = hot && blockTool === 'delete' && canvasMode === 'cad';
      const target =
        hot && canvasMode === 'cad' && (blockTool === 'ogrid' || blockTool === 'mergeB');
      ctx.beginPath();
      poly.forEach((p, i) => {
        const s = ws(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle =
        bad || doomed
          ? 'rgba(220, 38, 38, 0.18)'
          : picked || target
            ? 'rgba(224, 90, 0, 0.16)'
            : hot
              ? 'rgba(124, 58, 237, 0.14)'
              : 'rgba(124, 58, 237, 0.05)';
      ctx.fill();
      if (picked) {
        ctx.strokeStyle = '#E05A00';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // block number at the centroid
      const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
      const sc = ws(cx, cy);
      ctx.fillStyle = 'rgba(124, 58, 237, 0.75)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(bi + 1), sc.x, sc.y);
    });

    for (const edge of blocking.edges) {
      const v0 = blocking.vertices.find((v) => v.id === edge.v0);
      const v1 = blocking.vertices.find((v) => v.id === edge.v1);
      if (!v0 || !v1) continue;
      const chain = [v0.pt, ...edge.path, v1.pt];
      const col =
        directionColors?.[edge.id] ??
        (edge.patch ? (BOUNDARY_COLORS[edge.patch]?.hex ?? '#7C3AED') : '#7C3AED');
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      chain.forEach((p, i) => {
        const s = ws(p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();

      // node ticks give a read on the cell count - walk the chain by arc length.
      // Capped by on-screen length too: a short edge zoomed in tight (e.g. a
      // narrow throat block) would otherwise cram dozens of ticks into a few
      // pixels and smear into a solid black scribble instead of readable dots.
      let screenLen = 0;
      for (let i = 0; i + 1 < chain.length; i++) {
        const sa = ws(chain[i].x, chain[i].y);
        const sb = ws(chain[i + 1].x, chain[i + 1].y);
        screenLen += Math.hypot(sb.x - sa.x, sb.y - sa.y);
      }
      const n = Math.max(2, Math.min(edge.nodes, 120, Math.floor(screenLen / 5) || 2));
      const segLen: number[] = [];
      let total = 0;
      for (let i = 0; i + 1 < chain.length; i++) {
        const d = Math.hypot(chain[i + 1].x - chain[i].x, chain[i + 1].y - chain[i].y);
        segLen.push(d);
        total += d;
      }
      ctx.fillStyle = col;
      for (let k = 0; k < n; k++) {
        let target = (k / (n - 1)) * total;
        let si = 0;
        while (si < segLen.length && target > segLen[si]) {
          target -= segLen[si];
          si += 1;
        }
        const a = chain[Math.min(si, chain.length - 1)];
        const b = chain[Math.min(si + 1, chain.length - 1)];
        const f = segLen[si] ? target / segLen[si] : 0;
        const s = ws(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Editor highlights on top of the edges: picked / selected / hovered edges,
    // and (dashed red) boundary edges with no patch - they need associating.
    if (canvasMode === 'cad') {
      const vmap = new Map(blocking.vertices.map((v) => [v.id, v.pt] as const));
      const strokeEdge = (id: string, color: string, width: number, dash: number[] = []) => {
        const ed = blocking.edges.find((x) => x.id === id);
        if (!ed) return;
        const chain = [vmap.get(ed.v0)!, ...ed.path, vmap.get(ed.v1)!];
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.beginPath();
        chain.forEach((p, i) => {
          const q = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      };
      unpatchedEdgeIds.forEach((id) => strokeEdge(id, '#DC2626', 2, [5, 4]));
      if (hoverEdgeId && !assocEdges.includes(hoverEdgeId) && hoverEdgeId !== selectedEdgeId)
        strokeEdge(hoverEdgeId, 'rgba(224, 90, 0, 0.55)', 4);
      assocEdges.forEach((id) => strokeEdge(id, '#E05A00', 4));
      if (selectedEdgeId) strokeEdge(selectedEdgeId, '#E05A00', 4);
    }
    // Vertex markers say how each vertex moves when dragged: a square is
    // pinned (a corner or patch change), a filled dot slides along the wall
    // under it, a hollow dot is free. Hovering one grabs it and names it.
    let tip: { x: number; y: number; text: string } | null = null;
    for (const v of blocking.vertices) {
      const s = ws(v.pt.x, v.pt.y);
      const hot = hoveredBlockVtx === v.id || (blockTool === 'mergeV' && blockPick === v.id);
      const kind = blockVertexKinds.get(v.id) ?? 'free';
      const col = hot ? '#E05A00' : kind === 'free' ? '#7C3AED' : '#059669';
      ctx.fillStyle = col;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      if (kind === 'pinned') {
        const r = hot ? 3 : 2.5;
        ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
        ctx.fill();
      } else if (kind === 'slide') {
        ctx.arc(s.x, s.y, hot ? 3 : 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = C.bg;
        ctx.arc(s.x, s.y, hot ? 3 : 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (hot) {
        ctx.strokeStyle = '#E05A00';
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x - 5.5, s.y - 5.5, 11, 11);
        if (!blockDrag.current)
          tip = {
            x: s.x,
            y: s.y,
            text:
              kind === 'pinned'
                ? 'Pinned to the geometry'
                : kind === 'slide'
                  ? 'Slides along the wall (Alt: detach)'
                  : 'Free',
          };
      }
    }
    if (tip) {
      ctx.font = 'bold 9px Inter, sans-serif';
      const tw = ctx.measureText(tip.text).width;
      ctx.fillStyle = C.tipBg;
      ctx.fillRect(tip.x - tw / 2 - 4, tip.y - 22, tw + 8, 14);
      ctx.fillStyle = C.tipText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tip.text, tip.x, tip.y - 15);
    }

    // alignment guides while dragging a block corner (or placing one)
    if ((blockDrag.current || blockCursor) && blockSnapGuides.current.length) {
      ctx.strokeStyle = 'rgba(224, 90, 0, 0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      for (const g of blockSnapGuides.current) {
        const a = ws(g.a.x, g.a.y);
        const b = ws(g.b.x, g.b.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

/** Block editor previews (Blocks view): draw, split, merge and association feedback. */
export function drawBlockEditor(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const {
    blockCursor,
    blockDrawPts,
    blockTool,
    C,
    cadState,
    canvasMode,
    hoverCurveId,
    showBlocking,
    splitHover,
  } = scene;
  if (showBlocking && canvasMode === 'cad') {
    ctx.save();
    if (blockTool === 'draw' && (blockDrawPts.length || blockCursor)) {
      const pts = [...blockDrawPts, ...(blockCursor ? [blockCursor] : [])];
      ctx.beginPath();
      pts.forEach((p, i) => {
        const q = ws(p.x, p.y);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      if (pts.length === 4) ctx.closePath();
      ctx.strokeStyle = '#E05A00';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (pts.length === 4) {
        ctx.fillStyle = 'rgba(224, 90, 0, 0.08)';
        ctx.fill();
      }
      pts.forEach((p, i) => {
        const q = ws(p.x, p.y);
        ctx.beginPath();
        ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = i < blockDrawPts.length ? '#E05A00' : C.handleFill;
        ctx.fill();
        ctx.strokeStyle = '#E05A00';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    }
    if (blockTool === 'assoc' && hoverCurveId) {
      const ent = cadState.entities.find((x) => x.id === hoverCurveId);
      const c = ent ? curveOf(ent) : null;
      if (c) {
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 4;
        ctx.beginPath();
        c.pts.forEach((p, i) => {
          const q = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        if (c.closed) ctx.closePath();
        ctx.stroke();
      }
    }
    if (blockTool === 'split' && splitHover) {
      ctx.strokeStyle = '#E05A00';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      for (const chain of splitHover.cut) {
        ctx.beginPath();
        chain.forEach((p, i) => {
          const q = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const q = ws(splitHover.pt.x, splitHover.pt.y);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#E05A00';
      ctx.fill();
    }
    ctx.restore();
  }
}
