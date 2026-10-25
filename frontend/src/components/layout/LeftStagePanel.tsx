import React, { useEffect, useRef, useState } from 'react';
import type { StageId, StageStatus } from './stages';
import { SolverPanel } from '../solver/SolverPanel';
import { CFDProjectState, SmoothingSettings } from '../../types/cfd';
import {
  CadWorkflowStep,
  FlowType,
  DomainShapeType,
  DomainPreset,
  DOMAIN_PRESETS,
  BoundaryTag,
  GeometryBBox,
} from '../../types/cadWorkflow';
import { Blocking } from '../../types/blocking';
import { StageGate } from './leftStagePanel/StageGate';
import { ResultsStagePanel, type ResultsStagePanelProps } from './leftStagePanel/ResultsStagePanel';
import { YPlusStagePanel } from './leftStagePanel/YPlusStagePanel';
import { PhysicsStagePanel } from './leftStagePanel/PhysicsStagePanel';
import { MeshStagePanel } from './leftStagePanel/MeshStagePanel';
import { GeometryStagePanel } from './leftStagePanel/GeometryStagePanel';

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
  onStructuredStep?: (step: 'blocking' | 'sizing') => void;
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
  onInitializeBlocking?: () => void;
  onUpdateBlocking?: (bk: Blocking | null) => void;
  onGenerateStructuredMesh?: () => void;
  structuredSmooth?: SmoothingSettings;
  setStructuredSmooth?: (v: SmoothingSettings) => void;
  meshTopology?: 'unstructured' | 'structured';
  onMeshTopologyChange?: (t: 'unstructured' | 'structured') => void;
  width?: number;
  onWidthChange?: (w: number) => void;
  projectId?: string;
  onCreatePlot?: () => void;
  /** Results tab: computed views and handlers (field, probes, reports, plots). */
  resultsPanel?: Omit<
    ResultsStagePanelProps,
    | 'activeStage'
    | 'stageStatus'
    | 'onSelectStage'
    | 'state'
    | 'updatePostProcess'
    | 'onCreatePlot'
    | 'projectId'
  >;
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
  onStructuredStep,
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
  onInitializeBlocking,
  onUpdateBlocking,
  onGenerateStructuredMesh,
  structuredSmooth,
  setStructuredSmooth,
  meshTopology = 'unstructured',
  onMeshTopologyChange,
  width = 280,
  onWidthChange,
  projectId,
  onCreatePlot,
  resultsPanel,
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
      <GeometryStagePanel
        {...{
          activeStage,
          flowType,
          boundaryValidation,
          setOpenGeoSection,
          openGeoSection,
          setCadWorkflowStep,
          fileInputAirfoilRef,
          handleAirfoilChange,
          fileInputDxfRef,
          handleDxfChange,
          airfoilUrl,
          setAirfoilUrl,
          urlError,
          setUrlError,
          handleImportUrl,
          isFetchingUrl,
          onClearGeometry,
          setFlowType,
          domainKind,
          farfieldOpen,
          setFarfieldOpen,
          domainState,
          onSetSelectedAsDomain,
          domainShape,
          setDomainShape,
          onApplyPreset,
          domainPreset,
          geometryBBox,
          upstreamChordFactor,
          setUpstreamChordFactor,
          lateralHeightFactor,
          setLateralHeightFactor,
          downstreamChordFactor,
          setDownstreamChordFactor,
          setDomainPreset,
          domainValidation,
          onGenerateDomain,
          setFlowDirection,
          flowDirection,
          activeTagTool,
          setActiveTagTool,
          setAngleOfAttackDeg,
          onAutoSuggestTags,
        }}
      />

      <MeshStagePanel
        {...{
          activeStage,
          state,
          updateGeometry,
          stageStatus,
          onSelectStage,
          setMeshTopology,
          meshTopology,
          blocking,
          onInitializeBlocking,
          onUpdateBlocking,
          structuredSmooth,
          setStructuredSmooth,
          updateYPlus,
          onApplyYPlusToMesh,
          onDirectionColors,
          onStructuredStep,
          yplusDraft,
          commitYplusDraft,
          normalizeYplusDraft,
          setMeshAdvancedOpen,
          meshAdvancedOpen,
          onGenerateStructuredMesh,
          isMeshing,
          meshError,
          meshStale,
          meshData,
          onGenerateMesh,
        }}
      />
      <PhysicsStagePanel {...{ activeStage, updatePhysics, state }} />

      <YPlusStagePanel
        {...{
          activeStage,
          updateYPlus,
          state,
          yplusDraft,
          commitYplusDraft,
          normalizeYplusDraft,
          onApplyYPlusToMesh,
        }}
      />

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

      {resultsPanel && (
        <ResultsStagePanel
          {...{
            activeStage,
            stageStatus,
            onSelectStage,
            state,
            updatePostProcess,
            onCreatePlot: onCreatePlot ?? (() => {}),
            projectId: projectId ?? '',
          }}
          {...resultsPanel}
        />
      )}
    </aside>
  );
};
