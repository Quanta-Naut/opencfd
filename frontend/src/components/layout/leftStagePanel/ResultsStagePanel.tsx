import React, { useState } from 'react';
import { Calculator, ChevronDown, Crop, Crosshair, ImageDown, Pencil, Plus, X } from 'lucide-react';
import type { StageId, StageStatus } from '../stages';
import { CFDProjectState, PostProcessConfig } from '../../../types/cfd';
import { StageGate } from './StageGate';
import { NumberField } from './NumberField';
import { Tooltip } from '../../ui/Tooltip';
import { toast } from '../../ui/Toast';
import { colormapRGB } from '../../cad/workbenchCore';
import {
  RESULT_FIELDS,
  fieldDef,
  fmtValue,
  type CustomField,
  type FlowReference,
  type ResultFieldId,
} from '../../../utils/resultFields';
import { FieldCalculatorDialog } from '../../results/FieldCalculatorDialog';
import type { ProbeRow } from '../../../hooks/useResultsView';
import type { PatchReport } from '../../../utils/boundaryData';

const COLORMAPS: PostProcessConfig['colormap'][] = [
  'viridis',
  'coolwarm',
  'turbo',
  'jet',
  'rainbow',
];
const GROUPS = ['Velocity', 'Pressure', 'Turbulence', 'Thermal', 'Derived'] as const;
const OPEN_KEY = 'opencfd_results_sections';

const lbl = 'text-[10px] text-fg-2';
const field =
  'w-full px-2 py-1 bg-surface border border-line rounded-sm text-[11px] text-fg font-mono focus:outline-none focus:border-accent';
const select =
  'w-full px-2 py-1.5 bg-surface border border-line rounded-sm text-[11px] font-medium text-fg focus:outline-none focus:border-accent';
const seg = (on: boolean) =>
  `flex-1 py-1 rounded-sm text-[10px] font-medium border transition-colors ${
    on
      ? 'bg-accent-soft text-accent-fg border-accent-line'
      : 'bg-surface text-fg-2 border-line hover:text-fg hover:border-line-strong'
  }`;
const ghostBtn =
  'w-full py-1.5 rounded-sm border border-line bg-surface text-fg-2 hover:text-fg hover:border-line-strong text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors';

