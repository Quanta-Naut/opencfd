import React from 'react';
import { CFDProjectState } from '../types/cfd';
import { generateMesh, generateStructuredMesh } from '../utils/api';
import { toast } from '../components/ui/Toast';
import { FlowType, BoundaryTag, CadEntity } from '../types/cadWorkflow';
import {
  Blocking,
  autoBlockingFromOutline,
  propagateNodeCounts,
  toStructuredRequest,
  wrapBodyOgrid,
  bodiesForOgrid,
  entityRing,
  cGridFromAirfoil,
  wrapAirfoilOgrid,
  airfoilsForCGrid,
  outlineRing,
  applyTargetCellSize,
  autoCellSize,
} from '../types/blocking';

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

/** Build an automatic blocking (H-grid, O-grid or C-grid) around the geometry. */
export function runBuildBlocks(
  kind: 'hgrid' | 'ogrid' | 'cgrid' | 'cgrid_closed',
  wb: BuildBlocksContext,
) {
  const { setBlocksBuiltTick, cadEntities, bodyPatchFor, setBlocking, edgeTagMap, ogridParams } =
    wb;
  setBlocksBuiltTick((t) => t + 1); // reveal the Blocks view
  if (kind === 'cgrid') {
    const af = airfoilsForCGrid(cadEntities)[0];
    const domEnts = cadEntities.filter((e) => e.role === 'domain_boundary');
    const domain = outlineRing(domEnts);
    if (!af || domain.length < 3) {
      toast.error('C-grid needs an airfoil', {
        description: 'Place an elongated body inside a closed domain.',
      });
      return;
    }
    const ent = cadEntities[af.index];
    const domEnt =
      domEnts.length === 1
        ? domEnts[0]
        : domEnts.find(
            (e) =>
              e.isClosed || e.type === 'rectangle' || e.type === 'circle' || e.type === 'ellipse',
          );
    const raw = cGridFromAirfoil(entityRing(ent), domain, bodyPatchFor(ent.id), ent.id, domEnt?.id);
    if (!raw) {
      toast.error('Could not build a C-grid', {
        description: 'Give the airfoil more room downstream of the trailing edge.',
      });
      return;
    }
    const bk = applyTargetCellSize(raw, autoCellSize(raw));
    setBlocking(bk);
    toast.success(`C-grid built: ${bk.blocks.length} blocks`);
    return;
  }
  if (kind === 'cgrid_closed') {
    const af = airfoilsForCGrid(cadEntities)[0];
    if (!af) {
      toast.error('Closed O-grid needs an airfoil', {
        description: 'Place an elongated body inside the domain.',
      });
      return;
    }
    const ent = cadEntities[af.index];
    const base = autoBlockingFromOutline(cadEntities, edgeTagMap);
    if (!base) {
      toast.error('Could not auto-block this outline', {
        description: 'Define a closed domain first.',
      });
      return;
    }
    const raw = wrapAirfoilOgrid(base, entityRing(ent), bodyPatchFor(ent.id), {
      airfoilEntityId: ent.id,
    });
    if (!raw) {
      toast.error('Could not wrap a closed O-grid', {
        description: 'The airfoil may need more clearance from the domain edges.',
      });
      return;
    }
    const bk = applyTargetCellSize(propagateNodeCounts(raw), autoCellSize(raw));
    setBlocking(bk);
    toast.success(`Closed O-grid built: ${bk.blocks.length} blocks`);
    return;
  }

  let bk = autoBlockingFromOutline(cadEntities, edgeTagMap);
  if (!bk) {
    toast.error('Could not auto-block this outline', {
      description: 'Define a closed domain first.',
    });
    return;
  }
  let wrapped = 0;
  if (kind === 'ogrid') {
    for (const b of bodiesForOgrid(cadEntities, bk)) {
      const ent = cadEntities[b.index];
      const next = wrapBodyOgrid(bk, entityRing(ent), bodyPatchFor(ent.id), {
        bodyEntityId: ent.id,
        ...ogridParams,
      });
      if (next) {
        bk = next;
        wrapped += 1;
      }
    }
  }
  bk = applyTargetCellSize(propagateNodeCounts(bk), autoCellSize(bk));
  setBlocking(bk);
  if (kind === 'ogrid' && wrapped === 0) {
    toast.warning(`Built ${bk.blocks.length} blocks without an O-grid`, {
      description: 'No body could be wrapped. It must sit clear of the domain edges.',
    });
  } else if (wrapped > 0) {
    toast.success(`Built ${bk.blocks.length} blocks`, {
      description: `O-grid around ${wrapped} bod${wrapped > 1 ? 'ies' : 'y'}`,
    });
  } else {
    toast.success(`Built ${bk.blocks.length} block${bk.blocks.length > 1 ? 's' : ''}`);
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
