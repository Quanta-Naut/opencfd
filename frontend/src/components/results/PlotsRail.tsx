import React from 'react';
import { LineChart } from 'lucide-react';
import { PlotDefinition } from '../../types/cfd';
import { PlotThumbnail } from './PlotThumbnail';

export interface PlotsRailProps {
  plots: PlotDefinition[];
  selectedPlotId?: string | null;
  onSelectPlot: (plot: PlotDefinition) => void;
}

export const PlotsRail: React.FC<PlotsRailProps> = ({
  plots,
  selectedPlotId = null,
  onSelectPlot,
}) => {
  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-white">
      {/* Sub-header */}
      <div className="h-9 px-3 flex items-center justify-between border-b border-[#E1E4E8] bg-[#F5F6F8] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#69717D]">
            Saved plots
          </span>
          {plots.length > 0 && (
            <span className="text-[10px] font-mono text-[#8A929E]">
              {plots.length}
            </span>
          )}
        </div>
      </div>

      {/* Scrollable List of Saved Plots */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {plots.length === 0 ? (
          <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center text-[#A5ACB5] text-[11px] font-mono p-4">
            <LineChart className="w-8 h-8 mb-2 stroke-[1.5] text-[#C4C9D0]" />
            <p className="max-w-[220px] leading-relaxed">
              No saved plots yet. Use 'Create Plot' on the left sidebar to sample a line across the geometry.
            </p>
          </div>
        ) : (
          plots.map((plot) => (
            <PlotThumbnail
              key={plot.id}
              plot={plot}
              isSelected={selectedPlotId === plot.id}
              onClick={() => onSelectPlot(plot)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default PlotsRail;
