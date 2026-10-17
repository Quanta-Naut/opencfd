import { Point2D, BoundaryTag } from '../cadWorkflow';

export type EdgeLaw = 'uniform' | 'geometric' | 'bump';

export interface BlockVertex {
  id: string;
  pt: Point2D;
  /** ICEM-style association: CadEntity ids this vertex is constrained to (it
   *  slides along them when dragged). Undefined = free vertex. */
  curves?: string[];
}

export interface BlockEdge {
  id: string;
  v0: string;
  v1: string;
  /** Interior points the edge passes through (follows the geometry outline). */
  path: Point2D[];
  /** Patch name inherited from the geometry edges this block edge lies on. */
  patch?: BoundaryTag;
  nodes: number;
  law: EdgeLaw;
  /** Growth ratio: last cell / first cell along the edge. 1 = uniform. */
  ratio: number;
  /** CadEntity.id whose closed outline this edge follows. Undefined = straight or unassociated. */
  curveId?: string;
  /** ICEM-style explicit association: CadEntity ids (joined end to end) this
   *  edge is projected onto. Takes precedence over `curveId`. */
  curves?: string[];
}

export interface Block {
  id: string;
  /** Exactly four edge ids, ordered around the block (0-1-2-3, 3 closes to 0). */
  edges: [string, string, string, string];
}

export interface Blocking {
  vertices: BlockVertex[];
  edges: BlockEdge[];
  blocks: Block[];
  /** Edge-id groups forced to share a node count (O-grid rings, C-grid cuts). */
  links?: string[][];
}

export const emptyBlocking = (): Blocking => ({ vertices: [], edges: [], blocks: [], links: [] });

/** Flat per-edge payload the backend meshes. Blocks reference indices into it. */
export interface StructuredMeshRequest {
  edges: {
    p0: [number, number];
    p1: [number, number];
    path: [number, number][];
    nodes: number;
    law: EdgeLaw;
    ratio: number;
    patch?: string;
  }[];
  blocks: [number, number, number, number][];
}
