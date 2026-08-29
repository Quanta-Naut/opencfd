import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
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

  if (patches.length === 0) {
    return (
      <SectionCard span2 icon={<SlidersHorizontal className="w-4 h-4" />} title="Boundary conditions">
        <p className="text-[11px] text-[#69717D]">
          Tag the domain edges in Geometry ▸ Boundary patches. Each patch then gets its own card
          here with auto-assigned conditions.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      span2
      icon={<SlidersHorizontal className="w-4 h-4" />}
      title="Boundary conditions"
      hint="Auto-filled from each patch tag, the reference conditions and the turbulence model."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {patches.map((p) => (
          <div key={p.name} className="border border-[#E1E4E8] rounded-lg p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-semibold text-[#171A1F]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: ROLE_COLOR[p.role] }} />
                {p.name}
              </span>
              <span className="text-[10px] font-mono text-[#69717D]">{summarisePatch(p.bc)}</span>
            </div>
            <PatchEditor
              entry={p}
              compressible={compressible}
              onChange={(bc) => onPatchBC(p.name, bc)}
            />
          </div>
        ))}
      </div>

      <p className="text-[9px] text-[#A5ACB5]">
        Fields written to <span className="font-mono">0/</span>: {fields.join(', ')}, nut
      </p>
    </SectionCard>
  );
};

const PatchEditor: React.FC<{
  entry: PatchEntry;
  compressible: boolean;
  onChange: (bc: PatchBC) => void;
}> = ({ entry, compressible, onChange }) => {
  const { role, bc } = entry;
  const set = (p: Partial<PatchBC>) => onChange({ ...bc, ...p });
  const kinds = KINDS_FOR_ROLE[role];
  const isWall = bc.kind === 'noSlipWall' || bc.kind === 'movingWall' || bc.kind === 'rotatingWall';

  return (
    <div className="space-y-2.5">
      {kinds.length > 1 && (
        <Field label="Condition">
          <Select value={bc.kind} onChange={(v) => set({ kind: v as PatchBC['kind'] })}>
            {kinds.map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {bc.kind === 'velocityInlet' && (
          <Field label="Velocity"><NumberInput value={bc.velocity ?? 0} step={1} unit="m/s" onChange={(v) => set({ velocity: v })} /></Field>
        )}
        {(bc.kind === 'massFlowInlet' || bc.kind === 'massFlowOutlet') && (
          <Field label="Mass flow"><NumberInput value={bc.massFlowRate ?? 0} step={0.01} unit="kg/s" onChange={(v) => set({ massFlowRate: v })} /></Field>
        )}
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
        {bc.kind === 'farfield' && (
          <Field label="Freestream U"><NumberInput value={bc.velocity ?? 0} step={1} unit="m/s" onChange={(v) => set({ velocity: v })} /></Field>
        )}

        {isWall && (
          <Field label="Roughness Kₛ" hint="0 = smooth">
            <NumberInput value={bc.roughnessHeight ?? 0} step={1e-5} min={0} unit="m" onChange={(v) => set({ roughnessHeight: v })} />
          </Field>
        )}
      </div>

      {isWall && compressible && (
        <div className="grid grid-cols-2 gap-2.5">
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
        </div>
      )}
    </div>
  );
};
