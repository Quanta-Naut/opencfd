// Catalogue of turbulence models exposed in Case Setup. Each entry carries the
// metadata the UI and the case generator need: which fields it solves, what
// wall treatments it supports, and whether it is meant for compressible /
// high-speed flow.

export type TurbulenceModelId =
  | 'laminar'
  | 'kEpsilon'
  | 'realizableKE'
  | 'RNGkEpsilon'
  | 'kOmega'
  | 'kOmegaSST'
  | 'kOmegaSSTLM'        // gamma-Re_theta transition
  | 'SpalartAllmaras'
  | 'kOmegaSSTComp'      // SST with compressibility corrections
  | 'SpalartAllmarasComp';

export type WallTreatment = 'wall_functions' | 'resolved' | 'auto';

export interface TurbulenceModel {
  id: TurbulenceModelId;
  label: string;
  /** OpenFOAM `RASModel` / `simulationType` name. */
  foamName: string;
  group: 'none' | 'k-epsilon' | 'k-omega' | 'eddy-viscosity' | 'transition' | 'high-speed';
  /** Extra transported fields beyond U, p (T is added by the compressible flag). */
  fields: Array<'k' | 'omega' | 'epsilon' | 'nut' | 'nuTilda'>;
  wallTreatments: WallTreatment[];
  /** Recommended y+ band for the default wall treatment. */
  yPlus: { low: number; high: number; note: string };
  compressibleReady: boolean;
  blurb: string;
}

export const TURBULENCE_MODELS: TurbulenceModel[] = [
  {
    id: 'laminar',
    label: 'Laminar (no model)',
    foamName: 'laminar',
    group: 'none',
    fields: [],
    wallTreatments: ['resolved'],
    yPlus: { low: 0, high: 1, note: 'Resolve the boundary layer: y+ ~ 1.' },
    compressibleReady: true,
    blurb: 'No turbulence closure. Only valid at low Reynolds number.',
  },
  {
    id: 'kOmegaSST',
    label: 'k-omega SST',
    foamName: 'kOmegaSST',
    group: 'k-omega',
    fields: ['k', 'omega', 'nut'],
    wallTreatments: ['auto', 'wall_functions', 'resolved'],
    yPlus: { low: 1, high: 300, note: 'SST blends: y+ < 1 (resolved) or 30-300 (wall functions).' },
    compressibleReady: true,
    blurb: 'The general-purpose default. Good for adverse pressure gradients and separation.',
  },
  {
    id: 'kOmega',
    label: 'k-omega (Wilcox)',
    foamName: 'kOmega',
    group: 'k-omega',
    fields: ['k', 'omega', 'nut'],
    wallTreatments: ['resolved', 'wall_functions'],
    yPlus: { low: 1, high: 5, note: 'Best wall-resolved: y+ < 2.' },
    compressibleReady: true,
    blurb: 'Robust near walls, sensitive to freestream omega.',
  },
  {
    id: 'kEpsilon',
    label: 'Standard k-epsilon',
    foamName: 'kEpsilon',
    group: 'k-epsilon',
    fields: ['k', 'epsilon', 'nut'],
    wallTreatments: ['wall_functions'],
    yPlus: { low: 30, high: 300, note: 'Wall functions only: y+ 30-300.' },
    compressibleReady: true,
    blurb: 'Cheap and stable for fully turbulent internal flow. Weak in separation.',
  },
  {
    id: 'realizableKE',
    label: 'Realizable k-epsilon',
    foamName: 'realizableKE',
    group: 'k-epsilon',
    fields: ['k', 'epsilon', 'nut'],
    wallTreatments: ['wall_functions'],
    yPlus: { low: 30, high: 300, note: 'Wall functions: y+ 30-300.' },
    compressibleReady: true,
    blurb: 'Better than standard k-epsilon for jets, rotation and strong streamline curvature.',
  },
  {
    id: 'RNGkEpsilon',
    label: 'RNG k-epsilon',
    foamName: 'RNGkEpsilon',
    group: 'k-epsilon',
    fields: ['k', 'epsilon', 'nut'],
    wallTreatments: ['wall_functions'],
    yPlus: { low: 30, high: 300, note: 'Wall functions: y+ 30-300.' },
    compressibleReady: true,
    blurb: 'Handles low-Reynolds and transitional regions better than standard k-epsilon.',
  },
  {
    id: 'SpalartAllmaras',
    label: 'Spalart-Allmaras',
    foamName: 'SpalartAllmaras',
    group: 'eddy-viscosity',
    fields: ['nuTilda', 'nut'],
    wallTreatments: ['resolved'],
    yPlus: { low: 0, high: 1, note: 'One-equation, wall-resolved: y+ ~ 1.' },
    compressibleReady: true,
    blurb: 'Aerospace standard for attached external flow. Cheap, one equation.',
  },
  {
    id: 'kOmegaSSTLM',
    label: 'k-omega SST + transition (gamma-Re_theta)',
    foamName: 'kOmegaSSTLM',
    group: 'transition',
    fields: ['k', 'omega', 'nut'],
    wallTreatments: ['resolved'],
    yPlus: { low: 0, high: 1, note: 'Transition needs a resolved wall: y+ < 1.' },
    compressibleReady: true,
    blurb: 'Predicts laminar-to-turbulent transition. Needs a very fine wall-normal mesh.',
  },
  {
    id: 'kOmegaSSTComp',
    label: 'k-omega SST (compressibility corrected)',
    foamName: 'kOmegaSST',
    group: 'high-speed',
    fields: ['k', 'omega', 'nut'],
    wallTreatments: ['auto', 'resolved'],
    yPlus: { low: 0, high: 1, note: 'Supersonic / hypersonic: resolve the wall, y+ < 1.' },
    compressibleReady: true,
    blurb: 'SST with a compressibility correction for supersonic mixing layers and shock interaction.',
  },
  {
    id: 'SpalartAllmarasComp',
    label: 'Spalart-Allmaras (compressible)',
    foamName: 'SpalartAllmaras',
    group: 'high-speed',
    fields: ['nuTilda', 'nut'],
    wallTreatments: ['resolved'],
    yPlus: { low: 0, high: 1, note: 'Supersonic / hypersonic: y+ < 1.' },
    compressibleReady: true,
    blurb: 'SA for high-speed attached flow and aeroheating estimates.',
  },
];

export const turbulenceModel = (id: TurbulenceModelId): TurbulenceModel =>
  TURBULENCE_MODELS.find((m) => m.id === id) ?? TURBULENCE_MODELS[1];

/** Models valid for the current regime / compressibility choice. */
export function availableTurbulenceModels(opts: {
  regime: 'laminar' | 'turbulent';
  compressible: boolean;
}): TurbulenceModel[] {
  if (opts.regime === 'laminar') return TURBULENCE_MODELS.filter((m) => m.id === 'laminar');
  return TURBULENCE_MODELS.filter((m) => m.id !== 'laminar' && (!opts.compressible || m.compressibleReady));
}
