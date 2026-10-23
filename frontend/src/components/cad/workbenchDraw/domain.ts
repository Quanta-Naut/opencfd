import { Point2D } from '../../../types/cadWorkflow';
import type { DrawFrame, DrawScene } from './types';

/** Domain step: outer-domain dimensions and the interactive resize / AoA handles. */
export function drawDomain(f: DrawFrame, scene: DrawScene): void {
  const { ctx, ws } = f;
  const {
    C,
    currentStep,
    domainAnimScale,
    domainEntity,
    domainShape,
    downstreamChordFactor,
    draggingDomainHandle,
    flowType,
    geometryBBox,
    hoveredDomainHandle,
    lateralHeightFactor,
    upstreamChordFactor,
  } = scene;
  if (flowType === 'external') {
    const c = geometryBBox.chord;
    const h = geometryBBox.height;
    const effH = Math.max(0.5 * c, h);
    const lUp = upstreamChordFactor * c * domainAnimScale;
    const lDown = downstreamChordFactor * c * domainAnimScale;
    const lLat = lateralHeightFactor * effH * domainAnimScale;

    const domainLeftX = geometryBBox.minX - lUp;
    const domainRightX = geometryBBox.maxX + lDown;
    const domainTopY = geometryBBox.centerY + lLat;
    const domainBottomY = geometryBBox.centerY - lLat;

    // Interactive Handles in Step 2 - only for an auto-generated far-field domain
    // (a hand-drawn domain loop has no clearance sliders to resize).
    if (currentStep === 2 && domainEntity?.autoDomain) {
      const drawHandle = (
        pt: Point2D,
        key: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial',
        tooltip: string,
      ) => {
        const s = ws(pt.x, pt.y);
        const isHov = hoveredDomainHandle === key;
        const isDrag = draggingDomainHandle === key;

        ctx.save();
        if (isHov || isDrag) {
          ctx.fillStyle = C.accentA(0.22);
          ctx.beginPath();
          ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = isDrag ? C.accentStrong : C.accent;
        ctx.strokeStyle = C.halo;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, isHov || isDrag ? 6.5 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (isHov || isDrag) {
          ctx.font = 'bold 9px Inter, sans-serif';
          const tw = ctx.measureText(tooltip).width;
          ctx.fillStyle = C.tipBg;
          ctx.fillRect(s.x - tw / 2 - 4, s.y - 20, tw + 8, 14);
          ctx.fillStyle = C.tipText;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(tooltip, s.x, s.y - 13);
        }
        ctx.restore();
      };

      if (domainShape === 'circle') {
        drawHandle(
          { x: geometryBBox.centerX + Math.max(lUp, lDown, lLat), y: geometryBBox.centerY },
          'radial',
          `Radius: ${upstreamChordFactor}c`,
        );
      } else {
        drawHandle(
          { x: domainLeftX, y: geometryBBox.centerY },
          'upstream',
          `← ${upstreamChordFactor.toFixed(1)}c`,
        );
        drawHandle(
          { x: domainRightX, y: geometryBBox.centerY },
          'downstream',
          `→ ${downstreamChordFactor.toFixed(1)}c`,
        );
        drawHandle(
          { x: geometryBBox.centerX, y: domainTopY },
          'top',
          `↑ ${lateralHeightFactor.toFixed(1)}c`,
        );
        drawHandle(
          { x: geometryBBox.centerX, y: domainBottomY },
          'bottom',
          `↓ ${lateralHeightFactor.toFixed(1)}c`,
        );
      }
    }
  }
}
