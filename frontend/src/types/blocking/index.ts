// Structured-mesh "blocking" model: vertices/edges/blocks the CAD workbench
// edits, and the operations that build and transform them. Split by category -
// see the individual files for what lives where. This barrel keeps the public
// import surface (`from '../types/blocking'`) unchanged.

export type {
  EdgeLaw,
  BlockVertex,
  BlockEdge,
  Block,
  Blocking,
  StructuredMeshRequest,
} from './types';
export { emptyBlocking } from './types';

export { resampleOpen, entityRing } from './geometry';

export { reprojectEdgePath, applyVertexMove } from './edgeOps';

export {
  outlineRing,
  autoBlockingFromOutline,
  singleBlockFromOutline,
  stripDecomposition,
  makeTagLookup,
} from './autoBlock';

export { blockCornerIds, blockPolygon, splitBlock, deleteBlock, splitSheet } from './blockEdit';

export { bodiesForOgrid, wrapBodyOgrid } from './ogrid';

export { airfoilsForCGrid, cGridFromAirfoil, wrapAirfoilOgrid } from './cgrid';

export {
  cleanBlocking,
  propagateNodeCounts,
  edgeLength,
  autoCellSize,
  currentCellSize,
  applyTargetCellSize,
  edgeDirectionGroups,
  DIRECTION_COLORS,
} from './sizing';

export { toStructuredRequest } from './request';

export type { Outline, AddBlockOptions } from './editor';
export {
  outlinesFor,
  snapToOutline,
  traceAlong,
  pickEdge,
  blockAt,
  blocksOverBodies,
  addBlockFromCorners,
} from './editor';

export type { Curve, BlockingCheck } from './hexa';
export {
  curveOf,
  curveChain,
  projectOnCurve,
  initializeBlocking,
  associateEdges,
  disassociateEdges,
  snapProjectVertices,
  constrainToCurves,
  mergeVertices,
  mergeBlocks,
  ogridBlock,
  checkBlocking,
  edgeGroup,
  setEdgeParams,
} from './hexa';
