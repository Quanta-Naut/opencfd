import { colormapRGB } from '../workbenchCore';

/** Colour legends: Results field bar, Mesh quality, and the live solver preview. */
export function ViewportLegends(p: ViewportLegendsProps) {
  const {
    showField,
    fieldData,
    activeField,
    colormap,
    meshOnly,
    canvasMode,
    showMeshQuality,
    meshSkew,
    meshSkewStats,
    liveVals,
    liveField,
    livePreview,
    liveRange,
  } = p;
  return (
    <>
      {/* ─── Field colour bar (Results) ─── */}
      {showField &&
        Array.isArray(fieldData?.fields?.[activeField]) &&
        (() => {
          const r = fieldData?.ranges?.[activeField] || [0, 1];
          const stops = Array.from({ length: 12 }, (_, i) => colormapRGB(1 - i / 11, colormap));
          const labels: Record<string, { name: string; unit: string }> = {
            U_mag: { name: '[U]', unit: 'm/s' },
            p: { name: '[p]', unit: 'Pa' },
            k: { name: '[k]', unit: 'm²/s²' },
            omega: { name: '[ω]', unit: '1/s' },
            vorticity: { name: '[∇×U]', unit: '1/s' },
          };
          const fieldLabel = labels[activeField] || { name: activeField, unit: '' };
          return (
            <div
              className="absolute right-3 w-fit bg-surface/95 border border-line rounded p-1.5 pr-2 text-[10px] font-mono text-fg-2 pointer-events-none"
              style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 4px)' }}
            >
              <div className="mb-1 text-right text-fg font-semibold whitespace-nowrap">
                {fieldLabel.name} {fieldLabel.unit}
              </div>
              <div className="flex items-stretch justify-end h-56">
                <div className="flex flex-col justify-between items-end whitespace-nowrap">
                  <span>{Number(r[1]).toPrecision(3)}</span>
                  <span>{Number((Number(r[0]) + Number(r[1])) / 2).toPrecision(3)}</span>
                  <span>{Number(r[0]).toPrecision(3)}</span>
                </div>
                <div
                  className="ml-1 w-2.5 shrink-0 rounded-sm border border-line"
                  style={{ background: `linear-gradient(to bottom, ${stops.join(',')})` }}
                />
              </div>
            </div>
          );
        })()}

      {/* ─── Mesh-quality legend (Mesh tab only) ─── */}
      {!showField &&
        !meshOnly &&
        canvasMode === 'mesh' &&
        showMeshQuality &&
        meshSkew &&
        meshSkewStats && (
          <div
            className="absolute right-3 z-20 w-fit bg-surface/95 border border-line rounded p-2 text-[10px] font-mono text-fg-2 pointer-events-none"
            style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 4px)' }}
          >
            <div className="mb-1 text-right text-fg font-semibold whitespace-nowrap">
              Cell skewness
            </div>
            <div className="flex items-stretch justify-end h-56">
              <div className="flex flex-col justify-between items-end whitespace-nowrap pr-1">
                <span className="text-danger font-semibold">1.0 · degenerate</span>
                <span>0.80 · poor</span>
                <span>0.50 · fair</span>
                <span>0.25 · good</span>
                <span className="text-success font-semibold">0.0 · ideal</span>
              </div>
              <div
                className="w-3 shrink-0 rounded-sm border border-line"
                style={{
                  background: `linear-gradient(to bottom, ${Array.from({ length: 16 }, (_, i) => colormapRGB(1 - i / 15, 'quality')).join(',')})`,
                }}
              />
            </div>
            <div className="mt-2 pt-2 border-t border-line-soft text-right leading-relaxed">
              <div>
                max <span className="text-fg font-semibold">{meshSkewStats.max.toFixed(2)}</span>
              </div>
              <div>
                median{' '}
                <span className="text-fg font-semibold">{meshSkewStats.median.toFixed(2)}</span>
              </div>
              <div className={meshSkewStats.poorPct > 2 ? 'text-danger font-semibold' : ''}>
                {meshSkewStats.poor} cells &gt; 0.8 ({meshSkewStats.poorPct.toFixed(1)}%)
              </div>
            </div>
          </div>
        )}

      {/* ─── Live solver preview legend (Solver tab) ─── */}
      {liveVals && (
        <div
          className="absolute right-3 z-20 w-fit bg-surface/95 border border-line rounded p-2 text-[10px] font-mono text-fg-2 pointer-events-none"
          style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 4px)' }}
        >
          <div className="mb-1 text-right text-fg font-semibold whitespace-nowrap">
            {liveField === 'U_mag' ? '[U] m/s' : liveField === 'p' ? 'p Pa' : 'k m²/s²'}
            {livePreview?.time ? ` · t=${livePreview.time}` : ''}
          </div>
          <div className="flex items-stretch justify-end h-44">
            <div className="flex flex-col justify-between items-end whitespace-nowrap pr-1">
              <span>{Number(liveRange[1]).toPrecision(3)}</span>
              <span>{((Number(liveRange[0]) + Number(liveRange[1])) / 2).toPrecision(3)}</span>
              <span>{Number(liveRange[0]).toPrecision(3)}</span>
            </div>
            <div
              className="w-3 shrink-0 rounded-sm border border-line"
              style={{
                background: `linear-gradient(to bottom, ${Array.from({ length: 14 }, (_, i) => colormapRGB(1 - i / 13, colormap)).join(',')})`,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

export interface ViewportLegendsProps {
  showField: boolean;
  fieldData: any;
  activeField: string;
  colormap: string;
  meshOnly: boolean;
  canvasMode: 'cad' | 'mesh';
  showMeshQuality: boolean;
  meshSkew: Float32Array<ArrayBufferLike>;
  meshSkewStats: { max: number; median: number; poor: number; poorPct: number };
  liveVals: number[];
  liveField: 'U_mag' | 'p' | 'k';
  livePreview: {
    time: string;
    fields: Record<string, number[]>;
    ranges: Record<string, [number, number]>;
  };
  liveRange: [number, number];
}
