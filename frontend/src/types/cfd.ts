export type FlowRegime = 'laminar' | 'turbulent';
export type Compressibility = 'incompressible' | 'compressible';
export type TimeFormulation = 'steady' | 'transient';

export type TurbulenceModel = 
  | 'kOmegaSST'
  | 'kEpsilon'
  | 'realizableKE'
  | 'RNGkEpsilon'
  | 'SpalartAllmaras';

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
  k?: number;
  omega?: number;
  epsilon?: number;
}

export interface PostProcessConfig {
  activeField: 'U_mag' | 'p' | 'k' | 'omega' | 'vorticity';
  colormap: 'coolwarm' | 'viridis' | 'turbo' | 'jet' | 'rainbow';
  showMeshWireframe: boolean;
  showStreamlines: boolean;
  showSlicePlane: boolean;
  sliceAxis: 'x' | 'y' | 'z';
  slicePosition: number;
  numStreamlines: number;
  glyphScale: number;
  showVectors: boolean;
}

export interface CFDProjectState {
  geometry: GeometryConfig;
  physics: PhysicsConfig;
  boundaries: BoundaryConditions;
  yplus: YPlusCalculation;
  solver: SolverControls;
  postprocess: PostProcessConfig;
  executionStatus: 'idle' | 'meshing' | 'running' | 'completed' | 'error';
  residuals: ResidualDataPoint[];
  terminalLogs: string[];
}
