import type { DrawFrame, DrawScene } from './types';

/** Results stage: the plot probe line and its pick preview. */
export function drawProbeLine(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const { activePlotLine, C, plotPickPreviewP1 } = scene;
  if (activePlotLine || plotPickPreviewP1) {
    ctx.save();
    const p1 = activePlotLine ? activePlotLine.p1 : plotPickPreviewP1!;
    const p2 = activePlotLine ? activePlotLine.p2 : null;

    const s1 = ws(p1[0], p1[1]);

    if (p2) {
      const s2 = ws(p2[0], p2[1]);
      // Draw probe line
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Point 2 marker
      ctx.fillStyle = '#16A34A';
      ctx.beginPath();
      ctx.arc(s2.x, s2.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = C.halo;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = '#16A34A';
      ctx.fillText('P2', s2.x + 8, s2.y - 4);
    }

    // Point 1 marker
    ctx.fillStyle = C.accent;
    ctx.beginPath();
    ctx.arc(s1.x, s1.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.halo;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.fillStyle = C.accent;
    ctx.fillText('P1', s1.x + 8, s1.y - 4);

    if (activePlotLine?.label) {
      const midX = p2 ? (s1.x + ws(p2[0], p2[1]).x) / 2 : s1.x;
      const midY = p2 ? (s1.y + ws(p2[0], p2[1]).y) / 2 : s1.y;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillStyle = C.ink;
      ctx.fillText(activePlotLine.label, midX + 8, midY - 8);
    }
    ctx.restore();
  }
}
