import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { videoMime, type AnimationOptions } from '../../utils/exportAnimation';

export interface AnimationExportDialogProps {
  open: boolean;
  times: number[];
  /** The frame on screen, the default start. */
  frame: number;
  onExport: (o: AnimationOptions) => void;
  onClose: () => void;
}

const select =
  'w-full px-2 py-1.5 bg-surface border border-line rounded-sm text-xs text-fg focus:outline-none focus:border-accent';
const seg = (on: boolean) =>
  `flex-1 py-1.5 rounded-sm text-[11px] font-medium border transition-colors ${
    on
      ? 'bg-accent-soft text-accent-fg border-accent-line'
      : 'bg-surface text-fg-2 border-line hover:text-fg hover:border-line-strong'
  }`;

const fmtT = (t: number) => `${Number(t.toPrecision(5))} s`;

/** Options for exporting the saved time steps as an animation. */
export const AnimationExportDialog: React.FC<AnimationExportDialogProps> = ({
  open,
  times,
  onExport,
  onClose,
}) => {
  const canVideo = videoMime() !== null;
  const [format, setFormat] = useState<'gif' | 'video'>('gif');
  const [fps, setFps] = useState(10);
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.max(0, times.length - 1));
  const [sameRange, setSameRange] = useState(true);
  const [showTime, setShowTime] = useState(true);

  useEffect(() => {
    if (!open) return;
    setFrom(0);
    setTo(Math.max(0, times.length - 1));
  }, [open, times.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const n = to - from + 1;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded bg-surface border border-line flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Export animation"
      >
        <div className="px-5 py-3 border-b border-line-soft bg-surface-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-fg">Export animation</h2>
            <p className="text-[11px] text-fg-2">The view as it is now, played through time.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 text-fg-2 hover:bg-surface-3 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <span className="text-[11px] text-fg-2 block mb-1">Format</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                className={seg(format === 'gif')}
                onClick={() => setFormat('gif')}
              >
                GIF
              </button>
              <button
                type="button"
                className={`${seg(format === 'video')} disabled:opacity-40 disabled:pointer-events-none`}
                onClick={() => setFormat('video')}
                disabled={!canVideo}
                title={canVideo ? undefined : 'Video recording is not available here'}
              >
                Video
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="text-[11px] text-fg-2 block mb-1">From</span>
              <select
                value={from}
                onChange={(e) => setFrom(Math.min(Number(e.target.value), to - 1))}
                className={select}
              >
                {times.map((t, i) => (
                  <option key={i} value={i} disabled={i >= to}>
                    {fmtT(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-[11px] text-fg-2 block mb-1">To</span>
              <select
                value={to}
                onChange={(e) => setTo(Math.max(Number(e.target.value), from + 1))}
                className={select}
              >
                {times.map((t, i) => (
                  <option key={i} value={i} disabled={i <= from}>
                    {fmtT(t)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-[11px] text-fg-2 block mb-1">Frames per second</span>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className={select}>
              {[2, 5, 10, 15, 24, 30].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-fg-3 block mt-1">
              {n} frames, {(n / fps).toFixed(1)} s long
            </span>
          </label>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-[11px] text-fg cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sameRange}
                onChange={(e) => setSameRange(e.target.checked)}
                className="accent-accent mt-0.5"
              />
              <span>
                Same colour range on every frame
                <span className="block text-[10px] text-fg-3">
                  Taken from all the frames, so a colour means one value throughout.
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-fg cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showTime}
                onChange={(e) => setShowTime(e.target.checked)}
                className="accent-accent"
              />
              Show the time on each frame
            </label>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-line-soft bg-surface-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-fg-2 hover:text-fg border border-line rounded-sm bg-surface hover:bg-app"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onExport({ format, fps, from, to, sameRange, showTime })}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-accent hover:bg-accent-hover rounded-sm transition-colors"
          >
            Export
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnimationExportDialog;
