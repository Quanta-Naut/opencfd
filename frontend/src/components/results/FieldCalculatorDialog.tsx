import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import {
  EXPR_FIELDS,
  checkExpr,
  evaluateExpr,
  exprConstants,
  fieldValues,
  fmtValue,
  type CustomField,
  type FlowReference,
} from '../../utils/resultFields';
import { EXPR_FUNCTIONS } from '../../utils/fieldExpr';

export interface FieldCalculatorDialogProps {
  open: boolean;
  /** The field being edited, or null for a new one. */
  initial: CustomField | null;
  /** Names already taken by other calculator fields. */
  takenNames: string[];
  /** The loaded result's fields (with x and y), for the preview. */
  fields: Record<string, ArrayLike<number> | undefined> | undefined;
  flowRef: FlowReference;
  onSave: (f: CustomField) => void;
  onClose: () => void;
}

const PRESETS: { name: string; unit: string; expr: string; symmetric?: boolean; hint: string }[] = [
  { name: 'q', unit: 'Pa', expr: '0.5*rho*U^2', hint: 'Dynamic pressure' },
  {
    name: 'Tu',
    unit: '%',
    expr: '100*sqrt(2/3*k)/U_inf',
    hint: 'Turbulence intensity against the freestream speed',
  },
  { name: 'nut/nu', unit: '', expr: 'k/omega/nu', hint: 'Eddy viscosity ratio (k-omega models)' },
  {
    name: 'Flow angle',
    unit: 'deg',
    expr: 'atan2(Uy, Ux)*180/pi',
    symmetric: true,
    hint: 'Direction of the velocity, 0 = along +x',
  },
  { name: 'U deficit', unit: '', expr: '1 - U/U_inf', hint: 'Velocity deficit, as in a wake' },
  {
    name: 'Cp0',
    unit: '',
    expr: '(p0 - p_inf)/q_inf',
    hint: 'Total pressure coefficient; below 1 means losses',
  },
];

const FIELD_HINTS: Record<string, string> = {
  U: 'Velocity magnitude, m/s',
  Ux: 'Velocity x, m/s',
  Uy: 'Velocity y, m/s',
  p: 'Static pressure, Pa',
  Cp: 'Pressure coefficient',
  p0: 'Total pressure, Pa',
  k: 'Turbulent kinetic energy, m²/s²',
  omega: 'Specific dissipation, 1/s',
  vorticity: 'Vorticity, 1/s',
  x: 'Point x, m',
  y: 'Point y, m',
};
const CONST_HINTS: Record<string, string> = {
  rho: 'Density, kg/m³',
  U_inf: 'Freestream speed, m/s',
  p_inf: 'Freestream pressure, Pa',
  q_inf: 'Freestream dynamic pressure, Pa',
  nu: 'Kinematic viscosity, m²/s',
  pi: 'pi',
};

const chip =
  'px-1.5 py-0.5 rounded-sm border border-line bg-surface text-[11px] font-mono text-fg hover:border-line-strong hover:bg-surface-2 disabled:opacity-40 disabled:pointer-events-none';
const input =
  'w-full px-2 py-1.5 bg-surface border border-line rounded-sm text-xs text-fg focus:outline-none focus:border-accent';

/**
 * The calculator: define a field from an expression over the solver's
 * fields, with a live check and a preview of its values on the loaded
 * result. Saved fields appear wherever a field can be picked.
 */
