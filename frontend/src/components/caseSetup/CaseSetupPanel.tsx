import React, { useEffect, useMemo } from 'react';
import { CircleHelp, Gauge, Wind, Layers3, Thermometer, Droplets, LockKeyhole, Zap } from 'lucide-react';
import { CFDProjectState, CaseSetupConfig, PhysicsConfig, BoundaryConditions } from '../../types/cfd';
import { FlowType } from '../../types/cadWorkflow';
import { deriveFlow } from '../../caseSetup/flowCalc';
import { turbulenceModel } from '../../caseSetup/turbulenceCatalog';
import { defaultPatchBC, PatchEntry, PatchRole } from '../../caseSetup/bcCatalog';
import { AnalysisSection } from './AnalysisSection';
import { ReferenceSection } from './ReferenceSection';
import { ThermoSection } from './ThermoSection';
import { TurbulenceSection } from './TurbulenceSection';
import { NearWallSection } from './NearWallSection';
import { BoundarySection } from './BoundarySection';

export interface CaseSetupProps {
  state: CFDProjectState;
  setState: React.Dispatch<React.SetStateAction<CFDProjectState>>;
  flowType: FlowType;
  onFlowTypeChange: (v: FlowType) => void;
  /** patch (tag) names present on the geometry / mesh, with their role. */
  patchRoles: Array<{ name: string; role: PatchRole }>;
}

export interface SectionProps {
  state: CFDProjectState;
  setPhysics: (p: Partial<PhysicsConfig>) => void;
  setCaseSetup: (p: Partial<CaseSetupConfig>) => void;
  setBoundaries: (p: Partial<BoundaryConditions>) => void;
  refLength: number;
  flow: ReturnType<typeof deriveFlow>;
}

const lockedModes = [
  ['convection', 'Convection heat transfer', Thermometer],
  ['cht', 'Conjugate heat transfer', Layers3],
  ['multiphase', 'Multiphase flow', Droplets],
  ['comfort', 'Pedestrian wind comfort', Wind],
] as const;

