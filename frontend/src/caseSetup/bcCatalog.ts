// Boundary-condition model for Case Setup. The tag a patch got in Geometry
// (its "role") fixes most of its behaviour; this catalogue says which variants
// are selectable and what parameters each needs. The frontend sends this spec
// to the backend, which turns it into the OpenFOAM `0/` files.

export type PatchRole = 'inlet' | 'outlet' | 'wall' | 'farfield' | 'symmetry' | 'periodic';

export type PatchKind =
  | 'velocityInlet' | 'massFlowInlet' | 'totalPressureInlet'
  | 'pressureOutlet' | 'outflow' | 'massFlowOutlet'
  | 'noSlipWall' | 'slipWall' | 'movingWall' | 'rotatingWall'
  | 'farfield'
  | 'symmetry'
  | 'periodic';

export interface PatchBC {
  /** which variant of the role's behaviour */
  kind: PatchKind;
  // velocity inlet / moving wall
  velocity?: number;          // m/s (magnitude; direction from AoA / normal)
  // mass-flow boundaries
  massFlowRate?: number;      // kg/s
  // total-pressure inlet
  totalPressure?: number;     // Pa
  // pressure outlet
  staticPressure?: number;    // Pa (gauge)
  // rotating wall
  rpm?: number;
  axis?: [number, number, number];
  origin?: [number, number, number];
  // wall roughness (sand-grain model)
  roughnessHeight?: number;   // Ks, m
  roughnessConstant?: number; // Cs, default 0.5
  // thermal (compressible)
  thermal?: 'adiabatic' | 'fixedTemperature' | 'fixedHeatFlux';
  wallTemperature?: number;   // K
  wallHeatFlux?: number;      // W/m^2
}

export interface PatchEntry {
  name: string;               // the mesh patch name (== the tag today)
  role: PatchRole;
  bc: PatchBC;
}

export const KIND_LABEL: Record<PatchKind, string> = {
  velocityInlet: 'Velocity inlet',
  massFlowInlet: 'Mass-flow inlet',
  totalPressureInlet: 'Total-pressure inlet',
  pressureOutlet: 'Static-pressure outlet',
  outflow: 'Outflow (zero gradient)',
  massFlowOutlet: 'Mass-flow outlet',
  noSlipWall: 'No-slip wall',
  slipWall: 'Slip wall',
  movingWall: 'Moving wall',
  rotatingWall: 'Rotating wall',
  farfield: 'Freestream / far-field',
  symmetry: 'Symmetry plane',
  periodic: 'Periodic',
};

export const KINDS_FOR_ROLE: Record<PatchRole, PatchKind[]> = {
  inlet: ['velocityInlet', 'massFlowInlet', 'totalPressureInlet'],
  outlet: ['pressureOutlet', 'outflow', 'massFlowOutlet'],
  wall: ['noSlipWall', 'slipWall', 'movingWall', 'rotatingWall'],
  farfield: ['farfield'],
  symmetry: ['symmetry'],
  periodic: ['periodic'],
};

export function defaultPatchBC(role: PatchRole, refVelocity: number): PatchBC {
  switch (role) {
    case 'inlet':
      return { kind: 'velocityInlet', velocity: refVelocity };
    case 'outlet':
      return { kind: 'pressureOutlet', staticPressure: 0 };
    case 'wall':
      return { kind: 'noSlipWall', thermal: 'adiabatic', roughnessHeight: 0, roughnessConstant: 0.5 };
    case 'farfield':
      return { kind: 'farfield', velocity: refVelocity };
    case 'symmetry':
      return { kind: 'symmetry' };
    case 'periodic':
      return { kind: 'periodic' };
  }
}

/** Short human summary for the boundary table. */
export function summarisePatch(bc: PatchBC): string {
  switch (bc.kind) {
    case 'velocityInlet': return `U = ${bc.velocity ?? 0} m/s`;
    case 'massFlowInlet': return `${bc.massFlowRate ?? 0} kg/s`;
    case 'totalPressureInlet': return `p0 = ${bc.totalPressure ?? 0} Pa`;
    case 'pressureOutlet': return `p = ${bc.staticPressure ?? 0} Pa`;
    case 'outflow': return 'zero gradient';
    case 'massFlowOutlet': return `${bc.massFlowRate ?? 0} kg/s`;
    case 'noSlipWall': {
      const parts = ['no-slip'];
      if (bc.roughnessHeight && bc.roughnessHeight > 0) parts.push(`Ks = ${bc.roughnessHeight} m`);
      if (bc.thermal === 'fixedTemperature') parts.push(`T = ${bc.wallTemperature ?? 0} K`);
      if (bc.thermal === 'fixedHeatFlux') parts.push(`q = ${bc.wallHeatFlux ?? 0} W/m2`);
      return parts.join(', ');
    }
    case 'slipWall': return 'slip';
    case 'movingWall': return `wall U = ${bc.velocity ?? 0} m/s`;
    case 'rotatingWall': return `${bc.rpm ?? 0} rpm`;
    case 'farfield': return `freestream ${bc.velocity ?? 0} m/s`;
    case 'symmetry': return 'symmetry';
    case 'periodic': return 'periodic';
  }
}

/** Fields shown as columns in the boundary table for the current physics. */
export function solvedFields(opts: {
  turbulenceFields: string[];
  compressible: boolean;
}): string[] {
  return ['U', 'p', ...opts.turbulenceFields, ...(opts.compressible ? ['T'] : [])];
}
