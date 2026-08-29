import React, { useState } from 'react';
import { SlidersHorizontal, ChevronDown } from 'lucide-react';
import { SectionProps } from './CaseSetupPanel';
import { SectionCard, Field, NumberInput, Select } from './ui';
import { TurbulenceModel } from '../../caseSetup/turbulenceCatalog';
import {
  PatchEntry, PatchBC, KIND_LABEL, KINDS_FOR_ROLE, summarisePatch, solvedFields,
} from '../../caseSetup/bcCatalog';

const ROLE_COLOR: Record<string, string> = {
  inlet: '#2563EB',
  outlet: '#0E7C86',
  wall: '#6B7280',
  farfield: '#7C3AED',
  symmetry: '#B4622D',
  periodic: '#B4622D',
};

export const BoundarySection: React.FC<
  SectionProps & {
    model: TurbulenceModel;
    patches: PatchEntry[];
    onPatchBC: (name: string, bc: PatchBC) => void;
  }
> = ({ state, model, patches, onPatchBC }) => {
  const compressible = state.physics.compressibility === 'compressible';
  const fields = solvedFields({ turbulenceFields: model.fields.filter((f) => f !== 'nut'), compressible });
  const [open, setOpen] = useState<string | null>(patches[0]?.name ?? null);

  if (patches.length === 0) {
    return (
      <SectionCard span2 icon={<SlidersHorizontal className="w-4 h-4" />} title="Boundary conditions">
        <p className="text-[11px] text-[#69717D]">
          Tag the domain edges in Geometry ▸ Boundary patches. Each patch then gets a row here with its
          auto-assigned conditions.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      span2
      icon={<SlidersHorizontal className="w-4 h-4" />}
      title="Boundary conditions"
      hint="Auto-filled from each patch tag, the reference conditions and the turbulence model. Expand a row to override."
    >
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[520px] divide-y divide-[#EEF1F4] border border-[#E1E4E8] rounded-lg">
          <div className="grid grid-cols-[1.4fr_1fr_2fr] gap-2 px-3 py-2 bg-[#F8FAFC] text-[9px] font-semibold uppercase tracking-wide text-[#8B95A1]">
            <span>Patch</span>
            <span>Type</span>
            <span>Summary</span>
          </div>
          {patches.map((p) => {
            const isOpen = open === p.name;
            return (
              <div key={p.name}>
                <button
                  onClick={() => setOpen(isOpen ? null : p.name)}
                  className="w-full grid grid-cols-[1.4fr_1fr_2fr] gap-2 px-3 py-2 items-center text-left hover:bg-[#F8FAFC] transition-colors"
                >
                  <span className="flex items-center gap-2 text-[11px] font-medium text-[#171A1F]">
                    <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: ROLE_COLOR[p.role] }} />
                    {p.name}
                  </span>
                  <span className="text-[10px] text-[#69717D]">{KIND_LABEL[p.bc.kind]}</span>
                  <span className="flex items-center justify-between text-[10px] font-mono text-[#2563EB]">
                    {summarisePatch(p.bc)}
                    <ChevronDown className={`w-3 h-3 text-[#A5ACB5] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 bg-[#F8FAFC]">
                    <PatchEditor entry={p} refVelocity={state.physics.inletVelocity} compressible={compressible} onChange={(bc) => onPatchBC(p.name, bc)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[9px] text-[#A5ACB5]">
        Fields written to <span className="font-mono">0/</span>: {fields.join(', ')}, nut
      </p>
    </SectionCard>
  );
};

const PatchEditor: React.FC<{
  entry: PatchEntry;
  refVelocity: number;
  compressible: boolean;
  onChange: (bc: PatchBC) => void;
}> = ({ entry, compressible, onChange }) => {
  const { role, bc } = entry;
  const set = (p: Partial<PatchBC>) => onChange({ ...bc, ...p });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="Condition">
        <Select value={bc.kind} onChange={(v) => set({ kind: v as PatchBC['kind'] })}>
          {KINDS_FOR_ROLE[role].map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </Select>
      </Field>

      {bc.kind === 'velocityInlet' && (
        <Field label="Velocity"><NumberInput value={bc.velocity ?? 0} step={1} unit="m/s" onChange={(v) => set({ velocity: v })} /></Field>
      )}
      {bc.kind === 'massFlowInlet' || bc.kind === 'massFlowOutlet' ? (
        <Field label="Mass flow"><NumberInput value={bc.massFlowRate ?? 0} step={0.01} unit="kg/s" onChange={(v) => set({ massFlowRate: v })} /></Field>
      ) : null}
      {bc.kind === 'totalPressureInlet' && (
        <Field label="Total pressure"><NumberInput value={bc.totalPressure ?? 0} step={100} unit="Pa" onChange={(v) => set({ totalPressure: v })} /></Field>
      )}
      {bc.kind === 'pressureOutlet' && (
        <Field label="Static pressure (gauge)"><NumberInput value={bc.staticPressure ?? 0} step={100} unit="Pa" onChange={(v) => set({ staticPressure: v })} /></Field>
      )}
      {bc.kind === 'movingWall' && (
        <Field label="Wall velocity"><NumberInput value={bc.velocity ?? 0} step={0.1} unit="m/s" onChange={(v) => set({ velocity: v })} /></Field>
      )}
      {bc.kind === 'rotatingWall' && (
        <Field label="Rotation"><NumberInput value={bc.rpm ?? 0} step={10} unit="rpm" onChange={(v) => set({ rpm: v })} /></Field>
      )}

      {(bc.kind === 'noSlipWall' || bc.kind === 'movingWall' || bc.kind === 'rotatingWall') && (
        <>
          <Field label="Roughness Kₛ" hint="0 = smooth (sand-grain height)">
            <NumberInput value={bc.roughnessHeight ?? 0} step={1e-5} min={0} unit="m" onChange={(v) => set({ roughnessHeight: v })} />
          </Field>
          {compressible && (
            <>
              <Field label="Thermal">
                <Select value={bc.thermal ?? 'adiabatic'} onChange={(v) => set({ thermal: v as PatchBC['thermal'] })}>
                  <option value="adiabatic">Adiabatic</option>
                  <option value="fixedTemperature">Fixed temperature</option>
                  <option value="fixedHeatFlux">Fixed heat flux</option>
                </Select>
              </Field>
              {bc.thermal === 'fixedTemperature' && (
                <Field label="Wall T"><NumberInput value={bc.wallTemperature ?? 300} step={5} unit="K" onChange={(v) => set({ wallTemperature: v })} /></Field>
              )}
              {bc.thermal === 'fixedHeatFlux' && (
                <Field label="Heat flux"><NumberInput value={bc.wallHeatFlux ?? 0} step={100} unit="W/m²" onChange={(v) => set({ wallHeatFlux: v })} /></Field>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