/** A titled, collapsible block of the sidebar; open state is remembered. */
function Section(p: {
  id: string;
  title: string;
  open: Record<string, boolean>;
  setOpen: (id: string, v: boolean) => void;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const isOpen = p.open[p.id] ?? true;
  return (
    <section className="border-b border-line">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => p.setOpen(p.id, !isOpen)}
          aria-expanded={isOpen}
          className="flex-1 flex items-center gap-1.5 text-[11px] font-semibold text-fg-2 uppercase tracking-wider hover:text-fg"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`}
          />
          {p.title}
        </button>
        {p.aside}
      </div>
      {isOpen && <div className="px-4 pb-3.5 space-y-2.5">{p.children}</div>}
    </section>
  );
}

function Check(p: { label: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const box = (
    <label className="flex items-center gap-2 text-[11px] text-fg cursor-pointer select-none">
      <input
        type="checkbox"
        checked={p.on}
        onChange={(e) => p.onChange(e.target.checked)}
        className="accent-accent"
      />
      {p.label}
    </label>
  );
  return p.hint ? (
    <Tooltip content={p.hint} delay={300}>
      {box}
    </Tooltip>
  ) : (
    box
  );
}

/** Results stage: the native post-processor (contours, overlays, probes,
 *  boundary reports, plots, image export), or the stage gate while locked. */
export function ResultsStagePanel(p: ResultsStagePanelProps) {
  const { activeStage, stageStatus, onSelectStage, state, updatePostProcess: set, view } = p;
  const pp = state.postprocess;
  const [open, setOpenState] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}');
    } catch {
      return {};
    }
  });
  const setOpen = (id: string, v: boolean) =>
    setOpenState((s) => {
      const n = { ...s, [id]: v };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(n));
      } catch {
        /* per-viewer convenience only */
      }
      return n;
    });
  const [bPatch, setBPatch] = useState('');
  const [bVar, setBVar] = useState<ResultFieldId>('Cp');
  const [bAxis, setBAxis] = useState<'x' | 'y' | 's'>('x');
  // Calculator dialog: closed, a new field (null) or the field being edited.
  const [calc, setCalc] = useState<CustomField | null | undefined>(undefined);
  const [isoText, setIsoText] = useState('');

  if (activeStage !== 'results') return null;
  if (stageStatus?.results?.locked)
    return (
      <StageGate
        title="Results are locked"
        reason={stageStatus.results.reason || 'Generate a mesh first.'}
        ctaLabel="Go to Mesh"
        onCta={onSelectStage ? () => onSelectStage('mesh') : undefined}
      />
    );

  const def = fieldDef(pp.activeField);
  const unit = def.unit ? ` ${def.unit}` : '';
  const patch = bPatch || p.patches.find((x) => x === 'wall') || p.patches[0] || '';
  // Nothing flows through a wall; node-averaged velocity would show a trace.
  const walls = new Set(view.wallReports.map((r) => r.patch));
  const flows = view.reports.filter((r) => r.flow !== null && !walls.has(r.patch));
  const inflow = flows.reduce((s, r) => s + Math.min(0, r.flow!), 0);
  const net = flows.reduce((s, r) => s + r.flow!, 0);
  const custom = pp.customFields ?? [];
  const allIds: ResultFieldId[] = [...RESULT_FIELDS.map((f) => f.id), ...custom.map((f) => f.id)];
  const saveCustom = (f: CustomField) => {
    const exists = custom.some((c) => c.id === f.id);
    set({
      customFields: exists ? custom.map((c) => (c.id === f.id ? f : c)) : [...custom, f],
      // A new field is what you want to look at.
      ...(exists ? {} : { activeField: f.id }),
    });
    setCalc(undefined);
  };
  const isoNow = pp.isoValues?.[pp.activeField] ?? [];
  const setIso = (vals: number[]) =>
    set({ isoValues: { ...(pp.isoValues ?? {}), [pp.activeField]: vals } });
  const addIso = () => {
    const nums = isoText
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
    if (!nums.length) {
      toast.error('Type a number', { description: 'For example 0, or several: 0.2, 0.5' });
      return;
    }
    setIso([...new Set([...isoNow, ...nums])].sort((a, b) => a - b).slice(0, 12));
    setIsoText('');
  };
  const removeCustom = (f: CustomField) => {
    if (!confirm(`Delete the calculator field "${f.name}"?`)) return;
    set({
      customFields: custom.filter((c) => c.id !== f.id),
      ...(pp.activeField === f.id ? { activeField: 'U_mag' as ResultFieldId } : {}),
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto text-xs text-fg">
        {!p.hasField && (
          <p className="px-4 py-3 text-[11px] text-fg-2 border-b border-line leading-snug">
            No field loaded. Run the solver, or pick a finished run on the right.
          </p>
        )}

        <Section id="contours" title="Contours" open={open} setOpen={setOpen}>
          <div>
            <span className={`${lbl} block mb-1`}>Field</span>
            <select
              value={pp.activeField}
              onChange={(e) => set({ activeField: e.target.value as ResultFieldId })}
              className={select}
            >
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {RESULT_FIELDS.filter((f) => f.group === g).map((f) => (
                    <option
                      key={f.id}
                      value={f.id}
                      disabled={p.hasField && !view.available.has(f.id)}
                    >
                      {f.label}
                      {f.unit ? ` (${f.unit})` : ''}
                      {p.hasField && !view.available.has(f.id) ? ' - not in this run' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
              {custom.length > 0 && (
                <optgroup label="Calculator">
                  {custom.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.unit ? ` (${f.unit})` : ''}
                      {p.hasField && !view.available.has(f.id) ? ' - not in this run' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {p.diffRuns.length > 0 && (
            <div>
              <Tooltip
                content="Colour by this run's value minus another run's, to see what a change did."
                delay={300}
              >
                <span className={`${lbl} block mb-1 cursor-help`}>Subtract run</span>
              </Tooltip>
              <select
                aria-label="Subtract run"
                value={pp.diffRunId ?? ''}
                onChange={(e) => set({ diffRunId: e.target.value || null })}
                className={select}
              >
                <option value="">None</option>
                {p.diffRuns.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              {pp.diffRunId && p.diffRuns.some((r) => r.id === pp.diffRunId) && (
                <p
                  className={`mt-1 text-[10px] leading-snug ${p.diffStatus.error ? 'text-danger' : 'text-fg-2'}`}
                >
                  {p.diffStatus.loading
                    ? 'Loading that run...'
                    : p.diffStatus.error
                      ? p.diffStatus.error
                      : `Showing ${p.viewedRunLabel} minus ${
                          p.diffRuns.find((r) => r.id === pp.diffRunId)?.label
                        }.`}
                </p>
              )}
            </div>
          )}

          <div>
            <span className={`${lbl} block mb-1`}>Colormap</span>
            <div className="grid grid-cols-5 gap-1">
              {COLORMAPS.map((m) => (
                <Tooltip key={m} content={m[0].toUpperCase() + m.slice(1)} delay={250}>
                  <button
                    type="button"
                    aria-label={m}
                    aria-pressed={pp.colormap === m}
                    onClick={() => set({ colormap: m })}
                    className={`h-5 rounded-sm border ${
                      pp.colormap === m ? 'border-accent ring-1 ring-accent' : 'border-line'
                    }`}
                    style={{
                      background: `linear-gradient(to right, ${Array.from({ length: 6 }, (_, i) =>
                        colormapRGB(i / 5, m),
                      ).join(',')})`,
                    }}
                  />
                </Tooltip>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className={lbl}>Range</span>
              {view.range && (
                <span className="text-[10px] font-mono text-fg-3">
                  {fmtValue(view.range[0])} to {fmtValue(view.range[1])}
                  {unit}
                </span>
              )}
            </div>
            <div className="flex gap-1">
              {(
                [
                  [
                    'auto',
                    'Auto',
                    'Clips the top and bottom 1% so a few extreme cells do not wash out the colours.',
                  ],
                  ['full', 'Min to max', 'The true lowest and highest value.'],
                  ['custom', 'Custom', 'Type the range, for comparing runs on the same scale.'],
                ] as const
              ).map(([id, text, hint]) => (
                <Tooltip key={id} content={hint} delay={350}>
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        id === 'custom' && view.range
                          ? {
                              rangeMode: id,
                              rangeMin: pp.rangeMin ?? Number(view.range[0].toPrecision(4)),
                              rangeMax: pp.rangeMax ?? Number(view.range[1].toPrecision(4)),
                            }
                          : { rangeMode: id },
                      )
                    }
                    className={seg(pp.rangeMode === id)}
                  >
                    {text}
                  </button>
                </Tooltip>
              ))}
            </div>
            {pp.rangeMode === 'custom' && (
              <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                <label>
                  <span className={`${lbl} block mb-0.5`}>Min</span>
                  <NumberField
                    value={pp.rangeMin ?? view.autoRange?.[0] ?? 0}
                    onChange={(n) => set({ rangeMin: n })}
                    className={field}
                  />
                </label>
                <label>
                  <span className={`${lbl} block mb-0.5`}>Max</span>
                  <NumberField
                    value={pp.rangeMax ?? view.autoRange?.[1] ?? 1}
                    onChange={(n) => set({ rangeMax: n })}
                    className={field}
                  />
                </label>
              </div>
            )}
            {pp.rangeMode === 'custom' && (
              <div className="mt-1.5">
                <Check
                  label="Hide values outside the range"
                  on={!!pp.clipOutside}
                  onChange={(v) => set({ clipOutside: v })}
                  hint="Only the region whose value is between Min and Max is coloured, like a clip to range."
                />
              </div>
            )}
          </div>

          <div>
            <span className={`${lbl} block mb-1`}>Colouring</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => set({ levels: 0 })}
                className={seg(pp.levels === 0)}
              >
                Smooth
              </button>
              <button
                type="button"
                onClick={() => set({ levels: pp.levels || 12 })}
                className={seg(pp.levels > 0)}
              >
                Bands
              </button>
              {pp.levels > 0 && (
                <NumberField
                  value={pp.levels}
                  integer
                  min={2}
                  max={64}
                  fallback={12}
                  onChange={(n) => set({ levels: n })}
                  className={`${field} !w-12 text-right`}
                />
              )}
            </div>
          </div>
          <Check
            label="Contour lines"
            on={pp.contourLines}
            onChange={(v) => set({ contourLines: v })}
            hint="Lines of equal value, at the band edges (or 10 lines when smooth)."
          />
          <div>
            <span className={`${lbl} block mb-1`}>Lines at values{unit && ` (${def.unit})`}</span>
            <div className="flex gap-1">
              <input
                value={isoText}
                onChange={(e) => setIsoText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addIso();
                }}
                placeholder="e.g. 0, 0.5"
                aria-label="Value for a line"
                className={field}
              />
              <button
                type="button"
                onClick={addIso}
                aria-label="Add line"
                className="px-2 rounded-sm border border-line bg-surface text-fg-2 hover:text-fg hover:border-line-strong"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {isoNow.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {isoNow.map((v) => (
                  <span
                    key={v}
                    className="inline-flex items-center gap-1 pl-1.5 pr-0.5 py-0.5 rounded-sm border border-line bg-surface-2 text-[10px] font-mono text-fg"
                  >
                    {fmtValue(v)}
                    <button
                      type="button"
                      aria-label={`Remove line at ${fmtValue(v)}`}
                      onClick={() => setIso(isoNow.filter((x) => x !== v))}
                      className="text-fg-3 hover:text-fg"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Section>

        <Section
          id="calculator"
          title="Calculator"
          open={open}
          setOpen={setOpen}
          aside={
            <Tooltip content="New calculator field" delay={300}>
              <button
                type="button"
                aria-label="New calculator field"
                onClick={() => setCalc(null)}
                className="p-0.5 rounded-sm text-fg-2 hover:text-fg hover:bg-surface-2"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          }
        >
          {custom.length === 0 ? (
            <button type="button" onClick={() => setCalc(null)} className={ghostBtn}>
              <Calculator className="w-3.5 h-3.5" />
              New field from an expression
            </button>
          ) : (
            <ul className="space-y-1">
              {custom.map((f) => {
                const on = pp.activeField === f.id;
                return (
                  <li
                    key={f.id}
                    className={`group flex items-center gap-1.5 rounded-sm border px-2 py-1 ${
                      on ? 'bg-accent-soft border-accent-line' : 'border-line bg-surface'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => set({ activeField: f.id })}
                      title="Show as contours"
                      className="flex-1 min-w-0 text-left"
                    >
                      <div
                        className={`text-[11px] font-medium truncate ${on ? 'text-accent-fg' : 'text-fg'}`}
                      >
                        {f.name}
                        {f.unit && <span className="text-fg-3 font-normal"> {f.unit}</span>}
                      </div>
                      <div className="text-[10px] font-mono text-fg-2 truncate">{f.expr}</div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit ${f.name}`}
                      onClick={() => setCalc(f)}
                      className="p-0.5 text-fg-3 hover:text-fg"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${f.name}`}
                      onClick={() => removeCustom(f)}
                      className="p-0.5 text-fg-3 hover:text-danger"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section id="overlays" title="Overlays" open={open} setOpen={setOpen}>
          <Check
            label="Mesh"
            on={pp.showMeshWireframe}
            onChange={(v) => set({ showMeshWireframe: v })}
          />
          <Check
            label="Streamlines"
            on={pp.showStreamlines}
            onChange={(v) => set({ showStreamlines: v })}
          />
          <Check
            label="Velocity vectors"
            on={pp.showVectors}
            onChange={(v) => set({ showVectors: v })}
            hint="Arrows on an even screen grid, sized by speed."
          />
          {pp.showVectors && p.hasField && !view.available.has('Ux') ? (
            <p className="pl-5 text-[10px] leading-snug text-warning">
              This run was solved before velocity components were saved. Run the solver again to see
              vectors.
            </p>
          ) : (
            pp.showVectors && (
              <div className="grid grid-cols-2 gap-1.5 pl-5">
                <label>
                  <span className={`${lbl} block mb-0.5`}>Spacing (px)</span>
                  <NumberField
                    value={pp.vectorSpacing}
                    integer
                    min={10}
                    max={120}
                    fallback={28}
                    onChange={(n) => set({ vectorSpacing: n })}
                    className={field}
                  />
                </label>
                <label>
                  <span className={`${lbl} block mb-0.5`}>Length</span>
                  <NumberField
                    value={pp.glyphScale}
                    min={0.1}
                    max={5}
                    fallback={1}
                    onChange={(n) => set({ glyphScale: n })}
                    className={field}
                  />
                </label>
              </div>
            )
          )}
        </Section>

        <Section
          id="clip"
          title="Clip"
          open={open}
          setOpen={setOpen}
          aside={
            pp.clipBox && (
              <button
                type="button"
                onClick={() => set({ clipBox: null })}
                className="text-[10px] text-fg-2 hover:text-fg"
              >
                Clear
              </button>
            )
          }
        >
          <button
            type="button"
            onClick={p.onToggleClipPicking}
            disabled={!p.hasField}
            className={`${ghostBtn} disabled:opacity-40 ${
              p.clipPicking ? '!bg-accent-soft !text-accent-fg !border-accent-line' : ''
            }`}
          >
            <Crop className="w-3.5 h-3.5" />
            {p.clipPicking
              ? 'Click two opposite corners'
              : pp.clipBox
                ? 'Pick a new box'
                : 'Show results inside a box'}
          </button>
          {pp.clipBox && (
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  [0, 'x from'],
                  [2, 'x to'],
                  [1, 'y from'],
                  [3, 'y to'],
                ] as const
              ).map(([i, text]) => (
                <label key={i}>
                  <span className={`${lbl} block mb-0.5`}>{text}</span>
                  <NumberField
                    value={pp.clipBox![i]}
                    onChange={(n) => {
                      const b = [...pp.clipBox!] as [number, number, number, number];
                      b[i] = n;
                      set({ clipBox: b });
                    }}
                    className={field}
                  />
                </label>
              ))}
            </div>
          )}
        </Section>

        <Section
          id="probes"
          title="Probes"
          open={open}
          setOpen={setOpen}
          aside={
            pp.probes.length > 0 && (
              <button
                type="button"
                onClick={() => set({ probes: [] })}
                className="text-[10px] text-fg-2 hover:text-fg"
              >
                Clear
              </button>
            )
          }
        >
          <button
            type="button"
            onClick={p.onToggleProbePicking}
            disabled={!p.hasField}
            className={`${ghostBtn} disabled:opacity-40 ${
              p.probePicking ? '!bg-accent-soft !text-accent-fg !border-accent-line' : ''
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            {p.probePicking ? 'Click on the field. Done' : 'Add probe points'}
          </button>
          {view.probeRows.map((r, i) => (
            <div key={r.id} className="rounded-sm border border-line bg-surface-2 px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="w-4 h-4 rounded-full bg-fg text-surface font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="font-mono text-fg-2">
                  ({fmtValue(r.x)}, {fmtValue(r.y)})
                </span>
                <button
                  type="button"
                  aria-label="Remove probe"
                  onClick={() => set({ probes: pp.probes.filter((x) => x.id !== r.id) })}
                  className="ml-auto text-fg-3 hover:text-fg"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {r.values ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 mt-1 text-[10px]">
                  {allIds
                    .filter((id) => r.values![id] !== undefined && !fieldDef(id).wallOnly)
                    .map((id) => {
                      const f = fieldDef(id);
                      const cls = id === pp.activeField ? 'text-fg font-semibold' : 'text-fg-2';
                      return (
                        <React.Fragment key={id}>
                          <dt className={`${cls} truncate`}>{f.short}</dt>
                          <dd className={`font-mono text-right ${cls}`}>
                            {fmtValue(r.values![id]!)}
                            {f.unit ? ` ${f.unit}` : ''}
                          </dd>
                        </React.Fragment>
                      );
                    })}
                </dl>
              ) : (
                <p className="mt-1 text-[10px] text-fg-3">Outside the mesh.</p>
              )}
            </div>
          ))}
        </Section>

        <Section id="reports" title="Reports" open={open} setOpen={setOpen}>
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
                    <div className="text-[10px] text-fg-2">{k}</div>
                    <div className="font-mono text-[12px] text-fg">
                      {v !== undefined ? fmtValue(v) : '-'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {view.forces &&
            (view.forces.cd_pressure !== undefined || view.forces.cm !== undefined) && (
              <div>
                <Tooltip
                  content="Drag and lift from the pressure on the walls and from friction along them. Cm is the pitching moment about the reference point (a quarter chord by default)."
                  delay={300}
                >
                  <span className={`${lbl} block mb-1 cursor-help`}>Force breakdown</span>
                </Tooltip>
                <table className="w-full text-[10px]">
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
                        <td className="text-right text-fg">
                          {t !== undefined ? fmtValue(t) : '-'}
                        </td>
                        <td className="text-right text-fg-2">
                          {pr !== undefined ? fmtValue(pr) : ''}
                        </td>
                        <td className="text-right text-fg-2">
                          {vi !== undefined ? fmtValue(vi) : ''}
                        </td>
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
              <table className="w-full text-[10px]">
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
                      <td className="text-right text-fg">
                        {r.yPlus ? fmtValue(r.yPlus.avg) : '-'}
                      </td>
                      <td className="text-right text-fg-2">
                        {r.yPlus ? fmtValue(r.yPlus.max) : '-'}
                      </td>
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
              <table className="w-full text-[10px]">
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
                  <table className="w-full text-[10px] font-mono">
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
            <p className="text-[10px] text-fg-2">Load a field to see boundary values.</p>
          )}
        </Section>

        <Section id="plots" title="Plots" open={open} setOpen={setOpen}>
          <button type="button" onClick={p.onCreatePlot} className={ghostBtn}>
            <Plus className="w-3.5 h-3.5" />
            Plot along a line
          </button>
          <div className="rounded-sm border border-line p-2 space-y-1.5">
            <span className={`${lbl} block`}>Plot along a boundary</span>
            <div className="grid grid-cols-2 gap-1.5">
              <select
                aria-label="Boundary"
                value={patch}
                onChange={(e) => setBPatch(e.target.value)}
                className={select}
              >
                {p.patches.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
              <select
                aria-label="Value"
                value={bVar}
                onChange={(e) => setBVar(e.target.value as ResultFieldId)}
                className={select}
              >
                {allIds.map((id) => {
                  const f = fieldDef(id);
                  return (
                    <option key={id} value={id}>
                      {f.short}
                      {f.unit ? ` (${f.unit})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className={`${lbl} mr-1`}>Along</span>
              {(
                [
                  ['x', 'x'],
                  ['y', 'y'],
                  ['s', 'length'],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBAxis(id)}
                  className={seg(bAxis === id)}
                >
                  {text}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!patch || !p.hasField}
              onClick={() => {
                const ok = p.onAddBoundaryPlot(patch, bVar, bAxis);
                if (!ok)
                  toast.error('Nothing to plot', {
                    description: `No ${patch} edges in this mesh.`,
                  });
              }}
              className={`${ghostBtn} disabled:opacity-40`}
            >
              <Plus className="w-3.5 h-3.5" />
              Add plot
            </button>
          </div>
        </Section>
      </div>

      <div className="px-4 py-3 border-t border-line bg-surface shrink-0 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={p.onSaveImage}
          disabled={!p.hasField}
          className={`${ghostBtn} disabled:opacity-40`}
        >
          <ImageDown className="w-3.5 h-3.5" />
          Save image
        </button>
        <button
          type="button"
          onClick={async () => {
            const { launchParaview, checkParaviewStatus } = await import('../../../utils/api');
            const status = await checkParaviewStatus();
            if (!status.available) {
              toast.error('ParaView not found', {
                description: 'Install ParaView to open the case in it.',
              });
              return;
            }
            const res = await launchParaview(p.projectId);
            if (!res.success) toast.error('Could not open ParaView', { description: res.detail });
          }}
          className={ghostBtn}
        >
          Open in ParaView
        </button>
      </div>

      <FieldCalculatorDialog
        open={calc !== undefined}
        initial={calc ?? null}
        takenNames={custom.filter((c) => c.id !== calc?.id).map((c) => c.name)}
        fields={p.hasField ? view.allFields : undefined}
        flowRef={view.ref}
        onSave={saveCustom}
        onClose={() => setCalc(undefined)}
      />
    </div>
  );
}

