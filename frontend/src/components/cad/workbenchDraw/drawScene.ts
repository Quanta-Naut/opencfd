import type { DrawScene } from './types';
import { drawGrid } from './grid';
import { drawMeshView } from './meshView';
import { drawEntities } from './entities';
import { drawTempGeometry, drawTrimPreview } from './sketchPreview';
import { drawSnapGuides, drawSnapMarker, drawCrosshair, drawMarquee } from './snapOverlays';
import { drawDomain } from './domain';
import { drawBoundaryTags } from './boundaryTags';
import { drawBlockTopology, drawBlockEditor } from './blocking';
import { drawProbeLine } from './probeLine';

export type { DrawScene, DrawFrame } from './types';

/**
 * One full pass of the workbench's 2D canvas, in paint order. The GPU canvas
 * underneath draws the mesh itself; this draws everything over it.
 */
export function drawScene(canvas: HTMLCanvasElement | null, scene: DrawScene): void {
  const { pan, zoom, glMeshActive, C, meshOnly, meshData } = scene;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  // Reassigning width/height reallocates the backing store, so only do it
  // on an actual size change; otherwise just reset the transform.
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const o = { x: cw / 2 + pan.x, y: ch / 2 + pan.y };
  const ws = (wx: number, wy: number) => ({ x: o.x + wx * zoom, y: o.y - wy * zoom });
  const SCALE = zoom;

  // Background (the GPU canvas underneath paints the mesh when active)
  if (glMeshActive) {
    ctx.clearRect(0, 0, cw, ch);
  } else {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cw, ch);
  }
  const f = { ctx, cw, ch, o, ws, SCALE };

  drawGrid(f, scene);
  if (drawMeshView(f, scene)) return;

  // Solver / Results: mesh only. If the mesh is not shown above, draw nothing
  // else (no CAD geometry, no domain handles, no blocking).
  if (meshOnly) {
    if (!meshData?.nodes?.length) {
      ctx.fillStyle = C.label;
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No mesh yet - generate one in the Mesh tab', cw / 2, ch / 2);
    }
    return;
  }

  drawEntities(f, scene);
  drawTempGeometry(f, scene);
  drawTrimPreview(f, scene);
  drawSnapGuides(f, scene);
  drawSnapMarker(f, scene);
  drawCrosshair(f, scene);
  drawMarquee(f, scene);
  drawDomain(f, scene);
  drawBoundaryTags(f, scene);
  drawBlockTopology(f, scene);
  drawBlockEditor(f, scene);
  drawProbeLine(f, scene);
}
