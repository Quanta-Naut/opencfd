import type { ToolPicks } from '../workbenchUi/blockEditor/toolFields';
import type { BlockTool } from '../workbenchUi/blockEditor/shared';
import type { BlockDragState } from '../../../types/blocking';
import type React from 'react';
import type {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  BoundaryTag,
  BoundaryEdge,
  Point2D,
  CadEntity,
  GeometryBBox,
} from '../../../types/cadWorkflow';
import type { Blocking, BlockPremesh, SpacingJump, VertexKind } from '../../../types/blocking';
import type { CadTool, CanvasPalette, Snap } from '../workbenchCore';

/** Per-frame drawing context shared by every pass. */
export interface DrawFrame {
  ctx: CanvasRenderingContext2D;
  /** Canvas size in CSS pixels. */
  cw: number;
  ch: number;
  /** Screen position of the world origin. */
  o: { x: number; y: number };
  /** World to screen. */
  ws: (wx: number, wy: number) => { x: number; y: number };
  /** Pixels per world unit (the zoom). */
  SCALE: number;
}

/** Everything the canvas pass reads from the workbench component. */
export interface DrawScene {
  activeField: string;
  activePlotLine: { p1: [number, number]; p2: [number, number]; label?: string };
  activeTagTool: BoundaryTag;
  badBlockIds: Set<string>;
  blockCursor: Point2D;
  blockDrag: React.RefObject<BlockDragState>;
  blockDrawPts: Point2D[];
  blocking: Blocking;
  blockSnapGuides: React.RefObject<{ a: Point2D; b: Point2D }[]>;
  blockTool: BlockTool;
  boundaryEdges: BoundaryEdge[];
  C: CanvasPalette;
  cadState: { entities: CadEntity[] };
  canvasMode: 'cad' | 'mesh';
  colormap: string;
  currentStep: CadWorkflowStep;
  directionColors: Record<string, string>;
  displayOnly: boolean;
  domainAnimScale: number;
  domainBroken: boolean;
  domainEntity: CadEntity;
  domainShape: DomainShapeType;
  downstreamChordFactor: number;
  draggingDomainHandle: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial';
  elementBlockColor: string[];
  fieldData: any;
  flowType: FlowType;
  geometryBBox: GeometryBBox;
  glMeshActive: boolean;
  hoverCurveId: string;
  hoveredBlockIdx: number;
  hoveredBlockVtx: string;
  /** ICEM pre-mesh of every block, and whether to draw it. */
  blockPremesh: BlockPremesh[];
  showPremesh: boolean;
  /** Vertices where cell size jumps across a block join. */
  blockSpacingJumps: SpacingJump[];
  /** What the active tool's dialog fields hold (blocks, edges, vertices, curves). */
  toolPicks: ToolPicks;
  toolField: string;
  selectedVertexId: string | null;
  /** Drag behaviour per block vertex, for its marker. */
  blockVertexKinds: Map<string, VertexKind>;
  hoveredDomainHandle: 'upstream' | 'downstream' | 'top' | 'bottom' | 'radial';
  hoveredEdgeKey: string;
  hoverEdgeId: string;
  hoveredTrim: { p0: Point2D; p1: Point2D; polyline?: Point2D[] };
  hoveredVertex: Point2D;
  isDrawing: boolean;
  lateralHeightFactor: number;
  liveHasContent: boolean;
  liveMeshOn: boolean;
  liveRange: [number, number];
  liveVals: number[];
  marquee: { x: number; y: number; w: number; h: number };
  meshBoundaryEdges: Uint32Array<ArrayBufferLike>;
  meshData: any;
  meshOnly: boolean;
  meshSkew: Float32Array<ArrayBufferLike>;
  outsideBlockIds: Set<string>;
  pan: Point2D;
  plotPickPreviewP1: [number, number];
  selectedBlockId: string;
  selectedEdgeId: string;
  showBlocking: boolean;
  showConstruction: boolean;
  showField: boolean;
  showGrid: boolean;
  showMesh: boolean;
  showMeshQuality: boolean;
  showMeshWireframe: boolean;
  showResultsStreamlines: boolean;
  snap: Snap;
  splitHover: { edgeId: string; pt: Point2D; cut: Point2D[][] };
  tempPts: Point2D[];
  tool: CadTool;
  unpatchedEdgeIds: Set<string>;
  upstreamChordFactor: number;
  zoom: number;
}
