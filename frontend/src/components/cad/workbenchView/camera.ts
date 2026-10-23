import React from 'react';
import { CadEntity } from '../../../types/cadWorkflow';

/** Frame geometry already in the session once, when a project opens, instead of centring on (0, 0). */
export function autoCenterInitialGeometry(wb: AutoCenterContext) {
  const {
    hasAutoCenteredInitialRef,
    userInteractedRef,
    canvasRef,
    containerRef,
    viewport,
    cadState,
    initialEntities,
    fitBoundingBox,
  } = wb;
  if (hasAutoCenteredInitialRef.current || userInteractedRef.current) return;

  const canvas = canvasRef.current;
  const cw =
    (canvas && canvas.clientWidth > 0 ? canvas.clientWidth : 0) ||
    (containerRef.current && containerRef.current.clientWidth > 0
      ? containerRef.current.clientWidth
      : 0) ||
    viewport.w ||
    0;
  const ch =
    (canvas && canvas.clientHeight > 0 ? canvas.clientHeight : 0) ||
    (containerRef.current && containerRef.current.clientHeight > 0
      ? containerRef.current.clientHeight
      : 0) ||
    viewport.h ||
    0;

  // Wait until layout has completed and canvas has non-trivial dimensions
  if (cw < 50 || ch < 50) return;

  const entities =
    cadState.entities.length > 0
      ? cadState.entities
      : initialEntities && initialEntities.length > 0
        ? initialEntities
        : [];

  const geomEnts = entities.filter((e) => e.layer !== 'construction' && e.pts && e.pts.length > 0);
  if (geomEnts.length === 0) return;

  // We prefer framing actual geometry entities (e.g. airfoil, obstacle, body) if present,
  // falling back to whatever non-construction geometry is loaded (which may include domain).
  const actualGeom = geomEnts.filter((e) => e.role !== 'domain_boundary');
  const targetEnts = actualGeom.length > 0 ? actualGeom : geomEnts;

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const ent of targetEnts) {
    if (ent.type === 'circle' && typeof ent.radius === 'number' && ent.pts[0]) {
      const c = ent.pts[0];
      const r = ent.radius;
      minX = Math.min(minX, c.x - r);
      maxX = Math.max(maxX, c.x + r);
      minY = Math.min(minY, c.y - r);
      maxY = Math.max(maxY, c.y + r);
    } else if (
      ent.type === 'ellipse' &&
      typeof ent.rx === 'number' &&
      typeof ent.ry === 'number' &&
      ent.pts[0]
    ) {
      const c = ent.pts[0];
      const rx = ent.rx;
      const ry = ent.ry;
      const rot = ent.rotation || 0;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const hw = Math.sqrt((rx * cosR) ** 2 + (ry * sinR) ** 2);
      const hh = Math.sqrt((rx * sinR) ** 2 + (ry * cosR) ** 2);
      minX = Math.min(minX, c.x - hw);
      maxX = Math.max(maxX, c.x + hw);
      minY = Math.min(minY, c.y - hh);
      maxY = Math.max(maxY, c.y + hh);
    } else {
      for (const p of ent.pts) {
        if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
        if (!isFinite(p.x) || !isFinite(p.y)) continue;
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  }

  if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
    return;
  }

  if (maxX === minX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (maxY === minY) {
    minY -= 0.5;
    maxY += 0.5;
  }

  const applied = fitBoundingBox({ minX, maxX, minY, maxY }, 0.72);
  if (applied) {
    hasAutoCenteredInitialRef.current = true;
  }
}

/** What autoCenterInitialGeometry reads from the workbench component. */
export interface AutoCenterContext {
  hasAutoCenteredInitialRef: React.RefObject<boolean>;
  userInteractedRef: React.RefObject<boolean>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  containerRef: React.RefObject<HTMLDivElement>;
  viewport: { w: number; h: number };
  cadState: { entities: CadEntity[] };
  initialEntities: CadEntity[];
  fitBoundingBox: (
    box: { minX: number; maxX: number; minY: number; maxY: number },
    marginRatio?: number,
  ) => boolean;
}
