import React, { useState, useRef, useEffect, useCallback, useReducer, useMemo } from 'react';
import {
  MousePointer2,
  Minus,
  Circle,
  Square,
  CornerUpRight,
  Maximize2,
  Trash2,
  Layers,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Scissors,
  Spline,
  Move,
  Copy,
  RotateCcw,
  ChevronDown,
  Ruler,
  Grid3x3,
  Crosshair,
  Magnet,
  TriangleRight,
  ScanLine,
  Eraser,
  ArrowUpRight,
  Globe,
  Compass,
  Tag,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  Wind,
  Shield,
  Box,
  Sliders,
  Play,
  Download,
  FileCode,
  Check,
  HelpCircle,
} from 'lucide-react';
import { requestOffset, requestFillet, requestMeshFromSketch, uploadAndParseAirfoil, uploadAndParseDxf, fetchAndParseAirfoilFromUrl } from '../../utils/api';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  BoundaryTag,
  BoundaryEdge,
  BOUNDARY_COLORS,
  Point2D,
  CadEntity,
  GeometryBBox,
  getGeometryBBox,
  validateDomainContainment,
  createDomainEntity,
  extractBoundaryEdges,
  getContiguousEdgeChains,
  ContiguousEdgeChain,
  autoSuggestBoundaryTags,
  validateBoundaryTags,
  generateDefaultAirfoilPoints,
} from '../../types/cadWorkflow';

// ─── CAD Workbench Tool & State Types ─────────────────────────────────────────

export type CadTool =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rectangle'
  | 'circle_center_radius'
  | 'circle_3pt'
  | 'arc_center'
  | 'arc_3pt'
  | 'spline'
  | 'construction_line' // infinite reference line through two points
  | 'fillet'
  | 'chamfer'
  | 'offset'
  | 'trim'
  | 'extend'
  | 'mirror'
  | 'move'
  | 'copy_entity'
  | 'rotate'
  | 'dimension_linear';


export interface GuideLine {
  type: 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'projection' | 'origin' | 'xaxis' | 'yaxis';
  from: Point2D;
  to: Point2D;
  label?: string;
}

interface Snap {
  pt: Point2D;
  type: 'endpoint' | 'midpoint' | 'center' | 'origin' | 'grid' | 'perpendicular' | 'parallel' | 'alignment' | 'tangent' | 'intersection';
  guides?: GuideLine[];
}

export interface DynamicDimPrompt {
  entityId: string;
  type: 'line' | 'rectangle' | 'circle' | 'arc';
  worldPos: Point2D;
  val1: string;
  val2?: string;
  label1: string;
  label2?: string;
  basePt: Point2D;
  endPt?: Point2D;
  layer: string;
}


interface CadState {
  entities: CadEntity[];
}



type CadAction =
  | { type: 'ADD_ENTITY'; entity: CadEntity }
  | { type: 'REPLACE_ENTITIES'; entities: CadEntity[] }
  | { type: 'DELETE_SELECTED' }
  | { type: 'SELECT_ENTITY'; id: string | null; multi?: boolean }
  | { type: 'CLEAR' };

function cadReducer(state: CadState, action: CadAction): CadState {
  switch (action.type) {
    case 'ADD_ENTITY':
      return { entities: [...state.entities, action.entity] };
    case 'REPLACE_ENTITIES':
      return { entities: action.entities };
    case 'DELETE_SELECTED':
      return { entities: state.entities.filter(e => !e.selected) };
    case 'SELECT_ENTITY':
      return {
        entities: state.entities.map(e => ({
          ...e,
          selected: action.multi
            ? (e.id === action.id ? !e.selected : e.selected)
            : e.id === action.id,
        })),
      };
    case 'CLEAR':
      return { entities: [] };
    default:
      return state;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SNAP_RADIUS_PX = 12;
const INITIAL_ZOOM = 130;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpt(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Closest distance from point p to segment a→b */
function distToSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Dynamic Google Maps style scale computation based on zoom (pixels per meter) */
function getMapScaleInfo(zoom: number, targetPx = 75): {
  barWidthPx: number;
  label: string;
  worldDist: number;
} {
  const rawDist = targetPx / Math.max(zoom, 1e-6); // in meters
  const exponent = Math.floor(Math.log10(rawDist));
  const fraction = rawDist / Math.pow(10, exponent);

  let niceFraction = 1;
  if (fraction >= 5) niceFraction = 5;
  else if (fraction >= 2) niceFraction = 2;
  else niceFraction = 1;

  let niceDist = niceFraction * Math.pow(10, exponent); // in meters

  // Clamp minimum scale resolution to 0.2 mm (0.0002 m)
  if (niceDist < 0.0002) {
    niceDist = 0.0002;
  }

  const barWidthPx = Math.max(20, Math.round(niceDist * zoom));

  let label = '';
  if (niceDist >= 1000) {
    label = `${(niceDist / 1000).toLocaleString()} km`;
  } else if (niceDist >= 1) {
    label = `${niceDist >= 10 ? niceDist.toFixed(0) : niceDist.toFixed(niceDist % 1 === 0 ? 0 : 1)} m`;
  } else {
    // All sub-meter scales formatted in mm down to 0.2 mm (never micrometers)
    const mm = niceDist * 1000;
    if (mm >= 1) {
      label = `${mm >= 10 ? mm.toFixed(0) : mm.toFixed(mm % 1 === 0 ? 0 : 1)} mm`;
    } else {
      label = `${mm.toFixed(1)} mm`; // e.g. 0.5 mm, 0.2 mm
    }
  }

  return { barWidthPx, label, worldDist: niceDist };
}

/** Converts an imported point sequence into one closed CFD profile. */
function pointsToLineSegments(pts: Point2D[], role?: 'geometry' | 'domain_boundary'): CadEntity[] {
  if (pts.length < 3) return [];
  const clean = pts.filter((point, index) => index === 0 || dist(point, pts[index - 1]) > 1e-8);
  if (clean.length > 1 && dist(clean[0], clean[clean.length - 1]) < 1e-5) clean.pop();
  return [{
    id: uid(),
    type: 'polyline',
    layer: 'geometry',
    role,
    pts: clean,
    isClosed: true,
  }];
}

/** Parameter t ∈ [0,1] at which segment a→b is closest to p (-1 if beyond ends) */
function segParam(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
}

/**
 * Intersection of segment a→b with segment c→d.
 * Returns intersection point or null if parallel/non-intersecting.
 */
function segSegIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return { x: a.x + Math.max(0, Math.min(1, t)) * r.x, y: a.y + Math.max(0, Math.min(1, t)) * r.y };
  }
  return null;
}

/** Intersection of finite segment a→b with infinite line passing through p1 and p2 */
function segInfLineIntersect(a: Point2D, b: Point2D, p1: Point2D, p2: Point2D): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: p2.x - p1.x, y: p2.y - p1.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p1.x - a.x) * s.y - (p1.y - a.y) * s.x) / denom;
  if (t >= -1e-6 && t <= 1 + 1e-6) {
    return { x: a.x + Math.max(0, Math.min(1, t)) * r.x, y: a.y + Math.max(0, Math.min(1, t)) * r.y };
  }
  return null;
}

/** Intersections of finite segment a→b with circle (center, radius) */
function segCircleIntersect(a: Point2D, b: Point2D, center: Point2D, radius: number): Point2D[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [];
  const fx = a.x - center.x, fy = a.y - center.y;
  const A = lenSq;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sqrtD = Math.sqrt(disc);
  const t1 = (-B - sqrtD) / (2 * A);
  const t2 = (-B + sqrtD) / (2 * A);
  const res: Point2D[] = [];
  if (t1 >= -1e-6 && t1 <= 1 + 1e-6) res.push({ x: a.x + Math.max(0, Math.min(1, t1)) * dx, y: a.y + Math.max(0, Math.min(1, t1)) * dy });
  if (t2 >= -1e-6 && t2 <= 1 + 1e-6 && Math.abs(t2 - t1) > 1e-5) res.push({ x: a.x + Math.max(0, Math.min(1, t2)) * dx, y: a.y + Math.max(0, Math.min(1, t2)) * dy });
  return res;
}

function normalizeAngle(a: number): number {

  let res = a % (2 * Math.PI);
  if (res > Math.PI) res -= 2 * Math.PI;
  if (res < -Math.PI) res += 2 * Math.PI;
  return res;
}

export interface TrimTarget {
  targetEnt: CadEntity;
  targetSegIdx: number;
  subSeg: { p0: Point2D; p1: Point2D };
  preservedSegs: { p0: Point2D; p1: Point2D }[];
}

function getTrimTarget(rawPt: Point2D, entities: CadEntity[], zoom: number): TrimTarget | null {
  const hitR = 14 / zoom;
  let targetEnt: CadEntity | null = null;
  let targetSegIdx = -1;
  let bestD = Infinity;

  for (const ent of entities) {
    if (ent.layer === 'construction') continue;
    for (let i = 0; i < ent.pts.length - 1; i++) {
      const d = distToSegment(rawPt, ent.pts[i], ent.pts[i + 1]);
      if (d < hitR && d < bestD) { bestD = d; targetEnt = ent; targetSegIdx = i; }
    }
    if (ent.isClosed && ent.pts.length >= 3) {
      const i = ent.pts.length - 1;
      const d = distToSegment(rawPt, ent.pts[i], ent.pts[0]);
      if (d < hitR && d < bestD) { bestD = d; targetEnt = ent; targetSegIdx = i; }
    }
  }

  if (!targetEnt || targetSegIdx < 0) return null;

  const segA = targetEnt.pts[targetSegIdx];
  const segB = targetEnt.pts[(targetSegIdx + 1) % targetEnt.pts.length];

  // Collect all intersection t-parameters along the segment [0, 1]
  const tParams: number[] = [0, 1];

  for (const other of entities) {
    for (let j = 0; j < other.pts.length - 1; j++) {
      if (other.id === targetEnt.id && j === targetSegIdx) continue;
      if (other.type === 'construction' && other.pts.length >= 2) {
        const ix = segInfLineIntersect(segA, segB, other.pts[0], other.pts[1]);
        if (ix) {
          const t = segParam(ix, segA, segB);
          if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
        }
      } else {
        const ix = segSegIntersect(segA, segB, other.pts[j], other.pts[j + 1]);
        if (ix) {
          const t = segParam(ix, segA, segB);
          if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
        }
      }
    }
    if (other.isClosed && other.pts.length >= 3) {
      const j = other.pts.length - 1;
      if (!(other.id === targetEnt.id && j === targetSegIdx)) {
        const ix = segSegIntersect(segA, segB, other.pts[j], other.pts[0]);
        if (ix) {
          const t = segParam(ix, segA, segB);
          if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
        }
      }
    }
    if (other.type === 'circle' && other.pts.length >= 2) {
      const r = other.radius ?? dist(other.pts[0], other.pts[1]);
      const ixs = segCircleIntersect(segA, segB, other.pts[0], r);
      for (const ix of ixs) {
        const t = segParam(ix, segA, segB);
        if (t > 1e-5 && t < 1 - 1e-5) tParams.push(t);
      }
    }
  }

  const sortedT = Array.from(new Set(tParams.map(t => +t.toFixed(6)))).sort((a, b) => a - b);

  if (sortedT.length <= 2) {
    // No intersection: the whole segment is trimmed
    return {
      targetEnt,
      targetSegIdx,
      subSeg: { p0: segA, p1: segB },
      preservedSegs: []
    };
  }

  const tClick = segParam(rawPt, segA, segB);
  let subIdx = sortedT.findIndex((t, i) => i < sortedT.length - 1 && tClick >= t && tClick <= sortedT[i + 1]);
  if (subIdx < 0) subIdx = 0;

  const t0 = sortedT[subIdx];
  const t1 = sortedT[subIdx + 1];
  const subSeg = {
    p0: { x: +(segA.x + t0 * (segB.x - segA.x)).toFixed(5), y: +(segA.y + t0 * (segB.y - segA.y)).toFixed(5) },
    p1: { x: +(segA.x + t1 * (segB.x - segA.x)).toFixed(5), y: +(segA.y + t1 * (segB.y - segA.y)).toFixed(5) }
  };

  const preservedSegs: { p0: Point2D; p1: Point2D }[] = [];
  for (let i = 0; i < sortedT.length - 1; i++) {
    if (i !== subIdx) {
      const ta = sortedT[i];
      const tb = sortedT[i + 1];
      if (tb - ta > 1e-5) {
        preservedSegs.push({
          p0: { x: +(segA.x + ta * (segB.x - segA.x)).toFixed(5), y: +(segA.y + ta * (segB.y - segA.y)).toFixed(5) },
          p1: { x: +(segA.x + tb * (segB.x - segA.x)).toFixed(5), y: +(segA.y + tb * (segB.y - segA.y)).toFixed(5) }
        });
      }
    }
  }

  return {
    targetEnt,
    targetSegIdx,
    subSeg,
    preservedSegs,
  };
}





interface CadWorkbenchProps {
  onApplySketchMesh: (mesh: any, name: string) => void;
  domainLength: number;
  domainHeight: number;
  resolution: string;
  firstLayerMm: number;
  pendingImportFile?:
    | { type: 'parsed'; name: string; points: Point2D[] }
    | { type: 'airfoil' | 'dxf' | 'url'; file?: File; url?: string }
    | null;
  onClearPendingImport?: () => void;

