import React, { useEffect, useRef, useState } from 'react';
import { StageId } from './WorkflowStrip';
import { CFDProjectState, TurbulenceModel, SolverType } from '../../types/cfd';
import {
  Layers,
  Upload,
  Zap,
  Play,
  FileCode,
  Sliders,
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
  meshData?: any;
  onRunSolver: () => void;
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
  activeTagTool?: BoundaryTag;
  setActiveTagTool?: (t: BoundaryTag) => void;
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
  boundaryValidation?: { valid: boolean; reason?: string; counts: Record<BoundaryTag, number> };
  boundaryEdgesCount?: number;
  geometryEntitiesCount?: number;
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
  meshData,
  onRunSolver,
  isMeshing,
  onSelectBoundary,
  selectedBoundary,
  onUploadAirfoilFile,
  onUploadAirfoilUrl,
  onUploadDxfFile,
  cadWorkflowStep = 1,
  setCadWorkflowStep,
  flowType = 'external',
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
  activeTagTool = 'inlet',
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
  boundaryValidation = { valid: true, counts: { inlet: 0, outlet: 0, wall: 0, farfield: 0, symmetry: 0, periodic: 0 } },
  boundaryEdgesCount = 0,
  geometryEntitiesCount = 0,
}) => {
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

  // ── Single-Expanded Accordion (default: 1. Geometry expanded, others collapsed) ──
  const [expandedSection, setExpandedSection] = useState<number | null>(1);
  const [meshTopology, setMeshTopology] = useState<'unstructured' | 'structured'>('unstructured');
  const [meshAdvancedOpen, setMeshAdvancedOpen] = useState(false);
  const [flowDirection, setFlowDirection] = useState<'neg_x_pos_x' | 'pos_x_neg_x' | 'neg_y_pos_y' | 'pos_y_neg_y'>('neg_x_pos_x');

  const toggleSection = (s: number) => {
    setExpandedSection(prev => (prev === s ? null : s));
    setCadWorkflowStep?.(s as CadWorkflowStep);
  };

  const openSection = (s: number) => {
    setExpandedSection(s);
    setCadWorkflowStep?.(s as CadWorkflowStep);
  };

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
    <aside className="w-[280px] h-full bg-white border-r border-[#E1E4E8] flex flex-col select-none shrink-0 overflow-y-auto">
      {/* 01 GEOMETRY & 5-STEP PRE-PROCESSING ACCORDION WORKFLOW */}
      {activeStage === 'geometry' && (() => {
        const hasGeometry = !!(geometryBBox && geometryBBox.chord > 0);
        const isDomainValid = flowType === 'internal' || domainValidation.valid;
        const areBoundariesValid = boundaryValidation.valid && boundaryEdgesCount > 0;
        const isAllReady = hasGeometry && isDomainValid && areBoundariesValid;

        const totalCount = 3;
        const readyCount = (hasGeometry ? 1 : 0) + (isDomainValid ? 1 : 0) + (areBoundariesValid ? 1 : 0);
        const percentReady = Math.round((readyCount / totalCount) * 100);

        return (
          <div className="flex flex-col h-full text-xs text-[#171A1F]">
            {/* ── Sticky Pre-Flight Setup Header ── */}
            <div className="p-3 bg-[#F8F9FA] border-b border-[#E1E4E8] sticky top-0 z-10 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#2563EB]" />
                  <span className="text-[11px] font-bold text-[#171A1F] uppercase tracking-wider">
                    Pre-Processing Setup
                  </span>
                </div>
                <span
                  className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    percentReady === 100
                      ? 'bg-green-100 text-green-700'
                      : 'bg-blue-50 text-[#2563EB]'
                  }`}
                >
                  {readyCount}/{totalCount} Ready ({percentReady}%)
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-1.5 bg-[#E1E4E8] rounded-full overflow-hidden mb-1.5">
                <div
                  className={`h-full transition-all duration-300 ${
                    percentReady === 100 ? 'bg-[#16A34A]' : 'bg-[#2563EB]'
                  }`}
                  style={{ width: `${percentReady}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[10px] text-[#69717D]">
                <span>Progressive Pipeline</span>
                <span className="font-semibold text-[#2563EB]">
                  {expandedSection ? `Step ${expandedSection} of 3 Active` : 'All Collapsed'}
                </span>
              </div>
            </div>

            {/* ── Scrollable Accordion Container ── */}
            <div className="p-3 space-y-2 flex-1 overflow-y-auto">

              {/* ══════════════ 1. GEOMETRY INPUT ══════════════ */}
              <div className="border border-[#E1E4E8] rounded-lg overflow-hidden bg-white shadow-2xs transition-all">
                <button
                  onClick={() => toggleSection(1)}
                  className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors cursor-pointer ${
                    expandedSection === 1 ? 'bg-[#F8F9FA] border-b border-[#E1E4E8]' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-[#69717D] shrink-0 transition-transform duration-200 ${
                        expandedSection === 1 ? 'rotate-90 text-[#2563EB]' : ''
                      }`}
                    />
                    <span className="text-[11px] font-bold text-[#171A1F] truncate">
                      1. Geometry
                    </span>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      hasGeometry ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
                    }`}
                    title={hasGeometry ? 'Geometry loaded' : 'No geometry'}
                  />
                </button>

                {expandedSection === 1 && (
                  <div className="p-3 space-y-3">
                    <div>
                      <label className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1">
                        Profile / Body Name
                      </label>
                      <input
                        type="text"
                        value={state.geometry.name}
                        onChange={(e) => updateGeometry({ name: e.target.value })}
                        placeholder="e.g. NACA 0012, Cylinder..."
                        className="w-full px-2.5 py-1.5 bg-[#F5F6F8] hover:bg-white focus:bg-white border border-[#E1E4E8] focus:border-[#2563EB] rounded text-xs font-mono text-[#171A1F] outline-none transition-colors"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block">
                        Import Coordinates / CAD
                      </span>
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
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => fileInputAirfoilRef.current?.click()}
                          className="py-2 px-2 bg-[#F8F9FA] hover:bg-[#EFF6FF] hover:border-[#2563EB] text-[#171A1F] border border-[#E1E4E8] rounded-md text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer"
                        >
                          <Upload className="w-4 h-4 text-[#2563EB]" />
                          <span className="text-[11px]">.dat / .csv Airfoil</span>
                        </button>
                        <button
                          onClick={() => fileInputDxfRef.current?.click()}
                          className="py-2 px-2 bg-[#F8F9FA] hover:bg-[#EFF6FF] hover:border-[#2563EB] text-[#171A1F] border border-[#E1E4E8] rounded-md text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer"
                        >
                          <FileCode className="w-4 h-4 text-[#2563EB]" />
                          <span className="text-[11px]">DXF Drawing</span>
                        </button>
                      </div>

                      {/* Direct .dat Web Link Import */}
                      <div className="pt-0.5">
                        <div className="flex items-center gap-1">
                          <div className="relative flex-1">
                            <Link className="w-3.5 h-3.5 text-[#69717D] absolute left-2 top-2" />
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
                              placeholder="Paste .dat URL (Selig / UIUC)..."
                              className="w-full pl-7 pr-2 py-1.5 bg-[#F5F6F8] hover:bg-white focus:bg-white border border-[#E1E4E8] focus:border-[#2563EB] rounded text-[11px] font-mono text-[#171A1F] outline-none transition-colors"
                            />
                          </div>
                          <button
                            onClick={handleImportUrl}
                            disabled={!airfoilUrl.trim() || isFetchingUrl}
                            className="px-2.5 py-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-40 text-white rounded text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                            title="Fetch .dat file from URL"
                          >
                            <span>{isFetchingUrl ? 'Fetching...' : 'Fetch'}</span>
                          </button>
                        </div>
                        {urlError && (
                          <span className="text-[10px] text-red-600 block mt-1 leading-tight">{urlError}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ══════════════ 2. DOMAIN DEFINITION & TOPOLOGY ══════════════ */}
              <div className="border border-[#E1E4E8] rounded-lg overflow-hidden bg-white shadow-2xs transition-all">
                <button
                  onClick={() => toggleSection(2)}
                  className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors cursor-pointer ${
                    expandedSection === 2 ? 'bg-[#F8F9FA] border-b border-[#E1E4E8]' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-[#69717D] shrink-0 transition-transform duration-200 ${
                        expandedSection === 2 ? 'rotate-90 text-[#2563EB]' : ''
                      }`}
                    />
                    <span className="text-[11px] font-bold text-[#171A1F] truncate">
                      2. Domain Definition
                    </span>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isDomainValid ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
                    }`}
                    title={isDomainValid ? 'Domain valid' : 'Domain undefined'}
                  />
                </button>

                {expandedSection === 2 && (
                  <div className="p-3 space-y-3">
                    {flowType === 'internal' ? (
                      <div className="p-2.5 bg-gray-50 border border-[#E1E4E8] rounded-md text-[11px] text-[#69717D] space-y-1">
                        <span className="font-semibold text-[#171A1F] block">Internal Channel Flow:</span>
                        <p className="text-[10px] leading-relaxed">
                          Drawn CAD walls form the boundary walls directly. Outer domain generation is skipped.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* 1. Topology Preview Cards */}
                        <div className="grid grid-cols-3 gap-1.5">
                          {/* Rectangle */}
                          <button
                            onClick={() => setDomainShape?.('rectangle')}
                            className={`p-1.5 rounded-lg border text-left flex flex-col items-center gap-1 transition-all cursor-pointer ${
                              domainShape === 'rectangle'
                                ? 'bg-blue-50/70 border-[#2563EB] ring-1 ring-[#2563EB] shadow-2xs'
                                : 'bg-white border-[#E1E4E8] hover:border-gray-300'
                            }`}
                          >
                            <svg className="w-full h-8" viewBox="0 0 100 48" fill="none">
                              <rect x="6" y="6" width="88" height="36" rx="2" stroke={domainShape === 'rectangle' ? '#2563EB' : '#94A3B8'} strokeWidth="1.5" strokeDasharray="3 2" fill="#EFF6FF" fillOpacity={domainShape === 'rectangle' ? '0.7' : '0.2'} />
                              <path d="M12 24 L26 24 M23 21 L26 24 L23 27" stroke="#60A5FA" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M42 24 C44 20, 52 21, 62 24 C54 26, 46 26, 42 24 Z" fill="#171A1F" />
                            </svg>
                            <div className="text-center">
                              <div className="text-[10px] font-bold text-[#171A1F]">Rectangle</div>
                            </div>
                          </button>

                          {/* C-Grid */}
                          <button
                            onClick={() => setDomainShape?.('c_grid')}
                            className={`p-1.5 rounded-lg border text-left flex flex-col items-center gap-1 transition-all cursor-pointer ${
                              domainShape === 'c_grid'
                                ? 'bg-blue-50/70 border-[#2563EB] ring-1 ring-[#2563EB] shadow-2xs'
                                : 'bg-white border-[#E1E4E8] hover:border-gray-300'
                            }`}
                          >
                            <svg className="w-full h-8" viewBox="0 0 100 48" fill="none">
                              <path d="M94 8 L36 8 A16 16 0 0 0 36 40 L94 40 Z" stroke={domainShape === 'c_grid' ? '#2563EB' : '#94A3B8'} strokeWidth="1.5" strokeDasharray="3 2" fill="#EFF6FF" fillOpacity={domainShape === 'c_grid' ? '0.7' : '0.2'} />
                              <path d="M10 24 L24 24 M21 21 L24 24 L21 27" stroke="#60A5FA" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M42 24 C44 20, 52 21, 62 24 C54 26, 46 26, 42 24 Z" fill="#171A1F" />
                            </svg>
                            <div className="text-center">
                              <div className="text-[10px] font-bold text-[#171A1F]">C-Grid</div>
                            </div>
                          </button>

                          {/* Farfield */}
                          <button
                            onClick={() => setDomainShape?.('circle')}
                            className={`p-1.5 rounded-lg border text-left flex flex-col items-center gap-1 transition-all cursor-pointer ${
                              domainShape === 'circle'
                                ? 'bg-blue-50/70 border-[#2563EB] ring-1 ring-[#2563EB] shadow-2xs'
                                : 'bg-white border-[#E1E4E8] hover:border-gray-300'
                            }`}
                          >
                            <svg className="w-full h-8" viewBox="0 0 100 48" fill="none">
                              <circle cx="50" cy="24" r="17" stroke={domainShape === 'circle' ? '#2563EB' : '#94A3B8'} strokeWidth="1.5" strokeDasharray="3 2" fill="#EFF6FF" fillOpacity={domainShape === 'circle' ? '0.7' : '0.2'} />
                              <path d="M16 24 L30 24 M27 21 L30 24 L27 27" stroke="#60A5FA" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M42 24 C44 20, 52 21, 62 24 C54 26, 46 26, 42 24 Z" fill="#171A1F" />
                            </svg>
                            <div className="text-center">
                              <div className="text-[10px] font-bold text-[#171A1F]">Farfield</div>
                            </div>
                          </button>
                        </div>

                        {/* 2. Domain Presets */}
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block">
                            Size Presets
                          </span>
                          <div className="grid grid-cols-4 gap-1">
                            {(['tight', 'standard', 'large', 'custom'] as DomainPreset[]).map((p) => {
                              const isSel = domainPreset === p;
                              return (
                                <button
                                  key={p}
                                  onClick={() => onApplyPreset(p)}
                                  className={`py-1 rounded text-[10px] font-medium border transition-colors cursor-pointer capitalize ${
                                    isSel
                                      ? 'bg-[#2563EB] text-white border-[#2563EB]'
                                      : 'bg-[#F8F9FA] text-[#171A1F] border-[#E1E4E8] hover:bg-gray-100'
                                  }`}
                                >
                                  {p}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* 3. Clearance Diagram */}
                        <div className="bg-[#F8F9FA] border border-[#E1E4E8] rounded-lg p-2.5 space-y-2">
                          <div className="flex justify-between items-center text-[10px] text-[#69717D]">
                            <span className="font-semibold uppercase tracking-wider">Clearance Multipliers</span>
                            <span className="font-mono text-[#2563EB]">1c = {(geometryBBox?.chord ?? 1.0).toFixed(2)}m</span>
                          </div>

                          <div className="flex items-center justify-center py-1">
                            <div className="w-full max-w-[210px] border border-dashed border-[#2563EB]/40 bg-blue-50/30 rounded p-2 relative flex flex-col items-center gap-1.5">
                              {/* Top (Lateral) */}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-[#69717D]">↑ Top:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={lateralHeightFactor}
                                  onChange={(e) => {
                                    setLateralHeightFactor?.(+e.target.value);
                                    setDomainPreset?.('custom');
                                  }}
                                  className="w-10 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-center text-[10px] font-mono font-bold text-[#171A1F]"
                                />
                                <span className="text-[9px] font-mono text-[#69717D]">c</span>
                              </div>

                              {/* Center row: Inflow (Upstream) - Airfoil - Outflow (Downstream) */}
                              <div className="flex items-center justify-between w-full px-1">
                                <div className="flex flex-col items-center">
                                  <span className="text-[9px] text-[#69717D]">← Inlet</span>
                                  <div className="flex items-center gap-0.5">
                                    <input
                                      type="number"
                                      min="1"
                                      max="100"
                                      value={upstreamChordFactor}
                                      onChange={(e) => {
                                        setUpstreamChordFactor?.(+e.target.value);
                                        setDomainPreset?.('custom');
                                      }}
                                      className="w-10 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-center text-[10px] font-mono font-bold text-[#171A1F]"
                                    />
                                    <span className="text-[9px] font-mono text-[#69717D]">c</span>
                                  </div>
                                </div>

                                <div className="px-2 py-1 bg-white border border-[#E1E4E8] rounded text-[9px] font-bold text-[#171A1F] shadow-2xs">
                                  [ Geometry ]
                                </div>

                                <div className="flex flex-col items-center">
                                  <span className="text-[9px] text-[#69717D]">Outlet →</span>
                                  <div className="flex items-center gap-0.5">
                                    <input
                                      type="number"
                                      min="1"
                                      max="100"
                                      value={downstreamChordFactor}
                                      onChange={(e) => {
                                        setDownstreamChordFactor?.(+e.target.value);
                                        setDomainPreset?.('custom');
                                      }}
                                      className="w-10 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-center text-[10px] font-mono font-bold text-[#171A1F]"
                                    />
                                    <span className="text-[9px] font-mono text-[#69717D]">c</span>
                                  </div>
                                </div>
                              </div>

                              {/* Bottom (Lateral) */}
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] text-[#69717D]">↓ Bot:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={lateralHeightFactor}
                                  onChange={(e) => {
                                    setLateralHeightFactor?.(+e.target.value);
                                    setDomainPreset?.('custom');
                                  }}
                                  className="w-10 px-1 py-0.5 bg-white border border-[#E1E4E8] rounded text-center text-[10px] font-mono font-bold text-[#171A1F]"
                                />
                                <span className="text-[9px] font-mono text-[#69717D]">c</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Domain Containment Check */}
                        <div className="flex items-center gap-1 text-[10px]">
                          {domainValidation.valid ? <Check className="w-3 h-3 text-[#16A34A]" /> : <AlertCircle className="w-3 h-3 text-[#DC2626]" />}
                          <span className={domainValidation.valid ? 'text-[#171A1F]' : 'text-[#DC2626]'}>
                            {domainValidation.valid ? 'Geometry fully contained' : (domainValidation.reason || 'Obstacle outside domain')}
                          </span>
                        </div>

                        {/* Primary Action Button */}
                        <button
                          onClick={onGenerateDomain}
                          className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-md text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-[0.99]"
                        >
                          <Box className="w-3.5 h-3.5" />
                          <span>Generate Domain</span>
                        </button>

                        <button
                          onClick={onSetSelectedAsDomain}
                          className="w-full py-1 bg-white hover:bg-gray-50 text-[#171A1F] border border-[#E1E4E8] rounded text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          Set Selected CAD Loop as Domain
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* ══════════════ 3. BOUNDARY CONDITIONS ══════════════ */}
              <div className="border border-[#E1E4E8] rounded-lg overflow-hidden bg-white shadow-2xs transition-all">
                <button
                  onClick={() => toggleSection(3)}
                  className={`w-full px-3 py-2 flex items-center justify-between text-left transition-colors cursor-pointer ${
                    expandedSection === 3 ? 'bg-[#F8F9FA] border-b border-[#E1E4E8]' : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-[#69717D] shrink-0 transition-transform duration-200 ${
                        expandedSection === 3 ? 'rotate-90 text-[#2563EB]' : ''
                      }`}
                    />
                    <span className="text-[11px] font-bold text-[#171A1F] truncate">
                      3. Boundary Patches
                    </span>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      areBoundariesValid ? 'bg-[#16A34A]' : 'bg-[#DC2626]'
                    }`}
                    title={areBoundariesValid ? 'Boundaries tagged' : 'Untagged boundaries'}
                  />
                </button>

                {expandedSection === 3 && (
                  <div className="p-3 space-y-3">

                    {/* ── Flow Direction ── */}
                    <div>
                      <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">
                        Flow Direction
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          { label: '−X → +X', icon: '→', value: 'neg_x_pos_x' },
                          { label: '+X → −X', icon: '←', value: 'pos_x_neg_x' },
                          { label: '−Y → +Y', icon: '↑', value: 'neg_y_pos_y' },
                          { label: '+Y → −Y', icon: '↓', value: 'pos_y_neg_y' },
                        ] as const).map(({ label, icon, value }) => {
                          const isSel = flowDirection === value;
                          return (
                            <button
                              key={value}
                              onClick={() => setFlowDirection(value)}
                              className={`py-2 px-2 rounded-lg border text-left flex items-center gap-2 transition-all cursor-pointer ${
                                isSel
                                  ? 'bg-blue-50 border-[#2563EB] text-[#1D4ED8] ring-1 ring-[#2563EB]'
                                  : 'bg-[#F9FAFB] border-[#E1E4E8] text-[#171A1F] hover:bg-gray-50'
                              }`}
                            >
                              <span className="text-base font-bold leading-none">{icon}</span>
                              <span className="text-[10px] font-semibold">{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Tag Palette (3x2 Grid) ── */}
                    <div>
                      <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">
                        Boundary Tags
                      </span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(['inlet', 'outlet', 'wall', 'farfield', 'symmetry', 'periodic'] as BoundaryTag[]).map((tag) => {
                          const conf = BOUNDARY_COLORS[tag];
                          const isSel = activeTagTool === tag;
                          return (
                            <button
                              key={tag}
                              onClick={() => setActiveTagTool?.(tag)}
                              className={`py-1.5 px-2 rounded text-[10px] font-semibold uppercase tracking-wider border transition-all text-left flex items-center justify-between cursor-pointer ${
                                isSel
                                  ? 'text-white shadow-2xs'
                                  : `${conf.bg} ${conf.text} ${conf.border} hover:opacity-80`
                              }`}
                              style={{ backgroundColor: isSel ? conf.hex : undefined, borderColor: conf.hex }}
                            >
                              <span>{tag}</span>
                              <span className="text-[9px] font-mono opacity-80">
                                ({boundaryValidation.counts[tag] || 0})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Auto-Tag Button ── */}
                    <button
                      onClick={() => {
                        // Map flow direction to angle of attack
                        const dirToAoa: Record<string, number> = {
                          'neg_x_pos_x': 0,    // flow left→right (+X), flowDir=(1,0)
                          'pos_x_neg_x': 180,  // flow right→left (-X)
                          'neg_y_pos_y': 90,   // flow bottom→top (+Y)
                          'pos_y_neg_y': -90,  // flow top→bottom (-Y)
                        };
                        setAngleOfAttackDeg?.(dirToAoa[flowDirection] ?? 0);
                        // Small delay to allow AoA state to propagate
                        setTimeout(() => onAutoSuggestTags?.(), 30);
                      }}
                      className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-md text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-[0.99]"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Auto-Tag Based on Flow Direction</span>
                    </button>

                  </div>
                )}
              </div>

            </div>
          </div>
        );
      })()}

      {/* 03 MESH */}
      {activeStage === 'mesh' && (() => {
        const g = state.geometry;
        const set = updateGeometry;
        const resolutionHint: Record<string, string> = {
          coarse: 'Fast preview. Large free-stream / wake cells.',
          medium: 'Balanced. Good default for first runs.',
          fine: 'Dense wake and near-body. Slower to solve.',
        };
        const field = 'w-full px-2 py-1 bg-[#F5F6F8] border border-[#E1E4E8] rounded font-mono focus:outline-none focus:border-[#2563EB]';
        const q = meshData?.quality;
        return (
        <div className="p-4 space-y-4 text-xs text-[#171A1F]">

          {/* Topology */}
          <div>
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Mesh topology</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setMeshTopology('unstructured')} className={`py-2 rounded-md border font-medium transition-colors ${meshTopology === 'unstructured' ? 'bg-[#2563EB] border-[#2563EB] text-white' : 'bg-white border-[#E1E4E8] text-[#69717D] hover:bg-[#F5F6F8]'}`}>Unstructured</button>
              <button disabled title="Structured meshing is not available yet" className="py-2 rounded-md border font-medium bg-[#F8F9FA] border-[#E1E4E8] text-[#A5ACB5] cursor-not-allowed">Structured<span className="text-[9px] block">Coming soon</span></button>
            </div>
          </div>

          {meshTopology === 'structured' ? (
            <div className="p-3 bg-[#F8F9FA] border border-[#E1E4E8] rounded-md text-[10px] text-[#69717D]">Structured meshing will expose mapped blocks, edge counts and grading controls when available.</div>
          ) : (
            <>
              {/* Resolution */}
              <div>
                <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Resolution</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['coarse', 'medium', 'fine'] as const).map((res) => (
                    <button key={res} onClick={() => set({ meshResolution: res })} className={`py-1.5 rounded-md capitalize font-medium border transition-colors ${g.meshResolution === res ? 'bg-[#2563EB] text-white border-[#2563EB]' : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F5F6F8]'}`}>{res}</button>
                  ))}
                </div>
                <span className="text-[10px] text-[#69717D] block mt-1">{resolutionHint[g.meshResolution]}</span>
              </div>

              {/* Element type */}
              <label className="block">
                <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Element type</span>
                <select value={g.elementType} onChange={(e) => set({ elementType: e.target.value as typeof g.elementType })} className="w-full px-2 py-1.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md focus:outline-none focus:border-[#2563EB]">
                  <option value="hybrid">Hybrid — prism layers at wall + triangles</option>
                  <option value="tri">Triangles — fully unstructured</option>
                  <option value="quad_dominant">Quad-dominant — mostly quads</option>
                  <option value="quad">Quads — recombined all-quad</option>
                </select>
              </label>

              {/* Boundary layer */}
              <div className="border-t border-[#E1E4E8] pt-3">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block">Boundary layer</span>
                    <span className="text-[10px] text-[#69717D] block mt-0.5">Prism cells along tagged walls</span>
                  </div>
                  <input type="checkbox" checked={g.usePrismLayers} onChange={(e) => set({ usePrismLayers: e.target.checked })} className="accent-[#2563EB]" />
                </label>
                {g.usePrismLayers && (
                  <>
                    <div className="grid grid-cols-3 gap-2 mt-2.5">
                      <label><span className="text-[10px] text-[#69717D] block mb-1">First cell (mm)</span><input type="number" step="0.005" min="0.001" value={g.firstLayerHeightMm} onChange={(e) => set({ firstLayerHeightMm: parseFloat(e.target.value) || 0.05 })} className={field} /></label>
                      <label><span className="text-[10px] text-[#69717D] block mb-1">Layers</span><input type="number" min="1" max="50" value={g.numPrismLayers} onChange={(e) => set({ numPrismLayers: parseInt(e.target.value) || 12 })} className={field} /></label>
                      <label><span className="text-[10px] text-[#69717D] block mb-1">Growth</span><input type="number" step="0.05" min="1.01" max="2" value={g.prismExpansionRatio} onChange={(e) => set({ prismExpansionRatio: parseFloat(e.target.value) || 1.2 })} className={field} /></label>
                    </div>

                    <div className="mt-2.5 p-2.5 bg-blue-50/60 border border-blue-100 rounded-md space-y-2">
                      <div className="flex items-end gap-2">
                        <label className="flex-1">
                          <span className="text-[10px] text-[#69717D] block mb-1">Target y⁺</span>
                          <input
                            type="number"
                            min="0.1"
                            step="1"
                            value={state.yplus.target_yplus}
                            onChange={(e) => updateYPlus({ target_yplus: parseFloat(e.target.value) || 1 })}
                            className={`${field} bg-white border-blue-200`}
                          />
                        </label>
                        <div className="flex-1 pb-1">
                          <span className="text-[10px] text-[#69717D] block">Gives Δy</span>
                          <span className="font-mono font-semibold text-[#171A1F]">{state.yplus.first_layer_height_mm?.toFixed(4)} mm</span>
                        </div>
                      </div>
                      <button onClick={onApplyYPlusToMesh} className="w-full py-1.5 rounded-md bg-white border border-blue-200 text-[#1D4ED8] font-medium hover:bg-blue-50 transition-colors">
                        Apply y⁺ sizing to first cell & layers
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Advanced (collapsible) */}
              <div className="border-t border-[#E1E4E8] pt-3">
                <button onClick={() => setMeshAdvancedOpen((v) => !v)} className="w-full flex items-center justify-between text-[11px] font-semibold text-[#69717D] uppercase tracking-wider">
                  <span>Advanced</span>
                  {meshAdvancedOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {meshAdvancedOpen && (
                  <div className="space-y-2.5 mt-2.5">
                    <label className="block">
                      <span className="text-[#69717D] block mb-1">Algorithm</span>
                      <select value={g.meshAlgorithm} onChange={(e) => set({ meshAlgorithm: e.target.value as typeof g.meshAlgorithm })} className="w-full px-2 py-1.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md focus:outline-none focus:border-[#2563EB]">
                        <option value="frontal_delaunay">Frontal-Delaunay (recommended)</option>
                        <option value="mesh_adapt">MeshAdapt (robust fallback)</option>
                        <option value="delaunay">Delaunay (fast preview)</option>
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label><span className="text-[#69717D] block mb-1">Growth rate</span><input type="number" min="1.01" max="2" step="0.01" value={g.growthRate} onChange={(e) => set({ growthRate: parseFloat(e.target.value) || 1.2 })} className={field} /></label>
                      <label><span className="text-[#69717D] block mb-1">Elements / curve</span><input type="number" min="4" max="100" step="1" value={g.elementsPerCurve} onChange={(e) => set({ elementsPerCurve: parseInt(e.target.value) || 12 })} className={field} /></label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label><span className="text-[#69717D] block mb-1">Min size (m)</span><input type="number" min="0" step="any" placeholder="auto" value={g.minElementSize || ''} onChange={(e) => set({ minElementSize: parseFloat(e.target.value) || 0 })} className={field} /></label>
                      <label><span className="text-[#69717D] block mb-1">Max size (m)</span><input type="number" min="0" step="any" placeholder="auto" value={g.maxElementSize || ''} onChange={(e) => set({ maxElementSize: parseFloat(e.target.value) || 0 })} className={field} /></label>
                    </div>
                    <label className="block"><span className="text-[#69717D] block mb-1">Local wall / region size (m)</span><input type="number" min="0" step="any" placeholder="auto" value={g.localRefinementSize || ''} onChange={(e) => set({ localRefinementSize: parseFloat(e.target.value) || 0 })} className={field} /></label>
                    <label className="flex items-center justify-between text-[#69717D]"><span>Curvature + proximity refinement</span><input type="checkbox" checked={g.useProximityRefinement} onChange={(e) => set({ useProximityRefinement: e.target.checked })} className="accent-[#2563EB]" /></label>
                    <label className="flex items-center justify-between text-[#69717D]"><span>Optimize / smooth mesh</span><input type="checkbox" checked={g.optimizeMesh} onChange={(e) => set({ optimizeMesh: e.target.checked })} className="accent-[#2563EB]" /></label>
                  </div>
                )}
              </div>
            </>
          )}

          <button onClick={onGenerateMesh} disabled={isMeshing || meshTopology === 'structured'} className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40">
            <Layers className="w-3.5 h-3.5" />
            <span>{isMeshing ? 'Generating…' : 'Generate mesh'}</span>
          </button>

          {/* Last result */}
          {meshData?.num_elements && (
            <div className="border border-[#E1E4E8] rounded-md p-2.5 space-y-1.5 bg-[#FAFBFC]">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-[#69717D]">{meshData.num_nodes} nodes · {meshData.num_elements} cells</span>
                {q && <span className={q.min_angle_degrees < 15 ? 'text-amber-600' : 'text-[#16A34A]'}>{q.min_angle_degrees?.toFixed(0)}° min</span>}
              </div>
              {q && (q.triangles > 0 || q.quads > 0) && (
                <div className="font-mono text-[10px] text-[#A5ACB5]">{q.triangles} tri · {q.quads} quad · skew {q.max_skewness?.toFixed(2)}</div>
              )}
              {Array.isArray(meshData.warnings) && meshData.warnings.map((w: string, i: number) => (
                <div key={i} className="text-[10px] text-amber-600 leading-snug flex gap-1"><AlertCircle className="w-3 h-3 shrink-0 mt-0.5" /><span>{w}</span></div>
              ))}
            </div>
          )}
        </div>
        );
      })()}
      {/* 02 PHYSICS & FLOW SETUP */}
      {activeStage === 'physics' && (
        <div className="p-4 space-y-4 text-xs text-[#171A1F]">
          <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-lg space-y-3">
            <div className="flex items-start gap-2">
              <Wind className="w-4 h-4 text-[#2563EB] mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-[#171A1F] block">Simulation model</span>
                <span className="text-[10px] text-[#69717D] block mt-0.5">These reference values drive y⁺ and mesh sizing.</span>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Compressibility</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['incompressible', 'compressible'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updatePhysics({ compressibility: mode })}
                    className={`py-2 rounded-md text-[11px] font-medium border transition-colors ${
                      state.physics.compressibility === mode
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F5F6F8]'
                    }`}
                  >
                    {mode === 'incompressible' ? 'Incompressible' : 'Compressible'}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-[#69717D] block mt-1.5">
                {state.physics.compressibility === 'compressible'
                  ? 'Temperature and pressure participate in the flow solution.'
                  : 'Density is treated as constant in the flow solution.'}
              </span>
            </div>

            <div className="pt-2 border-t border-blue-100">
              <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Flow regime</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['laminar', 'turbulent'] as const).map((regime) => (
                  <button
                    key={regime}
                    onClick={() => updatePhysics({ regime })}
                    className={`py-1.5 rounded-md text-[11px] font-medium border transition-colors capitalize ${
                      state.physics.regime === regime
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F5F6F8]'
                    }`}
                  >
                    {regime}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3 bg-white border border-[#E1E4E8] rounded-lg space-y-3">
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block">Reference inlet state</span>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Velocity (U∞)', key: 'inletVelocity', value: state.physics.inletVelocity, unit: 'm/s', step: '1' },
                { label: 'Pressure (p∞)', key: 'inletPressure', value: state.physics.inletPressure, unit: 'Pa', step: '100' },
              ].map((field) => (
                <label key={field.key} className="block">
                  <span className="text-[#69717D] block mb-1">{field.label}</span>
                  <div className="relative">
                    <input
                      type="number"
                      step={field.step}
                      value={field.value}
                      onChange={(e) => updatePhysics({ [field.key]: parseFloat(e.target.value) || 0 })}
                      className="w-full px-2 py-1.5 pr-9 bg-[#F8F9FA] border border-[#E1E4E8] rounded font-mono focus:outline-none focus:border-[#2563EB]"
                    />
                    <span className="absolute right-2 top-1.5 text-[10px] text-[#A5ACB5]">{field.unit}</span>
                  </div>
                </label>
              ))}
            </div>
            <label className="block">
              <span className="text-[#69717D] flex items-center gap-1 mb-1"><Thermometer className="w-3 h-3" />Temperature (T∞)</span>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  value={state.physics.inletTemperature}
                  onChange={(e) => updatePhysics({ inletTemperature: parseFloat(e.target.value) || 288.15 })}
                  className="w-full px-2 py-1.5 pr-9 bg-[#F8F9FA] border border-[#E1E4E8] rounded font-mono focus:outline-none focus:border-[#2563EB]"
                />
                <span className="absolute right-2 top-1.5 text-[10px] text-[#A5ACB5]">K</span>
              </div>
            </label>
          </div>

          <div className="p-3 bg-[#F8F9FA] border border-[#E1E4E8] rounded-lg space-y-3">
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block">Fluid properties</span>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="text-[#69717D] block mb-1">Density (ρ)</span><input type="number" step="0.001" value={state.physics.density} onChange={(e) => updatePhysics({ density: parseFloat(e.target.value) || 1.225 })} className="w-full px-2 py-1.5 bg-white border border-[#E1E4E8] rounded font-mono" /></label>
              <label className="block"><span className="text-[#69717D] block mb-1">Kinematic ν</span><input type="number" step="1e-7" value={state.physics.kinematicViscosity} onChange={(e) => updatePhysics({ kinematicViscosity: parseFloat(e.target.value) || 1.5e-5 })} className="w-full px-2 py-1.5 bg-white border border-[#E1E4E8] rounded font-mono" /></label>
            </div>
          </div>

          {state.physics.regime === 'turbulent' && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block">Turbulence model</span>
              <select value={state.physics.turbulenceModel} onChange={(e) => updatePhysics({ turbulenceModel: e.target.value as TurbulenceModel })} className="w-full px-2.5 py-1.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md font-medium text-[#171A1F] focus:outline-none focus:border-[#2563EB]">
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
        <div className="p-4 space-y-4 text-xs text-[#171A1F]">
          <div>
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-2">
              Target y⁺ Objective
            </span>
            <div className="grid grid-cols-4 gap-1">
              {[1.0, 30.0, 60.0, 100.0].map((val) => (
                <button
                  key={val}
                  onClick={() => updateYPlus({ target_yplus: val })}
                  className={`py-1 rounded text-xs font-mono font-medium border transition-colors ${
                    state.yplus.target_yplus === val
                      ? 'bg-[#2563EB] text-white border-[#2563EB]'
                      : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F5F6F8]'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 mt-2">
              <span className="text-[10px] text-[#69717D] whitespace-nowrap">Custom y⁺</span>
              <input
                type="number"
                min="0.1"
                step="1"
                value={state.yplus.target_yplus}
                onChange={(e) => updateYPlus({ target_yplus: parseFloat(e.target.value) || 1 })}
                className="w-full px-2 py-1 bg-white border border-[#E1E4E8] rounded font-mono focus:outline-none focus:border-[#2563EB]"
              />
            </label>
            <span className="text-[10px] text-[#69717D] block mt-1">y⁺ ≈ 1 resolves the viscous sublayer; y⁺ 30–100 uses wall functions.</span>
          </div>

          <div className="border-t border-[#E1E4E8] pt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-[#A5ACB5] block text-[10px] uppercase">Inputs</span>
                <div className="font-mono text-[#69717D] space-y-0.5 mt-1">
                  <div>U∞: {state.boundaries.inletVelocity} m/s</div>
                  <div>L: {state.geometry.chord || 1.0} m</div>
                  <div>ρ: {state.physics.density}</div>
                </div>
              </div>
              <div>
                <span className="text-[#A5ACB5] block text-[10px] uppercase">Results</span>
                <div className="font-mono text-[#171A1F] space-y-0.5 mt-1">
                  <div>Re: {state.yplus.reynolds_number.toExponential(2)}</div>
                  <div>Cf: {state.yplus.skin_friction_coefficient.toFixed(4)}</div>
                  <div>τw: {state.yplus.wall_shear_stress.toFixed(2)} Pa</div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md text-center space-y-1">
            <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block">
              First Cell Height (Δy)
            </span>
            <div className="text-xl font-bold font-mono text-[#171A1F]">
              {state.yplus.first_layer_height_mm.toFixed(4)} mm
            </div>
            <div className="text-[10px] text-[#69717D] font-mono">
              Boundary layer thickness: {state.yplus.boundary_layer_thickness_mm.toFixed(1)} mm
            </div>
          </div>

          <button
            onClick={onApplyYPlusToMesh}
            className="w-full py-2 bg-[#16A34A] hover:bg-[#15803D] text-white font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors"
          >
            <Zap className="w-3.5 h-3.5 fill-current" />
            <span>Apply Sizing to Gmsh</span>
          </button>
        </div>
      )}

      {/* 05 BOUNDARIES */}
      {activeStage === 'boundaries' && (
        <div className="p-4 space-y-3 text-xs text-[#171A1F]">
          <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block">
            Boundary Patches
          </span>
          <div className="space-y-1">
            {[
              { name: 'inlet', type: 'Velocity Inlet', val: `${state.boundaries.inletVelocity} m/s` },
              { name: 'outlet', type: 'Pressure Outlet', val: '0 Pa' },
              { name: 'airfoil', type: 'No-Slip Wall', val: 'Solid' },
              { name: 'top', type: 'Slip Wall', val: 'Free' },
              { name: 'bottom', type: 'Slip Wall', val: 'Free' },
            ].map((patch) => {
              const isSelected = selectedBoundary === patch.name;
              return (
                <button
                  key={patch.name}
                  onClick={() => onSelectBoundary(patch.name)}
                  className={`w-full p-2.5 rounded-md border text-left flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-blue-50/60 border-[#2563EB] text-[#171A1F]'
                      : 'bg-white border-[#E1E4E8] text-[#69717D] hover:bg-[#F5F6F8]'
                  }`}
                >
                  <div>
                    <span className="font-semibold text-[#171A1F] block">{patch.name}</span>
                    <span className="text-[10px] text-[#69717D]">{patch.type}</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#2563EB] font-medium">{patch.val}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 06 SOLVER */}
      {activeStage === 'solver' && (
        <div className="p-4 space-y-4 text-xs text-[#171A1F]">
          <div>
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">
              OpenFOAM Solver
            </span>
            <select
              value={state.physics.solver}
              onChange={(e) => updatePhysics({ solver: e.target.value as SolverType })}
              className="w-full px-2.5 py-1.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md font-mono text-[#171A1F]"
            >
              <option value="simpleFoam">simpleFoam (Steady Incompressible)</option>
              <option value="pisoFoam">pisoFoam (Transient PISO)</option>
              <option value="icoFoam">icoFoam (Laminar Transient)</option>
              <option value="pimpleFoam">pimpleFoam (PIMPLE)</option>
            </select>
          </div>

          <div className="border-t border-[#E1E4E8] pt-3 space-y-2.5">
            <div className="flex justify-between items-center">
              <span className="text-[#69717D]">Max Iterations</span>
              <input
                type="number"
                step="50"
                value={state.solver.iterations}
                onChange={(e) => updateSolver({ iterations: parseInt(e.target.value) || 150 })}
                className="w-20 px-2 py-1 bg-[#F5F6F8] border border-[#E1E4E8] rounded text-right font-mono"
              />
            </div>

            <div className="flex justify-between items-center">
              <span className="text-[#69717D]">Write Interval</span>
              <input
                type="number"
                step="10"
                value={state.solver.writeInterval}
                onChange={(e) => updateSolver({ writeInterval: parseInt(e.target.value) || 25 })}
                className="w-20 px-2 py-1 bg-[#F5F6F8] border border-[#E1E4E8] rounded text-right font-mono"
              />
            </div>
          </div>

          <button
            onClick={onRunSolver}
            disabled={state.executionStatus === 'running'}
            className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run OpenFOAM Solver</span>
          </button>
        </div>
      )}

      {/* 07 RESULTS */}
      {activeStage === 'results' && (
        <div className="p-4 space-y-4 text-xs text-[#171A1F]">
          <div>
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">
              Scalar Field Variable
            </span>
            <select
              value={state.postprocess.activeField}
              onChange={(e) => updatePostProcess({ activeField: e.target.value as any })}
              className="w-full px-2.5 py-1.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md font-medium text-[#171A1F]"
            >
              <option value="U_mag">Velocity Magnitude (|U|)</option>
              <option value="p">Static Pressure (p)</option>
              <option value="k">Turbulent Kinetic Energy (k)</option>
              <option value="omega">Specific Dissipation (ω)</option>
              <option value="vorticity">Vorticity (∇×U)</option>
            </select>
          </div>

          <div className="border-t border-[#E1E4E8] pt-3 space-y-1.5">
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1">
              Scientific Colormap
            </span>
            <div className="grid grid-cols-3 gap-1">
              {(['viridis', 'coolwarm', 'turbo'] as const).map((map) => (
                <button
                  key={map}
                  onClick={() => updatePostProcess({ colormap: map })}
                  className={`py-1 rounded capitalize text-xs font-medium border transition-colors ${
                    state.postprocess.colormap === map
                      ? 'bg-[#2563EB] text-white border-[#2563EB]'
                      : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F5F6F8]'
                  }`}
                >
                  {map}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
