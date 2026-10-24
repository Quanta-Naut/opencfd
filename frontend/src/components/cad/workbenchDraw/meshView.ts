import { arrayRange } from '../../../utils/numeric';
import { colormapRGB } from '../workbenchCore';
import type { DrawFrame, DrawScene } from './types';

/** The Mesh stage view: the generated mesh on the CAD camera. Returns true when it drew, in which case nothing else is drawn this frame. */
export function drawMeshView(f: DrawFrame, scene: DrawScene): boolean {
  const { ctx, ws } = f;
  const {
    activeField,
    blocking,
    C,
    colormap,
    directionColors,
    displayOnly,
    elementBlockColor,
    fieldData,
    glMeshActive,
    liveHasContent,
    liveMeshOn,
    liveRange,
    liveVals,
    meshBoundaryEdges,
    meshData,
    meshOnly,
    meshSkew,
    pan,
    showField,
    showMesh,
    meshLayer,
    showMeshQuality,
    showMeshWireframe,
    showResultsStreamlines,
    tool,
    zoom,
  } = scene;
  // Mesh mode reuses this CAD canvas, including its camera, pan and zoom.
  // Only the backend mesh is drawn; fields and streamlines are intentionally absent.
  if (
    displayOnly &&
    showMesh &&
    liveHasContent &&
    meshLayer &&
    meshData?.nodes?.length &&
    meshData?.elements?.length
  ) {
    const nodes = meshData.nodes;
    const elements = meshData.elements;

    // Field overlay (Results): colour each element by the mean of its nodes'
    // scalar values, normalised to the field range.
    const vals: number[] | undefined = showField ? fieldData?.fields?.[activeField] : undefined;
    const haveField = Array.isArray(vals) && vals.length === nodes.length;
    let lo = 0;
    let hi = 1;
    if (haveField) {
      const r = fieldData?.ranges?.[activeField];
      if (Array.isArray(r) && r.length === 2 && r[0] !== r[1]) {
        [lo, hi] = r;
      } else {
        [lo, hi] = arrayRange(vals as number[]);
      }
    }

    // In Results mode (showField is true), only stroke internal mesh cell edges if showMeshWireframe is enabled.
    const shouldDrawWireframe = !showField || showMeshWireframe;
    // Mesh-quality colouring is a Mesh-stage tool only - never on the solver
    // or results canvas (meshOnly), where the plain mesh / live field belongs.
    const qualityMode = !showField && !meshOnly && showMeshQuality && !!meshSkew;
    const liveMode = !!liveVals && liveVals.length === elements.length && !qualityMode;
    const liveLo = Number(liveRange[0]);
    const liveSpan = Number(liveRange[1]) - liveLo || 1;
    ctx.strokeStyle = haveField ? 'rgba(255,255,255,0.18)' : C.meshLine;
    ctx.lineWidth = haveField ? 0.45 : 0.65;

    // When the GPU canvas is drawing the mesh, skip the per-element loop.
    if (!glMeshActive) {
      elements.forEach((element: number[], elIdx: number) => {
        if (element.length < 3) return;
        if (element.some((ni: number) => !nodes[ni])) return; // guard: out-of-range node refs
        const points = element.map((nodeIndex: number) =>
          ws(nodes[nodeIndex][0], nodes[nodeIndex][1]),
        );

        if (liveMode) {
          // flat per-cell fill; mesh wireframe stroke is independently toggled
          const t = (liveVals![elIdx] - liveLo) / liveSpan;
          ctx.fillStyle = colormapRGB(t, colormap);
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let index = 1; index < points.length; index += 1) {
            ctx.lineTo(points[index].x, points[index].y);
          }
          ctx.closePath();
          ctx.fill();
          if (liveMeshOn) {
            ctx.strokeStyle = 'rgba(255,255,255,0.28)';
            ctx.lineWidth = 0.35;
            ctx.stroke();
          }
        } else if (qualityMode) {
          const sk = meshSkew![elIdx] ?? 0;
          ctx.fillStyle = colormapRGB(sk, 'quality');
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let index = 1; index < points.length; index += 1) {
            ctx.lineTo(points[index].x, points[index].y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (haveField) {
          let s = 0;
          for (const ni of element) s += (vals as number[])[ni] ?? 0;
          const t = (s / element.length - lo) / (hi - lo);
          const col = colormapRGB(t, colormap);
          ctx.fillStyle = col;
          ctx.strokeStyle = shouldDrawWireframe ? 'rgba(255,255,255,0.30)' : col;
          ctx.lineWidth = shouldDrawWireframe ? 0.5 : 0.6;
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let index = 1; index < points.length; index += 1) {
            ctx.lineTo(points[index].x, points[index].y);
          }
          ctx.closePath();
          ctx.fill();
          if (shouldDrawWireframe) ctx.stroke();
        } else {
          const blockCol = directionColors ? elementBlockColor?.[elIdx] : null;
          ctx.fillStyle = blockCol ? blockCol + '26' : C.meshFill;
          ctx.strokeStyle = C.meshLine;
          ctx.lineWidth = 0.65;
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let index = 1; index < points.length; index += 1) {
            ctx.lineTo(points[index].x, points[index].y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      });
    }

    // Exterior edges explicitly show both the airfoil hole and domain edge.
    ctx.strokeStyle = C.boundary;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (let i = 0; i < meshBoundaryEdges.length; i += 2) {
      const a = meshBoundaryEdges[i];
      const b = meshBoundaryEdges[i + 1];
      if (!nodes[a] || !nodes[b]) continue; // guard: out-of-range node refs
      const p0 = ws(nodes[a][0], nodes[a][1]);
      const p1 = ws(nodes[b][0], nodes[b][1]);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();

    // Streamlines overlay (Results) - only when showResultsStreamlines is toggled on
    if (
      showField &&
      showResultsStreamlines &&
      Array.isArray(fieldData?.streamlines) &&
      fieldData.streamlines.length > 0
    ) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([]);
      for (const line of fieldData.streamlines) {
        if (!Array.isArray(line) || line.length < 2) continue;
        ctx.beginPath();
        const p0 = ws(line[0][0], line[0][1]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < line.length; i++) {
          const pi = ws(line[i][0], line[i][1]);
          ctx.lineTo(pi.x, pi.y);
        }
        ctx.stroke();
      }
    }

    // Direction-group overlay: while the mesh-sizing step is open, trace
    // the block edges in the same colors as the Direction A/B/C cards over
    // the generated mesh (the per-cell block fill itself is painted in the
    // main element loop above, directly on the real cells, not here).
    if (directionColors && blocking && blocking.edges.length > 0) {
      for (const edge of blocking.edges) {
        // Boundary (patched) edges are already traced by the exterior-edge
        // pass above, following the mesh's own node-by-node polyline. This
        // overlay's edge.path is the coarser blocking representation of the
        // same curve - stroking both independently at a kink in the wall
        // left two not-quite-aligned lines fighting each other there. Only
        // the interior (unpatched) block seams have no other outline, so
        // only those need drawing here.
        if (edge.patch) continue;
        const v0 = blocking.vertices.find((v) => v.id === edge.v0);
        const v1 = blocking.vertices.find((v) => v.id === edge.v1);
        const col = directionColors[edge.id];
        if (!v0 || !v1 || !col) continue;
        const chain = [v0.pt, ...edge.path, v1.pt];
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        chain.forEach((p, i) => {
          const s = ws(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
    }

    return true;
  }
  return false;
}
