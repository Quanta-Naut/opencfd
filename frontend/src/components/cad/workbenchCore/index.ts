// Pure types, constants, and helper functions behind the CAD workbench canvas,
// split by category so the giant interactive component isn't also where you
// have to go looking for e.g. segment-intersection math. See the individual
// files for what lives where. This barrel keeps the import surface stable.

export type {
  CadTool, GuideLine, Snap, DynamicDimPrompt, CadState, CadAction, CadWorkbenchProps,
} from './types';

export { SNAP_RADIUS_PX, INITIAL_ZOOM } from './constants';

export { cadReducer } from './reducer';

export { cellSkewness, colormapRGB } from './colormap';

export {
  uid, moveEntityVertex, translateEntity, dist, midpt, pointInPolygon, distToSegment,
  getMapScaleInfo, pointsToLineSegments, normalizeAngle,
} from './geometry';

export {
  segParam, segSegIntersect, segInfLineIntersect, segCircleIntersect, segEllipseIntersect,
} from './intersections';

export type { TrimTarget } from './trim';
export { getTrimTarget } from './trim';
