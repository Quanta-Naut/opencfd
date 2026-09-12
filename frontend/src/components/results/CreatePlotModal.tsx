import React, { useState, useEffect } from 'react';
import { X, Crosshair, Loader2, AlertCircle, LineChart, Sliders } from 'lucide-react';
import { PlotDefinition, FlowVariable } from '../../types/cfd';
import { sampleSolverRunLine } from '../../utils/api';
import { FLOW_VARIABLES } from './PlotThumbnail';

export interface CreatePlotModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  targetRunId: string | null;
  targetRunLabel?: string;
  defaultName: string;
  pickedP1?: [number, number] | null;
  pickedP2?: [number, number] | null;
  onStartPickPoints: () => void;
  onCreatePlot: (plot: PlotDefinition) => void;
}

const COLORMAPS: Array<'viridis' | 'coolwarm' | 'turbo'> = ['viridis', 'coolwarm', 'turbo'];

export const CreatePlotModal: React.FC<CreatePlotModalProps> = ({
  open,
  onClose,
  projectId,
  targetRunId,
  targetRunLabel,
  defaultName,
  pickedP1,
  pickedP2,
  onStartPickPoints,
  onCreatePlot,
}) => {
  const [name, setName] = useState(defaultName);
  const [variable, setVariable] = useState<FlowVariable>('U_mag');
  const [colormap, setColormap] = useState<'viridis' | 'coolwarm' | 'turbo'>('viridis');
  const [samples, setSamples] = useState(100);

  // Coordinates
  const [p1x, setP1x] = useState<string>('0.0');
  const [p1y, setP1y] = useState<string>('0.0');
  const [p2x, setP2x] = useState<string>('1.0');
  const [p2y, setP2y] = useState<string>('0.0');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync picked points from viewport
  useEffect(() => {
    if (pickedP1) {
      setP1x(pickedP1[0].toFixed(4));
      setP1y(pickedP1[1].toFixed(4));
    }
  }, [pickedP1]);

  useEffect(() => {
    if (pickedP2) {
      setP2x(pickedP2[0].toFixed(4));
      setP2y(pickedP2[1].toFixed(4));
    }
  }, [pickedP2]);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
    }
  }, [open, defaultName]);

  if (!open) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!targetRunId) {
      setError('No completed solver run selected. Please run the solver first.');
      return;
    }

    const x1 = parseFloat(p1x);
    const y1 = parseFloat(p1y);
    const x2 = parseFloat(p2x);
    const y2 = parseFloat(p2y);

    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
      setError('Coordinates for Point 1 and Point 2 must be valid numbers.');
      return;
    }

    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist <= 1e-12) {
      setError('Point 1 and Point 2 must not be identical (line length is zero).');
      return;
    }

    const s = Math.round(samples);
    if (s < 2 || s > 2000) {
      setError('Samples must be an integer between 2 and 2000.');
      return;
    }

    setLoading(true);
    try {
      const res = await sampleSolverRunLine(projectId, targetRunId, [x1, y1], [x2, y2], s);
      if (!res.data || !res.data.distance) {
        setError(res.detail || 'Failed to sample line data from solver run.');
        setLoading(false);
        return;
      }

      const values = res.data.fields[variable] ?? [];
      const newPlot: PlotDefinition = {
        id: `plot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || defaultName,
        runId: targetRunId,
        variable,
        line: {
          p1: [x1, y1],
          p2: [x2, y2],
          samples: s,
        },
        colormap,
        rangeMin: null,
        rangeMax: null,
        data: {
          distance: res.data.distance,
          values,
          fields: res.data.fields,
        },
        createdAt: Date.now(),
      };

      onCreatePlot(newPlot);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Network error while sampling line.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#0B0D10]/50 backdrop-blur-[2px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white border border-[#E4E7EC] shadow-2xl flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Create New Plot"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#EDEFF3] bg-[#FAFBFC]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2563EB] text-white flex items-center justify-center shadow-sm">
              <LineChart className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#171A1F]">New Plot Line</h2>
              <div className="text-[11px] text-[#8A929E]">
                ANSYS CFD-Post style line probe along geometry
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-md text-[#69717D] hover:bg-[#EEF1F5] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target Run info */}
        <div className="px-5 py-2.5 bg-[#F0F5FF] border-b border-[#DBEAFE] flex items-center justify-between text-xs">
          <span className="text-[#1E40AF] font-medium">Sampling Target:</span>
          <span className="font-mono text-[#1E3A8A] font-semibold">
            {targetRunLabel || targetRunId ? `${targetRunLabel || targetRunId}` : 'No active run found'}
          </span>
        </div>

        {/* Error notification */}
        {error && (
          <div className="px-5 py-2.5 bg-red-50 border-b border-red-200 flex items-start gap-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleConfirm} className="p-5 space-y-4 text-xs text-[#171A1F]">
          {/* Plot Name */}
          <div>
            <label className="block text-[11px] font-semibold text-[#69717D] uppercase tracking-wider mb-1">
              Plot Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Centerline Velocity"
              className="w-full px-3 py-1.5 bg-white border border-[#E1E4E8] rounded-md text-xs text-[#171A1F] focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          {/* Variable & Colormap */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#69717D] uppercase tracking-wider mb-1">
                Flow Variable
              </label>
              <select
                value={variable}
                onChange={(e) => setVariable(e.target.value as FlowVariable)}
                className="w-full px-2.5 py-1.5 bg-white border border-[#E1E4E8] rounded-md font-medium text-[#171A1F] focus:outline-none focus:border-[#2563EB]"
              >
                {FLOW_VARIABLES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#69717D] uppercase tracking-wider mb-1">
                Colormap
              </label>
              <div className="grid grid-cols-3 gap-1">
                {COLORMAPS.map((map) => (
                  <button
                    key={map}
                    type="button"
                    onClick={() => setColormap(map)}
                    className={`py-1 rounded capitalize text-[11px] font-medium border transition-colors ${
                      colormap === map
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#69717D] border-[#E1E4E8] hover:bg-[#F5F6F8]'
                    }`}
                  >
                    {map}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Line Definition: Points & Pick Mode */}
          <div className="border border-[#E1E4E8] rounded-lg p-3 bg-[#F9FAFB] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#171A1F] uppercase tracking-wider">
                Line Coordinates (meters)
              </span>
              <button
                type="button"
                onClick={onStartPickPoints}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2563EB] hover:text-[#1D4ED8] bg-white border border-[#2563EB]/40 px-2 py-1 rounded shadow-xs hover:bg-[#F0F5FF] transition-colors cursor-pointer"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>Pick on Viewport</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Point 1 */}
              <div className="bg-white p-2.5 rounded border border-[#E5E7EB]">
                <div className="text-[11px] font-semibold text-[#2563EB] mb-1.5 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
                  Point 1 (Start)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-[#8A929E] block mb-0.5">X (m)</span>
                    <input
                      type="number"
                      step="any"
                      value={p1x}
                      onChange={(e) => setP1x(e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-[#E1E4E8] rounded text-xs font-mono focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-[#8A929E] block mb-0.5">Y (m)</span>
                    <input
                      type="number"
                      step="any"
                      value={p1y}
                      onChange={(e) => setP1y(e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-[#E1E4E8] rounded text-xs font-mono focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
              </div>

              {/* Point 2 */}
              <div className="bg-white p-2.5 rounded border border-[#E5E7EB]">
                <div className="text-[11px] font-semibold text-[#16A34A] mb-1.5 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
                  Point 2 (End)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-[#8A929E] block mb-0.5">X (m)</span>
                    <input
                      type="number"
                      step="any"
                      value={p2x}
                      onChange={(e) => setP2x(e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-[#E1E4E8] rounded text-xs font-mono focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-[#8A929E] block mb-0.5">Y (m)</span>
                    <input
                      type="number"
                      step="any"
                      value={p2y}
                      onChange={(e) => setP2y(e.target.value)}
                      className="w-full px-2 py-1 bg-white border border-[#E1E4E8] rounded text-xs font-mono focus:outline-none focus:border-[#2563EB]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Samples */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] font-medium text-[#69717D]">
                Number of Samples:
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={2000}
                  value={samples}
                  onChange={(e) => setSamples(Math.max(2, Math.min(2000, parseInt(e.target.value) || 2)))}
                  className="w-20 px-2 py-1 bg-white border border-[#E1E4E8] rounded text-xs font-mono text-center focus:outline-none focus:border-[#2563EB]"
                />
                <span className="text-[10px] text-[#8A929E]">(2-2000)</span>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#EDEFF3]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-1.5 text-xs font-medium text-[#69717D] hover:bg-[#F5F6F8] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !targetRunId}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sampling line...</span>
                </>
              ) : (
                <span>Create Plot</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreatePlotModal;
