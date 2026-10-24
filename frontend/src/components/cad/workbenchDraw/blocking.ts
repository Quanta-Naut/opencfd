import { BOUNDARY_COLORS } from '../../../types/cadWorkflow';
import {
  blockPolygon,
  curveOf,
  edgeStations,
  PREMESH_MIN_ANGLE,
  PREMESH_MIN_DET,
} from '../../../types/blocking';
import type { DrawFrame, DrawScene } from './types';

/** ICEM CFD vertex colours: how a vertex moves when dragged. */
export const VERTEX_COLORS = {
  pinned: '#DC2626', // red: fixed to a geometry point
  slide: '#16A34A', // green: slides along a curve
  free: '#2563EB', // blue: free, usually inside the domain
} as const;

const SELECT = '#E05A00';

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
    blockPremesh,
    blockSnapGuides,
    blockSpacingJumps,
    blockTool,
    canvasMode,
    directionColors,
    hoveredBlockIdx,
    hoveredBlockVtx,
    hoverEdgeId,
    ogridPass,
    ogridSel,
    outsideBlockIds,
    selectedBlockId,
    selectedEdgeId,
    selectedVertexId,
    showBlocking,
    showMesh,
    showPremesh,
    unpatchedEdgeIds,
  } = scene;
  if (
    !showBlocking ||
    !blocking ||
    blocking.edges.length === 0 ||
    (showMesh && canvasMode === 'mesh')
  )
    return;
  const editing = canvasMode === 'cad';
  ctx.save();
  const vmap = new Map(blocking.vertices.map((v) => [v.id, v.pt] as const));
  const emap = new Map(blocking.edges.map((e) => [e.id, e] as const));
  const chainOf = (id: string) => {
    const ed = emap.get(id);
    return ed ? [vmap.get(ed.v0)!, ...ed.path, vmap.get(ed.v1)!] : [];
  };
  const tracePath = (pts: { x: number; y: number }[]) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      const q = ws(p.x, p.y);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
  };

  // Faint per-block fill so the layout reads at a glance; picked blocks in
  // the selection colour, blocks over a body or outside the fluid in red.
  blocking.blocks.forEach((blk, bi) => {
    const poly = blockPolygon(blocking, blk);
    if (poly.length < 3) return;
    const hot = hoveredBlockIdx === bi;
    const inOgrid = editing && blockTool === 'ogrid' && ogridSel.includes(blk.id);
    const picked =
      editing &&
      (selectedBlockId === blk.id || (blockTool === 'mergeB' && blockPick === blk.id) || inOgrid);
    const bad = badBlockIds.has(blk.id) || outsideBlockIds.has(blk.id);
    const doomed = hot && blockTool === 'delete' && editing;
    const target = hot && editing && (blockTool === 'ogrid' || blockTool === 'mergeB');
    tracePath(poly);
    ctx.closePath();
    ctx.fillStyle =
      bad || doomed
        ? 'rgba(220, 38, 38, 0.18)'
        : picked
          ? 'rgba(224, 90, 0, 0.16)'
          : target || hot
            ? 'rgba(124, 58, 237, 0.12)'
            : 'rgba(124, 58, 237, 0.04)';
    ctx.fill();
    if (picked) {
      ctx.strokeStyle = SELECT;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (!showPremesh) {
      const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
      const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length;
      const sc = ws(cx, cy);
      ctx.fillStyle = 'rgba(124, 58, 237, 0.7)';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(bi + 1), sc.x, sc.y);
    }
  });

  // ICEM pre-mesh: the grid each block will produce. Cells under ICEM's
  // targets (determinant 0.2, angle 18 deg) are tinted, folded ones solid.
  if (showPremesh) {
    for (const pm of blockPremesh) {
      const g = pm.grid;
      const m = g.length - 1;
      const n = g[0].length - 1;
      for (let j = 0; j < m; j++) {
        for (let i = 0; i < n; i++) {
          const d = pm.det[j * n + i];
          const a = pm.angle[j * n + i];
          if (d >= PREMESH_MIN_DET && a >= PREMESH_MIN_ANGLE) continue;
          tracePath([g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]]);
          ctx.closePath();
          ctx.fillStyle = d <= 0 ? 'rgba(220, 38, 38, 0.7)' : 'rgba(220, 38, 38, 0.3)';
          ctx.fill();
        }
      }
      ctx.strokeStyle = C.meshLine;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (let j = 1; j < m; j++) {
        g[j].forEach((p, i) => {
          const q = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
      }
      for (let i = 1; i < n; i++) {
        for (let j = 0; j <= m; j++) {
          const q = ws(g[j][i].x, g[j][i].y);
          if (j === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        }
      }
      ctx.stroke();
    }
  }

  // Block edges, coloured by patch (or by sizing direction while that step is
  // open), with a tick at every node where the edge's law puts it.
  for (const edge of blocking.edges) {
    const chain = chainOf(edge.id);
    if (chain.length < 2) continue;
    const col =
      directionColors?.[edge.id] ??
      (edge.patch ? (BOUNDARY_COLORS[edge.patch]?.hex ?? '#7C3AED') : '#7C3AED');
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    tracePath(chain);
    ctx.stroke();
    if (showPremesh) continue;
    // Capped by on-screen length so a short edge zoomed out never smears
    // its ticks into a solid line.
    let screenLen = 0;
    const cum = [0];
    for (let i = 0; i + 1 < chain.length; i++) {
      const sa = ws(chain[i].x, chain[i].y);
      const sb = ws(chain[i + 1].x, chain[i + 1].y);
      screenLen += Math.hypot(sb.x - sa.x, sb.y - sa.y);
      cum.push(cum[i] + Math.hypot(chain[i + 1].x - chain[i].x, chain[i + 1].y - chain[i].y));
    }
    const cells = Math.max(1, Math.min(edge.nodes - 1, Math.floor(screenLen / 4) || 1));
    const st = edgeStations(blocking, edge, cells, vmap, emap);
    const total = cum[cum.length - 1] || 1;
    ctx.fillStyle = col;
    let si = 0;
    for (const fr of st) {
      const t = fr * total;
      while (si < cum.length - 2 && cum[si + 1] < t) si++;
      const seg = cum[si + 1] - cum[si] || 1;
      const u = Math.min(1, Math.max(0, (t - cum[si]) / seg));
      const a = chain[si];
      const b = chain[si + 1];
      const q = ws(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
      ctx.beginPath();
      ctx.arc(q.x, q.y, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Editor highlights on top of the edges.
  if (editing) {
    const strokeEdge = (id: string, color: string, width: number, dash: number[] = []) => {
      const chain = chainOf(id);
      if (chain.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      tracePath(chain);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // Boundary edges with no patch need associating (dashed red).
    unpatchedEdgeIds.forEach((id) => strokeEdge(id, '#DC2626', 2, [5, 4]));
    if (hoverEdgeId && !assocEdges.includes(hoverEdgeId) && hoverEdgeId !== selectedEdgeId)
      strokeEdge(hoverEdgeId, 'rgba(224, 90, 0, 0.55)', 4);
    assocEdges.forEach((id) => strokeEdge(id, SELECT, 4));
    // O-grid pass-through edges: the grid lines run straight through them.
    if (blockTool === 'ogrid') ogridPass.forEach((id) => strokeEdge(id, SELECT, 4, [7, 4]));
    if (selectedEdgeId) {
      strokeEdge(selectedEdgeId, SELECT, 4);
      drawEdgeArrow(f, chainOf(selectedEdgeId));
    }
  }

  // Spacing jumps across block joins: an amber ring at the vertex.
  if (editing)
    for (const j of blockSpacingJumps) {
      const p = vmap.get(j.vid);
      if (!p) continue;
      const q = ws(p.x, p.y);
      ctx.strokeStyle = '#D97706';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

  // Vertices in ICEM's colours: red is fixed to a point, green slides along a
  // curve, blue is free. The one under the cursor names itself.
  let tip: { x: number; y: number; text: string } | null = null;
  for (const v of blocking.vertices) {
    const q = ws(v.pt.x, v.pt.y);
    const hot = hoveredBlockVtx === v.id || (blockTool === 'mergeV' && blockPick === v.id);
    const sel = selectedVertexId === v.id;
    const kind = blockVertexKinds.get(v.id) ?? 'free';
    ctx.fillStyle = VERTEX_COLORS[kind];
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(q.x, q.y, hot || sel ? 3.4 : 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (hot || sel) {
      ctx.strokeStyle = SELECT;
      ctx.lineWidth = 1;
      ctx.strokeRect(q.x - 5.5, q.y - 5.5, 11, 11);
    }
    if (hot && !blockDrag.current)
      tip = {
        x: q.x,
        y: q.y,
        text:
          kind === 'pinned'
            ? 'Fixed to a geometry point'
            : kind === 'slide'
              ? 'Slides along the curve (Alt-drag detaches)'
              : 'Free vertex',
      };
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

  // Alignment guides while dragging a block corner (or placing one).
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

/** ICEM's edge arrow: points from side 1 (v0) to side 2 (v1), so "Spacing 1"
 *  and "Spacing 2" in the inspector map to the canvas. */
function drawEdgeArrow(f: DrawFrame, chain: { x: number; y: number }[]): void {
  const { ctx, ws } = f;
  if (chain.length < 2) return;
  const pts = chain.map((p) => ws(p.x, p.y));
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[cum.length - 1];
  if (L < 30) return;
  const at = (t: number) => {
    let i = 0;
    while (i < pts.length - 2 && cum[i + 1] < t) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const u = (t - cum[i]) / seg;
    const a = pts[i];
    const b = pts[i + 1];
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      dx: (b.x - a.x) / seg,
      dy: (b.y - a.y) / seg,
    };
  };
  const m = at(L / 2);
  ctx.fillStyle = SELECT;
  ctx.beginPath();
  ctx.moveTo(m.x + m.dx * 7, m.y + m.dy * 7);
  ctx.lineTo(m.x - m.dx * 5 - m.dy * 5, m.y - m.dy * 5 + m.dx * 5);
  ctx.lineTo(m.x - m.dx * 5 + m.dy * 5, m.y - m.dy * 5 - m.dx * 5);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [t, label] of [
    [Math.min(14, L / 4), '1'],
    [L - Math.min(14, L / 4), '2'],
  ] as const) {
    const p = at(t);
    ctx.fillText(label, p.x - p.dy * 10, p.y + p.dx * 10);
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
