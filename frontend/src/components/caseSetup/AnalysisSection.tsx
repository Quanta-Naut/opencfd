import React from 'react';
import { Compass } from 'lucide-react';
import { SectionProps } from './CaseSetupPanel';
import { SectionCard, Field, Segmented, Select } from './ui';
import { FlowType } from '../../types/cadWorkflow';
import { SpeedRegime } from '../../types/cfd';

export const AnalysisSection: React.FC<
  SectionProps & { flowType: FlowType; onFlowTypeChange: (v: FlowType) => void }
> = ({ state, setPhysics, flow, flowType }) => {
  const { physics } = state;
  const compressible = physics.compressibility === 'compressible';

  return (
    <SectionCard
      span2
      icon={<Compass className="w-4 h-4" />}
      title="Analysis definition"
      hint="How the fluid domain and the flow equations are interpreted."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Flow topology" hint="Set in Geometry ▸ Domain">
          <div className="w-full px-2.5 py-2 bg-[#F5F6F8] border border-[#DDE2E8] rounded-md font-mono text-xs text-[#69717D] capitalize">
            {flowType} flow
          </div>
        </Field>
        <Field label="Flow regime">
          <Segmented
            value={physics.regime}
            options={[['laminar', 'Laminar'], ['turbulent', 'Turbulent']]}
            onChange={(v) => setPhysics({ regime: v })}
          />
        </Field>
      </div>
      <p className="text-[10px] text-[#69717D]">
        Steady state vs transient is chosen in the Solver tab.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        <Field
          label={
            <span className="flex items-center gap-1.5">
              Speed regime
              <span className="text-[9px] font-semibold px-1 py-px rounded bg-[#EEF2FF] text-[#2563EB]">
                AUTO
              </span>
            </span>
          }
          hint={`Mach ${flow.mach.toFixed(2)} (a = ${flow.speedOfSound.toFixed(0)} m/s at ${
            physics.inletTemperature
          } K). Tracks the inlet velocity; change it to override.`}
        >
          <Select value={physics.speedRegime} onChange={(v) => setPhysics({ speedRegime: v as SpeedRegime })}>
            <option value="incompressible">Incompressible (M &lt; 0.3)</option>
            <option value="subsonic">Subsonic (0.3 - 0.8)</option>
            <option value="transonic">Transonic (0.8 - 1.2)</option>
            <option value="supersonic">Supersonic (1.2 - 5)</option>
            <option value="hypersonic">Hypersonic (M &gt; 5)</option>
          </Select>
        </Field>
        <div className="flex items-end">
          <p className="text-[10px] text-[#69717D] leading-relaxed pb-2">
            {(physics.speedRegime === 'incompressible' || !compressible) &&
              'Constant density, pressure-based (simpleFoam / pimpleFoam).'}
            {compressible && physics.speedRegime === 'subsonic' &&
              'Pressure-based compressible (foamRun -solver fluid). Steady or transient.'}
            {compressible && physics.speedRegime === 'transonic' &&
              'Pressure-based fluid module - marginal near M1 on a coarse mesh. If it diverges, mark it Supersonic to use the density-based solver.'}
            {compressible && (physics.speedRegime === 'supersonic' || physics.speedRegime === 'hypersonic') &&
              'Density-based shock capturing (foamRun -solver shockFluid): transient, Courant-limited, needs a wall-resolved mesh.'}
          </p>
        </div>
      </div>
    </SectionCard>
  );
};
