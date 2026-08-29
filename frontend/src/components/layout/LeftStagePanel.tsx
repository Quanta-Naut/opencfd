import React, { useEffect, useRef, useState } from 'react';
import { StageId, StageStatus } from './WorkflowStrip';
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
  Lock,
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
import { Blocking, EdgeLaw, propagateNodeCounts, splitBlock, deleteBlock, applyTargetCellSize, currentCellSize } from '../../types/blocking';

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
  meshError?: string | null;
  meshStale?: boolean;
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
  onBuildBlocks?: (kind: 'hgrid' | 'ogrid' | 'cgrid') => void;
  onUpdateBlocking?: (bk: Blocking | null) => void;
  onGenerateStructuredMesh?: () => void;
  ogridBodies?: { index: number; name: string; blockId: string | null; wrapped: boolean }[];
  onWrapBody?: (bodyIndex: number) => void;
  structuredHint?: 'hgrid' | 'ogrid' | 'cgrid';
  structuredSmooth?: boolean;
  setStructuredSmooth?: (v: boolean) => void;
}

/**
 * Number input that lets you actually type. It keeps a free-form draft string
 * (so "0", "0.", "0.02", "" and "-" are all allowed while editing), commits any
 * finite value on the fly, and only clamps to [min,max] / falls back on blur.
 * Never snaps mid-keystroke the way `parseFloat(v) || fallback` does.
 */
const NumberField: React.FC<{
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: string;
  integer?: boolean;
  /** empty field / 0 is a valid value meaning "auto" - commit 0, show blank */
  allowEmpty?: boolean;
  /** value to restore when the field is blurred empty/invalid (defaults to current value) */
  fallback?: number;
  className?: string;
  placeholder?: string;
}> = ({ value, onChange, min, max, step, integer, allowEmpty, fallback, className, placeholder }) => {
  const fmt = (n: number) => (allowEmpty && !n ? '' : String(n));
  const [draft, setDraft] = useState(() => fmt(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, allowEmpty]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      step={step}
      value={draft}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => {
        const raw = e.target.value;
        // digits, one dot, optional leading minus, optional scientific exponent
        if (!/^-?\d*\.?\d*(?:[eE][-+]?\d*)?$/.test(raw)) return;
        setDraft(raw);
        const n = integer ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(n)) onChange(n);
        else if (raw === '' && allowEmpty) onChange(0);
      }}
      onBlur={(e) => {
        editing.current = false;
        const raw = e.target.value.trim();
        let n = integer ? parseInt(raw, 10) : parseFloat(raw);
        if (!Number.isFinite(n)) {
          if (allowEmpty) { onChange(0); setDraft(''); return; }
          n = fallback ?? value;
        }
        if (min != null && n < min) n = min;
        if (max != null && n > max) n = max;
        onChange(n);
        setDraft(fmt(n));
      }}
    />
  );
};

