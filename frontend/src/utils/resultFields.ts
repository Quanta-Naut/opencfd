// Result fields the Results tab can show: the solver's own (per node, from
// the backend) plus ones derived from them here, the way a post-processor
// offers Cp or total pressure without the solver writing them.
//
// Pressure: an incompressible OpenFOAM run solves kinematic pressure p/rho
// (m2/s2); a compressible one solves static pressure in Pa. Everything shown
// is in Pa, scaled by the reference density where needed.
//
// Calculator fields (id `c:<name>`) are expressions over these, defined per
// project and evaluated here like any derived field.

import { evalExpr, exprVars, isExprError, parseExpr, type ExprNode } from './fieldExpr';

export type ResultFieldId =
  | 'U_mag'
  | 'Ux'
  | 'Uy'
  | 'p'
  | 'Cp'
  | 'p_total'
  | 'k'
  | 'omega'
  | 'nut'
  | 'T'
  | 'Ma'
  | 'vorticity'
  | 'yPlus'
  | 'tau_w'
  | 'Cf'
  | `c:${string}`;

/** A field the user defined in the calculator. */
export interface CustomField {
  /** `c:` plus the name. */
  id: `c:${string}`;
  name: string;
  unit: string;
  expr: string;
  /** Signed about zero: centre the colour range on 0. */
  symmetric?: boolean;
}

export interface ResultFieldDef {
  id: ResultFieldId;
  label: string;
  /** Short name for legends and tables. */
  short: string;
  unit: string;
  group: 'Velocity' | 'Pressure' | 'Turbulence' | 'Thermal' | 'Derived' | 'Wall' | 'Calculator';
  /** Signed about zero: the colour range is centred on 0. */
  symmetric?: boolean;
  /** Has values on walls only: for boundary plots and reports, not contours. */
  wallOnly?: boolean;
}

export const RESULT_FIELDS: ResultFieldDef[] = [
  { id: 'U_mag', label: 'Velocity magnitude', short: '|U|', unit: 'm/s', group: 'Velocity' },
  { id: 'Ux', label: 'Velocity X', short: 'Ux', unit: 'm/s', group: 'Velocity' },
  { id: 'Uy', label: 'Velocity Y', short: 'Uy', unit: 'm/s', group: 'Velocity' },
  { id: 'Ma', label: 'Mach number', short: 'Ma', unit: '', group: 'Velocity' },
  { id: 'p', label: 'Static pressure', short: 'p', unit: 'Pa', group: 'Pressure' },
  { id: 'Cp', label: 'Pressure coefficient', short: 'Cp', unit: '', group: 'Pressure' },
  { id: 'p_total', label: 'Total pressure', short: 'p0', unit: 'Pa', group: 'Pressure' },
  { id: 'k', label: 'Turbulent kinetic energy', short: 'k', unit: 'm²/s²', group: 'Turbulence' },
  { id: 'omega', label: 'Specific dissipation', short: 'ω', unit: '1/s', group: 'Turbulence' },
  { id: 'nut', label: 'Turbulent viscosity', short: 'νt', unit: 'm²/s', group: 'Turbulence' },
  { id: 'T', label: 'Temperature', short: 'T', unit: 'K', group: 'Thermal' },
  {
    id: 'vorticity',
    label: 'Vorticity',
    short: 'ωz',
    unit: '1/s',
    group: 'Derived',
    symmetric: true,
  },
  { id: 'yPlus', label: 'Wall y+', short: 'y+', unit: '', group: 'Wall', wallOnly: true },
  {
    id: 'tau_w',
    label: 'Wall shear stress',
    short: 'τw',
    unit: 'Pa',
    group: 'Wall',
    wallOnly: true,
  },
  {
    id: 'Cf',
    label: 'Skin friction coefficient (x)',
    short: 'Cf',
    unit: '',
    group: 'Wall',
    wallOnly: true,
  },
];

// Labels for calculator fields, for the many places that name a field by id
// alone. Kept in step with the project's list by useResultsView.
let customDefs: CustomField[] = [];
export function registerCustomFields(list: CustomField[]): void {
  customDefs = list;
}

