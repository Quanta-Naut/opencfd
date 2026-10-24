import { Point2D, BoundaryTag } from '../cadWorkflow';

/** Node distribution along an edge. 'bigeometric' is ICEM's default: cells
 *  start at `spacing1` / `spacing2` and grow by `ratio1` / `ratio2` toward
 *  the middle, capped at `maxSpace`. 'tanh' is the two-sided hyperbolic
 *  tangent law (Vinokur) driven by the same spacings, Pointwise's default. */
export type EdgeLaw = 'uniform' | 'geometric' | 'bump' | 'tanh' | 'bigeometric';

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
  /** 'tanh' / 'bigeometric': first cell length at the v0 end (ICEM
   *  "Spacing 1"), in model units. Undefined leaves that end free. */
  spacing1?: number;
  /** First cell length at the v1 end (ICEM "Spacing 2"). */
  spacing2?: number;
  /** 'bigeometric': growth from cell to cell away from the v0 end (ICEM
   *  "Ratio 1"). Undefined = 1.2. */
  ratio1?: number;
  /** 'bigeometric': growth away from the v1 end (ICEM "Ratio 2"). */
  ratio2?: number;
  /** 'bigeometric': largest cell allowed (ICEM "Max space"). */
  maxSpace?: number;
  /** Curvature refinement: nodes gather where the edge turns. 0 or
   *  undefined = off; 1 sends about half the nodes to where it bends. */
  curvature?: number;
  /** CadEntity.id whose closed outline this edge follows. Undefined = straight or unassociated. */
  curveId?: string;
  /** ICEM-style explicit association: CadEntity ids (joined end to end) this
   *  edge is projected onto. Takes precedence over `curveId`. */
  curves?: string[];
  /** Id of a wall edge across the block whose node distribution this edge
   *  mirrors by projection along the wall normals (ICEM copy-by-projection),
   *  so grid lines leave a curved wall square to it. Overrides `law`. */
  match?: string;
  /** ICEM "Split Edge" spline points of an edge off the geometry, in the
   *  edge's own frame; `path` is the spline through them (see shape.ts). */
  shape?: ShapePoint[];
  /** ICEM "Link Edge Shape": this edge bends like `edge`, scaled by `factor`. */
  link?: { edge: string; factor: number };
}

/** A point in an edge's frame: `s` along the chord from v0 (0..1), `n` to
 *  its left, both in chord lengths. */
export interface ShapePoint {
  s: number;
  n: number;
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
    /** Explicit node stations (0..1 from p0), overriding the law. */
    stations?: number[];
  }[];
  blocks: [number, number, number, number][];
}
