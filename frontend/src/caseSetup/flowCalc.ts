// Pure flow / near-wall calculations shared by the Case Setup sections. No React,
// no state - just numbers in, numbers out, so they can be unit-tested and reused
// by the mesh and solver wiring.

export interface FlowInputs {
  velocity: number;          // m/s
  density: number;           // kg/m^3
  kinematicViscosity: number; // m^2/s
  refLength: number;         // m (chord or hydraulic diameter)
  temperature: number;       // K
  gamma: number;             // specific heat ratio
  gasConstant: number;       // J/(kg K)
}

export interface FlowDerived {
  reynolds: number;
  mach: number;
  speedOfSound: number;
  dynamicPressure: number;   // Pa
  regimeHint: 'incompressible' | 'subsonic' | 'transonic' | 'supersonic' | 'hypersonic';
}

export function deriveFlow(f: FlowInputs): FlowDerived {
  const a = Math.sqrt(Math.max(f.gamma * f.gasConstant * f.temperature, 1e-9));
  const mach = f.velocity / a;
  const reynolds = (f.velocity * f.refLength) / Math.max(f.kinematicViscosity, 1e-12);
  const regimeHint =
    mach < 0.3 ? 'incompressible'
      : mach < 0.8 ? 'subsonic'
        : mach < 1.2 ? 'transonic'
          : mach < 5 ? 'supersonic'
            : 'hypersonic';
  return {
    reynolds,
    mach,
    speedOfSound: a,
    dynamicPressure: 0.5 * f.density * f.velocity * f.velocity,
    regimeHint,
  };
}

// ---- near-wall / y+ ----------------------------------------------------------

export interface WallResolution {
  reynolds: number;
  skinFriction: number;      // Cf (flat-plate correlation)
  wallShearStress: number;   // tau_w, Pa
  frictionVelocity: number;  // u_tau, m/s
  firstCellHeight: number;   // m  (cell centre at y+ target -> first cell = 2x that)
  firstCellHeightMm: number;
  blThickness: number;       // m, turbulent flat-plate delta
  layerCount: number;        // prism layers to span the BL at the growth ratio
  totalLayerThickness: number; // m
}

/**
 * First-cell height for a target y+, from the Schlichting flat-plate skin
 * friction correlation. `growthRate` is the layer-to-layer expansion used to
 * back out how many prism layers span the boundary layer.
 */
export function wallResolution(
  f: Pick<FlowInputs, 'velocity' | 'density' | 'kinematicViscosity' | 'refLength'>,
  targetYPlus: number,
  growthRate = 1.2,
): WallResolution {
  const nu = Math.max(f.kinematicViscosity, 1e-12);
  const Re = (f.velocity * f.refLength) / nu;
  // Schlichting: Cf = 0.0576 Re_x^-1/5  (turbulent flat plate, local)
  const Cf = 0.0576 * Math.pow(Math.max(Re, 1), -0.2);
  const tauW = 0.5 * f.density * f.velocity * f.velocity * Cf;
  const uTau = Math.sqrt(Math.max(tauW / f.density, 1e-12));
  const yCentre = (targetYPlus * nu) / uTau;   // distance of the first cell centre
  const firstCell = 2 * yCentre;               // -> first cell height
  const delta = 0.37 * f.refLength * Math.pow(Math.max(Re, 1), -0.2); // turbulent BL thickness
  // n such that firstCell * (r^n - 1)/(r - 1) >= delta
  const g = Math.max(growthRate, 1.001);
  const ratio = 1 + (delta / Math.max(firstCell, 1e-12)) * (g - 1);
  const layerCount = Math.max(1, Math.min(60, Math.round(Math.log(ratio) / Math.log(g))));
  const totalLayerThickness = firstCell * (Math.pow(g, layerCount) - 1) / (g - 1);
  return {
    reynolds: Re,
    skinFriction: Cf,
    wallShearStress: tauW,
    frictionVelocity: uTau,
    firstCellHeight: firstCell,
    firstCellHeightMm: firstCell * 1000,
    blThickness: delta,
    layerCount,
    totalLayerThickness,
  };
}

/** The y+ the first cell height actually lands at (inverse of the above). */
export function yPlusOf(
  f: Pick<FlowInputs, 'velocity' | 'density' | 'kinematicViscosity' | 'refLength'>,
  firstCellHeight: number,
): number {
  const nu = Math.max(f.kinematicViscosity, 1e-12);
  const Re = (f.velocity * f.refLength) / nu;
  const Cf = 0.0576 * Math.pow(Math.max(Re, 1), -0.2);
  const tauW = 0.5 * f.density * f.velocity * f.velocity * Cf;
  const uTau = Math.sqrt(Math.max(tauW / f.density, 1e-12));
  return ((firstCellHeight / 2) * uTau) / nu;
}

// ---- inlet turbulence -------------------------------------------------------

export interface InletTurbulence {
  k: number;        // m^2/s^2
  epsilon: number;  // m^2/s^3
  omega: number;    // 1/s
  nut: number;      // m^2/s
}

/**
 * Inlet k / epsilon / omega from turbulence intensity (%) and a length scale.
 * length scale defaults to 0.07 * refLength when not given (pipe-flow rule).
 */
export function inletTurbulence(
  velocity: number,
  intensityPercent: number,
  lengthScale: number,
  Cmu = 0.09,
): InletTurbulence {
  const I = Math.max(intensityPercent, 0) / 100;
  const L = Math.max(lengthScale, 1e-6);
  const k = 1.5 * (velocity * I) ** 2;
  const epsilon = (Math.pow(Cmu, 0.75) * Math.pow(k, 1.5)) / L;
  const omega = Math.pow(k, 0.5) / (Math.pow(Cmu, 0.25) * L);
  const nut = k / Math.max(omega, 1e-9);
  return { k, epsilon, omega, nut };
}
