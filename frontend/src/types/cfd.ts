export type FlowRegime = 'laminar' | 'turbulent';
export type Compressibility = 'incompressible' | 'compressible';
export type TimeFormulation = 'steady' | 'transient';

// Kept for older code paths; Case Setup uses TurbulenceModelId from
// ../../caseSetup/turbulenceCatalog which is a superset.
export type TurbulenceModel =
  | 'kOmegaSST'
  | 'kEpsilon'
  | 'realizableKE'
  | 'RNGkEpsilon'
  | 'SpalartAllmaras';

export type SpeedRegime = 'incompressible' | 'subsonic' | 'transonic' | 'supersonic' | 'hypersonic';

export type SolverType = 'simpleFoam' | 'icoFoam' | 'pisoFoam' | 'pimpleFoam';

export type GeometryType =
  | 'naca0012'
  | 'cylinder'
  | 'backward_step'
  | 'lid_cavity'
  | 'channel'
  | 'custom';

export interface YPlusCalculation {
  velocity: number;
  length: number;
  density: number;
  viscosity: number;
  target_yplus: number;
  expansion_ratio: number;
  reynolds_number: number;
  skin_friction_coefficient: number;
  wall_shear_stress: number;
  friction_velocity: number;
  first_layer_height_m: number;
  first_layer_height_mm: number;
  boundary_layer_thickness_mm: number;
  recommended_layers: number;
  total_layer_thickness_mm: number;
}

export interface GeometryConfig {
  type: GeometryType;
  name: string;
  chord: number; // For airfoil
  angleOfAttackDeg: number; // Angle of attack
  cylinderDiameter: number; // For cylinder
  domainLength: number;
  domainHeight: number;
  stepHeight: number; // For step
  meshResolution: 'coarse' | 'medium' | 'fine';
  usePrismLayers: boolean;
  firstLayerHeightMm: number;
  numPrismLayers: number;
  prismExpansionRatio: number;
  meshAlgorithm: 'frontal_delaunay' | 'mesh_adapt' | 'delaunay';
  elementType: 'hybrid' | 'tri' | 'quad_dominant' | 'quad';
  growthRate: number;
  elementsPerCurve: number;
  useProximityRefinement: boolean;
  minElementSize: number;
  maxElementSize: number;
  localRefinementSize: number;
  optimizeMesh: boolean;
}

export interface PhysicsConfig {
  compressibility: Compressibility;
  regime: FlowRegime;
  timeFormulation: TimeFormulation;
  solver: SolverType;
  inletVelocity: number; // m/s, reference velocity used by physics and mesh sizing
  inletPressure: number; // Pa, reference/static inlet pressure
  inletTemperature: number; // K, required for compressible cases
  density: number; // kg/m^3
  kinematicViscosity: number; // m^2/s (e.g. 1.5e-5 for air)
  equationOfState: 'perfectGas' | 'constantDensity';
  specificHeatRatio: number;
  gasConstant: number;
  specificHeat: number;
  thermalConductivity: number;
  prandtlNumber: number;
  energyModel: 'disabled' | 'enabled';
  transportModel: 'constant' | 'sutherland';
  turbulenceModel: TurbulenceModel;

  // k-omega SST constants
  kOmegaConstants: {
    alpha1: number;
    beta1: number;
    betaStar: number;
    sigmaK1: number;
    sigmaOmega1: number;
  };

  // k-epsilon constants
  kEpsilonConstants: {
    cMu: number;
    c1Eps: number;
    c2Eps: number;
    sigmaK: number;
    sigmaEps: number;
  };

  // Spalart-Allmaras constants
  saConstants: {
    cb1: number;
    cb2: number;
    sigma: number;
    kappa: number;
  };

  // Wall treatment
  wallTreatment: 'wall_functions' | 'low_re_resolved';

  // ── Case Setup additions ──
  /** Turbulence model id from caseSetup/turbulenceCatalog (superset of TurbulenceModel). */
  turbulenceModelId: string;
  /** Wall-treatment choice used by Case Setup (superset of wallTreatment). */
  wallModel: 'auto' | 'wall_functions' | 'resolved';
  speedRegime: SpeedRegime;
  /** Revolve the 2D cross-section into a wedge about the x-axis (body of
   * revolution - a nozzle centerline, a bullet-shaped external body, etc).
   * Works for both internal and external `FlowType`. */
  axisymmetric: boolean;
}

/** Near-wall resolution + per-patch boundary conditions, edited in Case Setup. */
export interface CaseSetupConfig {
  /** Target y+ for the wall cells; drives the mesh first-cell height. */
  targetYPlus: number;
  /** Prism / wall-normal layer growth ratio. */
  growthRate: number;
  /** Manual characteristic length; null = auto (chord or hydraulic diameter). */
  refLengthOverride: number | null;
  /** Push the computed first-cell height into the mesh automatically. */
  linkFirstCellToMesh: boolean;
  /** Per-patch boundary conditions, keyed by patch (tag) name. */
  patches: Record<string, import('../caseSetup/bcCatalog').PatchBC>;
}

export interface BoundaryConditions {
  inletVelocity: number;
  inletAngleDeg: number;
  turbulenceIntensityPercent: number;
  turbulentLengthScaleM: number;
  inletK: number;
  inletOmega: number;
  inletEpsilon: number;
  inletNut: number;
  outletPressure: number;
  wallType: 'noSlip' | 'slip';
}

