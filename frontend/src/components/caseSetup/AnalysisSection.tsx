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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
        <Field label="Time formulation">
          <Select
            value={physics.timeFormulation}
            onChange={(v) => setPhysics({ timeFormulation: v as 'steady' | 'transient' })}
          >
            <option value="steady">Steady state</option>
            <option value="transient">Transient</option>
          </Select>
        </Field>
      </div>

      {compressible && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <Field
            label="Speed regime"
            hint={`Mach ${flow.mach.toFixed(2)} from the reference conditions ${
              flow.regimeHint !== physics.speedRegime ? `(suggests ${flow.regimeHint})` : ''
            }`}
          >
            <Select value={physics.speedRegime} onChange={(v) => setPhysics({ speedRegime: v as SpeedRegime })}>
              <option value="subsonic">Subsonic (M &lt; 0.8)</option>
              <option value="transonic">Transonic (0.8 - 1.2)</option>
              <option value="supersonic">Supersonic (1.2 - 5)</option>
              <option value="hypersonic">Hypersonic (M &gt; 5)</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <p className="text-[10px] text-[#69717D] leading-relaxed pb-2">
              {physics.speedRegime === 'subsonic' && 'Density-based, no shocks expected. rhoSimpleFoam / rhoPimpleFoam.'}
              {physics.speedRegime === 'transonic' && 'Shock capturing with limiters. rhoCentralFoam or a coupled solver.'}
              {(physics.speedRegime === 'supersonic' || physics.speedRegime === 'hypersonic') &&
                'Density-based flux scheme, wall-resolved mesh, real-gas effects grow with Mach.'}
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
};
