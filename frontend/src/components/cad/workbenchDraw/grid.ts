import type { DrawFrame, DrawScene } from './types';

/** Adaptive background grid (down to 0.2 mm) with the X/Y axes. */
export function drawGrid(f: DrawFrame, scene: DrawScene): void {
  const { ctx, cw, ch, o, SCALE } = f;
  const { C, showGrid, showMesh } = scene;
  // Mesh workflow views are intended for inspecting element topology; keep
  // the CAD grid out of both the CAD and mesh render modes there.
  if (showGrid && !showMesh) {
    const rawStep = 40 / Math.max(SCALE, 1e-6);
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let minorStep = mag;
    if (norm >= 5) minorStep = 5 * mag;
    else if (norm >= 2) minorStep = 2 * mag;
    else minorStep = mag;
    minorStep = Math.max(0.0002, minorStep); // Min grid step: 0.2 mm
    const majorStep = minorStep * 5;

    const drawGridLines = (step: number, color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      const screenStep = step * SCALE;
      if (screenStep < 4) return;
      const ox = ((o.x % screenStep) + screenStep) % screenStep;
      const oy = ((o.y % screenStep) + screenStep) % screenStep;
      ctx.beginPath();
      for (let x = ox; x < cw; x += screenStep) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ch);
      }
      for (let y = oy; y < ch; y += screenStep) {
        ctx.moveTo(0, y);
        ctx.lineTo(cw, y);
      }
      ctx.stroke();
    };
    drawGridLines(minorStep, C.gridMinor, 1);
    drawGridLines(majorStep, C.gridMajor, 1.2);

    // Axes: X-axis in light red, Y-axis in light green
    // X-axis (y = 0 line)
    ctx.strokeStyle = C.axisX;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, o.y);
    ctx.lineTo(cw, o.y);
    ctx.stroke();

    // Y-axis (x = 0 line)
    ctx.strokeStyle = C.axisY;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(o.x, 0);
    ctx.lineTo(o.x, ch);
    ctx.stroke();

    // Axis labels
    ctx.font = '10px JetBrains Mono';
    ctx.fillStyle = C.axisX;
    ctx.fillText('X', cw - 16, o.y - 6);
    ctx.fillStyle = C.axisY;
    ctx.fillText('Y', o.x + 6, 14);
  }
}
