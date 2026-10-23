import React from 'react';
import { wallResolution } from '../caseSetup/flowCalc';
import { CFDProjectState } from '../types/cfd';
import { fetchYPlus, fetchTurbulenceInflow } from '../utils/api';
import { FlowType } from '../types/cadWorkflow';

/** Recompute y+ / first-cell height and the derived flow numbers when their inputs change. */
export function updateCaseCalculations(wb: CaseCalculationsContext) {
  const { state, setState } = wb;
  const updateCalculations = async () => {
    try {
      const yplusRes = await fetchYPlus({
        velocity: state.boundaries.inletVelocity,
        length: state.geometry.chord || state.geometry.domainLength,
        density: state.physics.density,
        viscosity: state.physics.density * state.physics.kinematicViscosity,
        target_yplus: state.yplus.target_yplus,
        expansion_ratio: state.yplus.expansion_ratio,
        flow_regime: state.physics.regime,
      });
      // Keep the user's latest target while an older async calculation finishes.
      // The target is an input; the API response should only replace derived values.
      setState((prev) => ({
        ...prev,
        yplus: { ...yplusRes, target_yplus: prev.yplus.target_yplus },
      }));

      const turbRes = await fetchTurbulenceInflow({
        velocity: state.boundaries.inletVelocity,
        length_scale: state.boundaries.turbulentLengthScaleM || 0.01,
        intensity_percent: state.boundaries.turbulenceIntensityPercent,
      });
      setState((prev) => ({
        ...prev,
        boundaries: {
          ...prev.boundaries,
          inletK: turbRes.k,
          inletOmega: turbRes.omega,
          inletEpsilon: turbRes.epsilon,
          inletNut: turbRes.nut,
        },
      }));
    } catch (err) {
      console.warn('Calculation update note:', err);
    }
  };
  updateCalculations();
}

/** What updateCaseCalculations reads from the workbench component. */
export interface CaseCalculationsContext {
  state: CFDProjectState;
  setState: React.Dispatch<React.SetStateAction<CFDProjectState>>;
}

/** Case Setup drives the mesh first-cell height when the link is on. */
export function syncFirstCellToMesh(wb: SyncFirstCellContext) {
  const { state, flowType, setState } = wb;
  const cs = state.caseSetup;
  if (!cs.linkFirstCellToMesh) return;
  const refLen =
    cs.refLengthOverride && cs.refLengthOverride > 0
      ? cs.refLengthOverride
      : (flowType === 'internal' ? state.geometry.domainHeight : state.geometry.chord) || 1;
  const wr = wallResolution(
    {
      velocity: state.physics.inletVelocity,
      density: state.physics.density,
      kinematicViscosity: state.physics.kinematicViscosity,
      refLength: refLen,
    },
    cs.targetYPlus,
    cs.growthRate,
  );
  const mm = Number(wr.firstCellHeightMm.toPrecision(4));
  setState((prev) => {
    if (
      Math.abs(prev.geometry.firstLayerHeightMm - mm) < mm * 1e-3 &&
      prev.geometry.numPrismLayers === wr.layerCount
    )
      return prev;
    return {
      ...prev,
      geometry: {
        ...prev.geometry,
        firstLayerHeightMm: mm,
        numPrismLayers: wr.layerCount,
        prismExpansionRatio: cs.growthRate,
        usePrismLayers: true,
      },
    };
  });
}

/** What syncFirstCellToMesh reads from the workbench component. */
export interface SyncFirstCellContext {
  state: CFDProjectState;
  flowType: FlowType;
  setState: React.Dispatch<React.SetStateAction<CFDProjectState>>;
}
