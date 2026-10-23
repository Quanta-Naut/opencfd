import React, { useEffect, useRef, useState } from 'react';
import type { StageId, StageStatus } from './stages';
import { SolverPanel } from '../solver/SolverPanel';
import { Tooltip } from '../ui/Tooltip';
import { CFDProjectState, TurbulenceModel, SolverType } from '../../types/cfd';
import {
  Layers,
  Upload,
  Zap,
  Play,
  FileCode,
  Box,
  Activity,
  RotateCcw,
  Compass,
  Tag,
  Check,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Download,
  Minus,
  ChevronRight,
  ChevronDown,
  Link,
  Wind,
  Thermometer,
  Plus,
} from 'lucide-react';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  DomainPreset,
  DOMAIN_PRESETS,
  BoundaryTag,
  BOUNDARY_COLORS,
  GeometryBBox,
} from '../../types/cadWorkflow';
import { Blocking } from '../../types/blocking';
import { NumberField } from './leftStagePanel/NumberField';
import { StageGate } from './leftStagePanel/StageGate';
import { StructuredMeshPanel } from './leftStagePanel/StructuredMeshPanel';

interface LeftStagePanelProps {
  activeStage: StageId;
  state: CFDProjectState;
  updateGeometry: (p: any) => void;
  updatePhysics: (p: any) => void;
  updateBoundaries: (p: any) => void;
  updateYPlus: (p: any) => void;
  updateSolver: (p: any) => void;
  updatePostProcess: (p: any) => void;
  onGenerateMesh: () => void;
  onApplyYPlusToMesh: () => void;
  onDirectionColors?: (colors: Record<string, string> | null) => void;
  onBlockModeChange?: (mode: 'auto' | 'manual') => void;
  meshData?: any;
  meshError?: string | null;
  meshStale?: boolean;
  onRunSolver: () => void;
  onStopSolver?: () => void;
  onReloadResults?: () => void;
  resultsLoading?: boolean;
  fieldSource?: string;
  fieldTime?: string;
  onSetSolution?: (
    patch: (
      c: import('../../solver/solverConfig').SolverConfig,
    ) => import('../../solver/solverConfig').SolverConfig,
  ) => void;
  onSetTimeFormulation?: (t: 'steady' | 'transient') => void;
  solverPatchNames?: string[];
  solverWallPatches?: string[];
  solverConvergence?: { iteration: number; maxResidual: number; cd?: number; cl?: number } | null;
  isMeshing: boolean;
  onSelectBoundary: (name: string) => void;
  selectedBoundary: string;
  onUploadAirfoilFile: (file: File) => void;
  onUploadAirfoilUrl?: (url: string) => Promise<void> | void;
  onUploadDxfFile: (file: File) => void;

  // ── 6-Step Workflow Props ──
  cadWorkflowStep?: CadWorkflowStep;
  setCadWorkflowStep?: (step: CadWorkflowStep) => void;
  flowType?: FlowType;
  setFlowType?: (t: FlowType) => void;
  domainShape?: DomainShapeType;
  setDomainShape?: (s: DomainShapeType) => void;
  domainPreset?: DomainPreset;
  setDomainPreset?: (p: DomainPreset) => void;
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
  setFreestreamVelocity?: (v: number) => void;
  activeTagTool?: BoundaryTag | null;
  setActiveTagTool?: (t: BoundaryTag | null) => void;
  edgeTagMap?: Record<string, BoundaryTag>;
  onGenerateDomain?: () => void;
  onSetSelectedAsDomain?: () => void;
  onSetSelectedAsGeometry?: () => void;
  onSelectAllGeometry?: () => void;
  onClearGeometry?: () => void;
  onAutoSuggestTags?: () => void;
  onMeshHandoff?: () => void;
  onDownloadBlockMeshDict?: () => void;
  domainValidation?: { valid: boolean; reason?: string };
  domainKind?: 'none' | 'auto' | 'custom';
  domainState?: 'none' | 'auto' | 'ok' | 'broken';
  boundaryValidation?: { valid: boolean; reason?: string; counts: Record<BoundaryTag, number> };
  boundaryEdgesCount?: number;
  geometryEntitiesCount?: number;

  // ── Step-by-step gating ──
  onSelectStage?: (stage: StageId) => void;
  stageStatus?: Partial<Record<StageId, StageStatus>>;

  // ── Structured meshing (H-block transfinite) ──
  blocking?: Blocking | null;
  onBuildBlocks?: (kind: 'hgrid' | 'ogrid' | 'cgrid' | 'cgrid_closed') => void;
  onInitializeBlocking?: () => void;
  onUpdateBlocking?: (bk: Blocking | null) => void;
  onGenerateStructuredMesh?: () => void;
  ogridBodies?: { index: number; name: string; blockId: string | null; wrapped: boolean }[];
  onWrapBody?: (bodyIndex: number) => void;
  ogridParams?: { offsetFactor: number; radialNodes: number; radialRatio: number };
  onUpdateOgridParams?: (
    p: Partial<{ offsetFactor: number; radialNodes: number; radialRatio: number }>,
  ) => void;
  structuredHint?: 'hgrid' | 'ogrid' | 'cgrid' | 'cgrid_closed';
  structuredSmooth?: boolean;
  setStructuredSmooth?: (v: boolean) => void;
  meshTopology?: 'unstructured' | 'structured';
  onMeshTopologyChange?: (t: 'unstructured' | 'structured') => void;
  width?: number;
  onWidthChange?: (w: number) => void;
  projectId?: string;
  onCreatePlot?: () => void;
}

