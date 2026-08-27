import React from 'react';
import { CFDProjectState } from '../../types/cfd';

interface StatusBarProps {
  state: CFDProjectState;
  meshData: any;
}

export const StatusBar: React.FC<StatusBarProps> = ({ state, meshData }) => {
  const numCells = meshData?.num_elements ? `${(meshData.num_elements / 1000).toFixed(1)}k cells` : '2.8k cells';
  const solverName = state.physics.solver;
  const turbModel = state.physics.regime === 'turbulent' ? state.physics.turbulenceModel : 'Laminar';
  const uInf = `${state.boundaries.inletVelocity.toFixed(1)} m/s`;

  return (
    <footer className="h-6 bg-[#F5F6F8] border-t border-[#E1E4E8] px-3 flex items-center justify-between text-[11px] font-mono text-[#69717D] select-none shrink-0">
      {/* Left: Engineering Summary Tokens */}
      <div className="flex items-center gap-3">
        <span>{solverName}</span>
        <span className="text-[#D1D5DB]">│</span>
        <span>{numCells}</span>
        <span className="text-[#D1D5DB]">│</span>
        <span>{turbModel}</span>
        <span className="text-[#D1D5DB]">│</span>
        <span>U∞ {uInf}</span>
      </div>

      {/* Right: Connectivity Status */}
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
        <span className="text-[#171A1F] font-medium">Connected</span>
      </div>
    </footer>
  );
};
