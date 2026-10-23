import type { BoundaryEdge } from '../types/cadWorkflow';
import React from 'react';
import { CFDProjectState } from '../types/cfd';
import {
  FlowType,
  BoundaryTag,
  CadEntity,
  getGeometryBBox,
  extractBoundaryEdges,
} from '../types/cadWorkflow';

/** Give a redrawn edge back the tag that used to sit near it (see tagMemoryRef). */
export function restoreRememberedTags(wb: RestoreTagsContext) {
  const { cadEntities, flowType, edgeTagMap, tagMemoryRef, setEdgeTagMap } = wb;
  const edges = extractBoundaryEdges(cadEntities, flowType, edgeTagMap);
  const bbox = getGeometryBBox(cadEntities);
  const tol = Math.max(bbox.chord, bbox.height, 1) * 0.04;

  // Record where each currently-explicit tag lives.
  for (const e of edges) {
    if (e.explicit) {
      tagMemoryRef.current.set(e.key, { mx: e.midpoint.x, my: e.midpoint.y, tag: e.tag });
    }
  }

  // Re-associate untagged edges to a remembered tag position.
  const remap: Record<string, BoundaryTag> = {};
  for (const e of edges) {
    if (e.explicit) continue;
    let best: { d: number; tag: BoundaryTag } | null = null;
    for (const p of tagMemoryRef.current.values()) {
      const d = Math.hypot(p.mx - e.midpoint.x, p.my - e.midpoint.y);
      if (d < tol && (!best || d < best.d)) best = { d, tag: p.tag };
    }
    if (best) remap[e.key] = best.tag;
  }

  if (Object.keys(remap).length) {
    setEdgeTagMap((prev) => ({ ...prev, ...remap }));
    for (const [k, tag] of Object.entries(remap)) {
      const e = edges.find((x) => x.key === k)!;
      tagMemoryRef.current.set(k, { mx: e.midpoint.x, my: e.midpoint.y, tag });
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}

/** What restoreRememberedTags reads from the workbench component. */
export interface RestoreTagsContext {
  cadEntities: CadEntity[];
  flowType: FlowType;
  edgeTagMap: Record<string, BoundaryTag>;
  tagMemoryRef: React.RefObject<Map<string, { mx: number; my: number; tag: BoundaryTag }>>;
  setEdgeTagMap: React.Dispatch<React.SetStateAction<Record<string, BoundaryTag>>>;
}

/** The patches the solver will see and the role of each, including untagged domain edges the backend auto-classifies. */
export function computePatchRoles(wb: PatchRolesContext) {
  const { state, flowType, meshData, boundaryEdges } = wb;
  const order: BoundaryTag[] = [
    'inlet',
    'outlet',
    'wall',
    'farfield',
    'symmetry',
    'periodic',
    'axis',
  ];
  const roleFromName = (n: string): BoundaryTag => {
    const k = n.toLowerCase();
    return (order.find((t) => k === t || k.startsWith(t)) as BoundaryTag) || 'wall';
  };
  // Supersonic external flow: a `symmetry` plane mirrors the shock straight
  // back into the domain, so treat any lateral symmetry patch as a
  // non-reflecting far-field instead (unless the flow is genuinely a half-model
  // on the centreline, which the box domains never are).
  const ss =
    state.physics.compressibility === 'compressible' &&
    (state.physics.speedRegime === 'supersonic' || state.physics.speedRegime === 'hypersonic') &&
    flowType === 'external';
  const fix = (r: BoundaryTag): BoundaryTag => (ss && r === 'symmetry' ? 'farfield' : r);

  const meshNames = Object.keys(meshData?.boundaries || {}).filter(
    (n) => n !== 'frontAndBack' && n !== 'defaultFaces',
  );
  if (meshNames.length) {
    const explicit = new Map<string, BoundaryTag>();
    for (const e of boundaryEdges) if (e.explicit) explicit.set(e.tag, e.tag);
    return meshNames
      .map((name) => ({
        name,
        role: fix(explicit.get(name as BoundaryTag) || roleFromName(name)) as any,
      }))
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  }
  const seen = new Map<BoundaryTag, BoundaryTag>();
  for (const e of boundaryEdges) if (e.explicit) seen.set(e.tag, e.tag);
  return [...seen.keys()]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((t) => ({ name: t, role: fix(t) as any }));
}

/** What computePatchRoles reads from the workbench component. */
export interface PatchRolesContext {
  state: CFDProjectState;
  flowType: FlowType;
  meshData: any;
  boundaryEdges: BoundaryEdge[];
}
