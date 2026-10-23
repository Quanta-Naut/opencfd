import { BOUNDARY_COLORS, getContiguousEdgeChains } from '../../../types/cadWorkflow';
import type { DrawFrame, DrawScene } from './types';

/** Boundary Patches step: edge tag highlights and badges. */
export function drawBoundaryTags(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const { activeTagTool, boundaryEdges, C, cadState, currentStep, hoveredEdgeKey, tool } = scene;
  if (currentStep === 3) {
    // Faint outline on taggable edges ONLY while a tag tool is armed, so the
    // user can see what to click. Nothing implies any edge is a wall.
    if (activeTagTool) {
      ctx.save();
      ctx.strokeStyle = C.accentA(0.28);
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.4;
      for (const edge of boundaryEdges) {
        if (edge.explicit) continue;
        const a = ws(edge.p0.x, edge.p0.y);
        const b = ws(edge.p1.x, edge.p1.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Colour only edges the user has explicitly tagged. Untagged edges stay
    // the normal geometry colour - nothing is a "wall" until you say so.
    for (const edge of boundaryEdges) {
      if (!edge.explicit) continue;
      const isHovered = hoveredEdgeKey === edge.key;
      const p0 = ws(edge.p0.x, edge.p0.y);
      const p1 = ws(edge.p1.x, edge.p1.y);
      const colorConfig = BOUNDARY_COLORS[edge.tag] || BOUNDARY_COLORS.wall;
      // A circle is drawn as many short arc segments; only show a normal arrow
      // every so often so the outline does not turn into a sunburst.
      const edgeEntType = cadState.entities.find((en) => en.id === edge.entityId)?.type;
      const isCircleSeg = edgeEntType === 'circle' || edgeEntType === 'ellipse';
      const showArrow = !isCircleSeg || edge.edgeIndex % 8 === 0;

      ctx.save();
      // Thick highlight along the edge
      ctx.strokeStyle = colorConfig.hex;
      ctx.lineWidth = isHovered ? 5.5 : 3.5;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();

      // Normal indicator arrow at midpoint
      const mid = ws(edge.midpoint.x, edge.midpoint.y);
      if (showArrow) {
        const normLen = 12;
        const normEnd = {
          x: mid.x + edge.normal.x * normLen,
          y: mid.y - edge.normal.y * normLen,
        };
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(normEnd.x, normEnd.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // 2nd pass: draw ONE badge label per contiguous chain, positioned strictly OUTSIDE the domain
    const chains = getContiguousEdgeChains(boundaryEdges);

    for (const chain of chains) {
      const colorConfig = BOUNDARY_COLORS[chain.tag] || BOUNDARY_COLORS.wall;
      const mid = ws(chain.midpoint.x, chain.midpoint.y);
      const isChainHovered = chain.edges.some((e) => e.key === hoveredEdgeKey);
      const badgeText = chain.tag.toUpperCase();

      ctx.save();
      ctx.font = 'bold 9px JetBrains Mono';
      const textWidth = ctx.measureText(badgeText).width;
      const bw = textWidth + 14;
      const bh = 18;

      // Position badge strictly OUTSIDE domain with a clean 18px gap from the line
      // Project the badge box half-dimensions along the normal direction
      const boxExtentAlongNormal =
        Math.abs(chain.outwardNormal.x) * (bw / 2) + Math.abs(chain.outwardNormal.y) * (bh / 2);
      const totalOffset = boxExtentAlongNormal + 18;

      const badgeCenter = {
        x: mid.x + chain.outwardNormal.x * totalOffset,
        y: mid.y - chain.outwardNormal.y * totalOffset,
      };

      // Draw connecting leader line from edge midpoint to badge if offset is significant
      ctx.strokeStyle = colorConfig.hex;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.lineTo(badgeCenter.x, badgeCenter.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Badge pill
      ctx.fillStyle = isChainHovered ? C.handleFill : C.chipBg;
      ctx.strokeStyle = colorConfig.hex;
      ctx.lineWidth = isChainHovered ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(badgeCenter.x - bw / 2, badgeCenter.y - bh / 2, bw, bh, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = colorConfig.hex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, badgeCenter.x, badgeCenter.y);
      ctx.restore();
    }
  }
}