export const FieldCalculatorDialog: React.FC<FieldCalculatorDialogProps> = ({
  open,
  initial,
  takenNames,
  fields,
  flowRef,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [expr, setExpr] = useState('');
  const [symmetric, setSymmetric] = useState(false);
  const exprRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? '');
    setUnit(initial?.unit ?? '');
    setExpr(initial?.expr ?? '');
    setSymmetric(!!initial?.symmetric);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const check = useMemo(() => checkExpr(expr, flowRef), [expr, flowRef]);
  // Which short names this result has (an older run has no Ux / Uy).
  const has = useMemo(() => {
    const s = new Set<string>();
    for (const [short, id] of Object.entries(EXPR_FIELDS)) {
      const v = id === 'x' || id === 'y' ? fields?.[id] : fieldValues(fields, id, flowRef);
      if (v?.length) s.add(short);
    }
    return s;
  }, [fields, flowRef]);
  const values = useMemo(
    () => (check.ok && fields ? evaluateExpr(expr, fields, flowRef) : null),
    [check, expr, fields, flowRef],
  );
  const stats = useMemo(() => {
    if (!values?.length) return null;
    let lo = Infinity,
      hi = -Infinity,
      sum = 0,
      n = 0;
    for (const v of values)
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sum += v;
        n++;
      }
    if (!n) return { lo: NaN, hi: NaN, mean: NaN, bins: [], bad: values.length };
    const bins = new Array(32).fill(0);
    const span = hi - lo || 1;
    for (const v of values)
      if (Number.isFinite(v)) bins[Math.min(31, Math.floor(((v - lo) / span) * 32))]++;
    return { lo, hi, mean: sum / n, bins, bad: values.length - n };
  }, [values]);

  if (!open) return null;

  const err = check.error;
  const trimmed = name.trim();
  const nameTaken = takenNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
  const missing =
    check.ok && fields
      ? [...new Set([...expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]))].filter(
          (v) => v in EXPR_FIELDS && !has.has(v),
        )
      : [];
  const canSave = !!trimmed && !nameTaken && check.ok;

  const insert = (text: string, caretBack = 0) => {
    const el = exprRef.current;
    const a = el?.selectionStart ?? expr.length;
    const b = el?.selectionEnd ?? expr.length;
    const next = expr.slice(0, a) + text + expr.slice(b);
    setExpr(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const c = a + text.length - caretBack;
      el.setSelectionRange(c, c);
    });
  };

  const save = () => {
    if (!canSave) return;
    onSave({
      id: initial?.id ?? `c:${Date.now().toString(36)}`,
      name: trimmed,
      unit: unit.trim(),
      expr: expr.trim(),
      symmetric,
    });
  };

  const consts = exprConstants(flowRef);
  const maxBin = stats?.bins.length ? Math.max(...stats.bins) : 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] rounded bg-surface border border-line flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Calculator"
      >
        <div className="px-5 py-3 border-b border-line-soft bg-surface-2 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-fg">
              {initial ? 'Edit calculator field' : 'New calculator field'}
            </h2>
            <p className="text-[11px] text-fg-2">
              A field computed from the solver's own, usable in contours, probes, reports and plots.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-fg-2 hover:bg-surface-3 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col md:flex-row">
          <div className="flex-1 min-w-0 p-5 space-y-4">
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <label>
                <span className="text-[11px] text-fg-2 block mb-1">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. q"
                  className={input}
                  autoFocus={!initial}
                />
              </label>
              <label>
                <span className="text-[11px] text-fg-2 block mb-1">Unit</span>
                <input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g. Pa"
                  className={input}
                />
              </label>
            </div>
            {nameTaken && (
              <p className="text-[11px] text-danger -mt-2">Another field already has this name.</p>
            )}

            <label className="block">
              <span className="text-[11px] text-fg-2 block mb-1">Expression</span>
              <textarea
                ref={exprRef}
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
                }}
                rows={3}
                spellCheck={false}
                placeholder="0.5*rho*U^2"
                className={`${input} font-mono text-[13px] resize-y ${
                  expr && !check.ok ? '!border-danger-line' : ''
                }`}
              />
            </label>
            {expr && !check.ok && (
              <div className="-mt-2 rounded-sm bg-danger-soft border border-danger-line px-2 py-1.5">
                <pre className="text-[11px] font-mono text-fg whitespace-pre overflow-x-auto">
                  {expr.replace(/\n/g, ' ')}
                  {'\n'}
                  <span className="text-danger">{' '.repeat(err?.pos ?? 0)}^</span>
                </pre>
                <p className="text-[11px] text-danger mt-0.5">{err?.message}</p>
              </div>
            )}
            {missing.length > 0 && (
              <p className="-mt-2 text-[11px] text-warning">
                The loaded run has no {missing.join(', ')}; this field will be empty for it.
              </p>
            )}

            <div className="space-y-2">
              <ChipRow label="Fields">
                {['U', 'Ux', 'Uy', 'p', 'Cp', 'p0', 'k', 'omega', 'vorticity', 'x', 'y'].map(
                  (v) => (
                    <Tooltip key={v} content={FIELD_HINTS[v]} delay={250}>
                      <button
                        type="button"
                        className={chip}
                        disabled={!!fields && !has.has(v)}
                        onClick={() => insert(v)}
                      >
                        {v}
                      </button>
                    </Tooltip>
                  ),
                )}
              </ChipRow>
              <ChipRow label="Constants">
                {Object.keys(consts).map((c) => (
                  <Tooltip
                    key={c}
                    content={`${CONST_HINTS[c]} = ${fmtValue(consts[c])}`}
                    delay={250}
                  >
                    <button type="button" className={chip} onClick={() => insert(c)}>
                      {c}
                    </button>
                  </Tooltip>
                ))}
              </ChipRow>
              <ChipRow label="Functions">
                {Object.keys(EXPR_FUNCTIONS).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={chip}
                    onClick={() => insert(`${f}()`, 1)}
                  >
                    {f}
                  </button>
                ))}
              </ChipRow>
              <ChipRow label="Operators">
                {['+', '-', '*', '/', '^', '(', ')'].map((o) => (
                  <button key={o} type="button" className={`${chip} w-6`} onClick={() => insert(o)}>
                    {o}
                  </button>
                ))}
              </ChipRow>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-fg cursor-pointer select-none">
              <input
                type="checkbox"
                checked={symmetric}
                onChange={(e) => setSymmetric(e.target.checked)}
                className="accent-accent"
              />
              Signed value: centre the colours on zero
            </label>
          </div>

          <div className="md:w-64 shrink-0 border-t md:border-t-0 md:border-l border-line-soft bg-surface-2 p-4 space-y-4">
            <div>
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Preview
              </span>
              {!fields ? (
                <p className="text-[11px] text-fg-3">Load a result to preview.</p>
              ) : !check.ok ? (
                <p className="text-[11px] text-fg-3">Waiting for a valid expression.</p>
              ) : !stats ? (
                <p className="text-[11px] text-fg-3">No values for the loaded run.</p>
              ) : (
                <>
                  <div className="h-14 flex items-end gap-px border-b border-line">
                    {stats.bins.map((b, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-accent-line"
                        style={{
                          height: `${maxBin ? Math.max(b ? 4 : 0, (b / maxBin) * 100) : 0}%`,
                        }}
                      />
                    ))}
                  </div>
                  <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                    {(
                      [
                        ['Min', stats.lo],
                        ['Mean', stats.mean],
                        ['Max', stats.hi],
                      ] as const
                    ).map(([k, v]) => (
                      <React.Fragment key={k}>
                        <dt className="text-fg-2">{k}</dt>
                        <dd className="font-mono text-right text-fg">
                          {fmtValue(v)}
                          {unit.trim() ? ` ${unit.trim()}` : ''}
                        </dd>
                      </React.Fragment>
                    ))}
                  </dl>
                  {stats.bad > 0 && (
                    <p className="mt-1 text-[11px] text-warning">
                      {stats.bad} point{stats.bad === 1 ? '' : 's'} not a number (like a division by
                      zero).
                    </p>
                  )}
                </>
              )}
            </div>
            <div>
              <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block mb-1.5">
                Presets
              </span>
              <div className="space-y-1">
                {PRESETS.map((pr) => (
                  <button
                    key={pr.name}
                    type="button"
                    onClick={() => {
                      setName(pr.name);
                      setUnit(pr.unit);
                      setExpr(pr.expr);
                      setSymmetric(!!pr.symmetric);
                    }}
                    className="w-full text-left rounded-sm border border-line bg-surface px-2 py-1.5 hover:border-line-strong"
                  >
                    <div className="text-[11px] text-fg font-medium">{pr.hint}</div>
                    <div className="text-[11px] font-mono text-fg-2 truncate">{pr.expr}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line-soft bg-surface-2 flex items-center justify-end gap-2 shrink-0">
          <span className="mr-auto text-[11px] text-fg-3">Ctrl+Enter saves</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-fg-2 hover:text-fg border border-line rounded-sm bg-surface hover:bg-app"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent-hover rounded-sm transition-colors disabled:opacity-50"
          >
            {initial ? 'Save field' : 'Add field'}
          </button>
        </div>
      </div>
    </div>
  );
};

function ChipRow(p: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-[70px] shrink-0 pt-0.5 text-[11px] text-fg-2">{p.label}</span>
      <div className="flex flex-wrap gap-1">{p.children}</div>
    </div>
  );
}

export default FieldCalculatorDialog;