export const CaseSetupPanel: React.FC<CaseSetupProps> = ({
  state,
  setState,
  flowType,
  onFlowTypeChange,
  patchRoles,
}) => {
  const { physics, caseSetup, geometry } = state;
  const compressible = physics.compressibility === 'compressible';

  const refLength =
    caseSetup.refLengthOverride && caseSetup.refLengthOverride > 0
      ? caseSetup.refLengthOverride
      : flowType === 'internal'
        ? geometry.domainHeight || geometry.chord || 1
        : geometry.chord || geometry.cylinderDiameter || 1;

  const flow = useMemo(
    () =>
      deriveFlow({
        velocity: physics.inletVelocity,
        density: physics.density,
        kinematicViscosity: physics.kinematicViscosity,
        refLength,
        temperature: physics.inletTemperature,
        gamma: physics.specificHeatRatio,
        gasConstant: physics.gasConstant,
      }),
    [physics, refLength],
  );

  const setPhysics = (p: Partial<PhysicsConfig>) =>
    setState((prev) => ({
      ...prev,
      physics: { ...prev.physics, ...p },
      boundaries: {
        ...prev.boundaries,
        ...(p.inletVelocity !== undefined ? { inletVelocity: p.inletVelocity } : {}),
      },
    }));
  const setCaseSetup = (p: Partial<CaseSetupConfig>) =>
    setState((prev) => ({ ...prev, caseSetup: { ...prev.caseSetup, ...p } }));
  const setBoundaries = (p: Partial<BoundaryConditions>) =>
    setState((prev) => ({ ...prev, boundaries: { ...prev.boundaries, ...p } }));

  // keep the per-patch BC table in sync with the tagged patches
  const patches: PatchEntry[] = patchRoles.map(({ name, role }) => ({
    name,
    role,
    bc: caseSetup.patches[name] ?? defaultPatchBC(role, physics.inletVelocity),
  }));
  const setPatchBC = (name: string, bc: PatchEntry['bc']) =>
    setCaseSetup({ patches: { ...caseSetup.patches, [name]: bc } });

  // Keep the speed regime honest with the Mach number. Compressible: the regime
  // Select tracks the computed hint (it stays editable - it re-syncs on the next
  // flow-condition change). Incompressible at/above Mach 0.3: flip the whole
  // model to compressible so the physics match the flow the user typed.
  useEffect(() => {
    if (compressible) {
      if (physics.speedRegime !== flow.regimeHint && flow.regimeHint !== 'incompressible') {
        setPhysics({ speedRegime: flow.regimeHint });
      }
    } else if (flow.mach >= 0.3) {
      setPhysics({
        compressibility: 'compressible',
        equationOfState: 'perfectGas',
        energyModel: 'enabled',
        speedRegime: flow.regimeHint === 'incompressible' ? 'subsonic' : flow.regimeHint,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compressible, flow.regimeHint, flow.mach]);

  const model = turbulenceModel(physics.turbulenceModelId as any);
  const section: SectionProps = { state, setPhysics, setCaseSetup, setBoundaries, refLength, flow };

  return (
    <div className="h-full w-full bg-[#F5F6F8] flex min-h-0" role="region" aria-label="Case setup">
      <aside className="w-[260px] bg-white border-r border-[#E1E4E8] p-4 shrink-0 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold text-[#69717D] uppercase tracking-wider">CFD analysis</span>
          <CircleHelp className="w-3.5 h-3.5 text-[#A5ACB5]" />
        </div>
        <div className="space-y-1.5">
          <button
            onClick={() =>
              setPhysics({ compressibility: 'incompressible', equationOfState: 'constantDensity', energyModel: 'disabled', speedRegime: 'incompressible' })
            }
            className={`w-full p-3 rounded-lg border text-left transition-all ${
              !compressible ? 'bg-blue-50 border-[#2563EB] ring-1 ring-[#2563EB]' : 'border-[#E1E4E8] hover:bg-[#F8F9FA]'
            }`}
          >
            <div className="flex items-center gap-2">
              <Gauge className={`w-4 h-4 ${!compressible ? 'text-[#2563EB]' : 'text-[#69717D]'}`} />
              <span className="text-xs font-semibold">Incompressible flow</span>
            </div>
            <span className="text-[10px] text-[#69717D] block ml-6 mt-1">Constant density, Mach &lt; 0.3</span>
          </button>
          <button
            onClick={() =>
              setPhysics({ compressibility: 'compressible', equationOfState: 'perfectGas', energyModel: 'enabled', speedRegime: flow.regimeHint === 'incompressible' ? 'subsonic' : flow.regimeHint })
            }
            className={`w-full p-3 rounded-lg border text-left transition-all ${
              compressible ? 'bg-blue-50 border-[#2563EB] ring-1 ring-[#2563EB]' : 'border-[#E1E4E8] hover:bg-[#F8F9FA]'
            }`}
          >
            <div className="flex items-center gap-2">
              <Wind className={`w-4 h-4 ${compressible ? 'text-[#2563EB]' : 'text-[#69717D]'}`} />
              <span className="text-xs font-semibold">Compressible flow</span>
            </div>
            <span className="text-[10px] text-[#69717D] block ml-6 mt-1">Density &amp; energy, up to hypersonic</span>
          </button>
        </div>
        <div className="border-t border-[#E1E4E8] my-5" />
        <span className="text-[10px] font-bold text-[#A5ACB5] uppercase tracking-wider block mb-2">Other modes</span>
        <div className="space-y-1">
          {lockedModes.map(([id, label, Icon]) => (
            <div key={id} className="p-2.5 rounded-lg flex items-center gap-2.5 text-[#A5ACB5] cursor-not-allowed">
              <LockKeyhole className="w-3.5 h-3.5 shrink-0" />
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px] leading-tight">
                {label}
                <span className="block text-[9px] mt-0.5 uppercase tracking-wide">Coming soon</span>
              </span>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="w-full p-5 lg:p-7 grid grid-cols-1 xl:grid-cols-2 gap-4 content-start items-start">
          <AnalysisSection {...section} flowType={flowType} onFlowTypeChange={onFlowTypeChange} />
          <ReferenceSection {...section} flowType={flowType} />
          {compressible && <ThermoSection {...section} />}
          {physics.regime === 'turbulent' && <TurbulenceSection {...section} />}
          <NearWallSection {...section} model={model} />
          <BoundarySection {...section} model={model} patches={patches} onPatchBC={setPatchBC} />
        </div>
      </main>
    </div>
  );
};
