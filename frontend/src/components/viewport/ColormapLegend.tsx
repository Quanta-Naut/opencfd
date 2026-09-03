import React from 'react';

interface ColormapLegendProps {
  fieldName: string;
  unit: string;
  min: number;
  max: number;
  colormap: 'coolwarm' | 'viridis' | 'turbo' | 'jet' | 'rainbow';
}

export const ColormapLegend: React.FC<ColormapLegendProps> = ({
  fieldName,
  unit,
  min,
  max,
  colormap,
}) => {
  const getGradientStyle = () => {
    if (colormap === 'coolwarm') {
      return 'linear-gradient(to right, rgb(59,76,192), rgb(240,240,240), rgb(180,4,38))';
    } else if (colormap === 'viridis') {
      return 'linear-gradient(to right, #440154, #31688e, #35b779, #fde725)';
    } else if (colormap === 'turbo') {
      return 'linear-gradient(to right, #30123b, #4185f4, #22da78, #f5a623, #d92120, #7a0403)';
    } else {
      return 'linear-gradient(to right, blue, cyan, green, yellow, red)';
    }
  };

  return (
    <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur border border-slate-200 rounded-lg p-3 w-64 pointer-events-auto">
      <div className="flex justify-between items-center mb-1 text-xs font-semibold text-slate-700">
        <span>{fieldName}</span>
        <span className="text-slate-400 font-mono font-normal">[{unit}]</span>
      </div>
      <div
        className="h-3 rounded-sm border border-slate-300 "
        style={{ background: getGradientStyle() }}
      />
      <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-1">
        <span>{min.toFixed(2)}</span>
        <span>{((min + max) / 2).toFixed(2)}</span>
        <span>{max.toFixed(2)}</span>
      </div>
    </div>
  );
};