export const LeftStagePanel: React.FC<LeftStagePanelProps> = ({
  activeStage,
  state,
  updateGeometry,
  updatePhysics,
  updateBoundaries,
  updateYPlus,
  updateSolver,
  updatePostProcess,
  onGenerateMesh,
  onApplyYPlusToMesh,
  onDirectionColors,
  onBlockModeChange,
  meshData,
  meshError,
  meshStale,
  onRunSolver,
  onStopSolver,
  onReloadResults,
  resultsLoading,
  fieldSource,
  fieldTime,
  onSetSolution,
  onSetTimeFormulation,
  solverPatchNames,
  solverWallPatches,
  solverConvergence,
  isMeshing,
  onSelectBoundary,
  selectedBoundary,
  onUploadAirfoilFile,
  onUploadAirfoilUrl,
  onUploadDxfFile,
  cadWorkflowStep = 1,
  setCadWorkflowStep,
  flowType = 'external',
  setFlowType,
  domainShape = 'rectangle',
  setDomainShape,
  domainPreset = 'standard',
  setDomainPreset,
  upstreamChordFactor = 10,
  setUpstreamChordFactor,
  downstreamChordFactor = 20,
  setDownstreamChordFactor,
  lateralHeightFactor = 10,
  setLateralHeightFactor,
  geometryBBox,
  angleOfAttackDeg = 0.0,
  setAngleOfAttackDeg,
  freestreamVelocity = 35.0,
  setFreestreamVelocity,
  activeTagTool = null,
  setActiveTagTool,
  edgeTagMap = {},
  onGenerateDomain,
  onSetSelectedAsDomain,
  onSetSelectedAsGeometry,
  onSelectAllGeometry,
  onClearGeometry,
  onAutoSuggestTags,
  onMeshHandoff,
  onDownloadBlockMeshDict,
  domainValidation = { valid: true },
  domainKind = 'none',
  domainState = 'none',
  boundaryValidation = {
    valid: true,
    counts: { inlet: 0, outlet: 0, wall: 0, farfield: 0, symmetry: 0, periodic: 0 },
  },
  boundaryEdgesCount = 0,
  geometryEntitiesCount = 0,
  onSelectStage,
  stageStatus,
  blocking,
  onBuildBlocks,
  onInitializeBlocking,
  onUpdateBlocking,
  onGenerateStructuredMesh,
  ogridBodies,
  onWrapBody,
  ogridParams,
  onUpdateOgridParams,
  structuredHint,
  structuredSmooth,
  setStructuredSmooth,
  meshTopology = 'unstructured',
  onMeshTopologyChange,
  width = 280,
  onWidthChange,
  projectId,
  onCreatePlot,
}) => {
  // Drag the right edge to resize; the width is shared across every stage.
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const next = Math.max(
        220,
        Math.min(620, resizeRef.current.startW + (e.clientX - resizeRef.current.startX)),
      );
      onWidthChange?.(next);
    };
    const onUp = () => {
      if (resizeRef.current) {
        resizeRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onWidthChange]);
  const startResize = (e: React.MouseEvent) => {
    resizeRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const fileInputAirfoilRef = useRef<HTMLInputElement | null>(null);
  const fileInputDxfRef = useRef<HTMLInputElement | null>(null);

  const [airfoilUrl, setAirfoilUrl] = useState('');
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  const handleAirfoilChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadAirfoilFile(file);
    }
  };

  const handleImportUrl = async () => {
    const trimmed = airfoilUrl.trim();
    if (!trimmed) return;
    setUrlError(null);
    setIsFetchingUrl(true);
    try {
      if (onUploadAirfoilUrl) {
        await onUploadAirfoilUrl(trimmed);
      }
      setAirfoilUrl('');
    } catch (err: any) {
      setUrlError(err.message || 'Failed to fetch link');
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleDxfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadDxfFile(file);
    }
  };

  const setMeshTopology = (t: 'unstructured' | 'structured') => onMeshTopologyChange?.(t);
  const [meshAdvancedOpen, setMeshAdvancedOpen] = useState(true);
  // Geometry-stage accordion: one section open at a time, Geometry (1) by default.
  const [openGeoSection, setOpenGeoSection] = useState<CadWorkflowStep | null>(1);
  // Far-field disclosure in the Domain section - collapsed by default.
  const [farfieldOpen, setFarfieldOpen] = useState(false);

  // Disarm the edge-tag tool whenever the user leaves the Boundary patches
  // section or the Geometry stage - so Select never tags outside that context.
  useEffect(() => {
    if (activeStage !== 'geometry' || openGeoSection !== 3) setActiveTagTool?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStage, openGeoSection]);

  // Draft string for the y+ inputs so the field can be emptied / edited freely
  // instead of snapping back to a fallback number on every keystroke.
  const [yplusDraft, setYplusDraft] = useState(() => String(state.yplus.target_yplus ?? ''));
  useEffect(() => {
    setYplusDraft((prev) =>
      parseFloat(prev) === state.yplus.target_yplus ? prev : String(state.yplus.target_yplus ?? ''),
    );
  }, [state.yplus.target_yplus]);
  const commitYplusDraft = (raw: string) => {
    setYplusDraft(raw);
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) updateYPlus({ target_yplus: parsed });
  };
  const normalizeYplusDraft = () => {
    const parsed = parseFloat(yplusDraft);
    if (!Number.isFinite(parsed) || parsed <= 0)
      setYplusDraft(String(state.yplus.target_yplus ?? 30));
  };
  const [flowDirection, setFlowDirection] = useState<
    'neg_x_pos_x' | 'pos_x_neg_x' | 'neg_y_pos_y' | 'pos_y_neg_y'
  >('neg_x_pos_x');

  const onApplyPreset = (p: DomainPreset) => {
    setDomainPreset?.(p);
    if (p !== 'custom') {
      const conf = DOMAIN_PRESETS[p];
      setUpstreamChordFactor?.(conf.upstream);
      setDownstreamChordFactor?.(conf.downstream);
      setLateralHeightFactor?.(conf.lateral);
    }
  };

  return (
    <aside
      style={{ width }}
      className={`relative h-full bg-surface border-r border-line flex flex-col select-none shrink-0 ${activeStage === 'mesh' || activeStage === 'results' ? 'overflow-hidden' : 'overflow-y-auto'}`}
    >
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute top-0 right-0 h-full w-1.5 z-30 cursor-col-resize hover:bg-accent/30 transition-colors"
      />
      {/* 01 GEOMETRY · DOMAIN · BOUNDARY PATCHES (single-open accordion) */}
      {activeStage === 'geometry' &&
        (() => {
          const isInternal = flowType === 'internal';
          const inletCount = boundaryValidation.counts?.inlet ?? 0;
          const outletCount = boundaryValidation.counts?.outlet ?? 0;

          // Selection state: subtle blue outline + tint instead of a solid fill.
          const sel = (active: boolean) =>
            active
              ? 'border-accent bg-accent-soft text-accent-fg'
              : 'border-line bg-surface text-fg-2 hover:border-line-strong hover:bg-surface-2';

          const toggle = (n: CadWorkflowStep) => {
            setOpenGeoSection((prev) => (prev === n ? null : n));
            if (openGeoSection !== n) setCadWorkflowStep?.(n);
          };

          const section = (n: CadWorkflowStep, label: string, body: React.ReactNode) => {
            const isOpen = openGeoSection === n;
            return (
              <div className="border border-line rounded bg-surface overflow-hidden">
                <button
                  onClick={() => toggle(n)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${isOpen ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
                >
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold shrink-0 border ${isOpen ? 'bg-accent-soft text-accent border-accent' : 'bg-surface-3 text-fg-4 border-transparent'}`}
                  >
                    {n}
                  </span>
                  <span
                    className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${isOpen ? 'text-accent' : 'text-fg-2'}`}
                  >
                    {label}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-fg-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isOpen && <div className="px-3 pb-3.5 pt-1">{body}</div>}
              </div>
            );
          };

          return (
            <div className="p-3 pb-10 space-y-2 text-xs text-fg">
              {/* ══════════ 1 · GEOMETRY ══════════ */}
              {section(
                1,
                'Geometry',
                <div className="space-y-4">
                  <input
                    type="file"
                    ref={fileInputAirfoilRef}
                    onChange={handleAirfoilChange}
                    accept=".dat,.csv,.txt"
                    className="hidden"
                  />
                  <input
                    type="file"
                    ref={fileInputDxfRef}
                    onChange={handleDxfChange}
                    accept=".dxf"
                    className="hidden"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => fileInputAirfoilRef.current?.click()}
                      className="group py-3 px-2 bg-surface hover:bg-surface-2 border border-line hover:border-fg rounded font-medium flex flex-col items-center gap-1.5 transition-all"
                    >
                      <Upload className="w-4 h-4 text-fg-2 group-hover:text-fg" />
                      <span className="text-[11px] text-fg">.dat / .csv</span>
                      <span className="text-[10px] text-fg-4">airfoil coords</span>
                    </button>
                    <button
                      onClick={() => fileInputDxfRef.current?.click()}
                      className="group py-3 px-2 bg-surface hover:bg-surface-2 border border-line hover:border-fg rounded font-medium flex flex-col items-center gap-1.5 transition-all"
                    >
                      <FileCode className="w-4 h-4 text-fg-2 group-hover:text-fg" />
                      <span className="text-[11px] text-fg">DXF drawing</span>
                      <span className="text-[10px] text-fg-4">2D CAD outline</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-fg-4">
                    <span className="h-px flex-1 bg-line" />
                    or paste a URL
                    <span className="h-px flex-1 bg-line" />
                  </div>

                  <div className="space-y-1.5">
                    <div className="relative">
                      <Link className="w-3.5 h-3.5 text-fg-4 absolute left-2.5 top-2.5" />
                      <input
                        type="url"
                        value={airfoilUrl}
                        onChange={(e) => {
                          setAirfoilUrl(e.target.value);
                          if (urlError) setUrlError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleImportUrl();
                          }
                        }}
                        placeholder="Selig / UIUC .dat link…"
                        className="w-full pl-8 pr-2 py-2 bg-surface-2 focus:bg-surface border border-line focus:border-accent rounded text-[11px] font-mono placeholder:font-sans text-fg outline-none transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleImportUrl}
                      disabled={!airfoilUrl.trim() || isFetchingUrl}
                      className="w-full py-2 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded text-[11px] font-semibold transition-colors"
                    >
                      {isFetchingUrl ? 'Fetching…' : 'Fetch airfoil'}
                    </button>
                    {urlError && (
                      <span className="text-[10px] text-danger block leading-tight">
                        {urlError}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-fg-4">
                      Everything you draw here is geometry.
                    </span>
                    <button
                      onClick={onClearGeometry}
                      title="Clear all geometry"
                      className="px-2.5 py-1.5 bg-surface hover:bg-danger-soft hover:text-danger hover:border-danger-line text-fg-4 border border-line rounded transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                </div>,
              )}

              {/* ══════════ 2 · DOMAIN ══════════ */}
              {section(
                2,
                'Domain',
                <div className="space-y-3">
                  {/* Flow type */}
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { v: 'external', label: 'External flow', hint: 'around a body' },
                        { v: 'internal', label: 'Internal flow', hint: 'inside a channel' },
                      ] as const
                    ).map(({ v, label, hint }) => (
                      <button
                        key={v}
                        onClick={() => setFlowType?.(v)}
                        className={`py-2 px-2.5 rounded border text-left transition-colors ${sel(flowType === v)}`}
                      >
                        <span className="block text-[11px] font-semibold">{label}</span>
                        <span
                          className={`block text-[10px] ${flowType === v ? 'text-accent' : 'text-fg-4'}`}
                        >
                          {hint}
                        </span>
                      </button>
                    ))}
                  </div>

                  {isInternal
                    ? /* moved out of the live UI - see layout/LeftStagePanel.tsx (Domain section),
                    kept for a future tutorial
                    <div className="p-2.5 bg-surface-2 border border-line rounded text-[10px] text-fg-2 leading-relaxed">
                      The geometry walls bound the fluid directly - no outer domain is generated.
                      Tag the open ends as <b className="text-fg">inlet</b> /{' '}
                      <b className="text-fg">outlet</b> and the solid sides as{' '}
                      <b className="text-fg">wall</b> in step 3.
                    </div>
                    */
                      null
                    : (() => {
                        const farOpen = domainKind === 'auto' ? true : farfieldOpen;
                        return (
                          <>
                            {/* Collapsible far-field generator - collapsed by default */}
                            <button
                              onClick={() => setFarfieldOpen((v) => !v)}
                              className="w-full flex items-center gap-1.5 py-1.5 text-[11px] font-semibold text-fg-2 hover:text-fg transition-colors"
                            >
                              <ChevronRight
                                className={`w-3.5 h-3.5 transition-transform ${farOpen ? 'rotate-90 text-accent' : ''}`}
                              />
                              <span className={farOpen ? 'text-accent' : ''}>
                                Generate a far-field box automatically
                              </span>
                            </button>

                            {/* Collapsed: explicitly define the fluid domain */}
                            {!farOpen && (
                              <Tooltip
                                content={
                                  domainState === 'broken'
                                    ? 'The fluid domain is broken: an edge that formed the outer boundary was deleted or replaced, so the loop no longer closes. Select the whole outline again on the canvas (Select tool, drag a box around it), then click this to redefine it. Your inlet / outlet / wall tags are kept.'
                                    : domainState === 'ok'
                                      ? 'The fluid domain is set. Click to redefine it from the current selection. Deleting a boundary edge will break it and this button turns red.'
                                      : 'Marks the selected closed loop as the outer fluid boundary. Draw your outline as one closed loop (endpoints must meet), select all of it, then click this. Or expand the far-field option above.'
                                }
                              >
                                <button
                                  onClick={onSetSelectedAsDomain}
                                  className={`w-full py-2 rounded font-bold transition-colors text-white ${domainState === 'broken' ? 'bg-danger hover:bg-danger' : 'bg-accent hover:bg-accent-hover'}`}
                                >
                                  {domainState === 'ok'
                                    ? 'Redefine domain'
                                    : domainState === 'broken'
                                      ? 'Reselect & redefine'
                                      : 'Set as domain'}
                                </button>
                              </Tooltip>
                            )}

                            {farOpen && (
                              <div className="space-y-3">
                                <div>
                                  <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                                    Far-field shape
                                  </span>
                                  <div className="grid grid-cols-3 gap-2">
                                    {(
                                      [
                                        { v: 'rectangle', label: 'Box' },
                                        { v: 'c_grid', label: 'C-grid' },
                                        { v: 'circle', label: 'Farfield' },
                                      ] as const
                                    ).map(({ v, label }) => {
                                      const on = domainShape === v;
                                      return (
                                        <button
                                          key={v}
                                          onClick={() => setDomainShape?.(v)}
                                          className={`p-2 rounded border flex flex-col items-center gap-1 transition-colors ${sel(on)}`}
                                        >
                                          <svg
                                            className="w-full h-7"
                                            viewBox="0 0 100 48"
                                            fill="none"
                                          >
                                            {v === 'rectangle' && (
                                              <rect
                                                x="6"
                                                y="6"
                                                width="88"
                                                height="36"
                                                rx="2"
                                                stroke={on ? '#2563EB' : '#94A3B8'}
                                                strokeWidth="1.5"
                                                strokeDasharray="3 2"
                                                fill="#EFF6FF"
                                                fillOpacity={on ? 0.7 : 0.15}
                                              />
                                            )}
                                            {v === 'c_grid' && (
                                              <path
                                                d="M94 8 L36 8 A16 16 0 0 0 36 40 L94 40 Z"
                                                stroke={on ? '#2563EB' : '#94A3B8'}
                                                strokeWidth="1.5"
                                                strokeDasharray="3 2"
                                                fill="#EFF6FF"
                                                fillOpacity={on ? 0.7 : 0.15}
                                              />
                                            )}
                                            {v === 'circle' && (
                                              <circle
                                                cx="50"
                                                cy="24"
                                                r="17"
                                                stroke={on ? '#2563EB' : '#94A3B8'}
                                                strokeWidth="1.5"
                                                strokeDasharray="3 2"
                                                fill="#EFF6FF"
                                                fillOpacity={on ? 0.7 : 0.15}
                                              />
                                            )}
                                            <path
                                              d="M42 24 C44 20, 52 21, 62 24 C54 26, 46 26, 42 24 Z"
                                              fill="#171A1F"
                                            />
                                          </svg>
                                          <span
                                            className={`text-[10px] font-bold ${on ? 'text-accent-fg' : 'text-fg-2'}`}
                                          >
                                            {label}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div>
                                  <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                                    Size preset
                                  </span>
                                  <div className="grid grid-cols-4 gap-1.5">
                                    {(
                                      ['tight', 'standard', 'large', 'custom'] as DomainPreset[]
                                    ).map((p) => (
                                      <button
                                        key={p}
                                        onClick={() => onApplyPreset(p)}
                                        className={`py-1.5 rounded text-[10px] font-medium border transition-colors capitalize ${sel(domainPreset === p)}`}
                                      >
                                        {p}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="bg-surface-2 border border-line rounded p-2.5 space-y-2">
                                  <div className="flex justify-between items-center text-[10px] text-fg-2">
                                    <span className="font-semibold">Clearance (chords)</span>
                                    <span className="font-mono text-accent">
                                      1c = {(geometryBBox?.chord ?? 1.0).toFixed(2)} m
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-3 gap-1.5 items-start">
                                    {(
                                      [
                                        {
                                          label: '← Inlet',
                                          cls: '',
                                          v: upstreamChordFactor,
                                          set: setUpstreamChordFactor,
                                        },
                                        {
                                          label: '↕ Lateral',
                                          cls: 'text-center',
                                          v: lateralHeightFactor,
                                          set: setLateralHeightFactor,
                                        },
                                        {
                                          label: 'Outlet →',
                                          cls: 'text-right',
                                          v: downstreamChordFactor,
                                          set: setDownstreamChordFactor,
                                        },
                                      ] as const
                                    ).map(({ label, cls, v, set: setter }) => (
                                      <label key={label} className={`text-[10px] text-fg-2 ${cls}`}>
                                        {label}
                                        <NumberField
                                          value={v}
                                          min={1}
                                          max={100}
                                          onChange={(n) => {
                                            setter?.(n);
                                            setDomainPreset?.('custom');
                                          }}
                                          className="w-full mt-0.5 px-1 py-1 bg-surface border border-line focus:border-accent outline-none rounded text-center text-[10px] font-mono font-bold text-fg"
                                        />
                                      </label>
                                    ))}
                                  </div>
                                </div>

                                {!domainValidation.valid && domainKind === 'auto' && (
                                  <div className="flex items-start gap-1 text-[10px] text-danger">
                                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                                    <span>
                                      {domainValidation.reason || 'Geometry is outside the domain.'}
                                    </span>
                                  </div>
                                )}

                                <button
                                  onClick={onGenerateDomain}
                                  className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded font-bold transition-colors"
                                >
                                  Generate domain
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                </div>,
              )}

              {/* ══════════ 3 · BOUNDARY PATCHES ══════════ */}
              {section(
                3,
                'Boundary patches',
                <div className="space-y-3">
                  <div>
                    <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                      Flow direction
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {(
                        [
                          { label: '-X', icon: '→', value: 'neg_x_pos_x' },
                          { label: '+X', icon: '←', value: 'pos_x_neg_x' },
                          { label: '+Y', icon: '↑', value: 'neg_y_pos_y' },
                          { label: '-Y', icon: '↓', value: 'pos_y_neg_y' },
                        ] as const
                      ).map(({ label, icon, value }) => (
                        <button
                          key={value}
                          onClick={() => setFlowDirection(value)}
                          title={`Inlet from ${label}`}
                          className={`py-1.5 rounded border flex flex-col items-center transition-colors ${sel(flowDirection === value)}`}
                        >
                          <span className="text-sm font-bold leading-none">{icon}</span>
                          <span className="text-[10px] font-semibold font-mono">{label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-semibold text-fg-2 block mb-1.5">
                      {activeTagTool
                        ? `Tagging: ${activeTagTool.toUpperCase()} - click canvas edges (click the tag again to stop)`
                        : 'Pick a tag, then click canvas edges to apply it'}
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {/* 'axis' is always offered - tagging an edge with it is what turns
                        the case axisymmetric, manually, no separate toggle. */}
                      {(
                        [
                          'inlet',
                          'outlet',
                          'wall',
                          'farfield',
                          'symmetry',
                          'periodic',
                          'axis',
                        ] as BoundaryTag[]
                      ).map((tag) => {
                        const conf = BOUNDARY_COLORS[tag];
                        const isSel = activeTagTool === tag;
                        return (
                          <button
                            key={tag}
                            onClick={() => setActiveTagTool?.(isSel ? null : tag)}
                            className={`py-1.5 px-2 rounded text-[10px] font-semibold uppercase tracking-wider border transition-colors flex items-center gap-1.5 ${isSel ? `${conf.bg} ${conf.text}` : 'bg-surface text-fg-2 border-line hover:bg-surface-2'}`}
                            style={isSel ? { borderColor: conf.hex } : undefined}
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: isSel ? conf.hex : '#CBD5E1' }}
                            />
                            <span className="flex-1 text-left">{tag}</span>
                            <span className="text-[10px] font-mono opacity-70">
                              {boundaryValidation.counts[tag] || 0}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const dirToAoa: Record<string, number> = {
                        neg_x_pos_x: 0,
                        pos_x_neg_x: 180,
                        neg_y_pos_y: 90,
                        pos_y_neg_y: -90,
                      };
                      setAngleOfAttackDeg?.(dirToAoa[flowDirection] ?? 0);
                      setTimeout(() => onAutoSuggestTags?.(), 30);
                    }}
                    className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded font-bold transition-all active:scale-[0.99]"
                  >
                    Auto-tag edges
                  </button>

                  {(inletCount === 0 || outletCount === 0) && (
                    <div className="flex items-start gap-1 text-[10px] text-danger">
                      <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>
                        {inletCount === 0 && outletCount === 0
                          ? 'Tag at least one inlet and one outlet.'
                          : inletCount === 0
                            ? 'Tag at least one inlet.'
                            : 'Tag at least one outlet.'}
                      </span>
                    </div>
                  )}
                </div>,
              )}
            </div>
          );
        })()}

      {/* 03 MESH */}
      {activeStage === 'mesh' &&
        (() => {
          const g = state.geometry;
          const set = updateGeometry;
          const resolutionHint: Record<string, string> = {
            coarse: 'Fast preview. Large free-stream / wake cells.',
            medium: 'Balanced. Good default for first runs.',
            fine: 'Dense wake and near-body. Slower to solve.',
          };
          const field =
            'w-full px-2 py-1 bg-app border border-line rounded font-mono focus:outline-none focus:border-accent';
          const meshLock = stageStatus?.mesh;
          if (meshLock?.locked) {
            return (
              <div className="h-full min-h-0 flex flex-col text-xs text-fg">
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <StageGate
                    title="Meshing is locked"
                    reason="Complete these pre-processing steps before generating a mesh:"
                    missing={meshLock.missing}
                    onCta={onSelectStage ? () => onSelectStage('geometry') : undefined}
                  />
                </div>
                <div className="shrink-0 px-4 py-4 mt-3 border-t border-line bg-surface">
                  <button
                    disabled
                    className="w-full py-2 bg-accent text-white font-medium rounded-sm opacity-40"
                  >
                    Generate mesh
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div className="h-full min-h-0 flex flex-col text-xs text-fg">
              <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 pt-4">
                {/* Topology */}
                <div>
                  <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                    Mesh topology
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => setMeshTopology('unstructured')}
                      className={`py-2 rounded border font-medium transition-colors ${meshTopology === 'unstructured' ? 'border-accent bg-accent-soft text-accent-fg' : 'bg-surface border-line text-fg-2 hover:border-line-strong hover:bg-surface-2'}`}
                    >
                      Unstructured
                    </button>
                    <button
                      onClick={() => setMeshTopology('structured')}
                      className={`py-2 rounded border font-medium transition-colors ${meshTopology === 'structured' ? 'border-accent bg-accent-soft text-accent-fg' : 'bg-surface border-line text-fg-2 hover:border-line-strong hover:bg-surface-2'}`}
                    >
                      Structured
                    </button>
                  </div>
                </div>

                {meshTopology === 'structured' ? (
                  <StructuredMeshPanel
                    blocking={blocking ?? null}
                    onBuildBlocks={onBuildBlocks}
                    onInitializeBlocking={onInitializeBlocking}
                    onUpdateBlocking={onUpdateBlocking}
                    ogridBodies={ogridBodies}
                    onWrapBody={onWrapBody}
                    ogridParams={ogridParams}
                    onUpdateOgridParams={onUpdateOgridParams}
                    structuredHint={structuredHint}
                    structuredSmooth={structuredSmooth}
                    setStructuredSmooth={setStructuredSmooth}
                    field={field}
                    state={state}
                    updateYPlus={updateYPlus}
                    onApplyYPlusToMesh={onApplyYPlusToMesh}
                    onDirectionColors={onDirectionColors}
                    onBlockModeChange={onBlockModeChange}
                  />
                ) : (
                  <>
                    {/* Resolution */}
                    <div>
                      <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                        Resolution
                      </span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['coarse', 'medium', 'fine'] as const).map((res) => (
                          <button
                            key={res}
                            onClick={() => set({ meshResolution: res })}
                            className={`py-1.5 rounded capitalize font-medium border transition-colors ${g.meshResolution === res ? 'border-accent bg-accent-soft text-accent-fg' : 'bg-surface text-fg-2 border-line hover:border-line-strong hover:bg-surface-2'}`}
                          >
                            {res}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px] text-fg-2 block mt-1">
                        {resolutionHint[g.meshResolution]}
                      </span>
                    </div>

                    {/* Element type */}
                    <label className="block">
                      <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                        Element type
                      </span>
                      <select
                        value={g.elementType}
                        onChange={(e) =>
                          set({ elementType: e.target.value as typeof g.elementType })
                        }
                        className="w-full px-2 py-1.5 bg-app border border-line rounded-sm focus:outline-none focus:border-accent"
                      >
                        <option value="hybrid">Hybrid: prism layers at wall + triangles</option>
                        <option value="tri">Triangles: fully unstructured</option>
                        <option value="quad_dominant">Quad-dominant: mostly quads</option>
                        <option value="quad">Quads: recombined all-quad</option>
                      </select>
                    </label>

                    {/* Boundary layer */}
                    <div className="border-t border-line pt-3">
                      <label className="flex items-center justify-between cursor-pointer">
                        <div>
                          <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                            Boundary layer
                          </span>
                          <span className="text-[10px] text-fg-2 block mt-0.5">
                            Prism cells along tagged walls
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={g.usePrismLayers}
                          onChange={(e) => set({ usePrismLayers: e.target.checked })}
                          className="accent-accent"
                        />
                      </label>
                      {g.usePrismLayers && (
                        <>
                          <div className="grid grid-cols-3 gap-2 mt-2.5">
                            <label>
                              <Tooltip content="Height of the first cell against the wall, in mm. Sets y⁺ together with the flow speed. Smaller = finer boundary layer.">
                                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  First cell (mm)
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.firstLayerHeightMm}
                                min={0.0001}
                                fallback={0.05}
                                onChange={(n) => set({ firstLayerHeightMm: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Number of prism layers stacked from the wall outward.">
                                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Layers
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.numPrismLayers}
                                integer
                                min={1}
                                max={50}
                                fallback={12}
                                onChange={(n) => set({ numPrismLayers: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Each prism layer is this many times thicker than the one below it (1.1-1.3 typical).">
                                <span className="text-[10px] text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Growth
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.prismExpansionRatio}
                                min={1.01}
                                max={2}
                                fallback={1.2}
                                onChange={(n) => set({ prismExpansionRatio: n })}
                                className={field}
                              />
                            </label>
                          </div>

                          <Tooltip content="y⁺, first-cell height and layer count size the prism stack against the wall (Hybrid element type only). They don't set the overall cell size - that's the Resolution preset. For a plain triangle / quad mesh, near-wall size is Local wall / region size under Advanced. Low y⁺ (~1) resolves the boundary layer; high (~30-100) uses wall functions.">
                            <div className="mt-2.5 p-2.5 bg-surface-2 border border-line rounded space-y-2 cursor-help">
                              <div className="flex items-end gap-2">
                                <label className="flex-1">
                                  <span className="text-[10px] text-fg-2 block mb-1">
                                    Target y⁺
                                  </span>
                                  <input
                                    type="number"
                                    min="0.1"
                                    step="1"
                                    value={yplusDraft}
                                    onChange={(e) => commitYplusDraft(e.target.value)}
                                    onBlur={normalizeYplusDraft}
                                    className={`${field} bg-surface border-line`}
                                  />
                                </label>
                                <div className="flex-1 pb-1">
                                  <span className="text-[10px] text-fg-2 block">Gives Δy</span>
                                  <span className="font-mono font-semibold text-fg">
                                    {state.yplus.first_layer_height_mm?.toFixed(4)} mm
                                  </span>
                                </div>
                              </div>
                              <button
                                onClick={onApplyYPlusToMesh}
                                className="w-full py-1.5 rounded-sm bg-surface border border-line text-fg hover:bg-app font-medium transition-colors"
                              >
                                Apply y⁺ sizing to first cell &amp; layers
                              </button>
                            </div>
                          </Tooltip>
                        </>
                      )}
                    </div>

                    {/* Advanced (collapsible) */}
                    <div className="border-t border-line pt-3">
                      <button
                        onClick={() => setMeshAdvancedOpen((v) => !v)}
                        className="w-full flex items-center justify-between text-[11px] font-semibold text-fg-2 uppercase tracking-wider"
                      >
                        <span>Advanced</span>
                        {meshAdvancedOpen ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                      {meshAdvancedOpen && (
                        <div className="space-y-2.5 mt-2.5">
                          <label className="block">
                            <span className="text-fg-2 block mb-1">Algorithm</span>
                            <select
                              value={g.meshAlgorithm}
                              onChange={(e) =>
                                set({ meshAlgorithm: e.target.value as typeof g.meshAlgorithm })
                              }
                              className="w-full px-2 py-1.5 bg-app border border-line rounded-sm focus:outline-none focus:border-accent"
                            >
                              <option value="frontal_delaunay">
                                Frontal-Delaunay (recommended)
                              </option>
                              <option value="mesh_adapt">MeshAdapt (robust fallback)</option>
                              <option value="delaunay">Delaunay (fast preview)</option>
                            </select>
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <label>
                              <Tooltip content="How fast cells grow moving away from the wall. Low (1.1) = wide gradual transition to the coarse free stream; high (1.5+) = fine band collapses to coarse quickly.">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Growth rate
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.growthRate}
                                min={1.01}
                                max={2}
                                fallback={1.2}
                                onChange={(n) => set({ growthRate: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Target number of edge segments around a full circle of curvature - controls how finely curved boundaries (arcs, leading edges) are faceted.">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Elements / curve
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.elementsPerCurve}
                                integer
                                min={4}
                                max={100}
                                fallback={12}
                                onChange={(n) => set({ elementsPerCurve: n })}
                                className={field}
                              />
                            </label>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <label>
                              <Tooltip content="Absolute smallest cell edge length allowed anywhere, in metres. Blank = auto.">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Min size (m)
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.minElementSize}
                                min={0}
                                allowEmpty
                                placeholder="auto"
                                onChange={(n) => set({ minElementSize: n })}
                                className={field}
                              />
                            </label>
                            <label>
                              <Tooltip content="Cell edge length in the free stream / far field, in metres. Larger = coarser away from the body. Blank = auto (from the Resolution preset).">
                                <span className="text-fg-2 block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                  Max size (m)
                                </span>
                              </Tooltip>
                              <NumberField
                                value={g.maxElementSize}
                                min={0}
                                allowEmpty
                                placeholder="auto"
                                onChange={(n) => set({ maxElementSize: n })}
                                className={field}
                              />
                            </label>
                          </div>
                          <label className="block">
                            <Tooltip content="Cell edge length in the fine band next to wall-tagged edges, in metres. This is the near-wall cell size for a plain triangle / quad mesh (no prism layers). Blank = auto.">
                              <span className="text-fg-2 inline-block mb-1 cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                Local wall / region size (m)
                              </span>
                            </Tooltip>
                            <NumberField
                              value={g.localRefinementSize}
                              min={0}
                              allowEmpty
                              placeholder="auto"
                              onChange={(n) => set({ localRefinementSize: n })}
                              className={field}
                            />
                          </label>
                          <label className="flex items-center justify-between text-fg-2">
                            <Tooltip content="Adds cells where the boundary curves sharply (leading edges, fillets) and where two walls come close together (thin gaps), so those features stay resolved. It also widens the fine near-wall band downstream. Turn off for a tighter fine band that drops to coarse faster.">
                              <span className="cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                Curvature + proximity refinement
                              </span>
                            </Tooltip>
                            <input
                              type="checkbox"
                              checked={g.useProximityRefinement}
                              onChange={(e) => set({ useProximityRefinement: e.target.checked })}
                              className="accent-accent"
                            />
                          </label>
                          <label className="flex items-center justify-between text-fg-2">
                            <Tooltip content="After meshing, runs Laplacian smoothing and Netgen optimisation to improve cell shape - fewer slivers, larger minimum angle, more uniform size transitions. Slightly slower. Leave on unless you want the raw generator output.">
                              <span className="cursor-help decoration-dotted underline decoration-fg-5 underline-offset-2">
                                Optimize / smooth mesh
                              </span>
                            </Tooltip>
                            <input
                              type="checkbox"
                              checked={g.optimizeMesh}
                              onChange={(e) => set({ optimizeMesh: e.target.checked })}
                              className="accent-accent"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="shrink-0 px-4 py-4 mt-3 border-t border-line bg-surface space-y-2">
                {meshTopology === 'structured' ? (
                  <button
                    onClick={onGenerateStructuredMesh}
                    disabled={isMeshing || !blocking}
                    className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-sm transition-colors disabled:opacity-40"
                  >
                    {isMeshing
                      ? 'Generating…'
                      : !blocking
                        ? 'Build blocks first'
                        : meshError
                          ? 'Retry mesh'
                          : meshStale && meshData?.num_elements
                            ? 'Regenerate mesh'
                            : 'Generate mesh'}
                  </button>
                ) : (
                  <button
                    onClick={onGenerateMesh}
                    disabled={isMeshing}
                    className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-sm transition-colors disabled:opacity-40"
                  >
                    {isMeshing
                      ? 'Generating…'
                      : meshError
                        ? 'Retry mesh'
                        : meshStale && meshData?.num_elements
                          ? 'Regenerate mesh'
                          : 'Generate mesh'}
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      {/* 02 PHYSICS & FLOW SETUP */}
      {activeStage === 'physics' && (
        <div className="p-4 space-y-4 text-xs text-fg">
          <div className="p-3 bg-surface-2 border border-line rounded space-y-3">
            <div className="flex items-start gap-2">
              <Wind className="w-4 h-4 text-fg-2 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-fg block">Simulation model</span>
                <span className="text-[10px] text-fg-2 block mt-0.5">
                  These reference values drive y⁺ and mesh sizing.
                </span>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Compressibility
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['incompressible', 'compressible'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updatePhysics({ compressibility: mode })}
                    className={`py-2 rounded-sm text-[11px] font-medium border transition-colors ${
                      state.physics.compressibility === mode
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {mode === 'incompressible' ? 'Incompressible' : 'Compressible'}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-fg-2 block mt-1.5">
                {state.physics.compressibility === 'compressible'
                  ? 'Temperature and pressure participate in the flow solution.'
                  : 'Density is treated as constant in the flow solution.'}
              </span>
            </div>

            <div className="pt-2 border-t border-accent-line">
              <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Flow regime
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['laminar', 'turbulent'] as const).map((regime) => (
                  <button
                    key={regime}
                    onClick={() => updatePhysics({ regime })}
                    className={`py-1.5 rounded-sm text-[11px] font-medium border transition-colors capitalize ${
                      state.physics.regime === regime
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {regime}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3 bg-surface border border-line rounded space-y-3">
            <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
              Reference inlet state
            </span>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  label: 'Velocity (U∞)',
                  key: 'inletVelocity',
                  value: state.physics.inletVelocity,
                  unit: 'm/s',
                  step: '1',
                },
                {
                  label: 'Pressure (p∞)',
                  key: 'inletPressure',
                  value: state.physics.inletPressure,
                  unit: 'Pa',
                  step: '100',
                },
              ].map((field) => (
                <label key={field.key} className="block">
                  <span className="text-fg-2 block mb-1">{field.label}</span>
                  <div className="relative">
                    <input
                      type="number"
                      step={field.step}
                      value={field.value}
                      onChange={(e) =>
                        updatePhysics({ [field.key]: parseFloat(e.target.value) || 0 })
                      }
                      className="w-full px-2 py-1.5 pr-9 bg-surface-2 border border-line rounded font-mono focus:outline-none focus:border-accent"
                    />
                    <span className="absolute right-2 top-1.5 text-[10px] text-fg-4">
                      {field.unit}
                    </span>
                  </div>
                </label>
              ))}
            </div>
            <label className="block">
              <span className="text-fg-2 flex items-center gap-1 mb-1">
                <Thermometer className="w-3 h-3" />
                Temperature (T∞)
              </span>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  value={state.physics.inletTemperature}
                  onChange={(e) =>
                    updatePhysics({ inletTemperature: parseFloat(e.target.value) || 288.15 })
                  }
                  className="w-full px-2 py-1.5 pr-9 bg-surface-2 border border-line rounded font-mono focus:outline-none focus:border-accent"
                />
                <span className="absolute right-2 top-1.5 text-[10px] text-fg-4">K</span>
              </div>
            </label>
          </div>

          <div className="p-3 bg-surface-2 border border-line rounded space-y-3">
            <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
              Fluid properties
            </span>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-fg-2 block mb-1">Density (ρ)</span>
                <NumberField
                  value={state.physics.density}
                  min={0}
                  fallback={1.225}
                  onChange={(n) => updatePhysics({ density: n })}
                  className="w-full px-2 py-1.5 bg-surface border border-line rounded font-mono"
                />
              </label>
              <label className="block">
                <span className="text-fg-2 block mb-1">Kinematic ν</span>
                <NumberField
                  value={state.physics.kinematicViscosity}
                  min={0}
                  fallback={1.5e-5}
                  onChange={(n) => updatePhysics({ kinematicViscosity: n })}
                  className="w-full px-2 py-1.5 bg-surface border border-line rounded font-mono"
                />
              </label>
            </div>
          </div>

          {state.physics.regime === 'turbulent' && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                Turbulence model
              </span>
              <select
                value={state.physics.turbulenceModel}
                onChange={(e) =>
                  updatePhysics({ turbulenceModel: e.target.value as TurbulenceModel })
                }
                className="w-full px-2.5 py-1.5 bg-app border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                <option value="kOmegaSST">k-ω SST (Menter)</option>
                <option value="kEpsilon">Standard k-ε</option>
                <option value="realizableKE">Realizable k-ε</option>
                <option value="RNGkEpsilon">RNG k-ε</option>
                <option value="SpalartAllmaras">Spalart-Allmaras</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* 04 y+ CALCULATOR */}
      {activeStage === 'yplus' && (
        <div className="p-4 space-y-4 text-xs text-fg">
          <div>
            <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-2">
              Target y⁺ Objective
            </span>
            <div className="grid grid-cols-4 gap-1">
              {[1.0, 30.0, 60.0, 100.0].map((val) => (
                <button
                  key={val}
                  onClick={() => updateYPlus({ target_yplus: val })}
                  className={`py-1 rounded text-xs font-mono font-medium border transition-colors ${
                    state.yplus.target_yplus === val
                      ? 'bg-accent-soft text-accent-fg border-accent-line'
                      : 'bg-surface text-fg-2 border-line hover:bg-app'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-fg-2 whitespace-nowrap">Custom y⁺</span>
              <input
                type="number"
                min="0.1"
                step="1"
                value={yplusDraft}
                onChange={(e) => commitYplusDraft(e.target.value)}
                onBlur={normalizeYplusDraft}
                className="w-full px-2 py-1 bg-surface border border-line rounded font-mono focus:outline-none focus:border-accent"
              />
            </label>
            <span className="text-[10px] text-fg-2 block mt-1">
              y⁺ ≈ 1 resolves the viscous sublayer; y⁺ 30-100 uses wall functions.
            </span>
          </div>

          <div className="border-t border-line pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-fg-4 block text-[10px] uppercase">Inputs</span>
                <div className="font-mono text-fg-2 space-y-0.5 mt-1">
                  <div>U∞: {state.boundaries.inletVelocity} m/s</div>
                  <div>L: {state.geometry.chord || 1.0} m</div>
                  <div>ρ: {state.physics.density}</div>
                </div>
              </div>
              <div>
                <span className="text-fg-4 block text-[10px] uppercase">Results</span>
                <div className="font-mono text-fg space-y-0.5 mt-1">
                  <div>Re: {state.yplus.reynolds_number.toExponential(2)}</div>
                  <div>Cf: {state.yplus.skin_friction_coefficient.toFixed(4)}</div>
                  <div>τw: {state.yplus.wall_shear_stress.toFixed(2)} Pa</div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-app border border-line rounded text-center space-y-1">
            <span className="text-[10px] font-semibold text-fg-2 uppercase tracking-wider block">
              First Cell Height (Δy)
            </span>
            <div className="text-xl font-bold font-mono text-fg">
              {state.yplus.first_layer_height_mm.toFixed(4)} mm
            </div>
            <div className="text-[10px] text-fg-2 font-mono">
              Boundary layer thickness: {state.yplus.boundary_layer_thickness_mm.toFixed(1)} mm
            </div>
          </div>

          <button
            onClick={onApplyYPlusToMesh}
            className="w-full py-2 bg-success hover:bg-success text-white font-medium rounded-sm flex items-center justify-center gap-1.5 transition-colors"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>Apply Sizing to Gmsh</span>
          </button>
        </div>
      )}

      {/* 04 SOLVER */}
      {activeStage === 'solver' && stageStatus?.solver?.locked && (
        <StageGate
          title="Solver is locked"
          reason={stageStatus.solver.reason || 'Generate a mesh first.'}
          ctaLabel="Go to Mesh"
          onCta={onSelectStage ? () => onSelectStage('mesh') : undefined}
        />
      )}

      {activeStage === 'solver' && !stageStatus?.solver?.locked && onSetSolution && (
        <SolverPanel
          state={state}
          setSolution={onSetSolution}
          setTimeFormulation={onSetTimeFormulation ?? (() => {})}
          patchNames={solverPatchNames ?? []}
          wallPatches={solverWallPatches ?? []}
          running={state.executionStatus === 'running'}
          onRun={onRunSolver}
          onStop={onStopSolver ?? (() => {})}
          convergence={solverConvergence ?? null}
        />
      )}

      {/* 07 RESULTS */}
      {activeStage === 'results' && stageStatus?.results?.locked && (
        <StageGate
          title="Results are locked"
          reason={stageStatus.results.reason || 'Generate a mesh first.'}
          ctaLabel="Go to Mesh"
          onCta={onSelectStage ? () => onSelectStage('mesh') : undefined}
        />
      )}

      {activeStage === 'results' && !stageStatus?.results?.locked && (
        <div className="flex-1 min-h-0 flex flex-col justify-between">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 text-xs text-fg">
            <div>
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Scalar Field Variable
              </span>
              <select
                value={state.postprocess.activeField}
                onChange={(e) => updatePostProcess({ activeField: e.target.value as any })}
                className="w-full px-2.5 py-1.5 bg-surface border border-line rounded-sm font-medium text-fg focus:outline-none focus:border-accent"
              >
                <option value="U_mag">Velocity Magnitude (|U|)</option>
                <option value="p">Static Pressure (p)</option>
                <option value="k">Turbulent Kinetic Energy (k)</option>
                <option value="omega">Specific Dissipation (ω)</option>
                <option value="vorticity">Vorticity (∇×U)</option>
              </select>
            </div>

            <div className="border-t border-line pt-3 space-y-1.5">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1">
                Scientific Colormap
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(['viridis', 'coolwarm', 'turbo'] as const).map((map) => (
                  <button
                    key={map}
                    onClick={() => updatePostProcess({ colormap: map })}
                    className={`py-1 rounded capitalize text-xs font-medium border transition-colors ${
                      state.postprocess.colormap === map
                        ? 'bg-accent-soft text-accent-fg border-accent-line'
                        : 'bg-surface text-fg-2 border-line hover:bg-app'
                    }`}
                  >
                    {map}
                  </button>
                ))}
              </div>
            </div>

            {/* Line Plot Probe */}
            <div className="border-t border-line pt-3 space-y-2">
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
                Line Plot Probe
              </span>
              <button
                type="button"
                onClick={onCreatePlot}
                className="w-full py-2 px-3 rounded bg-accent hover:bg-accent-hover text-white font-semibold text-[11px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Plot</span>
              </button>
              {/* moved out of the live UI - see layout/LeftStagePanel.tsx (Line Plot Probe), kept for a future tutorial
              <p className="text-[10px] text-fg-2 leading-relaxed">
                Sample flow variables along a 2D line probe and visualize XY convergence or field
                profiles.
              </p>
              */}
            </div>
          </div>

          {/* Pinned ParaView Footer */}
          <div className="px-4 py-4 border-t border-line bg-surface shrink-0">
            <button
              type="button"
              onClick={async () => {
                const { launchParaview, checkParaviewStatus } = await import('../../utils/api');
                const status = await checkParaviewStatus();
                if (!status.available) {
                  alert(
                    'ParaView was not found on your system. Please install ParaView to use external 3D visualization.',
                  );
                  return;
                }
                const res = await launchParaview(projectId);
                if (!res.success) {
                  alert(`Failed to launch ParaView: ${res.detail}`);
                }
              }}
              className="w-full py-2 px-3 rounded border border-line bg-surface text-fg hover:bg-app font-semibold text-[11px] flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Open in ParaView</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
};
