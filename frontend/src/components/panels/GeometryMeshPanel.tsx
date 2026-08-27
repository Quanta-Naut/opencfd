import React from 'react';
import { GeometryConfig, GeometryType } from '../../types/cfd';
import { Box, Play, Sliders, Layers } from 'lucide-react';

interface GeometryMeshPanelProps {
  config: GeometryConfig;
  onChange: (updated: Partial<GeometryConfig>) => void;
  onGenerateMesh: () => void;
  isMeshing: boolean;
}

export const GeometryMeshPanel: React.FC<GeometryMeshPanelProps> = ({
  config,
  onChange,
  onGenerateMesh,
  isMeshing,
}) => {
  return (
    <div className="space-y-4 p-4 text-xs text-slate-700 select-none">
      {/* Geometry Template Selector */}
      <div className="space-y-1.5">
        <label className="font-semibold text-slate-800 flex items-center gap-1.5">
          <Box className="w-3.5 h-3.5 text-blue-600" />
          <span>Geometry Model</span>
        </label>
        <select
          value={config.type}
          onChange={(e) => onChange({ type: e.target.value as GeometryType })}
          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium"
        >
          <option value="naca0012">NACA 0012 Airfoil (2D)</option>
          <option value="cylinder">Cylinder in Crossflow</option>
          <option value="backward_step">Backward Facing Step</option>
          <option value="lid_cavity">Lid-Driven Cavity</option>
          <option value="channel">Channel Flow</option>
        </select>
      </div>

      {/* Geometry Parameters */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider">
          Dimensions & Flow Domain
        </span>

        {config.type === 'naca0012' && (
          <>
            <div>
              <div className="flex justify-between mb-1 text-slate-600">
                <span>Chord Length (c)</span>
                <span className="font-mono">{config.chord} m</span>
              </div>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10.0"
                value={config.chord}
                onChange={(e) => onChange({ chord: parseFloat(e.target.value) || 1.0 })}
                className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-slate-800"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1 text-slate-600">
                <span>Angle of Attack (α)</span>
                <span className="font-mono">{config.angleOfAttackDeg}°</span>
              </div>
              <input
                type="range"
                min="-10"
                max="25"
                step="1"
                value={config.angleOfAttackDeg}
                onChange={(e) => onChange({ angleOfAttackDeg: parseFloat(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
          </>
        )}

        {config.type === 'cylinder' && (
          <div>
            <div className="flex justify-between mb-1 text-slate-600">
              <span>Cylinder Diameter (D)</span>
              <span className="font-mono">{config.cylinderDiameter} m</span>
            </div>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="5.0"
              value={config.cylinderDiameter}
              onChange={(e) => onChange({ cylinderDiameter: parseFloat(e.target.value) || 1.0 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-slate-800"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="block text-slate-500 mb-1">Domain Length</span>
            <input
              type="number"
              step="1"
              value={config.domainLength}
              onChange={(e) => onChange({ domainLength: parseFloat(e.target.value) || 10.0 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-slate-800"
            />
          </div>
          <div>
            <span className="block text-slate-500 mb-1">Domain Height</span>
            <input
              type="number"
              step="1"
              value={config.domainHeight}
              onChange={(e) => onChange({ domainHeight: parseFloat(e.target.value) || 6.0 })}
              className="w-full px-2 py-1 bg-white border border-slate-200 rounded text-slate-800"
            />
          </div>
        </div>
      </div>

      {/* Gmsh Meshing Controls */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
        <span className="font-semibold text-slate-700 block text-[11px] uppercase tracking-wider flex items-center justify-between">
          <span>Gmsh Mesh Settings</span>
          <Layers className="w-3.5 h-3.5 text-slate-400" />
        </span>

        <div>
          <span className="block text-slate-600 mb-1">Mesh Density</span>
          <div className="grid grid-cols-3 gap-1.5">
            {(['coarse', 'medium', 'fine'] as const).map((res) => (
              <button
                key={res}
                onClick={() => onChange({ meshResolution: res })}
                className={`py-1 rounded capitalize font-medium border text-[11px] transition-colors ${
                  config.meshResolution === res
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {res}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200/80 space-y-2">
          <label className="block"><span className="text-slate-600 block mb-1">2D Algorithm</span><select value={config.meshAlgorithm} onChange={(e) => onChange({ meshAlgorithm: e.target.value as GeometryConfig['meshAlgorithm'] })} className="w-full px-2 py-1 bg-white border border-slate-200 rounded"><option value="frontal_delaunay">Frontal-Delaunay (recommended)</option><option value="mesh_adapt">MeshAdapt (robust fallback)</option><option value="delaunay">Delaunay (fast preview)</option></select></label>
          <div className="grid grid-cols-2 gap-2"><label><span className="text-slate-500 block">Growth rate</span><input type="number" min="1.01" max="2" step="0.01" value={config.growthRate} onChange={(e) => onChange({ growthRate: parseFloat(e.target.value) || 1.2 })} className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded" /></label><label><span className="text-slate-500 block">Elements / curve</span><input type="number" min="4" max="100" value={config.elementsPerCurve} onChange={(e) => onChange({ elementsPerCurve: parseInt(e.target.value) || 12 })} className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded" /></label></div>
          <div className="grid grid-cols-2 gap-2"><label><span className="text-slate-500 block">Min size (m)</span><input type="number" min="0" step="any" placeholder="auto" value={config.minElementSize || ''} onChange={(e) => onChange({ minElementSize: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded" /></label><label><span className="text-slate-500 block">Max size (m)</span><input type="number" min="0" step="any" placeholder="auto" value={config.maxElementSize || ''} onChange={(e) => onChange({ maxElementSize: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded" /></label></div>
          <label className="flex items-center justify-between text-slate-600"><span>Curvature + proximity refinement</span><input type="checkbox" checked={config.useProximityRefinement} onChange={(e) => onChange({ useProximityRefinement: e.target.checked })} className="accent-blue-600" /></label>
          <label className="flex items-center justify-between text-slate-600"><span>Optimize / smooth mesh</span><input type="checkbox" checked={config.optimizeMesh} onChange={(e) => onChange({ optimizeMesh: e.target.checked })} className="accent-blue-600" /></label>
        </div>

        {/* Boundary Layer Prisms */}
        <div className="pt-2 border-t border-slate-200/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700">Boundary Layer Prisms</span>
            <input
              type="checkbox"
              checked={config.usePrismLayers}
              onChange={(e) => onChange({ usePrismLayers: e.target.checked })}
              className="rounded text-blue-600 accent-blue-600 cursor-pointer"
            />
          </div>

          {config.usePrismLayers && (
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">First Layer (mm)</span>
                <input
                  type="number"
                  step="0.005"
                  value={config.firstLayerHeightMm}
                  onChange={(e) => onChange({ firstLayerHeightMm: parseFloat(e.target.value) || 0.05 })}
                  className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded"
                />
              </div>
              <div>
                <span className="text-slate-500 block">Layers Count</span>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={config.numPrismLayers}
                  onChange={(e) => onChange({ numPrismLayers: parseInt(e.target.value) || 10 })}
                  className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded"
                />
              </div>
              <div>
                <span className="text-slate-500 block">Growth Ratio</span>
                <input type="number" min="1.01" max="2" step="0.01" value={config.prismExpansionRatio} onChange={(e) => onChange({ prismExpansionRatio: parseFloat(e.target.value) || 1.2 })} className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Generate Mesh Action Button */}
      <button
        onClick={onGenerateMesh}
        disabled={isMeshing}
        className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
      >
        <Play className="w-3.5 h-3.5 fill-current" />
        <span>{isMeshing ? 'Generating Mesh...' : 'Generate Gmsh Mesh'}</span>
      </button>
    </div>
  );
};
