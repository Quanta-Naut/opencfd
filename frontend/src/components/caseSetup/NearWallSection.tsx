import React from 'react';
import { Ruler } from 'lucide-react';
import { SectionProps } from './CaseSetupPanel';
import { SectionCard, Field, NumberInput, Stat, fmt } from './ui';
import { wallResolution } from '../../caseSetup/flowCalc';
import { TurbulenceModel } from '../../caseSetup/turbulenceCatalog';

export const NearWallSection: React.FC<SectionProps & { model: TurbulenceModel }> = ({
  state,
  setCaseSetup,
  refLength,
  model,
}) => {
  const { physics, caseSetup } = state;
  const wr = wallResolution(
    {
      velocity: physics.inletVelocity,
      density: physics.density,
      kinematicViscosity: physics.kinematicViscosity,
      refLength,
    },
    caseSetup.targetYPlus,
    caseSetup.growthRate,
  );

  const rec =
    physics.wallModel === 'wall_functions'
      ? 50
      : Math.max(model.yPlus.low || 0.5, 0.8);
  const offRec = Math.abs(caseSetup.targetYPlus - rec) / rec > 0.5;

  return (
    <SectionCard
      span2
      icon={<Ruler className="w-4 h-4" />}
      title="Near-wall resolution"
      hint="The first cell height at the walls, from a flat-plate skin-friction estimate. Feeds the mesh."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field
          label="Target y+"
          hint={offRec ? `${model.label} wants ≈ ${rec}` : model.yPlus.note}
        >
          <NumberInput
            value={caseSetup.targetYPlus}
            step={caseSetup.targetYPlus < 5 ? 0.1 : 5}
            min={0.05}
            onChange={(v) => setCaseSetup({ targetYPlus: v })}
          />
        </Field>
        <Field label="Layer growth ratio">
          <NumberInput
            value={caseSetup.growthRate}
            step={0.02}
            min={1.02}
            onChange={(v) => setCaseSetup({ growthRate: v })}
          />
        </Field>
        <Field label="Link to mesh">
          <button
            onClick={() => setCaseSetup({ linkFirstCellToMesh: !caseSetup.linkFirstCellToMesh })}
            className={`w-full py-2 rounded-md border text-xs font-medium transition-colors ${
              caseSetup.linkFirstCellToMesh
                ? 'bg-blue-50 border-[#2563EB] text-[#1D4ED8]'
                : 'bg-white border-[#DDE2E8] text-[#69717D]'
            }`}
          >
            {caseSetup.linkFirstCellToMesh ? 'First cell driven by y+' : 'Mesh sets first cell'}
          </button>
        </Field>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="First cell Δy" value={`${fmt(wr.firstCellHeightMm, 3)} mm`} tone="good" />
        <Stat label="BL thickness δ" value={`${fmt(wr.blThickness * 1000, 3)} mm`} />
        <Stat label="Prism layers" value={String(wr.layerCount)} />
        <Stat label="Layer stack" value={`${fmt(wr.totalLayerThickness * 1000, 3)} mm`} />
      </div>
      <p className="text-[9px] text-[#A5ACB5]">
        Cf {wr.skinFriction.toExponential(2)} · τw {fmt(wr.wallShearStress, 3)} Pa · uτ {fmt(wr.frictionVelocity, 3)} m/s
      </p>
    </SectionCard>
  );
};
