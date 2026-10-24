import type { CanvasPalette } from '../workbenchCore';
import { type MeshGLScene } from '../useMeshGL';
import { arrayRange } from '../../../utils/numeric';

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
  // Theme mesh lines over plain cells.
  const wire = C.meshLineRGBA;
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
}
