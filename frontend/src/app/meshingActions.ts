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

    toast(`Mesh ready: ${mesh.num_nodes} nodes, ${mesh.num_elements} cells.`, 'success');
    // Only surface warnings the user can act on. Routine internal fallbacks
    // (boundary layer dropped, MeshAdapt fallback, prism-to-graded) are noise.
    (mesh.warnings || [])
      .filter((w: string) => /coarsen|too aggressive|cell sizes|closed loop|inlet|outlet/i.test(w))
      .forEach((w: string) => toast(w, 'info', 7000));

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
    toast(msg, 'error', 8000);
    setState((prev) => ({
      ...prev,
      executionStatus: 'error',
      terminalLogs: [...prev.terminalLogs, `[Error] ${msg}`],
    }));
  } finally {
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
      toast('C-grid needs an elongated body (airfoil) inside a closed domain.', 'error', 7000);
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
      toast(
        'Could not build a C-grid. Give the airfoil more room downstream of the trailing edge.',
        'error',
        7000,
      );
      return;
    }
    const bk = applyTargetCellSize(raw, autoCellSize(raw));
    setBlocking(bk);
    toast(`Built a ${bk.blocks.length}-block C-grid around the airfoil.`, 'success');
    return;
  }
  if (kind === 'cgrid_closed') {
    const af = airfoilsForCGrid(cadEntities)[0];
    if (!af) {
      toast('Closed O-grid needs an elongated body (airfoil) in the domain.', 'error', 7000);
      return;
    }
    const ent = cadEntities[af.index];
    const base = autoBlockingFromOutline(cadEntities, edgeTagMap);
    if (!base) {
      toast('Could not auto-block this outline. Define a closed domain first.', 'error', 7000);
      return;
    }
    const raw = wrapAirfoilOgrid(base, entityRing(ent), bodyPatchFor(ent.id), {
      airfoilEntityId: ent.id,
    });
    if (!raw) {
      toast(
        'Could not wrap a closed O-grid around this airfoil - it may need more clearance from the domain edges.',
        'error',
        7000,
      );
      return;
    }
    const bk = applyTargetCellSize(propagateNodeCounts(raw), autoCellSize(raw));
    setBlocking(bk);
    toast(`Built a ${bk.blocks.length}-block closed O-grid around the airfoil.`, 'success');
    return;
  }

  let bk = autoBlockingFromOutline(cadEntities, edgeTagMap);
  if (!bk) {
    toast('Could not auto-block this outline. Define a closed domain first.', 'error', 7000);
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
    toast(
      'Built blocks, but no body could be wrapped - it must sit clear of the domain edges.',
      'info',
      7000,
    );
  } else if (wrapped > 0) {
    toast(
      `Built ${bk.blocks.length} blocks with an O-grid around ${wrapped} bod${wrapped > 1 ? 'ies' : 'y'}.`,
      'success',
    );
  } else {
    toast(`Built ${bk.blocks.length} block${bk.blocks.length > 1 ? 's' : ''}.`, 'success');
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
    toast('Build the block topology first.', 'info');
    return;
  }
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
    toast(`Structured mesh: ${mesh.num_nodes} nodes, ${mesh.num_elements} quads.`, 'success');
    (mesh.warnings || [])
      .filter((w: string) => /coarsen|too aggressive|cell sizes|tris|non-quad/i.test(w))
      .forEach((w: string) => toast(w, 'info', 7000));
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
    toast(msg, 'error', 8000);
    setState((prev) => ({
      ...prev,
      executionStatus: 'error',
      terminalLogs: [...prev.terminalLogs, `[Error] ${msg}`],
    }));
  } finally {
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
