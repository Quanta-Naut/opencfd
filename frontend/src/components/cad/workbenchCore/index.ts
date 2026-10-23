// Pure types, constants, and helper functions behind the CAD workbench canvas,
// split by category so the giant interactive component isn't also where you
// have to go looking for e.g. segment-intersection math. See the individual
// files for what lives where. This barrel keeps the import surface stable.

export type {
  CadTool,
  GuideLine,
  Snap,
  DynamicDimPrompt,
  CadState,
  CadAction,
  CadWorkbenchProps,
} from './types';

export { SNAP_RADIUS_PX, ALIGN_TOL_PX, POLAR_TOL_DEG, INITIAL_ZOOM } from './constants';

export type { SnapSettings, SnapKeyPoint, SnapContext } from './snap';
export {
  DEFAULT_SNAP_SETTINGS,
  POLAR_STEP_CHOICES,
  SNAP_LABELS,
  loadSnapSettings,
  saveSnapSettings,
  collectSnapKeyPoints,
  entityIntersections,
  computeSnapPoint,
} from './snap';

export { cadReducer } from './reducer';

export { cellSkewness, colormapRGB } from './colormap';
export type { CanvasPalette } from './canvasPalette';
export { canvasPalette } from './canvasPalette';
export type { MeshEdgeSets } from './meshTopology';
export { meshEdgeSets, meshSkewness } from './meshTopology';

export {
  uid,
  moveEntityVertex,
  translateEntity,
  dist,
  midpt,
  pointInPolygon,
  distToSegment,
  getMapScaleInfo,
  pointsToLineSegments,
  normalizeAngle,
} from './geometry';

export {
  segParam,
  segSegIntersect,
  segInfLineIntersect,
  segCircleIntersect,
  segEllipseIntersect,
} from './intersections';

export type { TrimTarget } from './trim';
export { getTrimTarget } from './trim';
