import { AlertCircle, Loader2 } from 'lucide-react';

/** Results stage: loading and error overlays for a past run's stored field. */
export function HistoricalFieldOverlays(p: HistoricalFieldOverlaysProps) {
  const { showField, historicalStatus, onRestoreLive } = p;
  return (
    <>
      {/* --- Historical field loading overlay --- */}
      {showField && historicalStatus?.loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/50 z-30 pointer-events-none">
          <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-line rounded text-xs font-medium text-fg">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
            <span>Loading flow field snapshot...</span>
          </div>
        </div>
      )}

      {/* --- Historical field error overlay (e.g. 404 / no field stored) --- */}
      {showField && historicalStatus?.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-viewport/90 z-30 pointer-events-auto">
          <div className="max-w-sm bg-surface border border-line rounded p-5 text-center space-y-3">
            <div className="w-9 h-9 rounded-full bg-warning-soft border border-warning-line text-warning flex items-center justify-center mx-auto">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-fg">No flow field stored for this run</h3>
              <p className="text-[11px] text-fg-2 leading-relaxed">
                {historicalStatus.error.toLowerCase().includes('404') ||
                historicalStatus.error.toLowerCase().includes('no stored')
                  ? 'This solver run has no stored field snapshot on disk. It may have errored or stopped before fields were written.'
                  : historicalStatus.error}
              </p>
            </div>
            {onRestoreLive && (
              <button
                type="button"
                onClick={onRestoreLive}
                className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded text-xs font-medium transition-colors cursor-pointer"
              >
                Back to Latest Run
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export interface HistoricalFieldOverlaysProps {
  showField: boolean;
  historicalStatus: { runLabel?: string; loading?: boolean; error?: string | null };
  onRestoreLive: () => void;
}
