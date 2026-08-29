import React from 'react';
import { Thermometer } from 'lucide-react';
import { SectionProps } from './CaseSetupPanel';
import { SectionCard, Field, NumberInput, Select, Stat, fmt } from './ui';

// Cp from gamma and R when the user has not overridden it.
const cpFromGammaR = (gamma: number, R: number) => (gamma * R) / Math.max(gamma - 1, 1e-6);

export const ThermoSection: React.FC<SectionProps> = ({ state, setPhysics }) => {
  const { physics } = state;
  const gamma = physics.specificHeatRatio || 1.4;
  const R = physics.gasConstant || 287.05;
  const cpAuto = cpFromGammaR(gamma, R);
  const rho = physics.density || 1.225;
  const mu = (physics.kinematicViscosity || 1.5e-5) * rho;

  return (
    <SectionCard
      span2
      icon={<Thermometer className="w-4 h-4" />}
      title="Thermodynamics & transport"
      hint="Perfect-gas properties and the viscosity / conductivity model for the energy equation."
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Equation of state">
          <Select
            value={physics.equationOfState}
            onChange={(v) => setPhysics({ equationOfState: v as 'perfectGas' | 'constantDensity' })}
          >
            <option value="perfectGas">Perfect gas</option>
            <option value="constantDensity">Constant density</option>
          </Select>
        </Field>
        <Field label="Energy equation">
          <Select value={physics.energyModel} onChange={(v) => setPhysics({ energyModel: v as 'enabled' | 'disabled' })}>
            <option value="enabled">Solve energy</option>
            <option value="disabled">Isothermal</option>
          </Select>
        </Field>
        <Field label="Viscosity model" hint="Sutherland: μ(T). Constant: fixed μ.">
          <Select value={physics.transportModel} onChange={(v) => setPhysics({ transportModel: v as 'constant' | 'sutherland' })}>
            <option value="sutherland">Sutherland</option>
            <option value="constant">Constant properties</option>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Specific heat ratio γ">
          <NumberInput value={gamma} step={0.01} min={1.01} onChange={(v) => setPhysics({ specificHeatRatio: v })} />
        </Field>
        <Field label="Gas constant R">
          <NumberInput value={R} step={1} min={1} unit="J/kgK" onChange={(v) => setPhysics({ gasConstant: v })} />
        </Field>
        <Field label="Specific heat Cp" hint={`γ·R/(γ-1) = ${fmt(cpAuto, 4)}`}>
          <NumberInput
            value={physics.specificHeat || Math.round(cpAuto)}
            step={1}
            unit="J/kgK"
            onChange={(v) => setPhysics({ specificHeat: v })}
          />
        </Field>
        <Field label="Prandtl number Pr">
          <NumberInput value={physics.prandtlNumber || 0.71} step={0.01} min={0.1} onChange={(v) => setPhysics({ prandtlNumber: v })} />
        </Field>
      </div>

      {physics.transportModel === 'constant' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[420px]">
          <Field label="Thermal conductivity κ">
            <NumberInput
              value={physics.thermalConductivity || (physics.specificHeat || cpAuto) * mu / (physics.prandtlNumber || 0.71)}
              step={0.001}
              unit="W/mK"
              onChange={(v) => setPhysics({ thermalConductivity: v })}
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <Stat label="Cp (used)" value={`${fmt(physics.specificHeat || cpAuto, 4)} J/kgK`} />
        <Stat label="Cv" value={`${fmt((physics.specificHeat || cpAuto) / gamma, 4)} J/kgK`} />
        <Stat label="Dynamic viscosity μ" value={`${mu.toExponential(2)} Pa·s`} />
      </div>
    </SectionCard>
  );
};
