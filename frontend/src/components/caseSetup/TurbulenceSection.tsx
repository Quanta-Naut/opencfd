import React from 'react';
import { Layers3 } from 'lucide-react';
import { SectionProps } from './CaseSetupPanel';
import { SectionCard, Field, NumberInput, Select } from './ui';
import { availableTurbulenceModels, turbulenceModel } from '../../caseSetup/turbulenceCatalog';
import { inletTurbulence } from '../../caseSetup/flowCalc';

const GROUP_LABEL: Record<string, string> = {
  'k-omega': 'k-omega family',
  'k-epsilon': 'k-epsilon family',
  'eddy-viscosity': 'Eddy viscosity',
  transition: 'Transition',
  'high-speed': 'High-speed / compressible',
};

export const TurbulenceSection: React.FC<SectionProps> = ({ state, setPhysics, setBoundaries, refLength }) => {
  const { physics, boundaries } = state;
  const compressible = physics.compressibility === 'compressible';
  const models = availableTurbulenceModels({ regime: 'turbulent', compressible });
  const model = turbulenceModel(physics.turbulenceModelId as any);

  const groups = Array.from(new Set(models.map((m) => m.group)));
  const lengthScale = boundaries.turbulentLengthScaleM || 0.07 * refLength;
  const it = inletTurbulence(physics.inletVelocity, boundaries.turbulenceIntensityPercent, lengthScale);

  const applyModel = (id: string) => {
    const m = turbulenceModel(id as any);
    setPhysics({
      turbulenceModelId: id,
      wallModel: m.wallTreatments[0],
      // keep the legacy fields roughly aligned for older code paths
      turbulenceModel: (['kOmegaSST', 'kEpsilon', 'realizableKE', 'RNGkEpsilon', 'SpalartAllmaras'].includes(id)
        ? id
        : 'kOmegaSST') as any,
      wallTreatment: m.wallTreatments[0] === 'wall_functions' ? 'wall_functions' : 'low_re_resolved',
    });
  };

  return (
    <SectionCard
      span2
      icon={<Layers3 className="w-4 h-4" />}
      title="Turbulence model"
      hint="Sets the near-wall strategy, the y+ target and which fields the solver transports."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Model">
          <Select value={physics.turbulenceModelId} onChange={applyModel}>
            {groups.map((g) => (
              <optgroup key={g} label={GROUP_LABEL[g] ?? g}>
                {models.filter((m) => m.group === g).map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Wall treatment" hint={model.yPlus.note}>
          <Select
            value={physics.wallModel}
            onChange={(v) =>
              setPhysics({
                wallModel: v as any,
                wallTreatment: v === 'wall_functions' ? 'wall_functions' : 'low_re_resolved',
              })
            }
          >
            {model.wallTreatments.map((w) => (
              <option key={w} value={w}>
                {w === 'wall_functions' ? 'Wall functions (high y+)' : w === 'resolved' ? 'Wall-resolved (low y+)' : 'Auto (SST blended)'}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-[10px] text-[#69717D] leading-relaxed bg-[#F8FAFC] border border-[#E8EDF1] rounded-md px-3 py-2">
        {model.blurb} Solves: <span className="font-mono">{['U', 'p', ...model.fields].join(', ')}</span>
        {compressible && ', T'}.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Turbulence intensity">
          <NumberInput
            value={boundaries.turbulenceIntensityPercent}
            step={0.5}
            min={0}
            unit="%"
            onChange={(v) => setBoundaries({ turbulenceIntensityPercent: v })}
          />
        </Field>
        <Field label="Turbulent length scale">
          <NumberInput
            value={boundaries.turbulentLengthScaleM}
            step={0.001}
            min={1e-6}
            unit="m"
            onChange={(v) => setBoundaries({ turbulentLengthScaleM: v })}
          />
        </Field>
        <Field label="Inlet k / omega (computed)">
          <div className="w-full px-2.5 py-2 bg-[#F5F6F8] border border-[#DDE2E8] rounded-md font-mono text-[11px] text-[#69717D]">
            k {it.k.toExponential(2)} · ω {it.omega.toFixed(1)}
          </div>
        </Field>
      </div>
    </SectionCard>
  );
};
