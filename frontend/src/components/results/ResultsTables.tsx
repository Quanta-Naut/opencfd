import React, { useMemo, useState } from 'react';
import { Copy, Download, X } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { toast } from '../ui/Toast';
import { RESULT_FIELDS, fieldDef, fmtValue, type ResultFieldId } from '../../utils/resultFields';
import type { PostProcessConfig, PlotDefinition } from '../../types/cfd';
import type { ProbeRow, WallReport, ForceBreakdown } from '../../hooks/useResultsView';
import type { PatchReport } from '../../utils/boundaryData';
import type { SurfaceRef, SurfaceResult } from '../../utils/surfaceIntegrals';

// The Results tables that live in the bottom drawer: probe values, run and
// boundary reports, and surface integrals. The sidebar keeps the controls.

const lbl = 'text-[11px] text-fg-2';
const select =
  'w-full px-2 py-1.5 bg-surface border border-line rounded-sm text-[11px] font-medium text-fg focus:outline-none focus:border-accent';
const toolBtn =
  'inline-flex items-center gap-1 text-[11px] font-medium text-fg-2 hover:text-fg bg-surface border border-line px-2 py-1 rounded-sm hover:bg-app transition-colors disabled:opacity-40 disabled:pointer-events-none';

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export interface ProbesTabProps {
  rows: ProbeRow[];
  activeField: ResultFieldId;
  customIds: ResultFieldId[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

/** Probe values: a row per probe, a column per field. */
export function ProbesTab(p: ProbesTabProps) {
  const cols = useMemo(() => {
    const ids = [...RESULT_FIELDS.map((f) => f.id), ...p.customIds];
    return ids.filter(
      (id) => !fieldDef(id).wallOnly && p.rows.some((r) => r.values?.[id] !== undefined),
    );
  }, [p.rows, p.customIds]);
  if (!p.rows.length)
    return (
      <p className="p-4 text-[11px] text-fg-3">
        No probes yet. Use Add probe points in the sidebar and click on the field.
      </p>
    );
  const head = [
    '#',
    'x (m)',
    'y (m)',
    ...cols.map((id) => {
      const f = fieldDef(id);
      return f.unit ? `${f.short} (${f.unit})` : f.short;
    }),
  ];
  const body = p.rows.map((r, i) => [
    String(i + 1),
    String(r.x),
    String(r.y),
    ...cols.map((id) => (r.values?.[id] !== undefined ? String(r.values[id]) : '')),
  ]);
  const csv = [head, ...body]
    .map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n');
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line-soft sticky top-0 bg-surface z-10">
        <span className="text-[11px] text-fg-2">
          {p.rows.length} probe{p.rows.length > 1 ? 's' : ''}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            className={toolBtn}
            onClick={() =>
              navigator.clipboard
                ?.writeText(csv.replace(/,/g, '\t'))
                .then(() => toast.success('Copied the probe table'))
            }
          >
            <Copy className="w-3 h-3" />
            Copy
          </button>
          <button
            type="button"
            className={toolBtn}
            onClick={() => download('probes.csv', csv, 'text/csv')}
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
          <button type="button" className={toolBtn} onClick={p.onClear}>
            Clear
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] font-mono border-collapse">
          <thead>
            <tr className="text-fg-3">
              {head.map((h, i) => (
                <th
                  key={h}
                  className={`font-medium px-3 py-1 whitespace-nowrap ${i === 0 ? 'text-left' : 'text-right'} ${
                    cols[i - 3] === p.activeField ? 'text-accent-fg' : ''
                  }`}
                >
                  {h}
                </th>
              ))}
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, ri) => (
              <tr
                key={r.id}
                onClick={() => p.onSelect(p.selectedId === r.id ? null : r.id)}
                className={`border-t border-line-soft cursor-pointer ${
                  p.selectedId === r.id ? 'bg-accent-soft' : 'hover:bg-surface-2'
                }`}
              >
                {body[ri].map((c, ci) => (
                  <td
                    key={ci}
                    className={`px-3 py-0.5 whitespace-nowrap ${ci === 0 ? 'text-left text-fg font-sans font-semibold' : 'text-right'} ${
                      cols[ci - 3] === p.activeField ? 'text-fg font-semibold' : 'text-fg-2'
                    }`}
                  >
                    {ci >= 1 && c !== '' ? fmtValue(Number(c)) : c || (ci > 2 ? '' : c)}
                  </td>
                ))}
                <td className="px-1 text-right">
                  <button
                    type="button"
                    aria-label="Remove probe"
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onRemove(r.id);
                    }}
                    className="text-fg-3 hover:text-fg"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
            {p.rows.some((r) => !r.values) && (
              <tr>
                <td colSpan={head.length + 1} className="px-3 py-1 text-[10px] text-fg-3">
                  Probes outside the mesh have no values.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface ReportsTabProps {
  activeField: ResultFieldId;
  runForces: { label: string; cd?: number; cl?: number } | null;
  forces: ForceBreakdown | null;
  wallReports: WallReport[];
  reports: PatchReport[];
}

/** Forces, walls and per-boundary values side by side. */
export function ReportsTab(p: ReportsTabProps) {
  const def = fieldDef(p.activeField);
  const unit = def.unit ? ` ${def.unit}` : '';
  const view = { forces: p.forces, wallReports: p.wallReports, reports: p.reports };
  // Nothing flows through a wall; node-averaged velocity would show a trace.
  const walls = new Set(view.wallReports.map((r) => r.patch));
  const flows = view.reports.filter((r) => r.flow !== null && !walls.has(r.patch));
  const inflow = flows.reduce((s, r) => s + Math.min(0, r.flow!), 0);
  const net = flows.reduce((s, r) => s + r.flow!, 0);
  return (
    <div className="p-4 grid gap-x-8 gap-y-5 items-start [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
      {p.runForces && (p.runForces.cd !== undefined || p.runForces.cl !== undefined) && (
        <div>
          <span className={`${lbl} block mb-1`}>Forces · {p.runForces.label}</span>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ['Cd', p.runForces.cd],
                ['Cl', p.runForces.cl],
                [
                  'L/D',
                  p.runForces.cd && p.runForces.cl !== undefined
                    ? p.runForces.cl / p.runForces.cd
                    : undefined,
                ],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-sm border border-line bg-surface-2 px-2 py-1">
                <div className="text-[11px] text-fg-2">{k}</div>
                <div className="font-mono text-[12px] text-fg">
                  {v !== undefined ? fmtValue(v) : '-'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {view.forces && (view.forces.cd_pressure !== undefined || view.forces.cm !== undefined) && (
        <div>
          <Tooltip
            content="Drag and lift from the pressure on the walls and from friction along them. Cm is the pitching moment about the reference point (a quarter chord by default)."
            delay={300}
          >
            <span className={`${lbl} block mb-1 cursor-help`}>Force breakdown</span>
          </Tooltip>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-fg-3">
                <th className="text-left font-medium pb-0.5">&nbsp;</th>
                <th className="text-right font-medium">Total</th>
                <th className="text-right font-medium">Pressure</th>
                <th className="text-right font-medium">Viscous</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {(
                [
                  ['Cd', view.forces.cd, view.forces.cd_pressure, view.forces.cd_viscous],
                  ['Cl', view.forces.cl, view.forces.cl_pressure, view.forces.cl_viscous],
                  ['Cm', view.forces.cm, undefined, undefined],
                ] as const
              ).map(([k, t, pr, vi]) => (
                <tr key={k} className="border-t border-line-soft">
                  <td className="py-0.5 font-sans text-fg">{k}</td>
                  <td className="text-right text-fg">{t !== undefined ? fmtValue(t) : '-'}</td>
                  <td className="text-right text-fg-2">{pr !== undefined ? fmtValue(pr) : ''}</td>
                  <td className="text-right text-fg-2">{vi !== undefined ? fmtValue(vi) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.wallReports.length > 0 && (
        <div>
          <Tooltip
            content="y+ is the first cell's height in wall units. Near 1 resolves the viscous layer, which k-omega SST without wall functions needs; 30 to 300 suits wall functions."
            delay={300}
          >
            <span className={`${lbl} block mb-1 cursor-help`}>Walls</span>
          </Tooltip>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-fg-3">
                <th className="text-left font-medium pb-0.5">Patch</th>
                <th className="text-right font-medium">y+ avg</th>
                <th className="text-right font-medium">y+ max</th>
                <th className="text-right font-medium">τw avg (Pa)</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {view.wallReports.map((r) => (
                <tr key={r.patch} className="border-t border-line-soft">
                  <td className="py-0.5 font-sans text-fg">{r.patch}</td>
                  <td className="text-right text-fg">{r.yPlus ? fmtValue(r.yPlus.avg) : '-'}</td>
                  <td className="text-right text-fg-2">{r.yPlus ? fmtValue(r.yPlus.max) : '-'}</td>
                  <td className="text-right text-fg-2">{r.tau ? fmtValue(r.tau.avg) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.reports.length > 0 ? (
        <div>
          <span className={`${lbl} block mb-1`}>
            {def.label} on each boundary{unit && ` (${def.unit})`}
          </span>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-fg-3">
                <th className="text-left font-medium pb-0.5">Patch</th>
                <th className="text-right font-medium">Avg</th>
                <th className="text-right font-medium">Min</th>
                <th className="text-right font-medium">Max</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {view.reports.map((r) => (
                <tr key={r.patch} className="border-t border-line-soft">
                  <td className="py-0.5 font-sans text-fg">{r.patch}</td>
                  <td className="text-right text-fg">{fmtValue(r.avg)}</td>
                  <td className="text-right text-fg-2">{fmtValue(r.min)}</td>
                  <td className="text-right text-fg-2">{fmtValue(r.max)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {flows.length > 0 && (
            <>
              <Tooltip
                content="Volume flow through each boundary per metre of depth; positive leaves the domain. In a converged run, what comes in goes out."
                delay={300}
              >
                <span className={`${lbl} block mt-2 mb-1 cursor-help`}>Flow out (m²/s)</span>
              </Tooltip>
              <table className="w-full text-[11px] font-mono">
                <tbody>
                  {flows
                    .filter((r) => Math.abs(r.flow!) > 1e-9 * (Math.abs(inflow) || 1))
                    .map((r) => (
                      <tr key={r.patch} className="border-t border-line-soft">
                        <td className="py-0.5 font-sans text-fg">{r.patch}</td>
                        <td className="text-right text-fg">{fmtValue(r.flow!)}</td>
                      </tr>
                    ))}
                  <tr className="border-t border-line">
                    <td className="py-0.5 font-sans text-fg-2">Imbalance</td>
                    <td className="text-right text-fg-2">
                      {inflow < 0 ? `${((Math.abs(net) / -inflow) * 100).toFixed(2)}%` : '-'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-fg-2">Load a field to see boundary values.</p>
      )}
    </div>
  );
}

interface SurfaceChoice {
  value: string;
  label: string;
  ref: SurfaceRef;
}

/** Flow, averages and integrals of the shown field over one surface, and the
 *  pressure change between two. */
function SurfaceIntegrals(p: {
  integrate: (s: SurfaceRef, id: string) => SurfaceResult | null;
  surfaces: SurfaceChoice[];
  activeField: ResultFieldId;
  sel: string;
  setSel: (v: string) => void;
  from: string;
  setFrom: (v: string) => void;
  to: string;
  setTo: (v: string) => void;
}) {
  const find = (v: string) => p.surfaces.find((s) => s.value === v) ?? null;
  const surf = find(p.sel) ?? p.surfaces[0] ?? null;
  const a = find(p.from) ?? p.surfaces[0] ?? null;
  const b = find(p.to) ?? p.surfaces[1] ?? p.surfaces[0] ?? null;
  const def = fieldDef(p.activeField);
  const u = def.unit ? ` ${def.unit}` : '';
  const row = (label: string, value: string, hint?: string) => (
    <tr key={label} className="border-t border-line-soft">
      <td className="py-0.5 font-sans text-fg-2">
        {hint ? (
          <Tooltip content={hint} delay={300}>
            <span className="cursor-help">{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </td>
      <td className="text-right text-fg">{value}</td>
    </tr>
  );
  const main = surf ? p.integrate(surf.ref, p.activeField) : null;
  const sa = a ? p.integrate(a.ref, 'p') : null;
  const sb = b ? p.integrate(b.ref, 'p') : null;
  const ta = a ? p.integrate(a.ref, 'p_total') : null;
  const tb = b ? p.integrate(b.ref, 'p_total') : null;
  const choose = (value: string, set: (v: string) => void, label: string) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => set(e.target.value)}
      className={select}
    >
      {p.surfaces.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <div className="w-72 max-w-full space-y-3">
        <div>
          <span className={`${lbl} block mb-1`}>Surface</span>
          {choose(surf?.value ?? '', p.setSel, 'Surface')}
        </div>
        {main ? (
          <table className="w-full text-[11px] font-mono">
            <tbody>
              {row('Length', fmtValue(main.length), 'Its area per metre of depth')}
              {row(
                'Flow rate (m²/s)',
                fmtValue(main.flow),
                main.normal
                  ? `Counted to the right of the line from its first point to its second, along (${fmtValue(main.normal[0])}, ${fmtValue(main.normal[1])}).`
                  : 'Positive leaves the domain, negative enters it.',
              )}
              {row(
                'Mass flow (kg/s)',
                fmtValue(main.massFlow),
                'Flow rate times the density, per metre of depth',
              )}
              {row(
                `∫ ${def.short} dl${def.unit ? ` (${def.unit}·m)` : ''}`,
                fmtValue(main.integral),
              )}
              {row(`Average ${def.short}${u}`, fmtValue(main.avg), 'Weighted by length')}
              {row(
                `Mass-weighted ${def.short}${u}`,
                main.fluxAvg === null ? '-' : fmtValue(main.fluxAvg),
                'Weighted by the flow through each part of the surface',
              )}
            </tbody>
          </table>
        ) : (
          <p className="text-[11px] text-fg-2">Nothing to integrate here.</p>
        )}
      </div>

      {p.surfaces.length > 1 && (
        <div className="w-72 max-w-full space-y-1.5">
          <span className={`${lbl} block`}>Pressure drop</span>
          <div className="grid grid-cols-2 gap-1.5">
            <label>
              <span className={`${lbl} block mb-0.5`}>From</span>
              {choose(a?.value ?? '', p.setFrom, 'Pressure drop from')}
            </label>
            <label>
              <span className={`${lbl} block mb-0.5`}>To</span>
              {choose(b?.value ?? '', p.setTo, 'Pressure drop to')}
            </label>
          </div>
          {sa && sb && ta && tb ? (
            <table className="w-full text-[11px] font-mono">
              <tbody>
                {row(
                  'Static (Pa)',
                  fmtValue(sa.avg - sb.avg),
                  'Average static pressure on From minus on To',
                )}
                {row(
                  'Total (Pa)',
                  fmtValue((ta.fluxAvg ?? ta.avg) - (tb.fluxAvg ?? tb.avg)),
                  'Mass-weighted total pressure on From minus on To: what the flow lost between them',
                )}
              </tbody>
            </table>
          ) : (
            <p className="text-[11px] text-fg-2">Needs pressure in this run.</p>
          )}
        </div>
      )}
    </div>
  );
}

export interface IntegralsTabProps {
  integrate: ((s: SurfaceRef, id: string) => SurfaceResult | null) | null;
  patches: string[];
  plots: PlotDefinition[];
  activeField: ResultFieldId;
}

/** Surface integrals over a boundary or a plotted line, and a pressure drop. */
export function IntegralsTab(p: IntegralsTabProps) {
  const [sel, setSel] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // What can be integrated over: each boundary, and each line plotted along.
  const surfaces = useMemo<SurfaceChoice[]>(() => {
    const list: SurfaceChoice[] = p.patches.map((x) => ({
      value: `patch:${x}`,
      label: x,
      ref: { kind: 'patch', patch: x },
    }));
    for (const pl of p.plots)
      if (pl.kind !== 'monitor' && pl.kind !== 'boundary' && pl.line)
        list.push({
          value: `line:${pl.id}`,
          label: `Line of ${pl.name}`,
          ref: { kind: 'line', p1: pl.line.p1, p2: pl.line.p2 },
        });
    return list;
  }, [p.patches, p.plots]);
  if (!p.integrate)
    return <p className="p-4 text-[11px] text-fg-3">Load a field to integrate over a boundary.</p>;
  return (
    <div className="p-4">
      <SurfaceIntegrals
        integrate={p.integrate}
        surfaces={surfaces}
        activeField={p.activeField}
        sel={sel}
        setSel={setSel}
        from={from}
        setFrom={setFrom}
        to={to}
        setTo={setTo}
      />
    </div>
  );
}