  // ── 6-Step Workflow Props (controlled by sidebar) ──
  currentStep?: CadWorkflowStep;
  flowType?: FlowType;
  domainShape?: DomainShapeType;
  upstreamChordFactor?: number;
  setUpstreamChordFactor?: (f: number) => void;
  downstreamChordFactor?: number;
  setDownstreamChordFactor?: (f: number) => void;
  lateralHeightFactor?: number;
  setLateralHeightFactor?: (f: number) => void;
  geometryBBox?: GeometryBBox;
  angleOfAttackDeg?: number;
  setAngleOfAttackDeg?: (a: number) => void;
  freestreamVelocity?: number;
  activeTagTool?: BoundaryTag;
  edgeTagMap?: Record<string, BoundaryTag>;
  onSetEdgeTagMap?: React.Dispatch<React.SetStateAction<Record<string, BoundaryTag>>>;
  onEntitiesChange?: (entities: CadEntity[]) => void;
  onRequestGenerateDomainRef?: React.MutableRefObject<(() => void) | null>;
  onRequestSetSelectedAsDomainRef?: React.MutableRefObject<(() => void) | null>;
  onRequestSetSelectedAsGeometryRef?: React.MutableRefObject<(() => void) | null>;
  onRequestSelectAllGeometryRef?: React.MutableRefObject<(() => void) | null>;
  onRequestClearGeometryRef?: React.MutableRefObject<(() => void) | null>;
  onRequestAutoSuggestTagsRef?: React.MutableRefObject<(() => void) | null>;
  onRequestMeshHandoffRef?: React.MutableRefObject<(() => void) | null>;
  onRequestDownloadBlockMeshDictRef?: React.MutableRefObject<(() => void) | null>;
  cadName?: string;
  onCadNameChange?: (name: string) => void;
  initialEntities?: CadEntity[];
  displayOnly?: boolean;
  meshData?: any;
  showMesh?: boolean;
}