export const fieldDef = (id: string): ResultFieldDef => {
  const c = id.startsWith('c:') ? customDefs.find((f) => f.id === id) : undefined;
  if (c)
    return {
      id: c.id,
      label: c.name,
      short: c.name,
      unit: c.unit,
      group: 'Calculator',
      symmetric: c.symmetric,
    };
  return builtinDef(id);
};

const builtinDef = (id: string): ResultFieldDef =>
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
  /** Kinematic viscosity, m2/s. */
  nu?: number;
  /** The project's calculator fields. */
  custom?: CustomField[];
}

/** What a calculator expression can read besides constants: the solver and
 *  derived fields under short names, and the point coordinates. */
export const EXPR_FIELDS: Record<string, string> = {
  U: 'U_mag',
  U_mag: 'U_mag',
  Ux: 'Ux',
  Uy: 'Uy',
  p: 'p',
  Cp: 'Cp',
  p0: 'p_total',
  k: 'k',
  omega: 'omega',
  nut: 'nut',
  T: 'T',
  Ma: 'Ma',
  vorticity: 'vorticity',
  yPlus: 'yPlus',
  tau_w: 'tau_w',
  Cf: 'Cf',
  x: 'x',
  y: 'y',
};

/** Freestream constants an expression can use. */
export function exprConstants(ref: FlowReference): Record<string, number> {
  return {
    rho: ref.rho,
    U_inf: ref.U,
    p_inf: ref.compressible ? ref.p : 0,
    q_inf: 0.5 * ref.rho * ref.U * ref.U,
    nu: ref.nu ?? 1.5e-5,
    pi: Math.PI,
  };
}

const parsed = new Map<string, ReturnType<typeof parseExpr>>();
function parseCached(src: string) {
  let e = parsed.get(src);
  if (!e) {
    e = parseExpr(src);
    if (parsed.size > 200) parsed.clear();
    parsed.set(src, e);
  }
  return e;
}

/** Check an expression: the parse error, or the first name it does not know. */
export function checkExpr(
  src: string,
  ref: FlowReference,
): { ok: boolean; tree: ExprNode | null; error: { message: string; pos: number } | null } {
  const e = parseCached(src);
  if (isExprError(e)) return { ok: false, tree: null, error: e };
  const consts = exprConstants(ref);
  for (const [name, pos] of exprVars(e))
    if (!(name in EXPR_FIELDS) && !(name in consts))
      return { ok: false, tree: null, error: { message: `Unknown name "${name}"`, pos } };
  return { ok: true, tree: e, error: null };
}

/** Evaluate an expression over a set of fields; null if it does not parse or
 *  reads a field this data does not have. */
export function evaluateExpr(
  src: string,
  fields: Record<string, Arr | undefined>,
  ref: FlowReference,
): Float64Array | null {
  const c = checkExpr(src, ref);
  if (!c.tree) return null;
  const vars: Record<string, number | Arr> = { ...exprConstants(ref) };
  let n = -1;
  for (const name of exprVars(c.tree).keys()) {
    const id = EXPR_FIELDS[name];
    if (!id) continue;
    const v = id === 'x' || id === 'y' ? fields[id] : fieldValues(fields, id, ref);
    if (!v) return null;
    vars[name] = v;
    n = v.length;
  }
  if (n < 0) n = (fields.U_mag ?? fields.p)?.length ?? 0;
  return evalExpr(c.tree, vars, n);
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
  if (id.startsWith('c:')) {
    const def = ref.custom?.find((f) => f.id === id);
    return def ? evaluateExpr(def.expr, fields, ref) : null;
  }
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
    case 'tau_w': {
      // As written: kinematic (m2/s2) when incompressible.
      const t = fields.wallShear;
      if (!t) return null;
      const out = new Float64Array(t.length);
      for (let i = 0; i < t.length; i++) out[i] = t[i] * toPa;
      return out;
    }
    case 'Cf': {
      // OpenFOAM's shear points against the flow over the wall, so flip it:
      // positive where the flow runs along +x, negative where it reverses.
      const t = fields.wallShearX;
      if (!t || !(q > 0)) return null;
      const out = new Float64Array(t.length);
      for (let i = 0; i < t.length; i++) out[i] = (-t[i] * toPa) / q;
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
