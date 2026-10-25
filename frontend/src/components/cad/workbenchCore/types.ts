import type React from 'react';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  BoundaryTag,
  Point2D,
  CadEntity,
  GeometryBBox,
} from '../../../types/cadWorkflow';
import { Blocking } from '../../../types/blocking';

// ─── CAD Workbench Tool & State Types ─────────────────────────────────────────

export type CadTool =
  | 'select'
  | 'line'
  | 'polyline'
  | 'rectangle'
  | 'circle_center_radius'
  | 'ellipse_center'
  | 'circle_3pt'
  | 'arc_center'
  | 'arc_3pt'
  | 'spline'
  | 'point'
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
  | 'scale'
  | 'dimension_linear';

export interface GuideLine {
  type:
    | 'horizontal'
    | 'vertical'
    | 'parallel'
    | 'perpendicular'
    | 'projection'
    | 'polar'
    | 'extension'
    | 'origin'
    | 'xaxis'
    | 'yaxis';
  from: Point2D;
  to: Point2D;
  label?: string;
}

export interface Snap {
  pt: Point2D;
  type:
    | 'endpoint'
    | 'midpoint'
    | 'center'
    | 'quadrant'
    | 'origin'
    | 'grid'
    | 'perpendicular'
    | 'parallel'
    | 'alignment'
    | 'polar'
    | 'tangent'
    | 'intersection'
    | 'nearest';
  guides?: GuideLine[];
}

export interface DynamicDimPrompt {
  entityId: string;
  type: 'line' | 'rectangle' | 'circle' | 'ellipse' | 'arc';
  worldPos: Point2D;
  val1: string;
  val2?: string;
  label1: string;
  label2?: string;
  basePt: Point2D;
  endPt?: Point2D;
  layer: string;
  /** True while the shape is still being placed (no entity exists yet) - the
   * box tracks the mouse live until the user types, and Tab/Enter/typed
   * values drive the in-progress preview instead of editing a committed entity. */
  live?: boolean;
}

export interface CadState {
  entities: CadEntity[];
}

export type CadAction =
  | { type: 'ADD_ENTITY'; entity: CadEntity }
  | { type: 'REPLACE_ENTITIES'; entities: CadEntity[] }
  | { type: 'DELETE_SELECTED' }
  | { type: 'SELECT_ENTITY'; id: string | null; multi?: boolean }
  | { type: 'CLEAR' };

/** How the Results tab draws the field: contour style, overlays, probes and
 *  the legend title. Null outside Results. */
export interface CameraApi {
  get: () => { zoom: number; pan: { x: number; y: number } };
  set: (c: { zoom: number; pan: { x: number; y: number } }) => void;
}

export interface ResultsOverlay {
  levels: number;
  contourLines: boolean;
  showMesh: boolean;
  showStreamlines: boolean;
  showVectors: boolean;
  /** Screen pixels between vector arrows. */
  vectorSpacing: number;
  vectorScale: number;
  /** Probe points (model coordinates) and the text shown beside each. */
  probes: { id: string; x: number; y: number; label: string; selected?: boolean }[];
  legend: { title: string; unit: string };
  /** Leave out values outside the colour range. */
  clipOutside: boolean;
  /** Show results only inside this world box [x0, y0, x1, y1]. */
  clipBox: [number, number, number, number] | null;
  /** Lines at typed values: world segments [x1, y1, x2, y2, ...]. */
  isoLines: { level: number; label: string; segs: Float32Array }[];
  /** Particle tracks: world points [x, y, ...] and, when coloured, a value
   *  per point mapped through `trackRange` and the colormap. */
  tracks: { pts: Float32Array; vals: Float32Array | null }[];
  trackRange: [number, number] | null;
  /** What the track colours mean, e.g. "Time since release 0 to 0.12 s". */
  trackLegend: string | null;
  trackSeeds: { kind: 'point' | 'line'; x0: number; y0: number; x1: number; y1: number }[];
  colormap: string;
  /** Notes pinned to points. */
  notes: { id: string; x: number; y: number; text: string }[];
}

export interface CadWorkbenchProps {
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
  activeTagTool?: BoundaryTag | null;
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
  meshOnly?: boolean;
  showField?: boolean;
  fieldData?: any;
  /** cell-based field streamed live from the solver (Solver stage) */
  livePreview?: {
    time: string;
    fields: Record<string, number[]>;
    ranges: Record<string, [number, number]>;
  } | null;
  activeField?: string;
  colormap?: string;
  meshStale?: boolean;
  /** Outside the Geometry tab: the geometry the blocks and mesh were made
   *  from, shown instead of the live one when they differ. */
  frozenEntities?: CadEntity[];
  /** Mesh tab: offer the latest geometry (it clears blocks and mesh). */
  onTakeLatestGeometry?: () => void;
  domainBroken?: boolean;
  isMeshing?: boolean;
  blocking?: Blocking | null;
  onUpdateBlocking?: (bk: Blocking | null) => void;
  showBlocking?: boolean;
  blocksBuiltTick?: number;
  /** Block-edge id -> color, while the mesh-sizing step's Direction A/B/C
   * cards are open. Overrides the usual patch coloring so an edge reads as
   * the same color as the card that controls it. */
  directionColors?: Record<string, string> | null;
  /** Open structured-meshing section: Blocking shows the blocks, Mesh sizing the mesh. */
  structuredStep?: 'blocking' | 'sizing';
  isTransient?: boolean;
  transientTimes?: number[];
  transientFrameIndex?: number;
  transientPlaying?: boolean;
  transientSpeed?: number;
  onSelectTransientFrame?: (index: number) => void;
  onToggleTransientPlay?: () => void;
  onSelectTransientSpeed?: (speed: number) => void;
  onExportAnimation?: () => void;
  historicalStatus?: {
    runLabel?: string;
    loading?: boolean;
    error?: string | null;
  };
  onRestoreLive?: () => void;
  activePlotLine?: { p1: [number, number]; p2: [number, number]; label?: string } | null;
  isPickingPlotPoints?: boolean;
  onPickPlotPoint?: (pt: [number, number]) => void;
  plotPickPreviewP1?: [number, number] | null;
  resultsOverlay?: ResultsOverlay | null;
  /** Filled by the canvas with get / set for its camera (zoom and pan). */
  cameraApiRef?: React.MutableRefObject<CameraApi | null>;
}
