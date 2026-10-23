import type { CanvasPalette } from '../workbenchCore';
import { Blocking, blockPolygon } from '../../../types/blocking';
import { type MeshGLScene } from '../useMeshGL';
import { arrayRange } from '../../../utils/numeric';
import { pointInPolygon } from '../workbenchCore';
import { BLOCK_FILL_CYCLE } from '../workbenchCore';

/** Per-cell block colour for the Mesh view's direction colouring, or null when it is off. */
export function computeElementBlockColor(wb: ElementBlockColorContext): (string | null)[] | null {
  const { meshData, directionColors, blocking } = wb;
  const nodes: number[][] | undefined = meshData?.nodes;
  const elements: number[][] | undefined = meshData?.elements;
  if (!directionColors) return null;
  if (!Array.isArray(nodes) || !Array.isArray(elements) || elements.length === 0) return null;
  if (!blocking || blocking.blocks.length === 0) return null;
  const polys = blocking.blocks
    .map((blk, i) => {
      const poly = blockPolygon(blocking, blk);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const q of poly) {
        if (q.x < x0) x0 = q.x;
        if (q.x > x1) x1 = q.x;
        if (q.y < y0) y0 = q.y;
        if (q.y > y1) y1 = q.y;
      }
      return { poly, x0, x1, y0, y1, color: BLOCK_FILL_CYCLE[i % BLOCK_FILL_CYCLE.length] };
    })
    .filter((p) => p.poly.length >= 3);
  if (!polys.length) return null;
  const out: (string | null)[] = new Array(elements.length).fill(null);
  const c = { x: 0, y: 0 };
  for (let e = 0; e < elements.length; e++) {
    const el = elements[e];
    let sx = 0;
    let sy = 0;
    let ok = true;
    for (let i = 0; i < el.length; i++) {
      const nd = nodes[el[i]];
      if (!nd) {
        ok = false;
        break;
      }
      sx += nd[0];
      sy += nd[1];
    }
    if (!ok) continue;
    c.x = sx / el.length;
    c.y = sy / el.length;
    for (const p of polys) {
      if (c.x < p.x0 || c.x > p.x1 || c.y < p.y0 || c.y > p.y1) continue;
      if (pointInPolygon(c, p.poly)) {
        out[e] = p.color;
        break;
      }
    }
  }
  return out;
}

/** What computeElementBlockColor reads from the workbench component. */
export interface ElementBlockColorContext {
  meshData: any;
  directionColors: Record<string, string>;
  blocking: Blocking;
}

/** What the GPU mesh layer should draw this frame: geometry, per-cell colours and the active colouring mode. */
export function buildGlScene(wb: GlSceneContext): MeshGLScene {
  const {
    meshData,
    displayOnly,
    showMesh,
    liveHasContent,
    C,
    canvasMode,
    showField,
    fieldData,
    activeField,
    meshOnly,
    showMeshQuality,
    meshSkew,
    liveVals,
    liveRange,
    liveMeshOn,
    showMeshWireframe,
    directionColors,
    elementBlockColor,
    colormap,
  } = wb;
  const nodes: number[][] | undefined = meshData?.nodes;
  const elements: number[][] | undefined = meshData?.elements;
  const hidden: MeshGLScene = {
    visible: false,
    fill: { kind: 'solid', color: [1, 1, 1, 1] },
    wire: null,
  };
  if (
    !displayOnly ||
    !showMesh ||
    !liveHasContent ||
    canvasMode !== 'mesh' ||
    !nodes?.length ||
    !elements?.length
  ) {
    return hidden;
  }
  const vals: number[] | undefined = showField ? fieldData?.fields?.[activeField] : undefined;
  const haveField = Array.isArray(vals) && vals.length === nodes.length;
  const qualityMode = !showField && !meshOnly && showMeshQuality && !!meshSkew;
  const liveMode = !!liveVals && liveVals.length === elements.length && !qualityMode;

  if (liveMode) {
    const lo = Number(liveRange[0]);
    return {
      visible: true,
      fill: { kind: 'cell', vals: liveVals!, lo, hi: Number(liveRange[1]), colormap },
      wire: liveMeshOn ? [1, 1, 1, 0.28] : null,
    };
  }
  if (qualityMode) {
    return {
      visible: true,
      fill: { kind: 'cell', vals: meshSkew!, lo: 0, hi: 1, colormap: 'quality' },
      wire: [1, 1, 1, 0.35],
    };
  }
  if (haveField) {
    let lo = 0;
    let hi = 1;
    const r = fieldData?.ranges?.[activeField];
    if (Array.isArray(r) && r.length === 2 && r[0] !== r[1]) {
      [lo, hi] = r;
    } else {
      [lo, hi] = arrayRange(vals!);
    }
    return {
      visible: true,
      fill: { kind: 'node', vals: vals!, lo, hi, colormap },
      wire: showMeshWireframe ? [1, 1, 1, 0.3] : null,
    };
  }
  // Theme mesh lines over plain (or block-tinted) cells.
  const wire = C.meshLineRGBA;
  if (directionColors && elementBlockColor) {
    return {
      visible: true,
      fill: {
        kind: 'cellRGBA',
        colors: elementBlockColor,
        alpha: C.blockTint,
        base: C.meshFillRGBA,
      },
      wire,
    };
  }
  return { visible: true, fill: { kind: 'solid', color: C.meshFillRGBA }, wire };
}

/** What buildGlScene reads from the workbench component. */
export interface GlSceneContext {
  colormap: string;
  meshData: any;
  displayOnly: boolean;
  showMesh: boolean;
  liveHasContent: boolean;
  C: CanvasPalette;
  canvasMode: 'cad' | 'mesh';
  showField: boolean;
  fieldData: any;
  activeField: string;
  meshOnly: boolean;
  showMeshQuality: boolean;
  meshSkew: Float32Array<ArrayBufferLike>;
  liveVals: number[];
  liveRange: [number, number];
  liveMeshOn: boolean;
  showMeshWireframe: boolean;
  directionColors: Record<string, string>;
  elementBlockColor: string[];
}
