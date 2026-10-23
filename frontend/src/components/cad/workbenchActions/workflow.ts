import type { FlowType } from '../../../types/cadWorkflow';
import type { CadAction } from '../workbenchCore';
import type { DomainShapeType } from '../../../types/cadWorkflow';
import type { GeometryBBox } from '../../../types/cadWorkflow';
import React from 'react';
import { requestMeshFromSketch } from '../../../utils/api';
import { CadEntity, createDomainEntity } from '../../../types/cadWorkflow';

/** Build (or rebuild) the outer flow domain around the geometry. */
export function generateDomain(wb: GenerateDomainContext) {
  const {
    cadState,
    domainShape,
    geometryBBox,
    upstreamChordFactor,
    downstreamChordFactor,
    lateralHeightFactor,
    dispatch,
    setCmdText,
    fitBoundingBox,
    setDomainAnimScale,
  } = wb;
  const existingDomain = cadState.entities.find((e) => e.role === 'domain_boundary');
  const newDomain = createDomainEntity(
    domainShape,
    geometryBBox,
    upstreamChordFactor,
    downstreamChordFactor,
    lateralHeightFactor,
    existingDomain?.id,
  );
  const otherEnts = cadState.entities.filter((e) => e.role !== 'domain_boundary');
  dispatch({ type: 'REPLACE_ENTITIES', entities: [...otherEnts, newDomain] });
  setCmdText(
    `DOMAIN: Generated ${domainShape.toUpperCase().replace('_', '-')} domain (←${upstreamChordFactor}c, →${downstreamChordFactor}c, ↕${lateralHeightFactor}c).`,
  );

  // Auto-fit camera so the generated domain completely comes into picture
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of newDomain.pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX !== Infinity) {
    fitBoundingBox({ minX, maxX, minY, maxY }, 0.7);
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
}

/** What generateDomain reads from the workbench component. */
export interface GenerateDomainContext {
  cadState: { entities: CadEntity[] };
  domainShape: DomainShapeType;
  geometryBBox: GeometryBBox;
  upstreamChordFactor: number;
  downstreamChordFactor: number;
  lateralHeightFactor: number;
  dispatch: React.ActionDispatch<[action: CadAction]>;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
  fitBoundingBox: (
    box: { minX: number; maxX: number; minY: number; maxY: number },
    marginRatio?: number,
  ) => boolean;
  setDomainAnimScale: React.Dispatch<React.SetStateAction<number>>;
}

/** Send the sketch to the mesher and hand the result to the Mesh stage. */
export async function meshHandoff(wb: MeshHandoffContext) {
  const {
    cadState,
    flowType,
    setCmdText,
    setIsLoading,
    domainLength,
    domainHeight,
    resolution,
    firstLayerMm,
    onApplySketchMesh,
    cadName,
  } = wb;
  const geomProfile = cadState.entities.find(
    (e) => e.layer !== 'construction' && e.role !== 'domain_boundary' && e.pts.length >= 2,
  );
  if (!geomProfile && flowType === 'external') {
    setCmdText('ERROR: No obstacle geometry profile found in canvas.');
    return;
  }
  setIsLoading(true);
  setCmdText('Extruding 2D sketch to OpenFOAM 2D mesh (1 cell in Z)...');
  try {
    const pts = geomProfile
      ? geomProfile.pts.map((p) => [p.x, p.y])
      : [
          [0, 0],
          [1, 0],
          [1, 0.2],
          [0, 0.2],
        ];
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
}

/** What meshHandoff reads from the workbench component. */
export interface MeshHandoffContext {
  cadState: { entities: CadEntity[] };
  flowType: FlowType;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  domainLength: number;
  domainHeight: number;
  resolution: string;
  firstLayerMm: number;
  onApplySketchMesh: (mesh: any, name: string) => void;
  cadName: string;
}

/** Download a blockMeshDict for the current domain. */
export function downloadBlockMeshDict(wb: DownloadBlockMeshDictContext) {
  const { flowType, angleOfAttackDeg, freestreamVelocity, geometryBBox, setCmdText } = wb;
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
}

/** What downloadBlockMeshDict reads from the workbench component. */
export interface DownloadBlockMeshDictContext {
  flowType: FlowType;
  angleOfAttackDeg: number;
  freestreamVelocity: number;
  geometryBBox: GeometryBBox;
  setCmdText: React.Dispatch<React.SetStateAction<string>>;
}
