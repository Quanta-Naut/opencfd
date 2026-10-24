import React from 'react';
import { CFDProjectState } from '../types/cfd';
import { generateMesh, generateStructuredMesh } from '../utils/api';
import { toast } from '../components/ui/Toast';
import { FlowType, BoundaryTag, CadEntity } from '../types/cadWorkflow';
import {
  Blocking,
  BlockKind,
  KIND_KEYS,
  propagateNodeCounts,
  toStructuredRequest,
} from '../types/blocking';
import { runBlockingJob, BlockingReport } from './blockingRunner';

const fmtCount = (n: number) => (n ?? 0).toLocaleString();

/** Mesher warnings worth acting on, as one toast rather than one each. */
function warnAbout(warnings: string[]) {
  if (!warnings.length) return;
  toast.warning(warnings.length === 1 ? 'Mesh warning' : `${warnings.length} mesh warnings`, {
    description: warnings.length === 1 ? warnings[0] : warnings.map((w) => `• ${w}`).join('\n'),
  });
}

/** Generate the unstructured mesh from the sketch and the current sizing. */
export async function runGenerateMesh(wb: GenerateMeshContext) {
  const {
    meshGate,
    setState,
    setIsMeshing,
    setMeshData,
    setMeshError,
    clearResultsCache,
    state,
    cadEntities,
    edgeTagMap,
    flowType,
    meshSigRef,
    geomSignature,
    meshCoreSigRef,
    geomSigCore,
    makeCaseFiles,
    setCaseFiles,
  } = wb;
  if (!meshGate.ready) {
    setState((prev) => ({
      ...prev,
      terminalLogs: [
        ...prev.terminalLogs,
        `[Gmsh] Cannot mesh yet - ${meshGate.missing.join('; ')}.`,
      ],
    }));
    return;
  }
  const progress = toast.task('Generating mesh');
  setIsMeshing(true);
  // A failed regeneration must not leave an old or placeholder mesh visible.
  setMeshData(null);
  setMeshError(null);
  clearResultsCache();
  setState((prev) => ({
    ...prev,
    executionStatus: 'meshing',
    terminalLogs: [...prev.terminalLogs, `[Gmsh] Meshing geometry ${state.geometry.name}...`],
  }));

  try {
    const mesh = await generateMesh(state.geometry.type, {
      chord: state.geometry.chord,
      // Angle of attack has no meaning for a body of revolution - it would
      // break the axisymmetry assumption itself.
      angleOfAttackDeg: state.physics.axisymmetric ? 0 : state.geometry.angleOfAttackDeg,
      cylinderDiameter: state.geometry.cylinderDiameter,
      domainLength: state.geometry.domainLength,
      domainHeight: state.geometry.domainHeight,
      meshResolution: state.geometry.meshResolution,
      firstLayerHeightMm: state.geometry.firstLayerHeightMm,
      usePrismLayers: state.geometry.usePrismLayers,
      numPrismLayers: state.geometry.numPrismLayers,
      prismExpansionRatio: state.geometry.prismExpansionRatio,
      meshAlgorithm: state.geometry.meshAlgorithm,
      elementType: state.geometry.elementType,
      growthRate: state.geometry.growthRate,
      elementsPerCurve: state.geometry.elementsPerCurve,
      useProximityRefinement: state.geometry.useProximityRefinement,
      minElementSize: state.geometry.minElementSize,
      maxElementSize: state.geometry.maxElementSize,
      localRefinementSize: state.geometry.localRefinementSize,
      optimizeMesh: state.geometry.optimizeMesh,
      cadEntities,
      edgeTagMap,
      flowType,
      // Supersonic: an untagged lateral boundary must become a non-reflecting
      // far-field, not a `symmetry` plane (a symmetry plane mirrors the shock
      // straight back into the domain).
      speedRegime: state.physics.speedRegime,
      compressibility: state.physics.compressibility,
      axisymmetric: state.physics.axisymmetric,
    });

    setMeshData(mesh);
    meshSigRef.current = geomSignature;
    meshCoreSigRef.current = geomSigCore;

    progress.success('Mesh ready', {
      description: `${fmtCount(mesh.num_nodes)} nodes, ${fmtCount(mesh.num_elements)} cells`,
    });
    // Only surface warnings the user can act on. Routine internal fallbacks
    // (boundary layer dropped, MeshAdapt fallback, prism-to-graded) are noise.
    warnAbout(
      (mesh.warnings || []).filter((w: string) =>
        /coarsen|too aggressive|cell sizes|closed loop|inlet|outlet/i.test(w),
      ),
    );

    // Mesh generation succeeded independently of optional post-processing.
    setState((prev) => ({
      ...prev,
      executionStatus: 'idle',
      terminalLogs: [
        ...prev.terminalLogs,
        `[Gmsh] Complete: ${mesh.num_nodes} nodes, ${mesh.num_elements} elements.`,
      ],
    }));

    try {
      const dicts = await makeCaseFiles();
      setCaseFiles(dicts);
    } catch (caseErr: any) {
      setState((prev) => ({
        ...prev,
        terminalLogs: [...prev.terminalLogs, `[Case] ${caseErr.message}`],
      }));
    }
  } catch (err: any) {
    const msg = err?.message || 'Mesh generation failed.';
    setMeshError(msg);
    progress.error('Mesh generation failed', { description: msg });
    setState((prev) => ({
      ...prev,
      executionStatus: 'error',
      terminalLogs: [...prev.terminalLogs, `[Error] ${msg}`],
    }));
  } finally {
    progress.cancel();
    setIsMeshing(false);
  }
}

