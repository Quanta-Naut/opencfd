import React from 'react';
import { Wind } from 'lucide-react';
import { SectionProps } from './CaseSetupPanel';
import { SectionCard, Field, NumberInput, Stat, fmt } from './ui';
import { FlowType } from '../../types/cadWorkflow';

export const ReferenceSection: React.FC<SectionProps & { flowType: FlowType }> = ({
  state,
  setPhysics,
  setCaseSetup,
  refLength,
  flow,
  flowType,
}) => {
  const { physics, caseSetup } = state;
  const compressible = physics.compressibility === 'compressible';
  const autoLen = caseSetup.refLengthOverride == null;

  return (
    <SectionCard
      span2
      icon={<Wind className="w-4 h-4" />}
      title="Reference flow conditions"
      hint="Drive the Reynolds and Mach numbers, the y+ estimate and the initial mesh sizing."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Velocity U∞">
          <NumberInput value={physics.inletVelocity} step={1} min={0} unit="m/s" onChange={(v) => setPhysics({ inletVelocity: v })} />
        </Field>
        <Field label="Static pressure p∞">
          <NumberInput value={physics.inletPressure} step={100} unit="Pa" onChange={(v) => setPhysics({ inletPressure: v })} />
        </Field>
        <Field label="Temperature T∞">
          <NumberInput value={physics.inletTemperature} step={1} min={1} unit="K" onChange={(v) => setPhysics({ inletTemperature: v })} />
        </Field>
        <Field label="Density ρ">
          <NumberInput value={physics.density} step={0.001} min={1e-4} unit="kg/m³" onChange={(v) => setPhysics({ density: v })} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[430px]">
        <Field label="Kinematic viscosity ν">
          <NumberInput value={physics.kinematicViscosity} step={1e-7} min={1e-9} unit="m²/s" onChange={(v) => setPhysics({ kinematicViscosity: v })} />
        </Field>
        <Field
          label={`Characteristic length ${autoLen ? '(auto)' : '(manual)'}`}
          hint={autoLen ? (flowType === 'internal' ? 'hydraulic diameter' : 'chord / body length') : undefined}
        >
          <div className="flex gap-1.5">
            <NumberInput
              value={autoLen ? refLength : caseSetup.refLengthOverride!}
              step={0.01}
              min={1e-4}
              unit="m"
              onChange={(v) => setCaseSetup({ refLengthOverride: v })}
            />
            {!autoLen && (
              <button
                onClick={() => setCaseSetup({ refLengthOverride: null })}
                className="px-2 text-[10px] rounded border border-[#DDE2E8] text-[#69717D] hover:bg-[#F5F6F8]"
              >
                auto
              </button>
            )}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Reynolds" value={fmt(flow.reynolds, 3)} />
        <Stat
          label="Mach"
          value={flow.mach.toFixed(3)}
          tone={flow.mach > 0.3 && !compressible ? 'warn' : 'default'}
        />
        <Stat label="Speed of sound" value={`${fmt(flow.speedOfSound, 3)} m/s`} />
        <Stat label="Dynamic pressure" value={`${fmt(flow.dynamicPressure, 3)} Pa`} />
      </div>
      {flow.mach > 0.3 && !compressible && (
        <p className="text-[10px] text-[#B4622D]">
          Mach {flow.mach.toFixed(2)} exceeds 0.3 - compressibility matters. Switch to Compressible flow.
        </p>
      )}
    </SectionCard>
  );
};
