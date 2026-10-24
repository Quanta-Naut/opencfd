// Result fields the Results tab can show: the solver's own (per node, from
// the backend) plus ones derived from them here, the way a post-processor
// offers Cp or total pressure without the solver writing them.
//
// Pressure: an incompressible OpenFOAM run solves kinematic pressure p/rho
// (m2/s2); a compressible one solves static pressure in Pa. Everything shown
// is in Pa, scaled by the reference density where needed.

export type ResultFieldId =
  | 'U_mag'
  | 'Ux'
  | 'Uy'
  | 'p'
  | 'Cp'
  | 'p_total'
  | 'k'
  | 'omega'
  | 'vorticity';

export interface ResultFieldDef {
  id: ResultFieldId;
  label: string;
  /** Short name for legends and tables. */
  short: string;
  unit: string;
  group: 'Velocity' | 'Pressure' | 'Turbulence' | 'Derived';
  /** Signed about zero: the colour range is centred on 0. */
  symmetric?: boolean;
}

export const RESULT_FIELDS: ResultFieldDef[] = [
  { id: 'U_mag', label: 'Velocity magnitude', short: '|U|', unit: 'm/s', group: 'Velocity' },
  { id: 'Ux', label: 'Velocity X', short: 'Ux', unit: 'm/s', group: 'Velocity' },
  { id: 'Uy', label: 'Velocity Y', short: 'Uy', unit: 'm/s', group: 'Velocity' },
  { id: 'p', label: 'Static pressure', short: 'p', unit: 'Pa', group: 'Pressure' },
  { id: 'Cp', label: 'Pressure coefficient', short: 'Cp', unit: '', group: 'Pressure' },
  { id: 'p_total', label: 'Total pressure', short: 'p0', unit: 'Pa', group: 'Pressure' },
  { id: 'k', label: 'Turbulent kinetic energy', short: 'k', unit: 'm²/s²', group: 'Turbulence' },
  { id: 'omega', label: 'Specific dissipation', short: 'ω', unit: '1/s', group: 'Turbulence' },
  {
    id: 'vorticity',
    label: 'Vorticity',
    short: 'ωz',
    unit: '1/s',
    group: 'Derived',
    symmetric: true,
  },
];

export const fieldDef = (id: string): ResultFieldDef =>
  RESULT_FIELDS.find((f) => f.id === id) ?? {
    id: id as ResultFieldId,
    label: id,
    short: id,
    unit: '',
    group: 'Derived',
  };

/** Freestream reference for the derived pressure fields. */
export interface FlowReference {
  compressible: boolean;
  /** Density, kg/m3. */
  rho: number;
  /** Freestream speed, m/s. */
  U: number;
  /** Freestream static pressure in the solver's own units (0 for an
   *  incompressible run, Pa for a compressible one). */
  p: number;
}

type Arr = ArrayLike<number>;

/** The values of `id` from a set of solver fields (per node, or sampled along
 *  a line). Null when the run did not write what it needs. */
export function fieldValues(
  fields: Record<string, Arr | undefined> | undefined,
  id: string,
  ref: FlowReference,
): Arr | null {
  if (!fields) return null;
  const raw = fields[id];
  const p = fields.p;
  const umag = fields.U_mag;
  // Solver pressure to Pa: kinematic pressure times density.
  const toPa = ref.compressible ? 1 : ref.rho;
  const q = 0.5 * ref.rho * ref.U * ref.U;
  switch (id) {
    case 'p': {
      if (!p) return null;
      if (toPa === 1) return p;
      const out = new Float64Array(p.length);
      for (let i = 0; i < p.length; i++) out[i] = p[i] * toPa;
      return out;
    }
    case 'Cp': {
      if (!p || !(q > 0)) return null;
      const out = new Float64Array(p.length);
      for (let i = 0; i < p.length; i++) out[i] = ((p[i] - ref.p) * toPa) / q;
      return out;
    }
    case 'p_total': {
      if (!p || !umag) return null;
      // Incompressible total pressure; for a compressible run this is the
      // low-Mach form, close enough below about Mach 0.3.
      const out = new Float64Array(p.length);
      for (let i = 0; i < p.length; i++) out[i] = p[i] * toPa + 0.5 * ref.rho * umag[i] * umag[i];
      return out;
    }
    default:
      return raw ?? null;
  }
}

/** Display range: the 1st to 99th percentile ('auto', so a few near-wall
 *  spikes don't wash out the map), or the true min and max ('full'). */
export function valueRange(vals: Arr, mode: 'auto' | 'full', symmetric = false): [number, number] {
  const finite: number[] = [];
  for (let i = 0; i < vals.length; i++) if (Number.isFinite(vals[i])) finite.push(vals[i]);
  if (!finite.length) return [0, 1];
  if (symmetric) {
    const mags = finite.map(Math.abs).sort((a, b) => a - b);
    const m = mode === 'full' ? mags[mags.length - 1] : mags[Math.floor(0.95 * (mags.length - 1))];
    return m > 0 ? [-m, m] : [-1, 1];
  }
  finite.sort((a, b) => a - b);
  const at = (q: number) => finite[Math.round(q * (finite.length - 1))];
  let lo = mode === 'full' ? finite[0] : at(0.01);
  let hi = mode === 'full' ? finite[finite.length - 1] : at(0.99);
  if (!(hi - lo > 1e-12 * Math.max(1, Math.abs(hi)))) {
    lo = finite[0];
    hi = finite[finite.length - 1];
  }
  if (hi === lo) hi = lo + 1;
  return [lo, hi];
}

/** Readable number for tables and labels. */
export function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(3);
  return Number(v.toPrecision(4)).toString();
}