/** What runGenerateMesh reads from the workbench component. */
export interface GenerateMeshContext {
  meshGate: { ready: boolean; missing: string[] };
  setState: React.Dispatch<React.SetStateAction<CFDProjectState>>;
  setIsMeshing: React.Dispatch<React.SetStateAction<boolean>>;
  setMeshData: React.Dispatch<any>;
  setMeshError: React.Dispatch<React.SetStateAction<string>>;
  clearResultsCache: () => void;
  state: CFDProjectState;
  cadEntities: CadEntity[];
  edgeTagMap: Record<string, BoundaryTag>;
  flowType: FlowType;
  meshSigRef: React.RefObject<string>;
  geomSignature: string;
  meshCoreSigRef: React.RefObject<string>;
  geomSigCore: string;
  makeCaseFiles: () => Promise<any>;
  setCaseFiles: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

/** Build an automatic blocking: every topology of the chosen family is tried,
 *  shape-optimized and scored in a worker, and the best one is kept. */
export async function runBuildBlocks(kind: BlockKind, wb: BuildBlocksContext) {
  const { setBlocksBuiltTick, cadEntities, bodyPatchFor, setBlocking, edgeTagMap, ogridParams } =
    wb;
  setBlocksBuiltTick((t) => t + 1); // reveal the Blocks view
  const bodyPatches: Record<string, BoundaryTag> = {};
  for (const e of cadEntities)
    if (e.role !== 'domain_boundary' && e.layer !== 'construction')
      bodyPatches[e.id] = bodyPatchFor(e.id);
  const h = wb.firstCellMm;
  const id = toast.loading('Building blocks', { progress: 0, description: 'Trying topologies' });
  try {
    const report = await runBlockingJob(
      {
        kind: 'auto',
        entities: cadEntities,
        edgeTagMap,
        bodyPatches,
        options: {
          keys: KIND_KEYS[kind],
          firstCellHeight: h && h > 0 ? h / 1000 : undefined,
          growth: wb.growth,
          ogrid: ogridParams,
        },
      },
      {
        progress: (p, label) => toast.update(id, { progress: p * 100, description: label }),
        snapshot: (bk) => setBlocking(bk),
      },
    );
    if (!report) {
      toast.dismiss(id);
      return;
    }
    setBlocking(report.blocking);
    wb.setReport?.(report);
    const n = report.blocking.blocks.length;
    toast.success(`${report.label}: ${n} block${n > 1 ? 's' : ''}`, {
      id,
      description: `Wall skew ${report.quality.wallWorst.toFixed(2)}, worst ${report.quality.worst.toFixed(2)}`,
    });
  } catch (err) {
    toast.error('Could not block this geometry', {
      id,
      description: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Re-run the shape optimizer on the current blocking (after manual edits). */
export async function runOptimizeBlocking(
  blocking: Blocking,
  wb: Pick<BuildBlocksContext, 'cadEntities' | 'edgeTagMap' | 'setBlocking' | 'setReport'>,
) {
  const id = toast.loading('Optimizing block shapes', { progress: 0 });
  try {
    const report = await runBlockingJob(
      { kind: 'optimize', entities: wb.cadEntities, edgeTagMap: wb.edgeTagMap, blocking },
      {
        progress: (p) => toast.update(id, { progress: p * 100 }),
        snapshot: (bk) => wb.setBlocking(bk),
      },
    );
    if (!report) {
      toast.dismiss(id);
      return;
    }
    wb.setBlocking(report.blocking);
    wb.setReport?.(report);
    toast.success('Block shapes optimized', {
      id,
      description: `Wall skew ${report.quality.wallWorst.toFixed(2)}, worst ${report.quality.worst.toFixed(2)}`,
    });
  } catch (err) {
    wb.setBlocking(blocking);
    toast.error('Optimization failed', {
      id,
      description: err instanceof Error ? err.message : String(err),
    });
  }
}

/** What runBuildBlocks reads from the workbench component. */
export interface BuildBlocksContext {
  setBlocksBuiltTick: React.Dispatch<React.SetStateAction<number>>;
  cadEntities: CadEntity[];
  bodyPatchFor: (entId: string) => any;
  setBlocking: React.Dispatch<React.SetStateAction<Blocking>>;
  edgeTagMap: Record<string, BoundaryTag>;
  ogridParams: { offsetFactor: number; radialNodes: number; radialRatio: number };
  /** y+ first-cell height (mm) and growth, for wall clustering. */
  firstCellMm?: number;
  growth?: number;
  setReport?: (r: BlockingReport | null) => void;
}

/** Generate the structured mesh from the current blocking. */
export async function runGenerateStructuredMesh(wb: GenerateStructuredMeshContext) {
  const {
    blocking,
    setIsMeshing,
    setMeshData,
    setMeshError,
    clearResultsCache,
    setState,
    structuredSmooth,
    meshSigRef,
    geomSignature,
    meshCoreSigRef,
    geomSigCore,
    makeCaseFiles,
    setCaseFiles,
  } = wb;
  if (!blocking) {
    toast.info('Build the block topology first');
    return;
  }
  const progress = toast.task('Generating structured mesh');
  setIsMeshing(true);
  setMeshData(null);
  setMeshError(null);
  clearResultsCache();
  setState((prev) => ({
    ...prev,
    executionStatus: 'meshing',
    terminalLogs: [...prev.terminalLogs, '[Gmsh] Generating structured (transfinite) mesh...'],
  }));
  try {
    const req = toStructuredRequest(propagateNodeCounts(blocking));
    const mesh = await generateStructuredMesh(req, { smooth: structuredSmooth });
    setMeshData(mesh);
    meshSigRef.current = geomSignature;
    meshCoreSigRef.current = geomSigCore;
    progress.success('Structured mesh ready', {
      description: `${fmtCount(mesh.num_nodes)} nodes, ${fmtCount(mesh.num_elements)} quads`,
    });
    warnAbout(
      (mesh.warnings || []).filter((w: string) =>
        /coarsen|too aggressive|cell sizes|tris|non-quad/i.test(w),
      ),
    );
    setState((prev) => ({
      ...prev,
      executionStatus: 'idle',
      terminalLogs: [
        ...prev.terminalLogs,
        `[Gmsh] Structured mesh complete: ${mesh.num_nodes} nodes, ${mesh.num_elements} quads.`,
      ],
    }));
    try {
      const dicts = await makeCaseFiles();
      setCaseFiles(dicts);
    } catch (caseErr: any) {
      setState((prev) => ({
        ...prev,
        terminalLogs: [...prev.terminalLogs, `[Case] ${caseErr.message}`],
      }));
    }
  } catch (err: any) {
    const msg = err?.message || 'Structured meshing failed.';
    setMeshError(msg);
    progress.error('Structured meshing failed', { description: msg });
    setState((prev) => ({
      ...prev,
      executionStatus: 'error',
      terminalLogs: [...prev.terminalLogs, `[Error] ${msg}`],
    }));
  } finally {
    progress.cancel();
    setIsMeshing(false);
  }
}

/** What runGenerateStructuredMesh reads from the workbench component. */
export interface GenerateStructuredMeshContext {
  blocking: Blocking;
  setIsMeshing: React.Dispatch<React.SetStateAction<boolean>>;
  setMeshData: React.Dispatch<any>;
  setMeshError: React.Dispatch<React.SetStateAction<string>>;
  clearResultsCache: () => void;
  setState: React.Dispatch<React.SetStateAction<CFDProjectState>>;
  structuredSmooth: boolean;
  meshSigRef: React.RefObject<string>;
  geomSignature: string;
  meshCoreSigRef: React.RefObject<string>;
  geomSigCore: string;
  makeCaseFiles: () => Promise<any>;
  setCaseFiles: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}