export const CadWorkbench2D: React.FC<CadWorkbenchProps> = ({
  onApplySketchMesh,
  domainLength,
  domainHeight,
  resolution,
  firstLayerMm,
  pendingImportFile,
  onClearPendingImport,
  currentStep = 1,
  flowType = 'external',
  domainShape = 'rectangle',
  upstreamChordFactor = 10,
  setUpstreamChordFactor,
  downstreamChordFactor = 20,
  setDownstreamChordFactor,
  lateralHeightFactor = 10,
  setLateralHeightFactor,
  geometryBBox: propGeometryBBox,
  angleOfAttackDeg = 0.0,
  setAngleOfAttackDeg,
  freestreamVelocity = 35.0,
  activeTagTool = 'inlet',
  edgeTagMap: propEdgeTagMap,
  onSetEdgeTagMap,
  onEntitiesChange,
  onRequestGenerateDomainRef,
  onRequestSetSelectedAsDomainRef,
  onRequestSetSelectedAsGeometryRef,
  onRequestSelectAllGeometryRef,
  onRequestClearGeometryRef,
  onRequestAutoSuggestTagsRef,
  onRequestMeshHandoffRef,
  onRequestDownloadBlockMeshDictRef,
  cadName: propCadName,
  onCadNameChange,
  initialEntities,
  displayOnly = false,
  meshData,
  showMesh = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Domain Handle Dragging State ──
  const [hoveredDomainHandle, setHoveredDomainHandle] = useState<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null>(null);
  const draggingDomainHandleRef = useRef<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null>(null);
  const [draggingDomainHandle, setDraggingDomainHandle] = useState<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null>(null);
  const [domainAnimScale, setDomainAnimScale] = useState<number>(1.0);

  // ── Flow Vector AoA Dial Handle State ──
  const [hoveredAoAHandle, setHoveredAoAHandle] = useState<boolean>(false);
  const [draggingAoAHandle, setDraggingAoAHandle] = useState<boolean>(false);


  // ── Undo/Redo stack ─────────────────────────────────────────────────────────
  const historyRef = useRef<CadState[]>([]);
  const historyIdxRef = useRef<number>(-1);

  const [cadState, dispatch] = useReducer(cadReducer, {
    entities: initialEntities && initialEntities.length > 0 ? initialEntities : [],
  });

  // Sync initial entities if provided when local state is empty
  useEffect(() => {
    if (initialEntities && initialEntities.length > 0 && cadState.entities.length === 0) {
      dispatch({ type: 'REPLACE_ENTITIES', entities: initialEntities });
    }
  }, [initialEntities]);

  // Whenever cadState changes, push to history & notify parent
  useEffect(() => {
    const h = historyRef.current;
    const idx = historyIdxRef.current;
    if (draggingDomainHandleRef.current && idx >= 0) {
      // Overwrite current history frame during continuous drag to prevent undo stack bloating
      h[idx] = { entities: cadState.entities.map(e => ({ ...e })) };
    } else {
      // Truncate forward history on new action
      h.splice(idx + 1);
      h.push({ entities: cadState.entities.map(e => ({ ...e })) });
      historyIdxRef.current = h.length - 1;
    }
    onEntitiesChange?.(cadState.entities);
  }, [cadState.entities, onEntitiesChange]);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    dispatch({ type: 'REPLACE_ENTITIES', entities: historyRef.current[historyIdxRef.current].entities });
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    dispatch({ type: 'REPLACE_ENTITIES', entities: historyRef.current[historyIdxRef.current].entities });
  }, []);

  // ── Tool state ──────────────────────────────────────────────────────────────
  const [tool, setTool] = useState<CadTool>('select');
  const [tempPts, setTempPts] = useState<Point2D[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // ── Camera ──────────────────────────────────────────────────────────────────
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 });
  const panning = useRef(false);
  const panStart = useRef<Point2D>({ x: 0, y: 0 });
  const panOrigin = useRef<Point2D>({ x: 0, y: 0 });

  // ── Camera Framing Helper ───────────────────────────────────────────────────
  const fitBoundingBox = useCallback((box: { minX: number; maxX: number; minY: number; maxY: number }, marginRatio = 0.70) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cw = canvas.clientWidth || 800;
    const ch = canvas.clientHeight || 600;

    const w = Math.max(0.01, box.maxX - box.minX);
    const h = Math.max(0.01, box.maxY - box.minY);
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;

    const availW = cw * marginRatio;
    const availH = ch * marginRatio;
    const newZoom = Math.max(0.5, Math.min(25000, Math.min(availW / w, availH / h)));
    const newPan = {
      x: -cx * newZoom,
      y: cy * newZoom,
    };

    setZoom(newZoom);
    setPan(newPan);
  }, []);

  // When switching between steps (e.g. to Step 2, Step 3), reset to 'select' tool by default
  useEffect(() => {
    setTool('select');
    setIsDrawing(false);
    setTempPts([]);
    setDimPrompt(null);
    setCmdText('Switched to Select mode. Drag or click domain / boundary controls.');
  }, [currentStep]);

  // ── Snap ────────────────────────────────────────────────────────────────────
  const [snap, setSnap] = useState<Snap>({ pt: { x: 0, y: 0 }, type: 'grid' });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [ortho, setOrtho] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [canvasMode, setCanvasMode] = useState<'cad' | 'mesh'>('cad');

  useEffect(() => {
    if (!showMesh) {
      setCanvasMode('cad');
    } else if (meshData?.nodes?.length && meshData?.elements?.length) {
      setCanvasMode('mesh');
    }
  }, [showMesh, meshData]);
  const [showConstruction, setShowConstruction] = useState(true);
  const [constructionMode, setConstructionMode] = useState(false); // draw to construction layer

  // ── Op parameters ───────────────────────────────────────────────────────────
  const [filletR, setFilletR] = useState(0.05);
  const [offsetD, setOffsetD] = useState(0.05);
  const [localCadName, setLocalCadName] = useState('2D Profile');
  const cadName = propCadName ?? localCadName;
  const setCadName = onCadNameChange ?? setLocalCadName;

  const [isLoading, setIsLoading] = useState(false);
  const [cmdText, setCmdText] = useState('Pick a tool or press L / P / R / C to start drawing.');

  // ── HUD ─────────────────────────────────────────────────────────────────────
  const [hud, setHud] = useState({ length: '0.000', angle: '0.0', x: '0.0000', y: '0.0000' });

  // ── Drag-to-select (marquee) ─────────────────────────────────────────────────
  const dragSelecting = useRef(false);
  const dragStart = useRef<Point2D>({ x: 0, y: 0 });   // screen pixels
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // ── Dynamic Dimension Input (Onshape / Fusion 360 style) ───────────────────
  const [dimPrompt, setDimPrompt] = useState<DynamicDimPrompt | null>(null);
  const [inputVal1, setInputVal1] = useState('');
  const [inputVal2, setInputVal2] = useState('');
  const input1Ref = useRef<HTMLInputElement>(null);
  const input2Ref = useRef<HTMLInputElement>(null);

  // ── Trim Tool Preview ───────────────────────────────────────────────────────
  const [hoveredTrim, setHoveredTrim] = useState<{ p0: Point2D; p1: Point2D } | null>(null);

  // ── Fallback edgeTagMap if not controlled ──────────────────────────────────
  const [localEdgeTagMap, setLocalEdgeTagMap] = useState<Record<string, BoundaryTag>>({});
  const edgeTagMap = propEdgeTagMap ?? localEdgeTagMap;
  const setEdgeTagMap = onSetEdgeTagMap ?? setLocalEdgeTagMap;

  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);

  // ── Computed Bounding Box & Domain / Boundary Validations ──────────────────
  const geometryBBox = useMemo(() => getGeometryBBox(cadState.entities), [cadState.entities]);

  const domainEntity = useMemo(
    () => cadState.entities.find(e => e.role === 'domain_boundary') || null,
    [cadState.entities]
  );

  const domainValidation = useMemo(
    () =>
      flowType === 'external'
        ? validateDomainContainment(domainEntity, cadState.entities)
        : { valid: true, reason: 'Internal flow — duct walls serve as the domain boundary.' },
    [domainEntity, cadState.entities, flowType]
  );

  const boundaryEdges = useMemo(
    () => extractBoundaryEdges(cadState.entities, flowType, edgeTagMap),
    [cadState.entities, flowType, edgeTagMap]
  );

  const boundaryValidation = useMemo(
    () => validateBoundaryTags(boundaryEdges, flowType),
    [boundaryEdges, flowType]
  );

  // ── Dynamic Google Maps Style Scale Bar Info ──
  const scaleInfo = useMemo(() => getMapScaleInfo(zoom, 75), [zoom]);

  // ── Live Real-time Domain Synchronization ─────────────────────────────────
  // Whenever domain factors, shape, or geometry bounding box change, update the domain entity points in real time
  useEffect(() => {
    if (flowType !== 'external') return;
    const existingDomain = cadState.entities.find(e => e.role === 'domain_boundary');
    if (!existingDomain) return;

    const updatedDomain = createDomainEntity(
      domainShape,
      geometryBBox,
      upstreamChordFactor,
      downstreamChordFactor,
      lateralHeightFactor,
      existingDomain.id
    );

    const ptsChanged =
      existingDomain.pts.length !== updatedDomain.pts.length ||
      existingDomain.type !== updatedDomain.type ||
      existingDomain.pts.some((p, i) => Math.abs(p.x - updatedDomain.pts[i].x) > 1e-5 || Math.abs(p.y - updatedDomain.pts[i].y) > 1e-5);

    if (ptsChanged) {
      dispatch({
        type: 'REPLACE_ENTITIES',
        entities: cadState.entities.map(e => (e.id === existingDomain.id ? { ...updatedDomain, selected: e.selected } : e)),
      });
    }
  }, [domainShape, upstreamChordFactor, downstreamChordFactor, lateralHeightFactor, flowType, geometryBBox, cadState.entities]);

  // ── Global domain-handle drag (document listeners so cursor can leave canvas) ──
  useEffect(() => {
    const getBBoxAndChord = () => {
      const bbox = getGeometryBBox(cadState.entities) ?? { chord: 1, height: 0.5, minX: -0.5, maxX: 0.5, centerX: 0, centerY: 0 };
      return bbox;
    };

    const onMove = (e: MouseEvent) => {
      const handle = draggingDomainHandleRef.current;
      if (!handle) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const o = { x: canvas.clientWidth / 2 + pan.x, y: canvas.clientHeight / 2 + pan.y };
      const rawX = (e.clientX - rect.left - o.x) / zoom;
      const rawY = -(e.clientY - rect.top - o.y) / zoom;
      const bbox = getBBoxAndChord();
      const c = bbox.chord;
      const effH = Math.max(0.5 * c, bbox.height);

      if (handle === 'upstream') {
        const rawFactor = (bbox.minX - rawX) / c;
        setUpstreamChordFactor?.(Math.max(1, Math.min(100, Math.round(rawFactor * 2) / 2)));
      } else if (handle === 'downstream') {
        const rawFactor = (rawX - bbox.maxX) / c;
        setDownstreamChordFactor?.(Math.max(1, Math.min(100, Math.round(rawFactor * 2) / 2)));
      } else if (handle === 'top') {
        const rawFactor = (rawY - bbox.centerY) / effH;
        setLateralHeightFactor?.(Math.max(1, Math.min(100, Math.round(rawFactor * 2) / 2)));
      } else if (handle === 'bottom') {
        const rawFactor = (bbox.centerY - rawY) / effH;
        setLateralHeightFactor?.(Math.max(1, Math.min(100, Math.round(rawFactor * 2) / 2)));
      } else if (handle === 'radial') {
        const rawDist = Math.hypot(rawX - bbox.centerX, rawY - bbox.centerY);
        const factor = Math.max(1, Math.min(100, Math.round((rawDist / c) * 2) / 2));
        setUpstreamChordFactor?.(factor);
        setDownstreamChordFactor?.(factor);
        setLateralHeightFactor?.(factor);
      }
    };

    const onUp = () => {
      if (!draggingDomainHandleRef.current) return;
      draggingDomainHandleRef.current = null;
      setDraggingDomainHandle(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, pan, cadState.entities, setUpstreamChordFactor, setDownstreamChordFactor, setLateralHeightFactor]);



  // ── World ↔ Screen ───────────────────────────────────────────────────────────
  const origin = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    return { x: c.clientWidth / 2 + pan.x, y: c.clientHeight / 2 + pan.y };
  }, [pan]);

  const toScreen = useCallback((wx: number, wy: number): Point2D => {
    const o = origin();
    return { x: o.x + wx * zoom, y: o.y - wy * zoom };
  }, [origin, zoom]);

  const toWorld = useCallback((sx: number, sy: number): Point2D => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const rect = c.getBoundingClientRect();
    const o = origin();
    return { x: (sx - rect.left - o.x) / zoom, y: -(sy - rect.top - o.y) / zoom };
  }, [origin, zoom]);

  // ── Clean Professional CAD OSNAP & Inferencing Engine ──────────────────────
  const computeSnap = useCallback((raw: Point2D): Snap => {
    const snapR = SNAP_RADIUS_PX / zoom;
    const alignTol = 10 / zoom; // screen-scaled tolerance for tracking & alignments
    let minD = Infinity;

    if (!snapEnabled) {
      return { pt: raw, type: 'grid', guides: [] };
    }

    const activeStart = tempPts.length > 0 ? tempPts[tempPts.length - 1] : null;

    // 1. ORIGIN SNAP (priority when hovered near (0,0))
    const dOrigin = dist(raw, { x: 0, y: 0 });
    if (dOrigin < snapR * 1.2) {
      return {
        pt: { x: 0, y: 0 },
        type: 'origin',
        guides: [],
      };
    }

    // 2. COLLECT KEY GEOMETRIC VERTICES (Endpoints, Midpoints, Centers)
    const keyPoints: { pt: Point2D; type: Snap['type'] }[] = [
      { pt: { x: 0, y: 0 }, type: 'origin' },
    ];

    for (const e of cadState.entities) {
      if (e.pts.length >= 2) {
        keyPoints.push({ pt: e.pts[0], type: 'endpoint' });
        keyPoints.push({ pt: e.pts[e.pts.length - 1], type: 'endpoint' });
        for (let i = 0; i < e.pts.length - 1; i++) {
          keyPoints.push({ pt: midpt(e.pts[i], e.pts[i + 1]), type: 'midpoint' });
          if (i > 0 && i < e.pts.length - 1) {
            keyPoints.push({ pt: e.pts[i], type: 'endpoint' });
          }
        }
      }
      if (e.type === 'circle' && e.pts[0]) {
        keyPoints.push({ pt: e.pts[0], type: 'center' });
      }
      if (e.type === 'arc' && e.pts[0]) {
        keyPoints.push({ pt: e.pts[0], type: 'center' });
        keyPoints.push({ pt: e.pts[1], type: 'endpoint' });
        if (e.pts[2]) keyPoints.push({ pt: e.pts[2], type: 'endpoint' });
      }
    }

    // Direct Vertex / Point Snapping (highest priority)
    let directSnap: Snap | null = null;
    for (const kp of keyPoints) {
      const d = dist(raw, kp.pt);
      if (d < snapR && d < minD) {
        minD = d;
        directSnap = { pt: kp.pt, type: kp.type, guides: [] };
      }
    }
    if (directSnap) {
      return directSnap;
    }

    // 3. INFERENCING WHILE ACTIVELY DRAWING
    if (activeStart && dist(raw, activeStart) > snapR) {
      const dx = raw.x - activeStart.x;
      const dy = raw.y - activeStart.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Check if drawing near X-axis (y=0) or Y-axis (x=0)
      const onXAxis = Math.abs(raw.y) < alignTol;
      const onYAxis = Math.abs(raw.x) < alignTol;

      // Check if moving predominantly horizontal or vertical from start
      const isHorizontal = absDy < alignTol || onXAxis;
      const isVertical = absDx < alignTol || onYAxis;

      if (isHorizontal) {
        const targetY = onXAxis ? 0 : activeStart.y;
        let targetX = raw.x;
        const guides: GuideLine[] = [
          { type: onXAxis ? 'xaxis' : 'horizontal', from: activeStart, to: { x: targetX, y: targetY } },
        ];

        // Check if there is an opposing endpoint that aligns vertically with current cursor
        let bestAlignX: Point2D | null = null;
        let minDiffX = alignTol;
        for (const kp of keyPoints) {
          if (dist(kp.pt, activeStart) < 1e-4) continue;
          const diff = Math.abs(raw.x - kp.pt.x);
          if (diff < minDiffX) {
            minDiffX = diff;
            bestAlignX = kp.pt;
          }
        }

        if (bestAlignX) {
          targetX = bestAlignX.x;
          guides[0].to.x = targetX;
          guides.push({
            type: 'vertical',
            from: bestAlignX,
            to: { x: targetX, y: targetY },
          });
        }

        return {
          pt: { x: +targetX.toFixed(5), y: +targetY.toFixed(5) },
          type: 'alignment',
          guides,
        };
      }

      if (isVertical) {
        const targetX = onYAxis ? 0 : activeStart.x;
        let targetY = raw.y;
        const guides: GuideLine[] = [
          { type: onYAxis ? 'yaxis' : 'vertical', from: activeStart, to: { x: targetX, y: targetY } },
        ];

        // Check if there is an opposing endpoint that aligns horizontally with current cursor
        let bestAlignY: Point2D | null = null;
        let minDiffY = alignTol;
        for (const kp of keyPoints) {
          if (dist(kp.pt, activeStart) < 1e-4) continue;
          const diff = Math.abs(raw.y - kp.pt.y);
          if (diff < minDiffY) {
            minDiffY = diff;
            bestAlignY = kp.pt;
          }
        }

        if (bestAlignY) {
          targetY = bestAlignY.y;
          guides[0].to.y = targetY;
          guides.push({
            type: 'horizontal',
            from: bestAlignY,
            to: { x: targetX, y: targetY },
          });
        }

        return {
          pt: { x: +targetX.toFixed(5), y: +targetY.toFixed(5) },
          type: 'alignment',
          guides,
        };
      }

      // Check 90° Perpendicular and Parallel to existing segments (only when not H/V)
      const curLen = Math.hypot(dx, dy);
      const curAng = Math.atan2(dy, dx);

      for (const e of cadState.entities) {
        if (e.pts.length < 2) continue;
        for (let i = 0; i < e.pts.length - 1; i++) {
          const segA = e.pts[i];
          const segB = e.pts[i + 1];
          const segAng = Math.atan2(segB.y - segA.y, segB.x - segA.x);

          // 90° Perpendicular snap
          const perp1 = segAng + Math.PI / 2;
          const perp2 = segAng - Math.PI / 2;
          const diffPerp1 = Math.abs(normalizeAngle(curAng - perp1));
          const diffPerp2 = Math.abs(normalizeAngle(curAng - perp2));
          if (diffPerp1 < 0.05 || diffPerp2 < 0.05) {
            const targetAng = diffPerp1 < 0.05 ? perp1 : perp2;
            const pt = {
              x: +(activeStart.x + curLen * Math.cos(targetAng)).toFixed(5),
              y: +(activeStart.y + curLen * Math.sin(targetAng)).toFixed(5),
            };
            return {
              pt,
              type: 'perpendicular',
              guides: [{ type: 'perpendicular', from: activeStart, to: pt }],
            };
          }

          // Parallel snap
          const diffPar = Math.abs(normalizeAngle(curAng - segAng));
          const diffParOpp = Math.abs(normalizeAngle(curAng - (segAng + Math.PI)));
          if (diffPar < 0.05 || diffParOpp < 0.05) {
            const targetAng = diffPar < 0.05 ? segAng : segAng + Math.PI;
            const pt = {
              x: +(activeStart.x + curLen * Math.cos(targetAng)).toFixed(5),
              y: +(activeStart.y + curLen * Math.sin(targetAng)).toFixed(5),
            };
            return {
              pt,
              type: 'parallel',
              guides: [{ type: 'parallel', from: activeStart, to: pt }],
            };
          }
        }
      }
    }

    // Grid snap fallback
    if (gridSnapEnabled) {
      const rawStep = 40 / Math.max(zoom, 1e-6);
      const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const norm = rawStep / mag;
      let g = mag;
      if (norm >= 5) g = 5 * mag;
      else if (norm >= 2) g = 2 * mag;
      else g = mag;
      g = Math.max(0.0002, g); // Min grid snap step: 0.2 mm

      const gx = Math.round(raw.x / g) * g;
      const gy = Math.round(raw.y / g) * g;
      return { pt: { x: +gx.toFixed(6), y: +gy.toFixed(6) }, type: 'grid', guides: [] };
    }

    return { pt: raw, type: 'grid', guides: [] };
  }, [cadState.entities, snapEnabled, gridSnapEnabled, tempPts, zoom]);



  // ── Canvas render ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    ctx.scale(dpr, dpr);

    const o = { x: cw / 2 + pan.x, y: ch / 2 + pan.y };
    const ws = (wx: number, wy: number) => ({ x: o.x + wx * zoom, y: o.y - wy * zoom });
    const SCALE = zoom;

    // Background
    ctx.fillStyle = '#FAFAFA';
    ctx.fillRect(0, 0, cw, ch);

    // ─── Adaptive Dynamic Grid (down to 0.2 mm) ──────────────────────────────
    if (showGrid) {
      const rawStep = 40 / Math.max(SCALE, 1e-6);
      const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
      const norm = rawStep / mag;
      let minorStep = mag;
      if (norm >= 5) minorStep = 5 * mag;
      else if (norm >= 2) minorStep = 2 * mag;
      else minorStep = mag;
      minorStep = Math.max(0.0002, minorStep); // Min grid step: 0.2 mm
      const majorStep = minorStep * 5;

      const drawGridLines = (step: number, color: string, width: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        const screenStep = step * SCALE;
        if (screenStep < 4) return;
        const ox = ((o.x % screenStep) + screenStep) % screenStep;
        const oy = ((o.y % screenStep) + screenStep) % screenStep;
        ctx.beginPath();
        for (let x = ox; x < cw; x += screenStep) { ctx.moveTo(x, 0); ctx.lineTo(x, ch); }
        for (let y = oy; y < ch; y += screenStep) { ctx.moveTo(0, y); ctx.lineTo(cw, y); }
        ctx.stroke();
      };
      drawGridLines(minorStep, '#EBEBEB', 1);
      drawGridLines(majorStep, '#D8D8D8', 1.2);

      // Axes
      ctx.strokeStyle = '#D0D0D0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, o.y); ctx.lineTo(cw, o.y);
      ctx.moveTo(o.x, 0); ctx.lineTo(o.x, ch);
      ctx.stroke();

      // Axis labels
      ctx.fillStyle = '#BBBBBB';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText('X', cw - 16, o.y - 6);
      ctx.fillText('Y', o.x + 6, 14);
    }


    // Mesh mode reuses this CAD canvas, including its camera, pan and zoom.
    // Only the backend mesh is drawn; fields and streamlines are intentionally absent.
    if (displayOnly && showMesh && canvasMode === 'mesh' && meshData?.nodes?.length && meshData?.elements?.length) {
      const nodes = meshData.nodes;
      const elements = meshData.elements;
      const edgeCounts = new Map<string, [number, number, number]>();
      const addEdge = (a: number, b: number) => {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const existing = edgeCounts.get(key);
        if (existing) existing[2] += 1;
        else edgeCounts.set(key, [a, b, 1]);
      };

      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 0.65;
      for (const element of elements) {
        if (element.length < 3) continue;
        const points = element.map((nodeIndex: number) => ws(nodes[nodeIndex][0], nodes[nodeIndex][1]));
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
          ctx.lineTo(points[index].x, points[index].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        for (let index = 0; index < element.length; index += 1) {
          addEdge(element[index], element[(index + 1) % element.length]);
        }
      }

      // Exterior edges explicitly show both the airfoil hole and domain edge.
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.7;
      for (const [a, b, count] of edgeCounts.values()) {
        if (count !== 1) continue;
        const p0 = ws(nodes[a][0], nodes[a][1]);
        const p1 = ws(nodes[b][0], nodes[b][1]);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      return;
    }

    // ─── Entities ─────────────────────────────────────────────────────────────
    for (const e of cadState.entities) {
      const isDomain = e.role === 'domain_boundary';
      const isConst = e.layer === 'construction';
      const isSel = !!e.selected;

      if (isDomain) {
        ctx.strokeStyle = isSel ? '#E05A00' : '#2563EB';
        ctx.lineWidth = isSel ? 2.5 : 1.8;
        ctx.setLineDash([8, 4]);
        ctx.fillStyle = 'rgba(37, 99, 235, 0.03)';
      } else {
        ctx.strokeStyle = isConst ? '#4A90D9' : isSel ? '#E05A00' : '#1A1D21';
        ctx.lineWidth = isSel ? 2.5 : isConst ? 1.2 : 1.8;
        if (isConst) ctx.setLineDash([6, 4]);
        else ctx.setLineDash([]);

        if (!isConst && isSel) {
          ctx.fillStyle = 'rgba(224, 90, 0, 0.07)';
        } else if (!isConst) {
          ctx.fillStyle = 'rgba(37, 99, 235, 0.04)';
        } else {
          ctx.fillStyle = 'transparent';
        }
      }

      // Draw entity geometry
      if ((e.type === 'line' || e.type === 'polyline' || e.type === 'rectangle' || e.type === 'spline' || e.type === 'construction') && e.pts.length >= 2) {
        ctx.beginPath();
        const p0 = ws(e.pts[0].x, e.pts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < e.pts.length; i++) {
          const p = ws(e.pts[i].x, e.pts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        if (e.isClosed) {
          ctx.closePath();
          ctx.fill();
        }
        ctx.stroke();

        // Endpoint handles
        if (!isConst || showConstruction) {
          for (const pt of e.pts) {
            const ps = ws(pt.x, pt.y);
            ctx.fillStyle = isSel ? '#E05A00' : isConst ? '#4A90D9' : '#888';
            ctx.beginPath();
            ctx.arc(ps.x, ps.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (e.type === 'circle' && e.pts.length >= 2) {
        const center = ws(e.pts[0].x, e.pts[0].y);
        const r = (e.radius ?? dist(e.pts[0], e.pts[1])) * SCALE;
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Center mark
        ctx.strokeStyle = ctx.strokeStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center.x - 5, center.y); ctx.lineTo(center.x + 5, center.y);
        ctx.moveTo(center.x, center.y - 5); ctx.lineTo(center.x, center.y + 5);
        ctx.stroke();
      } else if (e.type === 'arc' && e.pts.length >= 3) {
        const center = ws(e.pts[0].x, e.pts[0].y);
        const r = dist(e.pts[0], e.pts[1]) * SCALE;
        const sa = e.startAngle ?? Math.atan2(-(e.pts[1].y - e.pts[0].y), e.pts[1].x - e.pts[0].x);
        const ea = e.endAngle ?? Math.atan2(-(e.pts[2].y - e.pts[0].y), e.pts[2].x - e.pts[0].x);
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, -ea, -sa); // Canvas Y-flipped
        ctx.stroke();
      }

      ctx.setLineDash([]);
    }

    // ─── Temp geometry (in-progress entity) ──────────────────────────────────
    if (isDrawing && tempPts.length > 0) {
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);

      if (tool === 'circle_center_radius' && tempPts.length === 1) {
        const center = ws(tempPts[0].x, tempPts[0].y);
        const r = dist(tempPts[0], snap.pt) * SCALE;
        if (r > 0) {
          ctx.beginPath();
          ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        const p0 = ws(tempPts[0].x, tempPts[0].y);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < tempPts.length; i++) {
          const p = ws(tempPts[i].x, tempPts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        const cur = ws(snap.pt.x, snap.pt.y);
        ctx.lineTo(cur.x, cur.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // ─── Trim Tool Hover Preview ─────────────────────────────────────────────
    if (tool === 'trim' && hoveredTrim) {
      const p0 = ws(hoveredTrim.p0.x, hoveredTrim.p0.y);
      const p1 = ws(hoveredTrim.p1.x, hoveredTrim.p1.y);

      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 3.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Red 'X' icon at trim cut center
      const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      ctx.strokeStyle = '#DC2626';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mid.x - 5, mid.y - 5); ctx.lineTo(mid.x + 5, mid.y + 5);
      ctx.moveTo(mid.x + 5, mid.y - 5); ctx.lineTo(mid.x - 5, mid.y + 5);
      ctx.stroke();
    }

    // ─── Assist / Alignment / Tracking Guide Lines ───────────────────────────
    if (tool !== 'select' && snap.guides && snap.guides.length > 0) {
      for (const g of snap.guides) {
        if (g.type === 'origin') continue;
        const p1 = ws(g.from.x, g.from.y);
        const p2 = ws(g.to.x, g.to.y);
        const isAxis = g.type === 'xaxis' || g.type === 'yaxis';

        // Thin warm orange line for axis snapping, sky blue for other inferencing
        ctx.strokeStyle = isAxis ? '#F59E0B' : '#0284C7';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        if (!isAxis && g.type !== 'perpendicular') {
          // Small origin square at tracking reference point
          ctx.fillStyle = '#0284C7';
          ctx.fillRect(p1.x - 2.5, p1.y - 2.5, 5, 5);
        }

        // For 90° perpendicular snap, draw the right-angle corner square at intersection
        if (g.type === 'perpendicular') {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy);
          if (len > 1e-3) {
            const vx = dx / len;
            const vy = dy / len;
            const ux = -vy;
            const uy = vx;
            const s = 8;
            ctx.strokeStyle = '#0284C7';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(p1.x + vx * s, p1.y + vy * s);
            ctx.lineTo(p1.x + vx * s + ux * s, p1.y + vy * s + uy * s);
            ctx.lineTo(p1.x + ux * s, p1.y + uy * s);
            ctx.stroke();
          }
        }
      }
    }

    // ─── Snap indicator ───────────────────────────────────────────────────────
    if (tool !== 'select' && snap.type !== 'grid') {
      const sp = ws(snap.pt.x, snap.pt.y);
      ctx.setLineDash([]);

      if (snap.type === 'origin') {
        // Amber Origin Snap Double Circle with Crosshair
        ctx.strokeStyle = '#D97706';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sp.x - 8, sp.y); ctx.lineTo(sp.x + 8, sp.y);
        ctx.moveTo(sp.x, sp.y - 8); ctx.lineTo(sp.x, sp.y + 8);
        ctx.stroke();
      } else if (snap.type === 'endpoint') {
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.8;
        ctx.strokeRect(sp.x - 5, sp.y - 5, 10, 10);
      } else if (snap.type === 'midpoint') {
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - 6);
        ctx.lineTo(sp.x + 6, sp.y + 5);
        ctx.lineTo(sp.x - 6, sp.y + 5);
        ctx.closePath();
        ctx.stroke();
      } else if (snap.type === 'center') {
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#16A34A';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (snap.type === 'perpendicular' || snap.type === 'parallel' || snap.type === 'alignment') {
        ctx.strokeStyle = '#0284C7';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }



    // ─── Cursor crosshair ─────────────────────────────────────────────────────
    if (tool !== 'select') {
      const sp = ws(snap.pt.x, snap.pt.y);
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sp.x - 12, sp.y); ctx.lineTo(sp.x + 12, sp.y);
      ctx.moveTo(sp.x, sp.y - 12); ctx.lineTo(sp.x, sp.y + 12);
      ctx.stroke();
    }

    // ─── Marquee selection box ────────────────────────────────────────────────
    if (marquee) {
      ctx.strokeStyle = '#2563EB';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      // left-to-right drag: solid blue fill; right-to-left: crossing selection (lighter)
      const crossingSelect = marquee.w < 0;
      ctx.fillStyle = crossingSelect ? 'rgba(37,99,235,0.05)' : 'rgba(37,99,235,0.08)';
      const rx = marquee.w >= 0 ? marquee.x : marquee.x + marquee.w;
      const ry = marquee.h >= 0 ? marquee.y : marquee.y + marquee.h;
      const rw = Math.abs(marquee.w);
      const rh = Math.abs(marquee.h);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    // ─── Step 2: Domain Definition Dimensions & Interactive Handles ───────────
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

      // Interactive Handles in Step 2 (Domain Definition)
      if (currentStep === 2) {
        const drawHandle = (
          pt: Point2D,
          key: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial',
          tooltip: string
        ) => {
          const s = ws(pt.x, pt.y);
          const isHov = hoveredDomainHandle === key;
          const isDrag = draggingDomainHandle === key;

          ctx.save();
          if (isHov || isDrag) {
            ctx.fillStyle = 'rgba(37, 99, 235, 0.22)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.fillStyle = isDrag ? '#1D4ED8' : '#2563EB';
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, isHov || isDrag ? 6.5 : 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          if (isHov || isDrag) {
            ctx.font = 'bold 9px Inter, sans-serif';
            const tw = ctx.measureText(tooltip).width;
            ctx.fillStyle = '#171A1F';
            ctx.fillRect(s.x - tw / 2 - 4, s.y - 20, tw + 8, 14);
            ctx.fillStyle = '#FFFFFF';
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
            `Radius: ${upstreamChordFactor}c`
          );
        } else {
          drawHandle({ x: domainLeftX, y: geometryBBox.centerY }, 'upstream', `← ${upstreamChordFactor.toFixed(1)}c`);
          drawHandle({ x: domainRightX, y: geometryBBox.centerY }, 'downstream', `→ ${downstreamChordFactor.toFixed(1)}c`);
          drawHandle({ x: geometryBBox.centerX, y: domainTopY }, 'top', `↑ ${lateralHeightFactor.toFixed(1)}c`);
          drawHandle({ x: geometryBBox.centerX, y: domainBottomY }, 'bottom', `↓ ${lateralHeightFactor.toFixed(1)}c`);
        }
      }
    }

    // ─── Step 3, 4: Edge-Level Boundary Tag Highlights & Badges ──────────────
    if (currentStep >= 3) {
      // 1st pass: draw colored highlight lines and normal arrows for all edges
      for (const edge of boundaryEdges) {
        const isHovered = hoveredEdgeKey === edge.key;
        const p0 = ws(edge.p0.x, edge.p0.y);
        const p1 = ws(edge.p1.x, edge.p1.y);
        const colorConfig = BOUNDARY_COLORS[edge.tag] || BOUNDARY_COLORS.wall;

        ctx.save();
        // Thick highlight along the edge
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = isHovered ? 5.5 : 3.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();

        // Normal indicator arrow at midpoint
        const mid = ws(edge.midpoint.x, edge.midpoint.y);
        const normLen = 12;
        const normEnd = {
          x: mid.x + edge.normal.x * normLen,
          y: mid.y - edge.normal.y * normLen,
        };
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = 1.2;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(normEnd.x, normEnd.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // 2nd pass: draw ONE badge label per contiguous chain, positioned strictly OUTSIDE the domain
      const chains = getContiguousEdgeChains(boundaryEdges);

      for (const chain of chains) {
        const colorConfig = BOUNDARY_COLORS[chain.tag] || BOUNDARY_COLORS.wall;
        const mid = ws(chain.midpoint.x, chain.midpoint.y);
        const isChainHovered = chain.edges.some(e => e.key === hoveredEdgeKey);
        const badgeText = chain.tag.toUpperCase();

        ctx.save();
        ctx.font = 'bold 9px JetBrains Mono';
        const textWidth = ctx.measureText(badgeText).width;
        const bw = textWidth + 14;
        const bh = 18;

        // Position badge strictly OUTSIDE domain with a clean 18px gap from the line
        // Project the badge box half-dimensions along the normal direction
        const boxExtentAlongNormal = Math.abs(chain.outwardNormal.x) * (bw / 2) + Math.abs(chain.outwardNormal.y) * (bh / 2);
        const totalOffset = boxExtentAlongNormal + 18;

        const badgeCenter = {
          x: mid.x + chain.outwardNormal.x * totalOffset,
          y: mid.y - chain.outwardNormal.y * totalOffset,
        };

        // Draw connecting leader line from edge midpoint to badge if offset is significant
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(badgeCenter.x, badgeCenter.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Badge pill
        ctx.fillStyle = isChainHovered ? '#FFFFFF' : 'rgba(255, 255, 255, 0.96)';
        ctx.strokeStyle = colorConfig.hex;
        ctx.lineWidth = isChainHovered ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.roundRect(badgeCenter.x - bw / 2, badgeCenter.y - bh / 2, bw, bh, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = colorConfig.hex;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeCenter.x, badgeCenter.y);
        ctx.restore();
      }
    }

  }, [cadState.entities, tempPts, snap, isDrawing, pan, zoom, showGrid, showConstruction, tool, domainLength, domainHeight, marquee, currentStep, flowType, angleOfAttackDeg, freestreamVelocity, boundaryEdges, hoveredEdgeKey, geometryBBox, displayOnly, showMesh, canvasMode, meshData]);



  // ── Mouse handlers ────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const raw = toWorld(e.clientX, e.clientY);
    const s = computeSnap(raw);
    setSnap(s);

    const ang = tempPts.length > 0
      ? ((Math.atan2(s.pt.y - tempPts[tempPts.length - 1].y, s.pt.x - tempPts[tempPts.length - 1].x) * 180) / Math.PI).toFixed(1)
      : '—';
    const L = tempPts.length > 0 ? dist(tempPts[tempPts.length - 1], s.pt).toFixed(3) : '—';
    setHud({ length: L, angle: ang, x: s.pt.x.toFixed(4), y: s.pt.y.toFixed(4) });

    // Step 2 Domain Handle Hover
    if (currentStep === 2 && flowType === 'external' && !isDrawing) {
      const c = geometryBBox.chord;
      const h = geometryBBox.height;
      const effH = Math.max(0.5 * c, h);
      const lUp = upstreamChordFactor * c;
      const lDown = downstreamChordFactor * c;
      const lLat = lateralHeightFactor * effH;

      const handlePts: Record<'upstream' | 'downstream' | 'top' | 'bottom' | 'radial', Point2D> = {
        upstream: { x: geometryBBox.minX - lUp, y: geometryBBox.centerY },
        downstream: { x: geometryBBox.maxX + lDown, y: geometryBBox.centerY },
        top: { x: geometryBBox.centerX, y: geometryBBox.centerY + lLat },
        bottom: { x: geometryBBox.centerX, y: geometryBBox.centerY - lLat },
        radial: { x: geometryBBox.centerX + Math.max(lUp, lDown, lLat), y: geometryBBox.centerY },
      };

      // Skip hover detection while actively dragging
      if (!draggingDomainHandle) {
        // Check handle hover
        const hitTolerance = 14 / zoom;
        let foundHandle: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial' | null = null;
        if (domainShape === 'circle') {
          if (dist(raw, handlePts.radial) < hitTolerance) foundHandle = 'radial';
        } else {
          if (dist(raw, handlePts.upstream) < hitTolerance) foundHandle = 'upstream';
          else if (dist(raw, handlePts.downstream) < hitTolerance) foundHandle = 'downstream';
          else if (dist(raw, handlePts.top) < hitTolerance) foundHandle = 'top';
          else if (dist(raw, handlePts.bottom) < hitTolerance) foundHandle = 'bottom';
        }
        setHoveredDomainHandle(foundHandle);
      }
    } else {
      if (hoveredDomainHandle) setHoveredDomainHandle(null);
    }

    // Trim hover preview
    if (tool === 'trim') {
      const target = getTrimTarget(raw, cadState.entities, zoom);
      setHoveredTrim(target ? target.subSeg : null);
    } else if (hoveredTrim) {
      setHoveredTrim(null);
    }

    // Pan (middle mouse or Alt+drag)
    if (panning.current) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan({ x: panOrigin.current.x + dx, y: panOrigin.current.y + dy });
      return;
    }

    // Marquee update (select tool + LMB held)
    if (dragSelecting.current && tool === 'select') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = dragStart.current.x - rect.left;
      const sy = dragStart.current.y - rect.top;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setMarquee({ x: sx, y: sy, w: cx - sx, h: cy - sy });
    }
  }, [toWorld, computeSnap, tempPts, tool, cadState.entities, zoom, hoveredTrim, currentStep, flowType, isDrawing, geometryBBox, upstreamChordFactor, downstreamChordFactor, lateralHeightFactor, domainShape, draggingDomainHandle, setUpstreamChordFactor, setDownstreamChordFactor, setLateralHeightFactor, hoveredDomainHandle]);


  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Step 2: Domain Handle Drag start
    if (currentStep === 2 && hoveredDomainHandle) {
      const hasDomain = cadState.entities.some(e => e.role === 'domain_boundary');
      if (!hasDomain) {
        const newDomain = createDomainEntity(
          domainShape,
          geometryBBox,
          upstreamChordFactor,
          downstreamChordFactor,
          lateralHeightFactor
        );
        const otherEnts = cadState.entities.filter(e => e.role !== 'domain_boundary');
        dispatch({ type: 'REPLACE_ENTITIES', entities: [...otherEnts, newDomain] });
      }
      draggingDomainHandleRef.current = hoveredDomainHandle;
      setDraggingDomainHandle(hoveredDomainHandle);
      e.preventDefault();
      return;
    }

    // Middle mouse or Alt+LMB → pan
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { ...pan };
      e.preventDefault();
      return;
    }
    if (displayOnly) return;
    // LMB in select tool → begin marquee
    if (e.button === 0 && tool === 'select') {
      dragSelecting.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      setMarquee(null);
    }
  }, [pan, tool, currentStep, hoveredDomainHandle]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    panning.current = false;

    // Domain handle drag is managed by document-level listeners (draggingDomainHandleRef)
    // so we only need to handle AoA here

    if (draggingAoAHandle) {
      setDraggingAoAHandle(false);
      return;
    }

    // Finish marquee selection
    if (dragSelecting.current && tool === 'select') {
      dragSelecting.current = false;
      if (!marquee) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const o = { x: canvas.clientWidth / 2 + pan.x, y: canvas.clientHeight / 2 + pan.y };

      const toW = (sx: number, sy: number): Point2D => ({
        x: (sx - o.x) / zoom,
        y: -(sy - o.y) / zoom,
      });

      const crossing = marquee.w < 0;
      const mx = marquee.w >= 0 ? marquee.x : marquee.x + marquee.w;
      const my = marquee.h >= 0 ? marquee.y : marquee.y + marquee.h;
      const mw = Math.abs(marquee.w);
      const mh = Math.abs(marquee.h);

      // Ignore tiny accidental drags (< 4px)
      if (mw < 4 && mh < 4) {
        setMarquee(null);
        return;
      }

      const worldMin = toW(mx, my + mh);
      const worldMax = toW(mx + mw, my);

      const updated = cadState.entities.map(ent => {
        if (crossing) {
          // Crossing (right-to-left): select if ANY point is inside box
          const touches = ent.pts.some(p =>
            p.x >= worldMin.x && p.x <= worldMax.x && p.y >= worldMin.y && p.y <= worldMax.y
          );
          return { ...ent, selected: e.shiftKey ? (ent.selected || touches) : touches };
        } else {
          // Window (left-to-right): select only if ALL points are inside box
          const inside = ent.pts.every(p =>
            p.x >= worldMin.x && p.x <= worldMax.x && p.y >= worldMin.y && p.y <= worldMax.y
          );
          return { ...ent, selected: e.shiftKey ? (ent.selected || inside) : inside };
        }
      });

      dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
      const selCount = updated.filter(e => e.selected).length;
      setCmdText(`Selected ${selCount} entit${selCount === 1 ? 'y' : 'ies'}.${crossing ? ' (crossing)' : ' (window)'}`);
      setMarquee(null);
    }
  }, [tool, marquee, cadState.entities, pan, zoom]);



  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const c = canvasRef.current;
    if (c) {
      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const originX = c.clientWidth / 2 + pan.x;
      const originY = c.clientHeight / 2 + pan.y;

      const newZoom = Math.max(0.5, Math.min(25000, zoom * factor));
      const zoomRatio = newZoom / zoom;

      // Pin mouse pointer in world coordinates during zoom
      const newPanX = mouseX - c.clientWidth / 2 - (mouseX - originX) * zoomRatio;
      const newPanY = mouseY - c.clientHeight / 2 - (mouseY - originY) * zoomRatio;

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    } else {
      setZoom(z => Math.max(0.5, Math.min(25000, z * factor)));
    }
  }, [pan, zoom]);

  /** Find entity closest to raw world point */
  const findEntityAt = useCallback((rawPt: Point2D): string | null => {
    const hitR = 14 / zoom;
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const ent of cadState.entities) {
      if (ent.pts.length === 0) continue;
      for (let i = 0; i < ent.pts.length - 1; i++) {
        const d = distToSegment(rawPt, ent.pts[i], ent.pts[i + 1]);
        if (d < hitR && d < bestD) { bestD = d; bestId = ent.id; }
      }
      if (ent.isClosed && ent.pts.length >= 3) {
        const d = distToSegment(rawPt, ent.pts[ent.pts.length - 1], ent.pts[0]);
        if (d < hitR && d < bestD) { bestD = d; bestId = ent.id; }
      }
      if (ent.type === 'circle' && ent.pts.length >= 2) {
        const r = ent.radius ?? dist(ent.pts[0], ent.pts[1]);
        const radialD = Math.abs(dist(rawPt, ent.pts[0]) - r);
        if (radialD < hitR && radialD < bestD) { bestD = radialD; bestId = ent.id; }
      }
      for (const p of ent.pts) {
        const d = dist(rawPt, p);
        if (d < hitR && d < bestD) { bestD = d; bestId = ent.id; }
      }
    }
    return bestId;
  }, [cadState.entities, zoom]);

  const openDimPromptForEntity = useCallback((ent: CadEntity) => {
    if (ent.type === 'line' && ent.pts.length === 2) {
      const p0 = ent.pts[0], p1 = ent.pts[1];
      const len = dist(p0, p1);
      const ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
      setDimPrompt({
        entityId: ent.id,
        type: 'line',
        worldPos: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 },
        val1: len.toFixed(4),
        val2: ang.toFixed(1),
        label1: 'L',
        label2: '∠',
        basePt: p0,
        endPt: p1,
        layer: ent.layer,
      });
      setInputVal1(len.toFixed(4));
      setInputVal2(ang.toFixed(1));
    } else if (ent.type === 'circle' && ent.pts.length >= 1) {
      const c = ent.pts[0];
      const r = ent.radius ?? (ent.pts[1] ? dist(c, ent.pts[1]) : 1);
      setDimPrompt({
        entityId: ent.id,
        type: 'circle',
        worldPos: { x: c.x + r * 0.707, y: c.y + r * 0.707 },
        val1: r.toFixed(4),
        val2: (r * 2).toFixed(4),
        label1: 'R',
        label2: 'Ø',
        basePt: c,
        endPt: ent.pts[1] || { x: c.x + r, y: c.y },
        layer: ent.layer,
      });
      setInputVal1(r.toFixed(4));
      setInputVal2((r * 2).toFixed(4));
    } else if (ent.type === 'rectangle' && ent.pts.length >= 3) {
      const p0 = ent.pts[0], p2 = ent.pts[2];
      const w = Math.abs(p2.x - p0.x);
      const h = Math.abs(p2.y - p0.y);
      setDimPrompt({
        entityId: ent.id,
        type: 'rectangle',
        worldPos: { x: (p0.x + p2.x) / 2, y: (p0.y + p2.y) / 2 },
        val1: w.toFixed(4),
        val2: h.toFixed(4),
        label1: 'W',
        label2: 'H',
        basePt: p0,
        endPt: p2,
        layer: ent.layer,
      });
      setInputVal1(w.toFixed(4));
      setInputVal2(h.toFixed(4));
    } else if (ent.type === 'arc' && ent.pts.length >= 3) {
      const [c, s, e] = ent.pts;
      const r = dist(c, s);
      const sa = ent.startAngle ?? Math.atan2(s.y - c.y, s.x - c.x);
      const ea = ent.endAngle ?? Math.atan2(e.y - c.y, e.x - c.x);
      const sweepDeg = ((ea - sa) * 180 / Math.PI + 360) % 360;
      setDimPrompt({
        entityId: ent.id,
        type: 'arc',
        worldPos: { x: (c.x + e.x) / 2, y: (c.y + e.y) / 2 },
        val1: r.toFixed(4),
        val2: sweepDeg.toFixed(1),
        label1: 'R',
        label2: '∠',
        basePt: c,
        endPt: e,
        layer: ent.layer,
      });
      setInputVal1(r.toFixed(4));
      setInputVal2(sweepDeg.toFixed(1));
    }
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (displayOnly) return;
    const rawPt = toWorld(e.clientX, e.clientY);
    const clickedId = findEntityAt(rawPt);
    if (clickedId) {
      const ent = cadState.entities.find(el => el.id === clickedId);
      if (ent) {
        dispatch({ type: 'SELECT_ENTITY', id: clickedId });
        openDimPromptForEntity(ent);
        setTool('select');
        setCmdText('Edit dimensions with Tab+Enter, or Esc to close.');
        return;
      }
    }
    // Double click on empty space -> center to origin
    setPan({ x: 0, y: 0 });
    setZoom(INITIAL_ZOOM);
    setCmdText('View centered to origin (0, 0).');
  }, [toWorld, findEntityAt, cadState.entities, openDimPromptForEntity]);



  const commitDimension = useCallback((prompt: DynamicDimPrompt, val1Str: string, val2Str?: string) => {
    const v1 = parseFloat(val1Str);
    const v2 = val2Str !== undefined ? parseFloat(val2Str) : NaN;
    if (isNaN(v1) || v1 <= 0) {
      setDimPrompt(null);
      return;
    }

    const { entityId, type, basePt, endPt } = prompt;

    if (type === 'line' && endPt) {
      const currentAng = Math.atan2(endPt.y - basePt.y, endPt.x - basePt.x);
      const rad = !isNaN(v2) ? (v2 * Math.PI) / 180 : currentAng;
      const newEnd: Point2D = {
        x: +(basePt.x + v1 * Math.cos(rad)).toFixed(5),
        y: +(basePt.y + v1 * Math.sin(rad)).toFixed(5),
      };
      dispatch({
        type: 'REPLACE_ENTITIES',
        entities: cadState.entities.map(e =>
          e.id === entityId ? { ...e, pts: [basePt, newEnd] } : e
        ),
      });
      // Shift start point of next chained line to the updated endpoint
      setTempPts(prev => {
        if (prev.length > 0 && dist(prev[prev.length - 1], endPt) < 1e-3) {
          return [newEnd];
        }
        return prev;
      });
      setCmdText(`Line dimensioned: L=${v1}m, ∠=${(!isNaN(v2) ? v2 : (currentAng * 180 / Math.PI)).toFixed(1)}°`);
    } else if (type === 'rectangle' && endPt) {
      const w = v1 * Math.sign(endPt.x - basePt.x || 1);
      const h = (!isNaN(v2) && v2 > 0 ? v2 : Math.abs(endPt.y - basePt.y)) * Math.sign(endPt.y - basePt.y || 1);
      const p0 = basePt;
      const p1 = { x: +(p0.x + w).toFixed(5), y: p0.y };
      const p2 = { x: +(p0.x + w).toFixed(5), y: +(p0.y + h).toFixed(5) };
      const p3 = { x: p0.x, y: +(p0.y + h).toFixed(5) };
      dispatch({
        type: 'REPLACE_ENTITIES',
        entities: cadState.entities.map(e =>
          e.id === entityId ? { ...e, pts: [p0, p1, p2, p3] } : e
        ),
      });
      setCmdText(`Rectangle dimensioned: W=${Math.abs(w)}m, H=${Math.abs(h)}m`);
    } else if (type === 'circle') {
      const r = v1;
      dispatch({
        type: 'REPLACE_ENTITIES',
        entities: cadState.entities.map(e =>
          e.id === entityId ? { ...e, radius: r, pts: [basePt, { x: basePt.x + r, y: basePt.y }] } : e
        ),
      });
      setCmdText(`Circle dimensioned: R=${r}m (Ø=${(r * 2).toFixed(3)}m)`);
    } else if (type === 'arc' && endPt) {
      const r = v1;
      const sa = Math.atan2(endPt.y - basePt.y, endPt.x - basePt.x);
      const sweepRad = !isNaN(v2) ? (v2 * Math.PI) / 180 : Math.PI / 2;
      const ea = sa + sweepRad;
      const p1 = { x: +(basePt.x + r * Math.cos(sa)).toFixed(5), y: +(basePt.y + r * Math.sin(sa)).toFixed(5) };
      const p2 = { x: +(basePt.x + r * Math.cos(ea)).toFixed(5), y: +(basePt.y + r * Math.sin(ea)).toFixed(5) };
      dispatch({
        type: 'REPLACE_ENTITIES',
        entities: cadState.entities.map(e =>
          e.id === entityId ? { ...e, pts: [basePt, p1, p2], startAngle: sa, endAngle: ea } : e
        ),
      });
      setCmdText(`Arc dimensioned: R=${r}m, ∠=${(!isNaN(v2) ? v2 : 90).toFixed(1)}°`);
    }

    setDimPrompt(null);
  }, [cadState.entities]);

  // Autofocus the first dimension field whenever a dimension prompt opens
  useEffect(() => {
    if (dimPrompt) {
      const timer = setTimeout(() => {
        input1Ref.current?.focus();
        input1Ref.current?.select();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [dimPrompt?.entityId]);

  const handleDimKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      if (document.activeElement === input1Ref.current && input2Ref.current) {
        input2Ref.current.focus();
        input2Ref.current.select();
      } else if (input1Ref.current) {
        input1Ref.current.focus();
        input1Ref.current.select();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (dimPrompt) {
        commitDimension(dimPrompt, inputVal1, inputVal2);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDimPrompt(null);
    }
  };

  const commitPoint = useCallback((pt: Point2D) => {
    const layer = constructionMode ? 'construction' : 'default';

    if (tool === 'line') {
      if (!isDrawing) {
        setTempPts([pt]);
        setIsDrawing(true);
        setDimPrompt(null);
        setCmdText('LINE: Pick second point (or press Esc to cancel)');
      } else {
        const newId = uid();
        const p0 = tempPts[0];
        dispatch({ type: 'ADD_ENTITY', entity: { id: newId, type: 'line', layer, pts: [p0, pt] } });
        const len = dist(p0, pt);
        const ang = (Math.atan2(pt.y - p0.y, pt.x - p0.x) * 180) / Math.PI;
        setDimPrompt({
          entityId: newId,
          type: 'line',
          worldPos: { x: (p0.x + pt.x) / 2, y: (p0.y + pt.y) / 2 },
          val1: len.toFixed(4),
          val2: ang.toFixed(1),
          label1: 'L',
          label2: '∠',
          basePt: p0,
          endPt: pt,
          layer,
        });
        setInputVal1(len.toFixed(4));
        setInputVal2(ang.toFixed(1));
        setTempPts([pt]); // chain: start next line from here
        setCmdText('LINE: Type Length, press Tab for Angle, Enter to commit.');
      }
    } else if (tool === 'polyline') {
      if (!isDrawing) {
        setTempPts([pt]);
        setIsDrawing(true);
        setDimPrompt(null);
        setCmdText('POLYLINE: Pick next vertex (click near start to close)');
      } else {
        const s = tempPts[0];
        if (tempPts.length >= 2 && dist(pt, s) < 12 / zoom) {
          dispatch({ type: 'ADD_ENTITY', entity: { id: uid(), type: 'polyline', layer, pts: tempPts, isClosed: true } });
          setIsDrawing(false); setTempPts([]); setDimPrompt(null);
          setCmdText('POLYLINE: Closed. Pick first point for next polyline.');
        } else {
          setTempPts(prev => [...prev, pt]);
        }
      }
    } else if (tool === 'rectangle') {
      if (!isDrawing) {
        setTempPts([pt]);
        setIsDrawing(true);
        setDimPrompt(null);
        setCmdText('RECTANGLE: Pick opposite corner');
      } else {
        const p0 = tempPts[0];
        const newId = uid();
        const w = +(pt.x - p0.x).toFixed(5);
        const h = +(pt.y - p0.y).toFixed(5);
        dispatch({ type: 'ADD_ENTITY', entity: { id: newId, type: 'rectangle', layer, pts: [p0, { x: pt.x, y: p0.y }, pt, { x: p0.x, y: pt.y }], isClosed: true } });
        setDimPrompt({
          entityId: newId,
          type: 'rectangle',
          worldPos: { x: (p0.x + pt.x) / 2, y: (p0.y + pt.y) / 2 },
          val1: Math.abs(w).toFixed(4),
          val2: Math.abs(h).toFixed(4),
          label1: 'W',
          label2: 'H',
          basePt: p0,
          endPt: pt,
          layer,
        });
        setInputVal1(Math.abs(w).toFixed(4));
        setInputVal2(Math.abs(h).toFixed(4));
        setIsDrawing(false); setTempPts([]);
        setCmdText('RECTANGLE: Type Width, press Tab for Height, Enter to commit.');
      }
    } else if (tool === 'circle_center_radius') {
      if (!isDrawing) {
        setTempPts([pt]);
        setIsDrawing(true);
        setDimPrompt(null);
        setCmdText('CIRCLE: Pick point on circumference');
      } else {
        const c = tempPts[0];
        const r = dist(c, pt);
        const newId = uid();
        dispatch({ type: 'ADD_ENTITY', entity: { id: newId, type: 'circle', layer, pts: [c, pt], radius: r, isClosed: true } });
        setDimPrompt({
          entityId: newId,
          type: 'circle',
          worldPos: { x: c.x + r * 0.707, y: c.y + r * 0.707 },
          val1: r.toFixed(4),
          val2: (r * 2).toFixed(4),
          label1: 'R',
          label2: 'Ø',
          basePt: c,
          endPt: pt,
          layer,
        });
        setInputVal1(r.toFixed(4));
        setInputVal2((r * 2).toFixed(4));
        setIsDrawing(false); setTempPts([]);
        setCmdText('CIRCLE: Type Radius, press Enter to commit.');
      }
    } else if (tool === 'arc_center') {
      if (tempPts.length === 0) {
        setTempPts([pt]); setIsDrawing(true);
        setDimPrompt(null);
        setCmdText('ARC: Pick start point on arc');
      } else if (tempPts.length === 1) {
        setTempPts(prev => [...prev, pt]);
        setCmdText('ARC: Pick end point on arc');
      } else {
        const [c, s, _] = tempPts;
        const sa = Math.atan2(s.y - c.y, s.x - c.x);
        const ea = Math.atan2(pt.y - c.y, pt.x - c.x);
        const r = dist(c, s);
        const sweepDeg = ((ea - sa) * 180 / Math.PI + 360) % 360;
        const newId = uid();
        dispatch({ type: 'ADD_ENTITY', entity: { id: newId, type: 'arc', layer, pts: [c, s, pt], startAngle: sa, endAngle: ea } });
        setDimPrompt({
          entityId: newId,
          type: 'arc',
          worldPos: { x: (c.x + pt.x) / 2, y: (c.y + pt.y) / 2 },
          val1: r.toFixed(4),
          val2: sweepDeg.toFixed(1),
          label1: 'R',
          label2: '∠',
          basePt: c,
          endPt: pt,
          layer,
        });
        setInputVal1(r.toFixed(4));
        setInputVal2(sweepDeg.toFixed(1));
        setIsDrawing(false); setTempPts([]);
        setCmdText('ARC: Type Radius, press Tab for Angle, Enter to commit.');
      }
    } else if (tool === 'construction_line') {
      if (!isDrawing) {
        setTempPts([pt]); setIsDrawing(true);
        setDimPrompt(null);
        setCmdText('XLINE: Pick second point to define infinite construction line direction');
      } else {
        dispatch({ type: 'ADD_ENTITY', entity: { id: uid(), type: 'construction', layer: 'construction', pts: [tempPts[0], pt] } });
        setIsDrawing(false); setTempPts([]);
        setCmdText('XLINE: Pick first point');
      }
    }
  }, [tool, isDrawing, tempPts, zoom, constructionMode]);


  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (displayOnly) return;
    if (panning.current) return;
    if (e.button !== 0) return;

    // If this click ended a marquee drag, don't also do a point-click action
    const dragDist = Math.hypot(e.clientX - dragStart.current.x, e.clientY - dragStart.current.y);
    if (tool === 'select' && dragDist > 4) return;

    const rawPt = toWorld(e.clientX, e.clientY);
    const snapPt = snap.pt;
    const hitR = 14 / zoom; // 14px pick tolerance in world coordinates

    if (currentStep === 3) {
      for (const edge of boundaryEdges) {
        const d = distToSegment(rawPt, edge.p0, edge.p1);
        if (d < 18 / zoom) {
          setEdgeTagMap(prev => ({ ...prev, [edge.key]: activeTagTool }));
          setCmdText(`TAGGED: Boundary segment assigned as ${activeTagTool.toUpperCase()}.`);
          return;
        }
      }
    }

    if (tool === 'select') {
      const clickedId = findEntityAt(rawPt);
      dispatch({ type: 'SELECT_ENTITY', id: clickedId, multi: e.shiftKey });
      setDimPrompt(null);
      setCmdText(clickedId ? 'Entity selected. Double-click to edit dimensions, or Del to delete.' : 'SELECT: Click entity or drag box to select.');
      return;
    }




    if (tool === 'trim') {
      const target = getTrimTarget(rawPt, cadState.entities, zoom);
      if (!target) {
        setCmdText('TRIM: Click on a line or intersection to trim.');
        return;
      }

      const { targetEnt, targetSegIdx, preservedSegs } = target;
      const otherEntities = cadState.entities.filter(e => e.id !== targetEnt.id);
      const newSegments: CadEntity[] = [];

      // If targetEnt was a multi-segment polyline/rectangle, preserve all other unmodified segments as individual lines
      if (targetEnt.pts.length > 2) {
        for (let i = 0; i < targetEnt.pts.length - 1; i++) {
          if (i !== targetSegIdx) {
            newSegments.push({ id: uid(), type: 'line', layer: targetEnt.layer, pts: [targetEnt.pts[i], targetEnt.pts[i + 1]] });
          }
        }
        if (targetEnt.isClosed && targetSegIdx !== targetEnt.pts.length - 1) {
          newSegments.push({ id: uid(), type: 'line', layer: targetEnt.layer, pts: [targetEnt.pts[targetEnt.pts.length - 1], targetEnt.pts[0]] });
        }
      }

      // Add the preserved sub-segments
      for (const seg of preservedSegs) {
        newSegments.push({ id: uid(), type: 'line', layer: targetEnt.layer, pts: [seg.p0, seg.p1] });
      }

      dispatch({ type: 'REPLACE_ENTITIES', entities: [...otherEntities, ...newSegments] });
      setHoveredTrim(null);
      setCmdText('TRIM: Portion trimmed at intersection.');
      return;
    }


    commitPoint(snapPt);
  }, [snap, tool, cadState.entities, commitPoint, zoom, toWorld]);



  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isDrawing || tempPts.length > 0) {
        setIsDrawing(false);
        setTempPts([]);
        setCmdText(`${tool.toUpperCase()}: Cancelled. Press Esc again to return to Select.`);
      } else {
        // Nothing in progress -> return to select tool and clear any active selection
        dispatch({ type: 'SELECT_ENTITY', id: null });
        setTool('select');
        setCmdText('SELECT: Click entity/vertex or drag box to select.');
      }
    }

    if (e.key === 'Enter' || e.key === ' ') {
      // End polyline without closing, or confirm
      if (tool === 'polyline' && isDrawing && tempPts.length >= 2) {
        const layer = constructionMode ? 'construction' : 'default';
        dispatch({ type: 'ADD_ENTITY', entity: { id: uid(), type: 'polyline', layer, pts: tempPts, isClosed: false } });
        setIsDrawing(false); setTempPts([]);
        setCmdText('POLYLINE: Done. Pick first point.');
      }
      if (tool === 'line' && isDrawing) {
        setIsDrawing(false); setTempPts([]);
        setCmdText('LINE: Done. Pick start point.');
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { dispatch({ type: 'DELETE_SELECTED' }); }
    if (e.key === 'F8') setOrtho(o => !o);
    if (e.key === 'F3') setSnapEnabled(s => !s);
    if (e.key === 'F7') setShowGrid(g => !g);
    if (e.key === 'l' || e.key === 'L') { setTool('line'); setIsDrawing(false); setTempPts([]); }
    if (e.key === 'p' || e.key === 'P') { setTool('polyline'); setIsDrawing(false); setTempPts([]); }
    if (e.key === 'r' || e.key === 'R') { setTool('rectangle'); setIsDrawing(false); setTempPts([]); }
    if (e.key === 'c' || e.key === 'C') { setTool('circle_center_radius'); setIsDrawing(false); setTempPts([]); }
    if (e.key === 'a' || e.key === 'A') { setTool('arc_center'); setIsDrawing(false); setTempPts([]); }
    if (e.key === 's' || e.key === 'S') { setTool('select'); setIsDrawing(false); setTempPts([]); }
    if (e.key === 't' || e.key === 'T') { setTool('trim'); setIsDrawing(false); setTempPts([]); }
  }, [tool, isDrawing, tempPts, constructionMode, undo, redo]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Handle file import from Left Panel ───────────────────────────────────────
  useEffect(() => {
    if (!pendingImportFile) return;
    const load = async () => {
      setIsLoading(true);
      try {
        if (pendingImportFile.type === 'parsed') {
          const pts = pendingImportFile.points;
          const segments = pointsToLineSegments(pts, 'geometry');
          dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
          setCadName(pendingImportFile.name);
          setCmdText(`Imported: ${pendingImportFile.name} (closed airfoil profile)`);
          setPan({ x: -120, y: 0 });
          setZoom(240);
        } else if (pendingImportFile.type === 'airfoil' && pendingImportFile.file) {
          const res = await uploadAndParseAirfoil(pendingImportFile.file);
          const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
          const segments = pointsToLineSegments(pts, 'geometry');
          dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
          setCadName(res.name || pendingImportFile.file.name);
          setCmdText(`Imported: ${res.name} (closed airfoil profile)`);
          setPan({ x: -120, y: 0 });
          setZoom(240);
        } else if (pendingImportFile.type === 'url' && pendingImportFile.url) {
          const res = await fetchAndParseAirfoilFromUrl(pendingImportFile.url);
          const pts: Point2D[] = res.points.map(([x, y]: number[]) => ({ x, y }));
          const segments = pointsToLineSegments(pts, 'geometry');
          dispatch({ type: 'REPLACE_ENTITIES', entities: segments });
          setCadName(res.name || 'Airfoil from Link');
          setCmdText(`Imported from Link: ${res.name} (closed airfoil profile)`);
          setPan({ x: -120, y: 0 });
          setZoom(240);
        } else if (pendingImportFile.type === 'dxf' && pendingImportFile.file) {
          const res = await uploadAndParseDxf(pendingImportFile.file);
          const newEnts: CadEntity[] = [];
          for (const p of (res.polylines || [])) {
            const pts: Point2D[] = p.points.map(([x, y]: number[]) => ({ x, y }));
            newEnts.push({ id: uid(), type: 'polyline', layer: 'default', pts, isClosed: p.is_closed });
          }
          for (const l of (res.lines || [])) {
            newEnts.push({ id: uid(), type: 'line', layer: 'default', pts: [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }] });
          }
          if (newEnts.length) {
            dispatch({ type: 'REPLACE_ENTITIES', entities: newEnts });
            setCadName(pendingImportFile.file.name);
            setCmdText(`Imported DXF: ${newEnts.length} entities`);
          }
        }
      } catch (err: any) {
        setCmdText(`Import error: ${err.message}`);
      }
      setIsLoading(false);
      onClearPendingImport?.();
    };
    load();
  }, [pendingImportFile, onClearPendingImport]);


  // ── Apply fillet ─────────────────────────────────────────────────────────────
  const applyFillet = async () => {
    setIsLoading(true);
    const updated = [...cadState.entities];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].pts.length >= 3) {
        try {
          const res = await requestFillet(updated[i].pts.map(p => [p.x, p.y]), filletR);
          updated[i] = { ...updated[i], pts: res.map(([x, y]: number[]) => ({ x, y })) };
        } catch { /* skip */ }
      }
    }
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`Fillet R=${filletR}m applied.`);
    setIsLoading(false);
  };

  const applyOffset = async () => {
    setIsLoading(true);
    const updated = [...cadState.entities];
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].pts.length >= 2) {
        try {
          const res = await requestOffset(updated[i].pts.map(p => [p.x, p.y]), offsetD);
          updated[i] = { ...updated[i], pts: res.map(([x, y]: number[]) => ({ x, y })) };
        } catch { /* skip */ }
      }
    }
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`Offset ${offsetD}m applied.`);
    setIsLoading(false);
  };

  // ── 6-Step Workflow Actions ──────────────────────────────────────────────────

  const handleGenerateDomain = useCallback(() => {
    const existingDomain = cadState.entities.find(e => e.role === 'domain_boundary');
    const newDomain = createDomainEntity(
      domainShape,
      geometryBBox,
      upstreamChordFactor,
      downstreamChordFactor,
      lateralHeightFactor,
      existingDomain?.id
    );
    const otherEnts = cadState.entities.filter(e => e.role !== 'domain_boundary');
    dispatch({ type: 'REPLACE_ENTITIES', entities: [...otherEnts, newDomain] });
    setCmdText(`DOMAIN: Generated ${domainShape.toUpperCase().replace('_', '-')} domain (←${upstreamChordFactor}c, →${downstreamChordFactor}c, ↕${lateralHeightFactor}c).`);

    // Auto-fit camera so the generated domain completely comes into picture
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of newDomain.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX !== Infinity) {
      fitBoundingBox({ minX, maxX, minY, maxY }, 0.70);
    }

    // Subtle outward expansion animation
    setDomainAnimScale(0.85);
    const start = performance.now();
    const duration = 260;
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      // Cubic ease out
      const ease = 1 - Math.pow(1 - progress, 3);
      setDomainAnimScale(0.85 + 0.15 * ease);
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  }, [domainShape, geometryBBox, upstreamChordFactor, downstreamChordFactor, lateralHeightFactor, cadState.entities, fitBoundingBox]);

  const handleSetSelectedAsDomain = useCallback(() => {
    const sel = cadState.entities.find(e => e.selected);
    if (!sel) {
      setCmdText('DOMAIN: Please select a drawn entity first, then click "Set as Domain".');
      return;
    }
    const updated = cadState.entities.map(e => ({
      ...e,
      role: e.id === sel.id ? ('domain_boundary' as const) : (e.role === 'domain_boundary' ? ('geometry' as const) : e.role),
    }));
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`DOMAIN: Selected entity tagged as Fluid Domain Boundary.`);
  }, [cadState.entities]);

  const handleSetSelectedAsGeometry = useCallback(() => {
    const selectedCount = cadState.entities.filter(e => e.selected).length;
    if (selectedCount === 0) {
      setCmdText('GEOMETRY: Select one or more curves/entities on canvas first, then click "Set Selected as Geometry".');
      return;
    }
    const updated = cadState.entities.map(e => {
      if (e.selected) {
        return { ...e, role: 'geometry' as const, layer: 'geometry' as const };
      }
      return e;
    });
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`GEOMETRY: ${selectedCount} entity/entities designated as CFD Obstacle Geometry.`);
  }, [cadState.entities]);

  const handleSelectAllGeometry = useCallback(() => {
    const geomCount = cadState.entities.filter(e => e.layer !== 'construction' && e.role !== 'domain_boundary').length;
    if (geomCount === 0) {
      setCmdText('GEOMETRY: No obstacle geometry found on canvas.');
      return;
    }
    const updated = cadState.entities.map(e => ({
      ...e,
      selected: e.layer !== 'construction' && e.role !== 'domain_boundary',
    }));
    dispatch({ type: 'REPLACE_ENTITIES', entities: updated });
    setCmdText(`GEOMETRY: Selected ${geomCount} obstacle entities on canvas.`);
  }, [cadState.entities]);

  const handleClearGeometry = useCallback(() => {
    const remaining = cadState.entities.filter(e => e.role === 'domain_boundary');
    dispatch({ type: 'REPLACE_ENTITIES', entities: remaining });
    setCmdText('GEOMETRY: Cleared all obstacle geometry from canvas.');
  }, [cadState.entities]);

  const handleAutoSuggestTags = useCallback(() => {
    const suggested = autoSuggestBoundaryTags(boundaryEdges, angleOfAttackDeg, flowType);
    setEdgeTagMap(prev => ({ ...prev, ...suggested }));
    setCmdText(`TAGGING: Auto-suggested boundary conditions for AoA = ${angleOfAttackDeg.toFixed(1)}°.`);
  }, [boundaryEdges, angleOfAttackDeg, flowType]);

  const handleMeshHandoff = useCallback(async () => {
    const geomProfile = cadState.entities.find(e => e.layer !== 'construction' && e.role !== 'domain_boundary' && e.pts.length >= 2);
    if (!geomProfile && flowType === 'external') {
      setCmdText('ERROR: No obstacle geometry profile found in canvas.');
      return;
    }
    setIsLoading(true);
    setCmdText('Extruding 2D sketch to OpenFOAM 2D mesh (1 cell in Z)...');
    try {
      const pts = geomProfile ? geomProfile.pts.map(p => [p.x, p.y]) : [[0, 0], [1, 0], [1, 0.2], [0, 0.2]];
      const mesh = await requestMeshFromSketch({
        sketch_points: pts,
        domain_length: domainLength,
        domain_height: domainHeight,
        resolution,
        first_layer_mm: firstLayerMm,
      });
      onApplySketchMesh(mesh, cadName);
      setCmdText(`Mesh ready: ${mesh.num_nodes} nodes, ${mesh.num_elements} elements.`);
    } catch (err: any) {
      setCmdText(`Meshing error: ${err.message}`);
    }
    setIsLoading(false);
  }, [cadState.entities, flowType, domainLength, domainHeight, resolution, firstLayerMm, onApplySketchMesh, cadName]);

  const handleDownloadBlockMeshDict = useCallback(() => {
    const content = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2312                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}
// Flow Type: ${flowType.toUpperCase()}
// Angle of Attack: ${angleOfAttackDeg.toFixed(2)} deg
// Freestream Velocity: ${freestreamVelocity.toFixed(2)} m/s

convertToMeters 1.0;

vertices
(
    // 2D Extruded 1-cell in Z (-0.05 to +0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.minY.toFixed(4)} -0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.minY.toFixed(4)} -0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)} -0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)} -0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.minY.toFixed(4)}  0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.minY.toFixed(4)}  0.05)
    (${geometryBBox.maxX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)}  0.05)
    (${geometryBBox.minX.toFixed(4)} ${geometryBBox.maxY.toFixed(4)}  0.05)
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (100 50 1) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    inlet
    {
        type patch;
        faces
        (
            (0 4 7 3)
        );
    }
    outlet
    {
        type patch;
        faces
        (
            (1 2 6 5)
        );
    }
    walls
    {
        type wall;
        faces
        (
            (0 1 5 4)
            (3 7 6 2)
        );
    }
    frontAndBack
    {
        type empty;
        faces
        (
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);
`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'blockMeshDict';
    a.click();
    URL.revokeObjectURL(url);
    setCmdText('EXPORT: Downloaded OpenFOAM blockMeshDict.');
  }, [flowType, angleOfAttackDeg, freestreamVelocity, geometryBBox]);

  // Synchronize actions to parent refs for LeftStagePanel triggers
  useEffect(() => {
    if (onRequestGenerateDomainRef) onRequestGenerateDomainRef.current = handleGenerateDomain;
    if (onRequestSetSelectedAsDomainRef) onRequestSetSelectedAsDomainRef.current = handleSetSelectedAsDomain;
    if (onRequestSetSelectedAsGeometryRef) onRequestSetSelectedAsGeometryRef.current = handleSetSelectedAsGeometry;
    if (onRequestSelectAllGeometryRef) onRequestSelectAllGeometryRef.current = handleSelectAllGeometry;
    if (onRequestClearGeometryRef) onRequestClearGeometryRef.current = handleClearGeometry;
    if (onRequestAutoSuggestTagsRef) onRequestAutoSuggestTagsRef.current = handleAutoSuggestTags;
    if (onRequestMeshHandoffRef) onRequestMeshHandoffRef.current = handleMeshHandoff;
    if (onRequestDownloadBlockMeshDictRef) onRequestDownloadBlockMeshDictRef.current = handleDownloadBlockMeshDict;
  });

  // ── Toolbar button helper ─────────────────────────────────────────────────────
  const Btn = ({ t, icon, label, kbd }: { t: CadTool; icon: React.ReactNode; label: string; kbd?: string }) => (

    <button
      title={`${label}${kbd ? ` [${kbd}]` : ''}`}
      onClick={() => { setTool(t); setIsDrawing(false); setTempPts([]); setCmdText(`${label}: ${prompt_for(t)}`); }}
      className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-medium transition-colors min-w-[42px] ${
        tool === t
          ? 'bg-[#2563EB] text-white shadow-sm'
          : 'text-[#69717D] hover:bg-white hover:text-[#171A1F]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const prompt_for = (t: CadTool) => {
    const m: Partial<Record<CadTool, string>> = {
      select: 'click entity/vertex or drag box',
      line: 'pick first point',
      polyline: 'pick first vertex',
      rectangle: 'pick first corner',
      circle_center_radius: 'pick center',
      arc_center: 'pick center',
      construction_line: 'pick first point',
      trim: 'click line to trim at intersection',
    };
    return m[t] ?? '';
  };

  const selectedCount = cadState.entities.filter(e => e.selected).length;

  return (
    <div className="w-full h-full flex flex-col bg-white overflow-hidden" style={{ fontFamily: 'Inter, sans-serif' }}>

      {/* ═══════════════════════════════ CAD TOOLBAR ═══════════════════════════════ */}
      <div className={`shrink-0 bg-[#F5F6F8] border-b border-[#E1E4E8] px-2 py-1 flex items-center gap-1 flex-wrap ${displayOnly ? 'hidden' : ''}`}>

        {/* ── File/Edit Group ────── */}
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <button title="Undo [Ctrl+Z]" onClick={undo} className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors">
            <Undo2 className="w-4 h-4" />
          </button>
          <button title="Redo [Ctrl+Y]" onClick={redo} className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors">
            <Redo2 className="w-4 h-4" />
          </button>
          <button title="Delete Selected [Del]" onClick={() => dispatch({ type: 'DELETE_SELECTED' })} disabled={selectedCount === 0}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#DC2626] disabled:opacity-30 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
          <button title="Clear All" onClick={() => { dispatch({ type: 'CLEAR' }); setCmdText('Canvas cleared.'); }}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#DC2626] transition-colors">
            <Eraser className="w-4 h-4" />
          </button>
        </div>

        {/* ── Select Group ──────── */}
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <Btn t="select" icon={<MousePointer2 className="w-4 h-4" />} label="Select" kbd="S" />
        </div>

        {/* ── Create Group ─────── */}
        <span className="text-[9px] font-semibold text-[#A5ACB5] uppercase tracking-wider px-1">Draw</span>
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <Btn t="line"                icon={<Minus className="w-4 h-4" />}           label="Line"    kbd="L" />
          <Btn t="polyline"            icon={<ArrowUpRight className="w-4 h-4" />}    label="Pline"   kbd="P" />
          <Btn t="rectangle"           icon={<Square className="w-4 h-4" />}          label="Rect"    kbd="R" />
          <Btn t="circle_center_radius" icon={<Circle className="w-4 h-4" />}         label="Circle"  kbd="C" />
          <Btn t="arc_center"          icon={<TriangleRight className="w-4 h-4" />}   label="Arc"     kbd="A" />
          <Btn t="construction_line"   icon={<ScanLine className="w-4 h-4" />}        label="XLine"   />
        </div>

        {/* ── Modify Group ────── */}
        <span className="text-[9px] font-semibold text-[#A5ACB5] uppercase tracking-wider px-1">Modify</span>
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <button title="Fillet" onClick={applyFillet} disabled={isLoading}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${isLoading ? 'opacity-40' : 'text-[#69717D] hover:bg-white hover:text-[#171A1F]'}`}>
            <CornerUpRight className="w-4 h-4" />
            <span>Fillet</span>
          </button>
          <button title="Offset" onClick={applyOffset} disabled={isLoading}
            className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-medium transition-colors ${isLoading ? 'opacity-40' : 'text-[#69717D] hover:bg-white hover:text-[#171A1F]'}`}>
            <Maximize2 className="w-4 h-4" />
            <span>Offset</span>
          </button>
          <Btn t="trim" icon={<Scissors className="w-4 h-4" />} label="Trim" kbd="T" />
        </div>

        {/* ── Modify Params ──── */}
        <div className="flex items-center gap-2 text-[10px] font-mono text-[#69717D] pr-2 border-r border-[#E1E4E8] mr-1">
          <label className="flex items-center gap-1">
            R: <input type="number" step="0.005" value={filletR} onChange={e => setFilletR(+e.target.value)}
              className="w-14 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-right text-[#171A1F] font-mono text-[10px]" />
          </label>
          <label className="flex items-center gap-1">
            Δd: <input type="number" step="0.005" value={offsetD} onChange={e => setOffsetD(+e.target.value)}
              className="w-14 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-right text-[#171A1F] font-mono text-[10px]" />
          </label>
        </div>

        {/* ── View Controls ──── */}
        <div className="flex items-center gap-0.5 pr-2 border-r border-[#E1E4E8] mr-1">
          <button title="Zoom In" onClick={() => setZoom(z => Math.min(25000, z * 1.35))}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button title="Zoom Out" onClick={() => setZoom(z => Math.max(0.5, z / 1.35))}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            title="Fit to Screen"
            onClick={() => {
              const allGeom = cadState.entities.filter(e => e.layer !== 'construction');
              if (allGeom.length > 0) {
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (const ent of allGeom) {
                  for (const p of ent.pts) {
                    if (p.x < minX) minX = p.x;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.y > maxY) maxY = p.y;
                  }
                }
                if (minX !== Infinity && maxX !== -Infinity) {
                  fitBoundingBox({ minX, maxX, minY, maxY }, 0.72);
                  return;
                }
              }
              setZoom(INITIAL_ZOOM);
              setPan({ x: 0, y: 0 });
            }}
            className="p-1.5 rounded hover:bg-white text-[#69717D] hover:text-[#171A1F] transition-colors"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>

        {/* ── Snap Toggles ──── */}
        <div className="flex items-center gap-1">
          {[
            { label: 'GRID', title: 'Toggle Grid (F7)', state: showGrid, toggle: () => setShowGrid(g => !g), icon: <Grid3x3 className="w-3 h-3" /> },
            { label: 'SNAP', title: 'Toggle OSNAP (F3)', state: snapEnabled, toggle: () => setSnapEnabled(s => !s), icon: <Magnet className="w-3 h-3" /> },
            { label: 'ORTHO', title: 'Ortho Lock (F8)', state: ortho, toggle: () => setOrtho(o => !o), icon: <Crosshair className="w-3 h-3" /> },
            { label: 'XLINE', title: 'Construction Mode', state: constructionMode, toggle: () => setConstructionMode(c => !c), icon: <ScanLine className="w-3 h-3" /> },
          ].map(({ label, title, state: on, toggle, icon }) => (
            <button key={label} title={title} onClick={toggle}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors ${
                on ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#69717D] border-[#E1E4E8] hover:border-[#2563EB]'
              }`}>
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>




      {/* ════════════════════ CANVAS ════════════════════════════════════════════ */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden outline-none focus:outline-none"
        style={{
          cursor: draggingDomainHandle
            ? (draggingDomainHandle === 'top' || draggingDomainHandle === 'bottom' ? 'ns-resize' : 'ew-resize')
            : hoveredDomainHandle
            ? (hoveredDomainHandle === 'top' || hoveredDomainHandle === 'bottom' ? 'ns-resize' : 'ew-resize')
            : draggingAoAHandle || hoveredAoAHandle
            ? 'crosshair'
            : tool === 'select'
            ? 'default'
            : 'crosshair',
        }}
      >
        {displayOnly && (
          <div className="absolute top-3 left-3 z-20 flex items-center gap-1 bg-white/95 border border-[#E1E4E8] rounded-md px-1.5 py-1 shadow-sm text-xs">
            <button
              onClick={() => setCanvasMode('cad')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${canvasMode === 'cad' ? 'bg-[#F5F6F8] text-[#171A1F] font-semibold' : 'text-[#69717D] hover:text-[#171A1F]'}`}
            >
              {canvasMode === 'cad' ? '◉' : '○'} CAD
            </button>
            <button
              onClick={() => meshData && setCanvasMode('mesh')}
              disabled={!meshData}
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${canvasMode === 'mesh' ? 'bg-[#F5F6F8] text-[#171A1F] font-semibold' : 'text-[#69717D] hover:text-[#171A1F] disabled:opacity-40 disabled:cursor-not-allowed'}`}
            >
              {canvasMode === 'mesh' ? '◉' : '○'} Mesh
            </button>
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="w-full h-full block outline-none focus:outline-none focus:ring-0 select-none"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleCanvasClick}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          onContextMenu={e => e.preventDefault()}
          tabIndex={-1}
        />

        {/* ─── Dynamic Dimension Input Box (Onshape / Fusion 360 style) ─── */}
        {!displayOnly && dimPrompt && (() => {
          const screenPos = toScreen(dimPrompt.worldPos.x, dimPrompt.worldPos.y);
          const containerW = containerRef.current?.clientWidth || 800;
          const containerH = containerRef.current?.clientHeight || 600;
          const posX = Math.max(12, Math.min(containerW - 270, screenPos.x - 100));
          const posY = Math.max(12, Math.min(containerH - 60, screenPos.y - 48));

          return (
            <div
              className="absolute z-30 flex items-center gap-2 bg-white/95 backdrop-blur-xs text-[#171A1F] px-2.5 py-1.5 rounded-md shadow-lg border border-[#E1E4E8] text-xs font-mono select-none transition-all duration-75"
              style={{ left: `${posX}px`, top: `${posY}px` }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Field 1 */}
              <div className="flex items-center gap-1">
                <span className="text-[#2563EB] font-bold text-[11px]">{dimPrompt.label1}:</span>
                <input
                  ref={input1Ref}
                  type="number"
                  step="any"
                  value={inputVal1}
                  onChange={(e) => {
                    setInputVal1(e.target.value);
                    if (dimPrompt.type === 'circle' && dimPrompt.label2 === 'Ø') {
                      const n = parseFloat(e.target.value);
                      if (!isNaN(n)) setInputVal2((n * 2).toFixed(4));
                    }
                  }}
                  onKeyDown={handleDimKeyDown}
                  className="w-20 px-1.5 py-0.5 bg-[#F5F6F8] hover:bg-white focus:bg-white border border-[#E1E4E8] focus:border-[#2563EB] rounded text-right text-[#171A1F] font-mono text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                />
              </div>

              {/* Field 2 */}
              {dimPrompt.label2 && (
                <div className="flex items-center gap-1">
                  <span className="text-[#2563EB] font-bold text-[11px]">{dimPrompt.label2}:</span>
                  <input
                    ref={input2Ref}
                    type="number"
                    step="any"
                    value={inputVal2}
                    onChange={(e) => {
                      setInputVal2(e.target.value);
                      if (dimPrompt.type === 'circle' && dimPrompt.label2 === 'Ø') {
                        const n = parseFloat(e.target.value);
                        if (!isNaN(n)) setInputVal1((n / 2).toFixed(4));
                      }
                    }}
                    onKeyDown={handleDimKeyDown}
                    className="w-18 px-1.5 py-0.5 bg-[#F5F6F8] hover:bg-white focus:bg-white border border-[#E1E4E8] focus:border-[#2563EB] rounded text-right text-[#171A1F] font-mono text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none transition-colors"
                  />
                </div>
              )}

              {/* Hints */}
              <div className="flex items-center gap-1 pl-1.5 border-l border-[#E1E4E8] text-[9px] text-[#69717D]">
                <span className="px-1 py-0.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded text-[8px] font-semibold">Tab ⇥</span>
                <span className="px-1 py-0.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded text-[8px] font-semibold">↵</span>
              </div>
            </div>
          );
        })()}

      </div>



      {/* ════════════════════ BOTTOM STATUS BAR ═════════════════════════════════ */}
      <div className={`${displayOnly ? 'hidden' : 'shrink-0 h-6'} bg-[#F5F6F8] border-t border-[#E1E4E8] px-3 flex items-center justify-between text-[11px] font-mono text-[#69717D]`}>
        {/* Bottom Left: Live Cursor Position & Google Maps Style Scale Indicator */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span>X: <strong className="text-[#171A1F]">{hud.x}</strong></span>
            <span>Y: <strong className="text-[#171A1F]">{hud.y}</strong></span>
          </div>

          <div className="h-3 w-px bg-[#D0D4DC]" />

          {/* Google Maps Style Scale Indicator */}
          <div className="flex items-center gap-1.5 select-none" title={`Scale: ${scaleInfo.label}`}>
            <span className="text-[10px] font-bold text-[#171A1F] leading-none">{scaleInfo.label}</span>
            <div className="flex items-end h-2">
              <div
                className="h-1.5 border-l-2 border-r-2 border-b border-[#171A1F] bg-black/5"
                style={{ width: `${scaleInfo.barWidthPx}px` }}
              />
            </div>
          </div>

          {tool !== 'select' && snap.type !== 'grid' && (
            <>
              <div className="h-3 w-px bg-[#D0D4DC]" />
              <span className="text-[10px] text-[#16A34A] uppercase font-bold">[{snap.type}]</span>
            </>
          )}
        </div>

        {/* Bottom Right: Zoom level percentage */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-[#69717D]">
            Zoom: <strong className="text-[#171A1F]">{(zoom / INITIAL_ZOOM * 100).toFixed(0)}%</strong>
          </span>
        </div>
      </div>

    </div>
  );
};
