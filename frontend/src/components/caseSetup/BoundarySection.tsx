import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { SectionProps } from './CaseSetupPanel';
import { NumberInput, Select } from './ui';
import { TurbulenceModel } from '../../caseSetup/turbulenceCatalog';
import { PatchEntry, PatchBC, KIND_LABEL, KINDS_FOR_ROLE, solvedFields } from '../../caseSetup/bcCatalog';

const ROLE_COLOR: Record<string, string> = {
  inlet: '#2563EB',
  outlet: '#0E7C86',
  wall: '#6B7280',
  farfield: '#7C3AED',
  symmetry: '#B4622D',
  periodic: '#B4622D',
};

// compact inline input: label above a narrow field
const Cell: React.FC<{ label: string; children: React.ReactNode; w?: string }> = ({ label, children, w = 'w-24' }) => (
  <label className={`flex flex-col gap-0.5 ${w}`}>
    <span className="text-[9px] text-[#8B95A1] uppercase tracking-wide truncate">{label}</span>
    {children}
  </label>
);

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
      <section className="bg-white border border-[#E1E4E8] rounded-xl p-5 xl:col-span-2">
        <div className="flex items-center gap-2 mb-2">
          <SlidersHorizontal className="w-4 h-4 text-[#2563EB]" />
          <h2 className="text-sm font-bold text-[#171A1F]">Boundary conditions</h2>
        </div>
        <p className="text-[11px] text-[#69717D]">
          Tag the domain edges in Geometry ▸ Boundary patches. Each patch then gets a row here.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-white border border-[#E1E4E8] rounded-xl p-5 xl:col-span-2 space-y-3">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="w-4 h-4 text-[#2563EB]" />
        <div>
          <h2 className="text-sm font-bold text-[#171A1F]">Boundary conditions</h2>
          <p className="text-[10px] text-[#69717D] mt-0.5">
            Auto-filled from each patch tag, the reference conditions and the turbulence model.
          </p>
        </div>
      </div>

      <div className="border border-[#E1E4E8] rounded-lg divide-y divide-[#EEF1F4]">
        {patches
          .filter((p) => p.role !== 'symmetry' && p.role !== 'periodic')
          .map((p) => (
            <PatchRow key={p.name} entry={p} compressible={compressible} onChange={(bc) => onPatchBC(p.name, bc)} />
          ))}
      </div>

      <p className="text-[9px] text-[#A5ACB5]">
        Writes <span className="font-mono">0/</span>: {fields.join(', ')}, nut
        {patches.some((p) => p.role === 'symmetry' || p.role === 'periodic') &&
          ' · symmetry / periodic patches are written automatically'}
      </p>
    </section>
  );
};

const PatchRow: React.FC<{
  entry: PatchEntry;
  compressible: boolean;
  onChange: (bc: PatchBC) => void;
}> = ({ entry, compressible, onChange }) => {
  const { name, role, bc } = entry;
  const set = (p: Partial<PatchBC>) => onChange({ ...bc, ...p });
  const kinds = KINDS_FOR_ROLE[role];
  const isWall = bc.kind === 'noSlipWall' || bc.kind === 'movingWall' || bc.kind === 'rotatingWall';

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2 px-3 py-2.5">
      <span className="flex items-center gap-2 text-[11px] font-semibold text-[#171A1F] w-24 shrink-0 self-center">
        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: ROLE_COLOR[role] }} />
        {name}
      </span>

      {kinds.length > 1 && (
            <Cell label="Condition" w="w-40">
              <Select value={bc.kind} onChange={(v) => set({ kind: v as PatchBC['kind'] })}>
                {kinds.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </Select>
            </Cell>
          )}

          {bc.kind === 'velocityInlet' && (
            <Cell label="U m/s"><NumberInput value={bc.velocity ?? 0} step={1} onChange={(v) => set({ velocity: v })} /></Cell>
          )}
          {(bc.kind === 'massFlowInlet' || bc.kind === 'massFlowOutlet') && (
            <Cell label="ṁ kg/s"><NumberInput value={bc.massFlowRate ?? 0} step={0.01} onChange={(v) => set({ massFlowRate: v })} /></Cell>
          )}
          {bc.kind === 'totalPressureInlet' && (
            <Cell label="p0 Pa"><NumberInput value={bc.totalPressure ?? 0} step={100} onChange={(v) => set({ totalPressure: v })} /></Cell>
          )}
          {bc.kind === 'pressureOutlet' && (
            <Cell label="p Pa" w="w-28"><NumberInput value={bc.staticPressure ?? 0} step={100} onChange={(v) => set({ staticPressure: v })} /></Cell>
          )}
          {bc.kind === 'movingWall' && (
            <Cell label="wall U m/s"><NumberInput value={bc.velocity ?? 0} step={0.1} onChange={(v) => set({ velocity: v })} /></Cell>
          )}
          {bc.kind === 'rotatingWall' && (
            <Cell label="rpm"><NumberInput value={bc.rpm ?? 0} step={10} onChange={(v) => set({ rpm: v })} /></Cell>
          )}
          {bc.kind === 'farfield' && (
            <Cell label="U∞ m/s"><NumberInput value={bc.velocity ?? 0} step={1} onChange={(v) => set({ velocity: v })} /></Cell>
          )}

          {isWall && (
            <Cell label="Kₛ m"><NumberInput value={bc.roughnessHeight ?? 0} step={1e-5} min={0} onChange={(v) => set({ roughnessHeight: v })} /></Cell>
          )}
          {isWall && compressible && (
            <>
              <Cell label="Thermal" w="w-28">
                <Select value={bc.thermal ?? 'adiabatic'} onChange={(v) => set({ thermal: v as PatchBC['thermal'] })}>
                  <option value="adiabatic">Adiabatic</option>
                  <option value="fixedTemperature">Fixed T</option>
                  <option value="fixedHeatFlux">Fixed q</option>
                </Select>
              </Cell>
              {bc.thermal === 'fixedTemperature' && (
                <Cell label="T K"><NumberInput value={bc.wallTemperature ?? 300} step={5} onChange={(v) => set({ wallTemperature: v })} /></Cell>
              )}
              {bc.thermal === 'fixedHeatFlux' && (
                <Cell label="q W/m²"><NumberInput value={bc.wallHeatFlux ?? 0} step={100} onChange={(v) => set({ wallHeatFlux: v })} /></Cell>
              )}
            </>
          )}
    </div>
  );
};
