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
    <div className="space-y-4 p-4 text-xs text-fg select-none">
      {/* Field Variable Selector */}
      <div className="space-y-1.5">
        <label className="font-semibold text-fg flex items-center gap-1.5">
          <Eye className="w-3.5 h-3.5 text-accent" />
          <span>Active Field Variable</span>
        </label>
        <select
          value={config.activeField}
          onChange={(e) => onChange({ activeField: e.target.value as any })}
          className="w-full px-2.5 py-1.5 bg-surface border border-line rounded-sm focus:outline-none focus:ring-1 focus:ring-accent font-medium text-fg"
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
        <label className="font-semibold text-fg flex items-center gap-1.5">
          <Palette className="w-3.5 h-3.5 text-accent" />
          <span>Scientific Colormap</span>
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {(['coolwarm', 'viridis', 'turbo', 'rainbow'] as const).map((map) => (
            <button
              key={map}
              onClick={() => onChange({ colormap: map })}
              className={`py-1.5 px-2 rounded-sm font-medium border text-center capitalize transition-colors ${
                config.colormap === map
                  ? 'bg-accent-soft text-accent-fg border-accent-line '
                  : 'bg-surface text-fg-2 border-line hover:bg-surface-2'
              }`}
            >
              {map}
            </button>
          ))}
        </div>
      </div>

      {/* Display Layers & Filters */}
      <div className="p-3 bg-surface-2 border border-line rounded space-y-2.5">
        <span className="font-semibold text-fg block text-[11px] uppercase tracking-wider">
          Visual Overlays
        </span>

        <label className="flex items-center justify-between p-1.5 bg-surface border border-line rounded cursor-pointer hover:bg-surface-2">
          <span className="flex items-center gap-2 text-fg">
            <Layers className="w-3.5 h-3.5 text-fg-2" />
            <span>Gmsh Mesh Wireframe</span>
          </span>
          <input
            type="checkbox"
            checked={config.showMeshWireframe}
            onChange={(e) => onChange({ showMeshWireframe: e.target.checked })}
            className="rounded text-accent accent-accent"
          />
        </label>

        <label className="flex items-center justify-between p-1.5 bg-surface border border-line rounded cursor-pointer hover:bg-surface-2">
          <span className="flex items-center gap-2 text-fg">
            <Wind className="w-3.5 h-3.5 text-fg-2" />
            <span>Flow Streamlines</span>
          </span>
          <input
            type="checkbox"
            checked={config.showStreamlines}
            onChange={(e) => onChange({ showStreamlines: e.target.checked })}
            className="rounded text-accent accent-accent"
          />
        </label>
      </div>
    </div>
  );
};
