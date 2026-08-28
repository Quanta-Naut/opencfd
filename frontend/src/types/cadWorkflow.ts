// ─── 3-Step CFD Pre-Processing Types & Geometry Helpers ────────────────────────

export type CadWorkflowStep = 1 | 2 | 3;

export type FlowType = 'external' | 'internal';

export type DomainShapeType = 'rectangle' | 'c_grid' | 'circle';

export type DomainPreset = 'tight' | 'standard' | 'large' | 'custom';

export const DOMAIN_PRESETS: Record<Exclude<DomainPreset, 'custom'>, { upstream: number; downstream: number; lateral: number; label: string; description: string }> = {
  tight: { upstream: 5, downstream: 10, lateral: 5, label: 'Tight', description: '5c upstream / 10c wake / 5c lateral' },
  standard: { upstream: 10, downstream: 20, lateral: 10, label: 'Standard', description: '10c upstream / 20c wake / 10c lateral (Recommended)' },
  large: { upstream: 20, downstream: 40, lateral: 20, label: 'Large', description: '20c upstream / 40c wake / 20c lateral (Farfield)' },
};

export type BoundaryTag = 'inlet' | 'outlet' | 'wall' | 'farfield' | 'symmetry' | 'periodic';


export const BOUNDARY_COLORS: Record<BoundaryTag, { hex: string; bg: string; text: string; border: string; label: string }> = {
  inlet: { hex: '#2563EB', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300', label: 'Inlet (Velocity / Pressure)' },
  outlet: { hex: '#DC2626', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', label: 'Outlet (0 Pa Gauge)' },
  wall: { hex: '#D97706', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', label: 'No-Slip Wall' },
  farfield: { hex: '#0891B2', bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-300', label: 'Farfield (Freestream)' },
  symmetry: { hex: '#9333EA', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-300', label: 'Symmetry Plane' },
  periodic: { hex: '#16A34A', bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-300', label: 'Periodic / Cyclic' },
};

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundaryEdge {
  key: string; // `${entityId}_${edgeIndex}`
  entityId: string;
  edgeIndex: number;
  p0: Point2D;
  p1: Point2D;
  tag: BoundaryTag;
  /** true only if the user explicitly tagged this edge. Untagged edges are NOT
   *  "wall" - they carry `tag` only as a rendering fallback and must not be
   *  drawn coloured or counted as a patch. */
  explicit: boolean;
  role: 'domain' | 'geometry';
  normal: Point2D; // outward unit normal
  midpoint: Point2D;
  length: number;
}

export interface CadEntity {
  id: string;
  type: 'line' | 'polyline' | 'circle' | 'arc' | 'rectangle' | 'spline' | 'construction';
  layer: string;
  pts: Point2D[];
  selected?: boolean;
  isClosed?: boolean;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  role?: 'geometry' | 'domain_boundary';
  /** true only for a far-field loop built by "Generate domain" - it stays in
   *  sync with the clearance sliders. A hand-drawn loop pinned as the domain
   *  must NOT have this, or it gets regenerated and the user's geometry is lost. */
  autoDomain?: boolean;
}

export interface GeometryBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  chord: number;
  height: number;
  centerX: number;
  centerY: number;
}

export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function getGeometryBBox(entities: CadEntity[]): GeometryBBox {
  const geomEntities = entities.filter(e => e.layer !== 'construction' && e.role !== 'domain_boundary');
  if (geomEntities.length === 0) {
    return { minX: 0, maxX: 1, minY: -0.1, maxY: 0.1, chord: 1.0, height: 0.2, centerX: 0.5, centerY: 0 };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of geomEntities) {
    for (const p of e.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const chord = Math.max(0.01, maxX - minX);
  const height = Math.max(0.01, maxY - minY);
  return {
    minX,
    maxX,
    minY,
    maxY,
    chord,
    height,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

export function isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function validateDomainContainment(
  domain: CadEntity | null,
  entities: CadEntity[]
): { valid: boolean; reason?: string } {
  if (!domain || domain.pts.length < 3) {
    return { valid: false, reason: 'No valid outer domain boundary defined yet.' };
  }
  const obstacles = entities.filter(
    e => e.layer !== 'construction' && e.id !== domain.id && e.role !== 'domain_boundary'
  );
  if (obstacles.length === 0) {
    return { valid: true };
  }
  for (const obs of obstacles) {
    for (const pt of obs.pts) {
      if (!isPointInPolygon(pt, domain.pts)) {
        return { valid: false, reason: `Geometry vertex (${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}) is outside fluid domain.` };
      }
    }
  }
  return { valid: true };
}

export function createDomainEntity(
  shape: DomainShapeType,
  bbox: GeometryBBox,
  upstreamFactor: number,
  downstreamFactor: number,
  lateralFactor: number,
  existingId?: string
): CadEntity {
  const c = bbox.chord;
  const h = bbox.height;
  const lUp = Math.max(1, upstreamFactor) * c;
  const lDown = Math.max(1, downstreamFactor) * c;
  const lLat = Math.max(1, lateralFactor) * Math.max(c * 0.5, h);

  const entityId = existingId || ('domain_' + Math.random().toString(36).substring(2, 9));

  if (shape === 'rectangle') {
    const x0 = bbox.minX - lUp;
    const x1 = bbox.maxX + lDown;
    const y0 = bbox.centerY - lLat;
    const y1 = bbox.centerY + lLat;
    return {
      id: entityId,
      type: 'rectangle',
      layer: 'default',
      role: 'domain_boundary',
      autoDomain: true,
      isClosed: true,
      pts: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    };
  }

  if (shape === 'circle') {
    const r = Math.max(lUp, lDown, lLat);
    const numPts = 48;
    const pts: Point2D[] = [];
    for (let i = 0; i < numPts; i++) {
      const ang = (i / numPts) * Math.PI * 2;
      pts.push({
        x: bbox.centerX + r * Math.cos(ang),
        y: bbox.centerY + r * Math.sin(ang),
      });
    }
    return {
      id: entityId,
      type: 'polyline',
      layer: 'default',
      role: 'domain_boundary',
      autoDomain: true,
      isClosed: true,
      pts,
    };
  }

  // C-Grid Domain: Upstream semicircle + Downstream rectangular wake
  const r = lUp;
  const xWake = bbox.maxX + lDown;
  const yTop = bbox.centerY + r;
  const yBottom = bbox.centerY - r;
  const pts: Point2D[] = [];

  // Top wake edge from right to left
  pts.push({ x: xWake, y: yTop });
  pts.push({ x: bbox.minX, y: yTop });

  // Semicircle arc upstream from +90 deg to -90 deg
  const arcPts = 24;
  for (let i = 0; i <= arcPts; i++) {
    const ang = Math.PI / 2 + (i / arcPts) * Math.PI;
    pts.push({
      x: bbox.minX + r * Math.cos(ang),
      y: bbox.centerY + r * Math.sin(ang),
    });
  }

  // Bottom wake edge from left to right
  pts.push({ x: bbox.minX, y: yBottom });
  pts.push({ x: xWake, y: yBottom });

  return {
    id: entityId,
    type: 'polyline',
    layer: 'default',
    role: 'domain_boundary',
    autoDomain: true,
    isClosed: true,
    pts,
  };
}

/**
 * True if the drawn geometry forms at least one closed loop - a closed polyline
 * or rectangle, OR loose segments whose every endpoint is shared by >= 2 edges.
 * Used so the flow domain can be auto-detected instead of manually pinned.
 */
export function geometryFormsLoop(entities: CadEntity[]): boolean {
  const geom = entities.filter(e => e.layer !== 'construction');
  if (geom.some(e => (e.isClosed || e.type === 'rectangle') && e.pts.length >= 3)) return true;
  const segs = geom.filter(e => e.pts.length === 2);
  if (segs.length < 3) return false;
  const key = (p: Point2D) => `${Math.round(p.x * 1e4)}_${Math.round(p.y * 1e4)}`;
  const deg = new Map<string, number>();
  for (const s of segs) for (const p of [s.pts[0], s.pts[1]]) deg.set(key(p), (deg.get(key(p)) ?? 0) + 1);
  return [...deg.values()].every(d => d >= 2);
}

export function extractBoundaryEdges(
  entities: CadEntity[],
  flowType: FlowType,
  edgeTagMap: Record<string, BoundaryTag>
): BoundaryEdge[] {
  const edges: BoundaryEdge[] = [];
  const targetEntities = entities.filter(e => e.layer !== 'construction' && e.pts.length >= 2);

  for (const ent of targetEntities) {
    const pts = ent.pts;
    const n = pts.length;
    if (n < 2) continue;

    const count = ent.isClosed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      const key = `${ent.id}_${i}`;
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;

      // Unit outward normal
      const nx = dy / len;
      const ny = -dx / len;

      const fallbackTag: BoundaryTag =
        ent.role === 'domain_boundary' ? 'farfield' : 'wall';
      const explicit = Object.prototype.hasOwnProperty.call(edgeTagMap, key);

      edges.push({
        key,
        entityId: ent.id,
        edgeIndex: i,
        p0,
        p1,
        tag: edgeTagMap[key] || fallbackTag,
        explicit,
        role: ent.role === 'domain_boundary' ? 'domain' : 'geometry',
        normal: { x: nx, y: ny },
        midpoint: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
        length: len,
      });
    }
  }

  return edges;
}

export interface ContiguousEdgeChain {
  id: string;
  tag: BoundaryTag;
  role: 'domain' | 'geometry';
  edges: BoundaryEdge[];
  midpoint: Point2D;
  outwardNormal: Point2D;
}

export function getContiguousEdgeChains(allEdges: BoundaryEdge[]): ContiguousEdgeChain[] {
  // Only explicitly-tagged edges get a chain / badge.
  const edges = allEdges.filter(e => e.explicit);
  if (edges.length === 0) return [];

  const visited = new Set<string>();
  const chains: ContiguousEdgeChain[] = [];

  for (let i = 0; i < edges.length; i++) {
    const startEdge = edges[i];
    if (visited.has(startEdge.key)) continue;

    const chainEdges: BoundaryEdge[] = [];
    const queue: BoundaryEdge[] = [startEdge];
    visited.add(startEdge.key);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      chainEdges.push(curr);

      // Find adjacent unvisited edges sharing the exact same tag and role
      for (const candidate of edges) {
        if (visited.has(candidate.key)) continue;
        if (candidate.tag !== curr.tag || candidate.role !== curr.role) continue;

        // Check if endpoints touch (within tolerance)
        const tol = 1e-3;
        const d00 = Math.hypot(candidate.p0.x - curr.p0.x, candidate.p0.y - curr.p0.y);
        const d01 = Math.hypot(candidate.p0.x - curr.p1.x, candidate.p0.y - curr.p1.y);
        const d10 = Math.hypot(candidate.p1.x - curr.p0.x, candidate.p1.y - curr.p0.y);
        const d11 = Math.hypot(candidate.p1.x - curr.p1.x, candidate.p1.y - curr.p1.y);

        if (d00 < tol || d01 < tol || d10 < tol || d11 < tol) {
          visited.add(candidate.key);
          queue.push(candidate);
        }
      }
    }

    // Compute chain length-weighted midpoint and outward normal
    let totalLen = 0;
    let midX = 0;
    let midY = 0;
    let normX = 0;
    let normY = 0;

    for (const e of chainEdges) {
      const len = e.length;
      totalLen += len;
      midX += e.midpoint.x * len;
      midY += e.midpoint.y * len;
      normX += e.normal.x * len;
      normY += e.normal.y * len;
    }

    if (totalLen > 0) {
      midX /= totalLen;
      midY /= totalLen;
      const nLen = Math.hypot(normX, normY);
      if (nLen > 1e-4) {
        normX /= nLen;
        normY /= nLen;
      } else {
        // If normals cancel (e.g. full closed loop obstacle like an airfoil),
        // use upward normal
        normX = 0;
        normY = 1;
      }
    }

    chains.push({
      id: `chain_${startEdge.key}`,
      tag: startEdge.tag,
      role: startEdge.role,
      edges: chainEdges,
      midpoint: { x: midX, y: midY },
      outwardNormal: { x: normX, y: normY },
    });
  }

  return chains;
}

export function autoSuggestBoundaryTags(
  edges: BoundaryEdge[],
  aoaDeg: number,
  flowType: FlowType
): Record<string, BoundaryTag> {
  const rad = (aoaDeg * Math.PI) / 180;
  const flowDir = { x: Math.cos(rad), y: Math.sin(rad) };
  const result: Record<string, BoundaryTag> = {};

  for (const edge of edges) {
    if (edge.role === 'geometry' && flowType === 'external') {
      result[edge.key] = 'wall';
      continue;
    }
    // Dot product with outward normal
    const dot = edge.normal.x * flowDir.x + edge.normal.y * flowDir.y;

    if (dot < -0.35) {
      result[edge.key] = 'inlet';
    } else if (dot > 0.35) {
      result[edge.key] = 'outlet';
    } else {
      result[edge.key] = flowType === 'external' ? 'symmetry' : 'wall';
    }
  }

  return result;
}

export function validateBoundaryTags(
  edges: BoundaryEdge[],
  flowType: FlowType
): { valid: boolean; reason?: string; counts: Record<BoundaryTag, number> } {
  const counts: Record<BoundaryTag, number> = {
    inlet: 0,
    outlet: 0,
    wall: 0,
    farfield: 0,
    symmetry: 0,
    periodic: 0,
  };

  // Only edges the user explicitly tagged count - an untagged edge is not a wall.
  for (const e of edges) {
    if (!e.explicit) continue;
    counts[e.tag] = (counts[e.tag] || 0) + 1;
  }

  if (edges.length === 0) {
    return { valid: false, reason: 'No boundary edges defined.', counts };
  }

  if (counts.inlet === 0) {
    return { valid: false, reason: 'Tag at least one Inlet edge.', counts };
  }

  if (counts.outlet === 0) {
    return { valid: false, reason: 'Tag at least one Outlet edge.', counts };
  }

  return { valid: true, counts };
}

export function generateDefaultAirfoilPoints(numPts = 60): Point2D[] {
  const t = 0.12;
  const ptsUpper: Point2D[] = [];
  const ptsLower: Point2D[] = [];
  const n = Math.floor(numPts / 2);
  for (let i = 0; i <= n; i++) {
    const beta = (i / n) * Math.PI;
    const x = 0.5 * (1 - Math.cos(beta));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * Math.pow(x, 2) + 0.2843 * Math.pow(x, 3) - 0.1036 * Math.pow(x, 4));
    if (i === 0) {
      ptsUpper.push({ x: 0, y: 0 });
    } else {
      ptsUpper.unshift({ x: parseFloat(x.toFixed(5)), y: parseFloat(yt.toFixed(5)) });
      ptsLower.push({ x: parseFloat(x.toFixed(5)), y: parseFloat((-yt).toFixed(5)) });
    }
  }
  return [...ptsUpper, ...ptsLower];
}
