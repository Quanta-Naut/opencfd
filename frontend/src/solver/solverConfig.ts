// Solver configuration for the Solution tab. Mirrors Fluent's Solution ribbon
// (Methods / Controls / Reports / Monitors / Initialization / Run) but writes
// OpenFOAM fvSchemes, fvSolution and functionObjects.

export type Coupling = 'SIMPLE' | 'SIMPLEC' | 'PIMPLE' | 'PISO';
export type SpatialOrder = 'firstOrder' | 'secondOrder' | 'central' | 'blended';
export type TimeScheme = 'steadyState' | 'Euler' | 'backward' | 'CrankNicolson';
export type InitMode = 'uniform' | 'potentialFlow' | 'continue';
export type StabilityPreset = 'conservative' | 'balanced' | 'aggressive' | 'custom';

export interface SolverMethods {
  coupling: Coupling;
  momentum: SpatialOrder;
  turbulence: SpatialOrder;
  energy: SpatialOrder;
  gradient: 'gauss' | 'leastSquares' | 'cellLimited';
  time: TimeScheme;
  nNonOrthogonalCorrectors: number;
  momentumPredictor: boolean;
  nOuterCorrectors: number;   // PIMPLE
  nCorrectors: number;        // PISO / PIMPLE inner
}

export interface SolverControlsX {
  preset: StabilityPreset;
  relax: { p: number; U: number; k: number; omega: number; e: number };
  maxCo: number;              // transient
  adjustableTimeStep: boolean;
  residualTargets: { p: number; U: number; turbulence: number };
}

export interface ForceReport {
  enabled: boolean;
  bodyPatch: string;          // '' = auto (first wall)
  refArea: number;            // 0 = auto (reference length x nominal 0.1 m span)
  refLength: number;          // 0 = auto (chord)
  liftDir: [number, number, number];
  dragDir: [number, number, number];
  centreOfRotation: [number, number, number];
}

export interface SurfaceReport {
  id: string;
  patch: string;
  quantity: 'massFlow' | 'areaAverage' | 'areaIntegral';
  field: 'p' | 'U' | 'T' | 'k';
}

export interface PointProbe {
  id: string;
  x: number;
  y: number;
}

export interface SolverMonitors {
  forces: ForceReport;
  surfaces: SurfaceReport[];
  probes: PointProbe[];
  convergeOnForces: boolean;  // also stop when Cd is steady
  forceWindow: number;        // iterations to judge steadiness
}

export interface SolverRun {
  iterations: number;         // steady
  endTime: number;            // transient
  deltaT: number;             // transient
  writeInterval: number;
  init: InitMode;
  parallelProcs: number;      // 1 = serial
}

export interface SolverConfig {
  methods: SolverMethods;
  controls: SolverControlsX;
  monitors: SolverMonitors;
  run: SolverRun;
}

export const PRESET_RELAX: Record<Exclude<StabilityPreset, 'custom'>, SolverControlsX['relax']> = {
  conservative: { p: 0.3, U: 0.5, k: 0.5, omega: 0.5, e: 0.5 },
  balanced: { p: 0.5, U: 0.7, k: 0.7, omega: 0.7, e: 0.7 },
  aggressive: { p: 0.7, U: 0.9, k: 0.8, omega: 0.8, e: 0.9 },
};

export const PRESET_METHODS: Record<Exclude<StabilityPreset, 'custom'>, Partial<SolverMethods>> = {
  conservative: { momentum: 'firstOrder', turbulence: 'firstOrder', coupling: 'SIMPLE' },
  balanced: { momentum: 'secondOrder', turbulence: 'firstOrder', coupling: 'SIMPLEC' },
  aggressive: { momentum: 'secondOrder', turbulence: 'secondOrder', coupling: 'SIMPLEC' },
};

export function defaultSolverConfig(): SolverConfig {
  return {
    methods: {
      coupling: 'SIMPLEC',
      momentum: 'secondOrder',
      turbulence: 'firstOrder',
      energy: 'secondOrder',
      gradient: 'gauss',
      time: 'steadyState',
      nNonOrthogonalCorrectors: 1,
      momentumPredictor: true,
      nOuterCorrectors: 1,
      nCorrectors: 2,
    },
    controls: {
      preset: 'balanced',
      relax: { ...PRESET_RELAX.balanced },
      maxCo: 5,
      adjustableTimeStep: true,
      residualTargets: { p: 1e-4, U: 1e-4, turbulence: 1e-4 },
    },
    monitors: {
      forces: {
        enabled: true,
        bodyPatch: '',
        refArea: 0,
        refLength: 0,
        liftDir: [0, 1, 0],
        dragDir: [1, 0, 0],
        centreOfRotation: [0.25, 0, 0],
      },
      surfaces: [],
      probes: [],
      convergeOnForces: true,
      forceWindow: 200,
    },
    run: {
      iterations: 1000,
      endTime: 1,
      deltaT: 1e-4,
      writeInterval: 0,  // 0 = auto-compute (backend targets ~25 frames)
      init: 'uniform',
      parallelProcs: 1,
    },
  };
}

/** Rotate the lift / drag unit vectors for an angle of attack (degrees). */
export function directionsForAoA(aoaDeg: number): { liftDir: [number, number, number]; dragDir: [number, number, number] } {
  const a = (aoaDeg * Math.PI) / 180;
  return {
    dragDir: [Math.cos(a), Math.sin(a), 0],
    liftDir: [-Math.sin(a), Math.cos(a), 0],
  };
}