export interface SolverControls {
  iterations: number;
  writeInterval: number;
  timeStep: number;
  relaxationFactors: {
    p: number;
    U: number;
    k: number;
    omega: number;
  };
  convergenceTolerances: {
    p: number;
    U: number;
    k: number;
    omega: number;
  };
}

export interface ResidualDataPoint {
  iteration: number;
  p: number;
  Ux: number;
  Uy: number;
  Uz?: number;
  k?: number;
  omega?: number;
  epsilon?: number;
  e?: number;
  nuTilda?: number;
  time?: number;
  cd?: number;
  cl?: number;
}

export interface PostProcessConfig {
  activeField: import('../utils/resultFields').ResultFieldId;
  colormap: 'coolwarm' | 'viridis' | 'turbo' | 'jet' | 'rainbow';
  showMeshWireframe: boolean;
  showStreamlines: boolean;
  showSlicePlane: boolean;
  sliceAxis: 'x' | 'y' | 'z';
  slicePosition: number;
  numStreamlines: number;
  /** Vector arrow length multiplier. */
  glyphScale: number;
  showVectors: boolean;
  /** Colour range: percentile-clipped ('auto'), true min/max, or typed in. */
  rangeMode: 'auto' | 'full' | 'custom';
  rangeMin: number | null;
  rangeMax: number | null;
  /** 0 = smooth colours; N = N flat bands. */
  levels: number;
  /** Iso-lines over the colours (at the band edges, or 10 when smooth). */
  contourLines: boolean;
  /** Screen pixels between vector arrows. */
  vectorSpacing: number;
  /** Probe points on the field, in model coordinates. */
  probes: { id: string; x: number; y: number }[];
  /** Fields defined in the calculator. */
  customFields: import('../utils/resultFields').CustomField[];
  /** Lines at typed values, per field id. */
  isoValues: Record<string, number[]>;
  /** Leave out values outside the colour range instead of saturating. */
  clipOutside: boolean;
  /** Show results only inside this box [x0, y0, x1, y1], model units. */
  clipBox: [number, number, number, number] | null;
}

export interface SolverRunRecord {
  id: string;
  startedAt: number; // Date.now()
  finishedAt: number | null;
  status: 'running' | 'completed' | 'error' | 'stopped';
  label: string; // user-editable; default `Run ${n}`
  config: {
    timeFormulation: 'steady' | 'transient';
    turbulenceModel: string;
    iterations: number;
    velocity: number;
    reynolds: number;
    regime: string;
    cells: number;
    momentumOrder: string;
    relax: { p: number; U: number; k: number; omega: number; e: number };
    axisymmetric: boolean;
  };
  residuals: ResidualDataPoint[]; // this run's full residual stream
  logs: string[]; // this run's console lines only
  finalCd?: number;
  finalCl?: number;
  iterationsRun?: number;
}

export type FlowVariable = import('../utils/resultFields').ResultFieldId;

/** A convergence-monitor quantity, read live from a run's `residuals` stream -
 * the same source the Solver tab's own residuals chart already uses. */
export type MonitorField =
  | 'residual_p'
  | 'residual_Ux'
  | 'residual_Uy'
  | 'residual_k'
  | 'residual_omega'
  | 'residual_epsilon'
  | 'cd'
  | 'cl';

export interface PlotLine {
  p1: [number, number];
  p2: [number, number];
  samples: number;
}

export interface PlotSampleData {
  distance: number[];
  values: number[];
  fields?: Record<string, number[]>;
}

export interface PlotDefinition {
  id: string;
  name: string; // user-editable label, default like "Plot 1", "Plot 2"
  /** 'line' (default, back-compat): a spatial probe sampled along a line, field
   * vs distance or field vs field. 'monitor': one or more solver-run quantities
   * (residuals, Cd, Cl) vs iteration/time - no sampling, reads the run's own
   * already-captured residuals stream live. */
  kind?: 'line' | 'monitor' | 'boundary';
  /** 'boundary' plots: a field along one patch, against x, y or arc length
   * (`data.distance` holds that coordinate). */
  boundary?: { patch: string; axis: 'x' | 'y' | 's' };
  runId: string | null; // which solver run this was sampled from
  variable: FlowVariable; // 'line' plots: the Y axis
  xAxis?: 'distance' | FlowVariable; // 'line' plots: the X axis; default 'distance'
  monitorFields?: MonitorField[]; // 'monitor' plots: one or more Y series
  monitorX?: 'iteration' | 'time'; // 'monitor' plots: the X axis; default 'iteration'
  line?: PlotLine; // 'line' plots only
  colormap: 'coolwarm' | 'viridis' | 'turbo' | 'jet' | 'rainbow' | string;
  rangeMin: number | null; // null = auto/full range
  rangeMax: number | null;
  data: PlotSampleData | null; // cached sampled result ('line' plots only)
  createdAt: number;
}

export interface CFDProjectState {
  geometry: GeometryConfig;
  physics: PhysicsConfig;
  boundaries: BoundaryConditions;
  caseSetup: CaseSetupConfig;
  yplus: YPlusCalculation;
  solver: SolverControls;
  /** Solution-tab configuration (methods, controls, monitors, run). */
  solution: import('../solver/solverConfig').SolverConfig;
  postprocess: PostProcessConfig;
  executionStatus: 'idle' | 'meshing' | 'running' | 'completed' | 'error';
  residuals: ResidualDataPoint[];
  solverRuns: SolverRunRecord[];
  plots: PlotDefinition[];
  terminalLogs: string[];
}