export interface ResultsStagePanelProps {
  activeStage: StageId;
  stageStatus: Partial<Record<StageId, StageStatus>>;
  onSelectStage: (stage: StageId) => void;
  state: CFDProjectState;
  updatePostProcess: (p: Partial<PostProcessConfig>) => void;
  onCreatePlot: () => void;
  projectId: string;
  hasField: boolean;
  view: {
    available: Set<ResultFieldId>;
    range: [number, number] | null;
    autoRange: [number, number] | null;
    probeRows: ProbeRow[];
    reports: PatchReport[];
    ref: FlowReference;
    allFields: Record<string, ArrayLike<number> | undefined> | undefined;
    wallReports: import('../../../hooks/useResultsView').WallReport[];
    forces: import('../../../hooks/useResultsView').ForceBreakdown | null;
  };
  patches: string[];
  probePicking: boolean;
  onToggleProbePicking: () => void;
  clipPicking: boolean;
  onToggleClipPicking: () => void;
  /** Runs that can be subtracted from the viewed one. */
  diffRuns: { id: string; label: string }[];
  viewedRunLabel: string;
  diffStatus: { loading: boolean; error: string | null };
  /** Returns false when the patch has no edges to plot. */
  onAddBoundaryPlot: (patch: string, variable: ResultFieldId, axis: 'x' | 'y' | 's') => boolean;
  runForces: { label: string; cd?: number; cl?: number } | null;
  onSaveImage: () => void;
}
