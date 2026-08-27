import React from 'react';
import { PostProcessConfig } from '../../types/cfd';
import { Eye, Palette, Layers, Wind, Slice } from 'lucide-react';

interface PostProcessPanelProps {
  config: PostProcessConfig;
  onChange: (updated: Partial<PostProcessConfig>) => void;
  availableRanges: Record<string, [number, number]>;
}

export const PostProcessPanel: React.FC<PostProcessPanelProps> = ({
  config,
  onChange,
  availableRanges,
}) => {
  return (
    <div className="space-y-4 p-4 text-xs text-slate-700 select-none">
      {/* Field Variable Selector */}
      <div className="space-y-1.5">
        <label className="font-semibold text-slate-800 flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-blue-600" />
          <span>Active Field Variable</span>
        </label>
        <select
          value={config.activeField}
          onChange={(e) => onChange({ activeField: e.target.value as any })}
          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium text-slate-800"
        >
          <option value="U_mag">Velocity Magnitude (|U|) [m/s]</option>
          <option value="p">Static Pressure (p) [Pa]</option>
          <option value="k">Turbulent Kinetic Energy (k) [m²/s²]</option>
          <option value="omega">Specific Dissipation (ω) [1/s]</option>
          <option value="vorticity">Vorticity (∇×U) [1/s]</option>
        </select>
      </div>

      {/* Colormap Preset Selector */}
      <div className="space-y-1.5">
        <label className="font-semibold text-slate-800 flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-blue-600" />
          <span>Scientific Colormap</span>
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {(['coolwarm', 'viridis', 'turbo', 'rainbow'] as const).map((map) => (
            <button
              key={map}
              onClick={() => onChange({ colormap: map })}
              className={`py-1.5 px-2 rounded-md font-medium border text-center capitalize transition-colors ${
                config.colormap === map
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {map}
            </button>
          ))}
        </div>
      </div>

      {/* Display Layers & Filters */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider">
          Visual Overlays
        </span>

        <label className="flex items-center justify-between p-1.5 bg-white border border-slate-200 rounded cursor-pointer hover:bg-slate-50">
          <span className="flex items-center gap-2 text-slate-700">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <span>Gmsh Mesh Wireframe</span>
          </span>
          <input
            type="checkbox"
            checked={config.showMeshWireframe}
            onChange={(e) => onChange({ showMeshWireframe: e.target.checked })}
            className="rounded text-blue-600 accent-blue-600"
          />
        </label>

        <label className="flex items-center justify-between p-1.5 bg-white border border-slate-200 rounded cursor-pointer hover:bg-slate-50">
          <span className="flex items-center gap-2 text-slate-700">
            <Wind className="w-3.5 h-3.5 text-slate-500" />
            <span>Flow Streamlines</span>
          </span>
          <input
            type="checkbox"
            checked={config.showStreamlines}
            onChange={(e) => onChange({ showStreamlines: e.target.checked })}
            className="rounded text-blue-600 accent-blue-600"
          />
        </label>
      </div>
    </div>
  );
};