const StageGate: React.FC<{
  title: string;
  reason?: string;
  missing?: string[];
  ctaLabel?: string;
  onCta?: () => void;
}> = ({ title, reason, missing, ctaLabel = 'Go to Geometry', onCta }) => (
  <div className="p-4">
    <div className="p-4 bg-[#F8F9FA] border border-[#E1E4E8] rounded-lg">
      <div className="flex items-center gap-2 mb-1.5">
        <Lock className="w-4 h-4 text-[#69717D]" />
        <span className="text-[12px] font-bold text-[#171A1F]">{title}</span>
      </div>
      {reason && <p className="text-[11px] text-[#69717D] mb-3">{reason}</p>}
      {missing && missing.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {missing.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] text-[#171A1F]">
              <span className="mt-0.5 w-3.5 h-3.5 rounded-full border border-[#DC2626] text-[#DC2626] flex items-center justify-center text-[9px] shrink-0">✕</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}
      {onCta && (
        <button
          onClick={onCta}
          className="w-full py-1.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium transition-colors"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  </div>
);

/**
 * Structured (block-structured) mesh controls, in two steps like the Geometry
 * stage: (1) Blocking - pick a topology type and generate the mapped block
 * layout; (2) Mesh sizing - per-direction cell counts and wall grading.
 */
const StructuredMeshPanel: React.FC<{
  blocking: Blocking | null;
  onBuildBlocks?: (kind: 'hgrid' | 'ogrid' | 'cgrid') => void;
  onUpdateBlocking?: (bk: Blocking | null) => void;
  ogridBodies?: { index: number; name: string; blockId: string | null; wrapped: boolean }[];
  onWrapBody?: (bodyIndex: number) => void;
  structuredHint?: 'hgrid' | 'ogrid' | 'cgrid';
  structuredSmooth?: boolean;
  setStructuredSmooth?: (v: boolean) => void;
  field: string;
}> = ({ blocking, onBuildBlocks, onUpdateBlocking, ogridBodies, onWrapBody, structuredHint, structuredSmooth, setStructuredSmooth, field }) => {
  const hasBlocks = !!blocking && blocking.blocks.length > 0;
  const recommended: 'hgrid' | 'ogrid' | 'cgrid' = structuredHint ?? 'hgrid';
  const [kind, setKind] = useState<'hgrid' | 'ogrid' | 'cgrid'>(recommended);
  const [openStep, setOpenStep] = useState<1 | 2>(1);
  const kindRef = useRef(recommended);
  useEffect(() => {
    // follow the recommendation until the user has picked, and until blocks exist
    if (!hasBlocks && kindRef.current !== recommended) {
      kindRef.current = recommended;
      setKind(recommended);
    }
  }, [recommended, hasBlocks]);
  useEffect(() => { if (hasBlocks) setOpenStep(2); }, [hasBlocks]);

  const pick = (k: 'hgrid' | 'ogrid' | 'cgrid') => { kindRef.current = k; setKind(k); };

  const kindBlurb: Record<'hgrid' | 'ogrid' | 'cgrid', string> = {
    hgrid: 'One block per vertical strip of the domain. Ramps become slanted-floor blocks; floor / ceiling steps split automatically.',
    ogrid: 'Blocks the domain, then wraps every body inside it in a 4-block ring (fine at the wall, coarser outward). The rest stays H-grid.',
    cgrid: 'Wraps an airfoil in 2 wrap blocks out to an offset curve, plus 2 wake blocks trailing to the outlet. Best for lifting bodies with a sharp trailing edge.',
  };

  // ── Step 1: Blocking ──
  const step1 = (
    <div className="space-y-2.5">
      <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block">Topology</span>
      <div className="grid grid-cols-3 gap-1.5">
        {([
          ['hgrid', 'H-grid', 'Box / channel / step'],
          ['ogrid', 'O-grid', 'Body in the flow'],
          ['cgrid', 'C-grid', 'Airfoil + wake'],
        ] as const).map(([k, label, hint]) => (
          <button
            key={k}
            onClick={() => pick(k)}
            className={`p-2 rounded-lg border text-left transition-colors ${
              kind === k
                ? 'border-[#2563EB] bg-blue-50'
                : 'bg-white border-[#E1E4E8] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
            }`}
          >
            <span className={`text-[11px] font-semibold block ${kind === k ? 'text-[#1D4ED8]' : 'text-[#171A1F]'}`}>
              {label}
              {recommended === k && <span className="ml-1 text-[9px] font-medium text-[#059669]">rec.</span>}
            </span>
            <span className="text-[9px] text-[#69717D] block leading-tight mt-0.5">{hint}</span>
          </button>
        ))}
      </div>

      <p className="text-[10px] text-[#69717D] leading-relaxed">{kindBlurb[kind]}</p>

      <button
        onClick={() => onBuildBlocks?.(kind)}
        className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium rounded-md transition-colors"
      >
        {hasBlocks ? 'Rebuild blocks' : 'Generate blocks'}
      </button>

      {hasBlocks && blocking && (
        <>
          <div className="border-t border-[#E1E4E8] pt-2.5 space-y-1.5">
            <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block">
              Blocks ({blocking.blocks.length})
            </span>
            {blocking.blocks.map((blk, i) => (
              <div key={blk.id} className="flex items-center gap-1.5 text-[10px]">
                <span className="text-[#69717D] w-12 shrink-0">Block {i + 1}</span>
                <button
                  onClick={() => onUpdateBlocking?.(propagateNodeCounts(splitBlock(blocking, blk.id, 'x')))}
                  className="flex-1 py-1 rounded border border-[#E1E4E8] bg-white hover:border-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                >
                  Split &#8596;
                </button>
                <button
                  onClick={() => onUpdateBlocking?.(propagateNodeCounts(splitBlock(blocking, blk.id, 'y')))}
                  className="flex-1 py-1 rounded border border-[#E1E4E8] bg-white hover:border-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                >
                  Split &#8597;
                </button>
                <button
                  onClick={() => onUpdateBlocking?.(propagateNodeCounts(deleteBlock(blocking, blk.id)))}
                  disabled={blocking.blocks.length <= 1}
                  className="px-2 py-1 rounded border border-[#E1E4E8] bg-white text-[#DC2626] hover:border-[#DC2626] transition-colors disabled:opacity-30"
                >
                  Del
                </button>
              </div>
            ))}
            <p className="text-[9px] text-[#69717D]">Drag block corners on the canvas to reshape.</p>
          </div>

          {ogridBodies && ogridBodies.length > 0 && (
            <div className="border-t border-[#E1E4E8] pt-2.5 space-y-1.5">
              <span className="text-[10px] font-semibold text-[#69717D] uppercase tracking-wider block">Bodies</span>
              {ogridBodies.map((b) => (
                <div key={b.index} className="flex items-center gap-1.5 text-[10px]">
                  <span className="flex-1 text-[#171A1F] truncate">{b.name}</span>
                  {b.wrapped ? (
                    <span className="px-2 py-1 text-[#059669] font-medium">Wrapped</span>
                  ) : (
                    <button
                      onClick={() => onWrapBody?.(b.index)}
                      disabled={!b.blockId}
                      className="px-2 py-1 rounded border border-[#E1E4E8] bg-white hover:border-[#2563EB] hover:text-[#1D4ED8] transition-colors disabled:opacity-30"
                    >
                      Wrap O-grid
                    </button>
                  )}
                </div>
              ))}
              {ogridBodies.some((b) => !b.blockId && !b.wrapped) && (
                <p className="text-[9px] text-[#69717D] leading-relaxed">
                  Body must sit clear of the domain edges to wrap.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  // ── Step 2: Mesh sizing ──
  let step2: React.ReactNode = (
    <p className="text-[10px] text-[#69717D]">Generate the blocks first.</p>
  );
  if (hasBlocks && blocking) {
    const parent: Record<string, string> = {};
    blocking.edges.forEach((e) => { parent[e.id] = e.id; });
    const find = (x: string): string => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    blocking.blocks.forEach((blk) => {
      parent[find(blk.edges[0])] = find(blk.edges[2]);
      parent[find(blk.edges[1])] = find(blk.edges[3]);
    });
    (blocking.links ?? []).forEach((grp) => grp.slice(1).forEach((id) => {
      if (parent[grp[0]] && parent[id]) parent[find(id)] = find(grp[0]);
    }));
    const groups: Record<string, string[]> = {};
    blocking.edges.forEach((e) => { (groups[find(e.id)] ||= []).push(e.id); });
    const groupList = Object.entries(groups);
    const edgeById = (id: string) => blocking.edges.find((e) => e.id === id)!;
    const patchLabel = (ids: string[]) => {
      const ps = Array.from(new Set(ids.map((id) => edgeById(id).patch).filter(Boolean)));
      return ps.length ? ps.join(' / ') : 'interior';
    };
    const applyToGroup = (ids: string[], patch: Partial<{ nodes: number; law: EdgeLaw; ratio: number }>) => {
      if (!onUpdateBlocking) return;
      onUpdateBlocking(propagateNodeCounts({
        ...blocking,
        edges: blocking.edges.map((e) => (ids.includes(e.id) ? { ...e, ...patch } : e)),
      }));
    };

    const bkNow = blocking;
    step2 = (
      <div className="space-y-2.5">
        <div className="flex items-end gap-2">
          <label className="flex-1">
            <Tooltip content="Target cell edge length. Every direction's node count is set from this and its block-edge length, so a short edge gets few cells and the mesh reads uniform. Adjust a direction below to override.">
              <span className="text-[10px] text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Target cell size</span>
            </Tooltip>
            <NumberField
              value={Number(currentCellSize(bkNow).toPrecision(3))}
              min={1e-4}
              onChange={(v) => onUpdateBlocking?.(applyTargetCellSize(bkNow, v))}
              className={field}
            />
          </label>
          <button
            onClick={() => onUpdateBlocking?.(applyTargetCellSize(bkNow, currentCellSize(bkNow) * 0.5))}
            className="px-2 py-1.5 text-[10px] rounded border border-[#E1E4E8] bg-white hover:border-[#2563EB] hover:text-[#1D4ED8] transition-colors"
          >
            Finer &times;2
          </button>
        </div>

        {setStructuredSmooth && (
          <label className="flex items-center justify-between text-[10px] text-[#69717D]">
            <Tooltip content="After meshing, relax the interior grid with an elliptic (Winslow) pass so grid lines flow across block seams. Kept only if it does not make the worst cell worse.">
              <span className="cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Elliptic smoothing</span>
            </Tooltip>
            <input type="checkbox" checked={structuredSmooth !== false} onChange={(ev) => setStructuredSmooth(ev.target.checked)} className="accent-[#2563EB]" />
          </label>
        )}

        <p className="text-[10px] text-[#69717D] leading-relaxed pt-1 border-t border-[#E1E4E8]">
          Each group below is one direction of the grid. Opposite and shared block edges stay equal automatically.
        </p>
        {groupList.map(([gid, ids], i) => {
          const e = edgeById(ids[0]);
          return (
            <div key={gid} className="p-2.5 bg-[#F8F9FA] border border-[#E1E4E8] rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#171A1F]">Direction {String.fromCharCode(65 + i)}</span>
                <span className="text-[10px] text-[#69717D] lowercase">along {patchLabel(ids)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <Tooltip content="Grid nodes along this direction (cells = nodes minus one).">
                    <span className="text-[10px] text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Nodes</span>
                  </Tooltip>
                  <NumberField value={e.nodes} integer min={2} max={600} fallback={30} onChange={(n) => applyToGroup(ids, { nodes: n })} className={field} />
                </label>
                <label>
                  <Tooltip content="Last cell / first cell along the edge. 1 = uniform. Above 1 clusters cells toward the start (wall).">
                    <span className="text-[10px] text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Grading ratio</span>
                  </Tooltip>
                  <NumberField value={e.ratio} min={0.05} max={20} fallback={1} onChange={(n) => applyToGroup(ids, { ratio: n })} className={field} />
                </label>
              </div>
              <label className="block">
                <span className="text-[10px] text-[#69717D] block mb-1">Distribution</span>
                <select
                  value={e.law}
                  onChange={(ev) => applyToGroup(ids, { law: ev.target.value as EdgeLaw })}
                  className="w-full px-2 py-1.5 bg-white border border-[#E1E4E8] rounded-md text-[11px] focus:outline-none focus:border-[#2563EB]"
                >
                  <option value="uniform">Uniform</option>
                  <option value="geometric">Geometric (cluster one end)</option>
                  <option value="bump">Bump (cluster both ends)</option>
                </select>
              </label>
            </div>
          );
        })}
      </div>
    );
  }

  const stepRow = (n: 1 | 2, label: string, body: React.ReactNode) => {
    const open = openStep === n;
    const locked = n === 2 && !hasBlocks;
    return (
      <div className="border-t border-[#E1E4E8] first:border-t-0">
        <button
          onClick={() => !locked && setOpenStep(n)}
          disabled={locked}
          className={`w-full flex items-center gap-2 py-2.5 text-left ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold shrink-0 border ${open ? 'bg-blue-50 text-[#2563EB] border-[#2563EB]' : 'bg-[#F1F3F5] text-[#A5ACB5] border-transparent'}`}>{n}</span>
          <span className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${open ? 'text-[#2563EB]' : 'text-[#69717D]'}`}>{label}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#A5ACB5] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && <div className="pb-3">{body}</div>}
      </div>
    );
  };

  return (
    <div>
      {stepRow(1, 'Blocking', step1)}
      {stepRow(2, 'Mesh sizing', step2)}
    </div>
  );
};

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
  meshError,
  meshStale,
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
  boundaryValidation = { valid: true, counts: { inlet: 0, outlet: 0, wall: 0, farfield: 0, symmetry: 0, periodic: 0 } },
  boundaryEdgesCount = 0,
  geometryEntitiesCount = 0,
  onSelectStage,
  stageStatus,
  blocking,
  onBuildBlocks,
  onUpdateBlocking,
  onGenerateStructuredMesh,
  ogridBodies,
  onWrapBody,
  structuredHint,
  structuredSmooth,
  setStructuredSmooth,
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

  const [meshTopology, setMeshTopology] = useState<'unstructured' | 'structured'>('unstructured');
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
    setYplusDraft((prev) => (parseFloat(prev) === state.yplus.target_yplus ? prev : String(state.yplus.target_yplus ?? '')));
  }, [state.yplus.target_yplus]);
  const commitYplusDraft = (raw: string) => {
    setYplusDraft(raw);
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) updateYPlus({ target_yplus: parsed });
  };
  const normalizeYplusDraft = () => {
    const parsed = parseFloat(yplusDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) setYplusDraft(String(state.yplus.target_yplus ?? 30));
  };
  const [flowDirection, setFlowDirection] = useState<'neg_x_pos_x' | 'pos_x_neg_x' | 'neg_y_pos_y' | 'pos_y_neg_y'>('neg_x_pos_x');

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
    <aside className={`w-[280px] h-full bg-white border-r border-[#E1E4E8] flex flex-col select-none shrink-0 ${activeStage === 'mesh' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      {/* 01 GEOMETRY · DOMAIN · BOUNDARY PATCHES (single-open accordion) */}
      {activeStage === 'geometry' && (() => {
        const isInternal = flowType === 'internal';
        const inletCount = boundaryValidation.counts?.inlet ?? 0;
        const outletCount = boundaryValidation.counts?.outlet ?? 0;

        // Selection state: subtle blue outline + tint instead of a solid fill.
        const sel = (active: boolean) =>
          active
            ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]'
            : 'border-[#E1E4E8] bg-white text-[#69717D] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]';

        const toggle = (n: CadWorkflowStep) => {
          setOpenGeoSection((prev) => (prev === n ? null : n));
          if (openGeoSection !== n) setCadWorkflowStep?.(n);
        };

        const section = (n: CadWorkflowStep, label: string, body: React.ReactNode) => {
          const isOpen = openGeoSection === n;
          return (
            <div className="border border-[#E1E4E8] rounded-lg bg-white overflow-hidden">
              <button
                onClick={() => toggle(n)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${isOpen ? 'bg-[#F8FAFC]' : 'hover:bg-[#F8FAFC]'}`}
              >
                <span className={`w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold shrink-0 border ${isOpen ? 'bg-blue-50 text-[#2563EB] border-[#2563EB]' : 'bg-[#F1F3F5] text-[#A5ACB5] border-transparent'}`}>{n}</span>
                <span className={`flex-1 text-[11px] font-semibold uppercase tracking-wider ${isOpen ? 'text-[#2563EB]' : 'text-[#69717D]'}`}>{label}</span>
                <ChevronDown className={`w-3.5 h-3.5 text-[#A5ACB5] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && <div className="px-3 pb-3.5 pt-1">{body}</div>}
            </div>
          );
        };

        return (
          <div className="p-3 pb-10 space-y-2 text-xs text-[#171A1F]">

            {/* ══════════ 1 · GEOMETRY ══════════ */}
            {section(1, 'Geometry', (
              <div className="space-y-4">
                <input type="file" ref={fileInputAirfoilRef} onChange={handleAirfoilChange} accept=".dat,.csv,.txt" className="hidden" />
                <input type="file" ref={fileInputDxfRef} onChange={handleDxfChange} accept=".dxf" className="hidden" />

                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => fileInputAirfoilRef.current?.click()} className="py-3 px-2 bg-white hover:bg-[#F8FAFC] border border-[#E1E4E8] hover:border-[#2563EB] rounded-lg font-medium flex flex-col items-center gap-1.5 transition-all">
                    <Upload className="w-4 h-4 text-[#2563EB]" />
                    <span className="text-[11px] text-[#171A1F]">.dat / .csv</span>
                    <span className="text-[9px] text-[#A5ACB5]">airfoil coords</span>
                  </button>
                  <button onClick={() => fileInputDxfRef.current?.click()} className="py-3 px-2 bg-white hover:bg-[#F8FAFC] border border-[#E1E4E8] hover:border-[#2563EB] rounded-lg font-medium flex flex-col items-center gap-1.5 transition-all">
                    <FileCode className="w-4 h-4 text-[#2563EB]" />
                    <span className="text-[11px] text-[#171A1F]">DXF drawing</span>
                    <span className="text-[9px] text-[#A5ACB5]">2D CAD outline</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-wider text-[#A5ACB5]">
                  <span className="h-px flex-1 bg-[#E1E4E8]" />
                  or paste a URL
                  <span className="h-px flex-1 bg-[#E1E4E8]" />
                </div>

                <div className="space-y-1.5">
                  <div className="relative">
                    <Link className="w-3.5 h-3.5 text-[#A5ACB5] absolute left-2.5 top-2.5" />
                    <input
                      type="url"
                      value={airfoilUrl}
                      onChange={(e) => { setAirfoilUrl(e.target.value); if (urlError) setUrlError(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleImportUrl(); } }}
                      placeholder="Selig / UIUC .dat link…"
                      className="w-full pl-8 pr-2 py-2 bg-[#F8FAFC] focus:bg-white border border-[#E1E4E8] focus:border-[#2563EB] rounded-lg text-[11px] font-mono text-[#171A1F] outline-none transition-colors"
                    />
                  </div>
                  <button onClick={handleImportUrl} disabled={!airfoilUrl.trim() || isFetchingUrl} className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-40 text-white rounded-lg text-[11px] font-semibold transition-colors">
                    {isFetchingUrl ? 'Fetching…' : 'Fetch airfoil'}
                  </button>
                  {urlError && <span className="text-[10px] text-red-600 block leading-tight">{urlError}</span>}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-[#A5ACB5]">Everything you draw here is geometry.</span>
                  <button onClick={onClearGeometry} title="Clear all geometry" className="px-2.5 py-1.5 bg-white hover:bg-red-50 hover:text-[#DC2626] hover:border-red-200 text-[#A5ACB5] border border-[#E1E4E8] rounded-lg transition-colors">
                    <RotateCcw className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}

            {/* ══════════ 2 · DOMAIN ══════════ */}
            {section(2, 'Domain', (
              <div className="space-y-3">
                {/* Flow type */}
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'external', label: 'External flow', hint: 'around a body' },
                    { v: 'internal', label: 'Internal flow', hint: 'inside a channel' },
                  ] as const).map(({ v, label, hint }) => (
                    <button
                      key={v}
                      onClick={() => setFlowType?.(v)}
                      className={`py-2 px-2.5 rounded-lg border text-left transition-colors ${sel(flowType === v)}`}
                    >
                      <span className="block text-[11px] font-semibold">{label}</span>
                      <span className={`block text-[9px] ${flowType === v ? 'text-[#3B82F6]' : 'text-[#A5ACB5]'}`}>{hint}</span>
                    </button>
                  ))}
                </div>

                {isInternal ? (
                  <div className="p-2.5 bg-[#F8FAFC] border border-[#E1E4E8] rounded-lg text-[10px] text-[#69717D] leading-relaxed">
                    The geometry walls bound the fluid directly - no outer domain is generated.
                    Tag the open ends as <b className="text-[#171A1F]">inlet</b> / <b className="text-[#171A1F]">outlet</b> and the
                    solid sides as <b className="text-[#171A1F]">wall</b> in step 3.
                  </div>
                ) : (() => {
                  const farOpen = domainKind === 'auto' ? true : farfieldOpen;
                  return (
                  <>
                    {/* Collapsible far-field generator - collapsed by default */}
                    <button
                      onClick={() => setFarfieldOpen((v) => !v)}
                      className="w-full flex items-center gap-1.5 py-1.5 text-[11px] font-semibold text-[#69717D] hover:text-[#171A1F] transition-colors"
                    >
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${farOpen ? 'rotate-90 text-[#2563EB]' : ''}`} />
                      <span className={farOpen ? 'text-[#2563EB]' : ''}>Generate a far-field box automatically</span>
                    </button>

                    {/* Collapsed: explicitly define the fluid domain */}
                    {!farOpen && (
                      <Tooltip content={
                        domainState === 'broken'
                          ? 'The fluid domain is broken: an edge that formed the outer boundary was deleted or replaced, so the loop no longer closes. Select the whole outline again on the canvas (Select tool, drag a box around it), then click this to redefine it. Your inlet / outlet / wall tags are kept.'
                          : domainState === 'ok'
                          ? 'The fluid domain is set. Click to redefine it from the current selection. Deleting a boundary edge will break it and this button turns red.'
                          : 'Marks the selected closed loop as the outer fluid boundary. Draw your outline as one closed loop (endpoints must meet), select all of it, then click this. Or expand the far-field option above.'
                      }>
                        <button
                          onClick={onSetSelectedAsDomain}
                          className={`w-full py-2 rounded-lg font-bold shadow-sm transition-colors text-white ${domainState === 'broken' ? 'bg-[#DC2626] hover:bg-[#B91C1C]' : 'bg-[#2563EB] hover:bg-[#1D4ED8]'}`}
                        >
                          {domainState === 'ok' ? 'Redefine domain' : domainState === 'broken' ? 'Reselect & redefine' : 'Set as domain'}
                        </button>
                      </Tooltip>
                    )}

                    {farOpen && (
                    <div className="space-y-3">
                    <div>
                      <span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">Far-field shape</span>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { v: 'rectangle', label: 'Box' },
                          { v: 'c_grid', label: 'C-grid' },
                          { v: 'circle', label: 'Farfield' },
                        ] as const).map(({ v, label }) => {
                          const on = domainShape === v;
                          return (
                            <button key={v} onClick={() => setDomainShape?.(v)} className={`p-2 rounded-lg border flex flex-col items-center gap-1 transition-colors ${sel(on)}`}>
                              <svg className="w-full h-7" viewBox="0 0 100 48" fill="none">
                                {v === 'rectangle' && <rect x="6" y="6" width="88" height="36" rx="2" stroke={on ? '#2563EB' : '#94A3B8'} strokeWidth="1.5" strokeDasharray="3 2" fill="#EFF6FF" fillOpacity={on ? 0.7 : 0.15} />}
                                {v === 'c_grid' && <path d="M94 8 L36 8 A16 16 0 0 0 36 40 L94 40 Z" stroke={on ? '#2563EB' : '#94A3B8'} strokeWidth="1.5" strokeDasharray="3 2" fill="#EFF6FF" fillOpacity={on ? 0.7 : 0.15} />}
                                {v === 'circle' && <circle cx="50" cy="24" r="17" stroke={on ? '#2563EB' : '#94A3B8'} strokeWidth="1.5" strokeDasharray="3 2" fill="#EFF6FF" fillOpacity={on ? 0.7 : 0.15} />}
                                <path d="M42 24 C44 20, 52 21, 62 24 C54 26, 46 26, 42 24 Z" fill="#171A1F" />
                              </svg>
                              <span className={`text-[10px] font-bold ${on ? 'text-[#1D4ED8]' : 'text-[#69717D]'}`}>{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">Size preset</span>
                      <div className="grid grid-cols-4 gap-1.5">
                        {(['tight', 'standard', 'large', 'custom'] as DomainPreset[]).map((p) => (
                          <button key={p} onClick={() => onApplyPreset(p)} className={`py-1.5 rounded-lg text-[10px] font-medium border transition-colors capitalize ${sel(domainPreset === p)}`}>{p}</button>
                        ))}
                      </div>
                    </div>

                    <div className="bg-[#F8FAFC] border border-[#E1E4E8] rounded-lg p-2.5 space-y-2">
                      <div className="flex justify-between items-center text-[10px] text-[#69717D]">
                        <span className="font-semibold">Clearance (chords)</span>
                        <span className="font-mono text-[#2563EB]">1c = {(geometryBBox?.chord ?? 1.0).toFixed(2)} m</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 items-start">
                        {([
                          { label: '← Inlet', cls: '', v: upstreamChordFactor, set: setUpstreamChordFactor },
                          { label: '↕ Lateral', cls: 'text-center', v: lateralHeightFactor, set: setLateralHeightFactor },
                          { label: 'Outlet →', cls: 'text-right', v: downstreamChordFactor, set: setDownstreamChordFactor },
                        ] as const).map(({ label, cls, v, set: setter }) => (
                          <label key={label} className={`text-[9px] text-[#69717D] ${cls}`}>{label}
                            <NumberField
                              value={v} min={1} max={100}
                              onChange={(n) => { setter?.(n); setDomainPreset?.('custom'); }}
                              className="w-full mt-0.5 px-1 py-1 bg-white border border-[#E1E4E8] focus:border-[#2563EB] outline-none rounded text-center text-[10px] font-mono font-bold text-[#171A1F]"
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    {!domainValidation.valid && domainKind === 'auto' && (
                      <div className="flex items-start gap-1 text-[10px] text-[#DC2626]">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span>{domainValidation.reason || 'Geometry is outside the domain.'}</span>
                      </div>
                    )}

                    <button onClick={onGenerateDomain} className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg font-bold shadow-sm transition-colors">
                      Generate domain
                    </button>
                    </div>
                    )}
                  </>
                  );
                })()}
              </div>
            ))}

            {/* ══════════ 3 · BOUNDARY PATCHES ══════════ */}
            {section(3, 'Boundary patches', (
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">Flow direction</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { label: '-X', icon: '→', value: 'neg_x_pos_x' },
                      { label: '+X', icon: '←', value: 'pos_x_neg_x' },
                      { label: '+Y', icon: '↑', value: 'neg_y_pos_y' },
                      { label: '-Y', icon: '↓', value: 'pos_y_neg_y' },
                    ] as const).map(({ label, icon, value }) => (
                      <button
                        key={value}
                        onClick={() => setFlowDirection(value)}
                        title={`Inlet from ${label}`}
                        className={`py-1.5 rounded-lg border flex flex-col items-center transition-colors ${sel(flowDirection === value)}`}
                      >
                        <span className="text-sm font-bold leading-none">{icon}</span>
                        <span className="text-[9px] font-semibold font-mono">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">
                    {activeTagTool
                      ? `Tagging: ${activeTagTool.toUpperCase()} - click canvas edges (click the tag again to stop)`
                      : 'Pick a tag, then click canvas edges to apply it'}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['inlet', 'outlet', 'wall', 'farfield', 'symmetry', 'periodic'] as BoundaryTag[]).map((tag) => {
                      const conf = BOUNDARY_COLORS[tag];
                      const isSel = activeTagTool === tag;
                      return (
                        <button
                          key={tag}
                          onClick={() => setActiveTagTool?.(isSel ? null : tag)}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-semibold uppercase tracking-wider border transition-colors flex items-center gap-1.5 ${isSel ? `${conf.bg} ${conf.text}` : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F8FAFC]'}`}
                          style={isSel ? { borderColor: conf.hex } : undefined}
                        >
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: isSel ? conf.hex : '#CBD5E1' }} />
                          <span className="flex-1 text-left">{tag}</span>
                          <span className="text-[9px] font-mono opacity-70">{boundaryValidation.counts[tag] || 0}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  onClick={() => {
                    const dirToAoa: Record<string, number> = { neg_x_pos_x: 0, pos_x_neg_x: 180, neg_y_pos_y: 90, pos_y_neg_y: -90 };
                    setAngleOfAttackDeg?.(dirToAoa[flowDirection] ?? 0);
                    setTimeout(() => onAutoSuggestTags?.(), 30);
                  }}
                  className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg font-bold shadow-sm transition-all active:scale-[0.99]"
                >
                  Auto-tag edges
                </button>

                {(inletCount === 0 || outletCount === 0) && (
                  <div className="flex items-start gap-1 text-[10px] text-[#DC2626]">
                    <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>{inletCount === 0 && outletCount === 0 ? 'Tag at least one inlet and one outlet.' : inletCount === 0 ? 'Tag at least one inlet.' : 'Tag at least one outlet.'}</span>
                  </div>
                )}
              </div>
            ))}
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
        const meshLock = stageStatus?.mesh;
        if (meshLock?.locked) {
          return (
            <div className="h-full min-h-0 flex flex-col text-xs text-[#171A1F]">
              <div className="flex-1 min-h-0 overflow-y-auto">
                <StageGate
                  title="Meshing is locked"
                  reason="Complete these pre-processing steps before generating a mesh:"
                  missing={meshLock.missing}
                  onCta={onSelectStage ? () => onSelectStage('geometry') : undefined}
                />
              </div>
              <div className="shrink-0 px-4 pt-3 mt-3 border-t border-[#E1E4E8] bg-white">
                <button disabled className="w-full py-2 bg-[#2563EB] text-white font-medium rounded-md opacity-40">
                  Generate mesh
                </button>
              </div>
            </div>
          );
        }
        return (
        <div className="h-full min-h-0 flex flex-col text-xs text-[#171A1F]">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-4 pt-4">

          {/* Topology */}
          <div>
            <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Mesh topology</span>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => setMeshTopology('unstructured')} className={`py-2 rounded-lg border font-medium transition-colors ${meshTopology === 'unstructured' ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]' : 'bg-white border-[#E1E4E8] text-[#69717D] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'}`}>Unstructured</button>
              <button onClick={() => setMeshTopology('structured')} className={`py-2 rounded-lg border font-medium transition-colors ${meshTopology === 'structured' ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]' : 'bg-white border-[#E1E4E8] text-[#69717D] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'}`}>Structured</button>
            </div>
            {meshTopology === 'structured' && (
              <span className="text-[10px] text-[#69717D] block mt-1">Block-structured all-quad mesh. Pick a topology and generate the blocks, then set cell counts.</span>
            )}
          </div>

          {meshTopology === 'structured' ? (
            <StructuredMeshPanel
              blocking={blocking ?? null}
              onBuildBlocks={onBuildBlocks}
              onUpdateBlocking={onUpdateBlocking}
              ogridBodies={ogridBodies}
              onWrapBody={onWrapBody}
              structuredHint={structuredHint}
              structuredSmooth={structuredSmooth}
              setStructuredSmooth={setStructuredSmooth}
              field={field}
            />
          ) : (
            <>
              {/* Resolution */}
              <div>
                <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Resolution</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['coarse', 'medium', 'fine'] as const).map((res) => (
                    <button key={res} onClick={() => set({ meshResolution: res })} className={`py-1.5 rounded-lg capitalize font-medium border transition-colors ${g.meshResolution === res ? 'border-[#2563EB] bg-blue-50 text-[#1D4ED8]' : 'bg-white text-[#69717D] border-[#E1E4E8] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'}`}>{res}</button>
                  ))}
                </div>
                <span className="text-[10px] text-[#69717D] block mt-1">{resolutionHint[g.meshResolution]}</span>
              </div>

              {/* Element type */}
              <label className="block">
                <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block mb-1.5">Element type</span>
                <select value={g.elementType} onChange={(e) => set({ elementType: e.target.value as typeof g.elementType })} className="w-full px-2 py-1.5 bg-[#F5F6F8] border border-[#E1E4E8] rounded-md focus:outline-none focus:border-[#2563EB]">
                  <option value="hybrid">Hybrid: prism layers at wall + triangles</option>
                  <option value="tri">Triangles: fully unstructured</option>
                  <option value="quad_dominant">Quad-dominant: mostly quads</option>
                  <option value="quad">Quads: recombined all-quad</option>
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
                      <label><Tooltip content="Height of the first cell against the wall, in mm. Sets y⁺ together with the flow speed. Smaller = finer boundary layer."><span className="text-[10px] text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">First cell (mm)</span></Tooltip><NumberField value={g.firstLayerHeightMm} min={0.0001} fallback={0.05} onChange={(n) => set({ firstLayerHeightMm: n })} className={field} /></label>
                      <label><Tooltip content="Number of prism layers stacked from the wall outward."><span className="text-[10px] text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Layers</span></Tooltip><NumberField value={g.numPrismLayers} integer min={1} max={50} fallback={12} onChange={(n) => set({ numPrismLayers: n })} className={field} /></label>
                      <label><Tooltip content="Each prism layer is this many times thicker than the one below it (1.1-1.3 typical)."><span className="text-[10px] text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Growth</span></Tooltip><NumberField value={g.prismExpansionRatio} min={1.01} max={2} fallback={1.2} onChange={(n) => set({ prismExpansionRatio: n })} className={field} /></label>
                    </div>

                    <Tooltip content="y⁺, first-cell height and layer count size the prism stack against the wall (Hybrid element type only). They don't set the overall cell size - that's the Resolution preset. For a plain triangle / quad mesh, near-wall size is Local wall / region size under Advanced. Low y⁺ (~1) resolves the boundary layer; high (~30-100) uses wall functions.">
                    <div className="mt-2.5 p-2.5 bg-blue-50/60 border border-blue-100 rounded-md space-y-2 cursor-help">
                      <div className="flex items-end gap-2">
                        <label className="flex-1">
                          <span className="text-[10px] text-[#69717D] block mb-1">Target y⁺</span>
                          <input
                            type="number"
                            min="0.1"
                            step="1"
                            value={yplusDraft}
                            onChange={(e) => commitYplusDraft(e.target.value)}
                            onBlur={normalizeYplusDraft}
                            className={`${field} bg-white border-blue-200`}
                          />
                        </label>
                        <div className="flex-1 pb-1">
                          <span className="text-[10px] text-[#69717D] block">Gives Δy</span>
                          <span className="font-mono font-semibold text-[#171A1F]">{state.yplus.first_layer_height_mm?.toFixed(4)} mm</span>
                        </div>
                      </div>
                      <button onClick={onApplyYPlusToMesh} className="w-full py-1.5 rounded-md bg-white border border-blue-200 text-[#1D4ED8] font-medium hover:bg-blue-50 transition-colors">
                        Apply y⁺ sizing to first cell &amp; layers
                      </button>
                    </div>
                    </Tooltip>
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
                      <label><Tooltip content="How fast cells grow moving away from the wall. Low (1.1) = wide gradual transition to the coarse free stream; high (1.5+) = fine band collapses to coarse quickly."><span className="text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Growth rate</span></Tooltip><NumberField value={g.growthRate} min={1.01} max={2} fallback={1.2} onChange={(n) => set({ growthRate: n })} className={field} /></label>
                      <label><Tooltip content="Target number of edge segments around a full circle of curvature - controls how finely curved boundaries (arcs, leading edges) are faceted."><span className="text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Elements / curve</span></Tooltip><NumberField value={g.elementsPerCurve} integer min={4} max={100} fallback={12} onChange={(n) => set({ elementsPerCurve: n })} className={field} /></label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label><Tooltip content="Absolute smallest cell edge length allowed anywhere, in metres. Blank = auto."><span className="text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Min size (m)</span></Tooltip><NumberField value={g.minElementSize} min={0} allowEmpty placeholder="auto" onChange={(n) => set({ minElementSize: n })} className={field} /></label>
                      <label><Tooltip content="Cell edge length in the free stream / far field, in metres. Larger = coarser away from the body. Blank = auto (from the Resolution preset)."><span className="text-[#69717D] block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Max size (m)</span></Tooltip><NumberField value={g.maxElementSize} min={0} allowEmpty placeholder="auto" onChange={(n) => set({ maxElementSize: n })} className={field} /></label>
                    </div>
                    <label className="block">
                      <Tooltip content="Cell edge length in the fine band next to wall-tagged edges, in metres. This is the near-wall cell size for a plain triangle / quad mesh (no prism layers). Blank = auto.">
                        <span className="text-[#69717D] inline-block mb-1 cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Local wall / region size (m)</span>
                      </Tooltip>
                      <NumberField value={g.localRefinementSize} min={0} allowEmpty placeholder="auto" onChange={(n) => set({ localRefinementSize: n })} className={field} />
                    </label>
                    <label className="flex items-center justify-between text-[#69717D]"><Tooltip content="Adds cells where the boundary curves sharply (leading edges, fillets) and where two walls come close together (thin gaps), so those features stay resolved. It also widens the fine near-wall band downstream. Turn off for a tighter fine band that drops to coarse faster."><span className="cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Curvature + proximity refinement</span></Tooltip><input type="checkbox" checked={g.useProximityRefinement} onChange={(e) => set({ useProximityRefinement: e.target.checked })} className="accent-[#2563EB]" /></label>
                    <label className="flex items-center justify-between text-[#69717D]"><Tooltip content="After meshing, runs Laplacian smoothing and Netgen optimisation to improve cell shape - fewer slivers, larger minimum angle, more uniform size transitions. Slightly slower. Leave on unless you want the raw generator output."><span className="cursor-help decoration-dotted underline decoration-[#C4C9D0] underline-offset-2">Optimize / smooth mesh</span></Tooltip><input type="checkbox" checked={g.optimizeMesh} onChange={(e) => set({ optimizeMesh: e.target.checked })} className="accent-[#2563EB]" /></label>
                  </div>
                )}
              </div>
            </>
          )}

          </div>

          <div className="shrink-0 px-4 pt-3 mt-3 border-t border-[#E1E4E8] bg-white space-y-2">
          {meshTopology === 'structured' ? (
            <button onClick={onGenerateStructuredMesh} disabled={isMeshing || !blocking} className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium rounded-md transition-colors disabled:opacity-40">
              {isMeshing ? 'Generating…' : !blocking ? 'Build blocks first' : meshError ? 'Retry mesh' : (meshStale && meshData?.num_elements) ? 'Regenerate mesh' : 'Generate mesh'}
            </button>
          ) : (
            <button onClick={onGenerateMesh} disabled={isMeshing} className="w-full py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-medium rounded-md transition-colors disabled:opacity-40">
              {isMeshing ? 'Generating…' : meshError ? 'Retry mesh' : (meshStale && meshData?.num_elements) ? 'Regenerate mesh' : 'Generate mesh'}
            </button>
          )}
          </div>

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
              <label className="block"><span className="text-[#69717D] block mb-1">Density (ρ)</span><NumberField value={state.physics.density} min={0} fallback={1.225} onChange={(n) => updatePhysics({ density: n })} className="w-full px-2 py-1.5 bg-white border border-[#E1E4E8] rounded font-mono" /></label>
              <label className="block"><span className="text-[#69717D] block mb-1">Kinematic ν</span><NumberField value={state.physics.kinematicViscosity} min={0} fallback={1.5e-5} onChange={(n) => updatePhysics({ kinematicViscosity: n })} className="w-full px-2 py-1.5 bg-white border border-[#E1E4E8] rounded font-mono" /></label>
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
                value={yplusDraft}
                onChange={(e) => commitYplusDraft(e.target.value)}
                onBlur={normalizeYplusDraft}
                className="w-full px-2 py-1 bg-white border border-[#E1E4E8] rounded font-mono focus:outline-none focus:border-[#2563EB]"
              />
            </label>
            <span className="text-[10px] text-[#69717D] block mt-1">y⁺ ≈ 1 resolves the viscous sublayer; y⁺ 30-100 uses wall functions.</span>
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
      {activeStage === 'boundaries' && stageStatus?.boundaries?.locked && (
        <StageGate
          title="Boundaries are locked"
          reason="Finish geometry, domain and boundary tagging first:"
          missing={stageStatus.boundaries.missing}
          onCta={onSelectStage ? () => onSelectStage('geometry') : undefined}
        />
      )}

      {activeStage === 'boundaries' && !stageStatus?.boundaries?.locked && (
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
      {activeStage === 'solver' && stageStatus?.solver?.locked && (
        <StageGate
          title="Solver is locked"
          reason={stageStatus.solver.reason || 'Generate a mesh first.'}
          ctaLabel="Go to Mesh"
          onCta={onSelectStage ? () => onSelectStage('mesh') : undefined}
        />
      )}

      {activeStage === 'solver' && !stageStatus?.solver?.locked && (
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
      {activeStage === 'results' && stageStatus?.results?.locked && (
        <StageGate
          title="Results are locked"
          reason={stageStatus.results.reason || 'Generate a mesh first.'}
          ctaLabel="Go to Mesh"
          onCta={onSelectStage ? () => onSelectStage('mesh') : undefined}
        />
      )}

      {activeStage === 'results' && !stageStatus?.results?.locked && (
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
