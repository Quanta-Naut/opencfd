import { Play, Pause, SkipBack, SkipForward, ChevronFirst, ChevronLast, Film } from 'lucide-react';

/** Results stage: transient time-step player. */
export function TransientPlayer(p: TransientPlayerProps) {
  const {
    showField,
    isTransient,
    onSelectTransientFrame,
    transientTimes,
    transientFrameIndex,
    onToggleTransientPlay,
    transientPlaying,
    onSelectTransientSpeed,
    transientSpeed,
    onExportAnimation,
  } = p;
  return (
    <>
      {/* ─── Transient Flow Simulation Player ─── */}
      {showField && isTransient && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-30 w-[92%] max-w-2xl bg-surface border border-line rounded px-4 py-2 flex items-center gap-3 select-none transition-all duration-150"
          style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 52px)' }}
        >
          {/* 5 Playback Control Buttons: First, Prev, Play/Pause, Next, Last */}
          <div className="flex items-center gap-1 shrink-0">
            {/* First Frame */}
            <button
              onClick={() => onSelectTransientFrame?.(0)}
              disabled={transientTimes.length === 0 || transientFrameIndex === 0}
              title="First Frame"
              className="p-1.5 rounded text-fg-2 hover:text-fg hover:bg-app disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronFirst className="w-4 h-4" />
            </button>

            {/* Previous Frame */}
            <button
              onClick={() => onSelectTransientFrame?.(transientFrameIndex - 1)}
              disabled={transientTimes.length === 0 || transientFrameIndex === 0}
              title="Previous Frame"
              className="p-1.5 rounded text-fg-2 hover:text-fg hover:bg-app disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>

            {/* Play / Pause */}
            <button
              onClick={() => onToggleTransientPlay?.()}
              disabled={transientTimes.length < 2}
              title={transientPlaying ? 'Pause' : 'Play Simulation'}
              className="p-2 rounded-full bg-accent hover:bg-accent-hover text-white disabled:opacity-40 disabled:pointer-events-none transition-transform active:scale-95 flex items-center justify-center mx-0.5"
            >
              {transientPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            {/* Next Frame */}
            <button
              onClick={() => onSelectTransientFrame?.(transientFrameIndex + 1)}
              disabled={
                transientTimes.length === 0 || transientFrameIndex >= transientTimes.length - 1
              }
              title="Next Frame"
              className="p-1.5 rounded text-fg-2 hover:text-fg hover:bg-app disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>

            {/* Last Frame */}
            <button
              onClick={() => onSelectTransientFrame?.(transientTimes.length - 1)}
              disabled={
                transientTimes.length === 0 || transientFrameIndex >= transientTimes.length - 1
              }
              title="Last Frame"
              className="p-1.5 rounded text-fg-2 hover:text-fg hover:bg-app disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <ChevronLast className="w-4 h-4" />
            </button>
          </div>

          {/* Middle: Timeline Slider & Timestamp display */}
          <div className="flex-1 flex flex-col justify-center min-w-0 px-1 gap-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-fg-2">
              <span>
                Time:{' '}
                <strong className="text-fg">
                  {transientTimes[transientFrameIndex] !== undefined
                    ? `${transientTimes[transientFrameIndex]}s`
                    : '0.00s'}
                </strong>
              </span>
              <span>
                Frame{' '}
                <strong className="text-fg">
                  {transientTimes.length > 0 ? transientFrameIndex + 1 : 0}
                </strong>{' '}
                / {transientTimes.length || 1}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, transientTimes.length - 1)}
              step={1}
              value={transientFrameIndex}
              onChange={(e) => onSelectTransientFrame?.(parseInt(e.target.value, 10))}
              disabled={transientTimes.length < 2}
              className="w-full h-1.5 bg-line rounded appearance-none cursor-pointer accent-accent disabled:cursor-not-allowed"
            />
          </div>

          {/* Rightmost: Speed Controls (0.05x, 0.1x, 0.25x, 0.5x, 1x, 2x) */}
          <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-line">
            {([0.05, 0.1, 0.25, 0.5, 1, 2] as const).map((spd) => (
              <button
                key={spd}
                onClick={() => onSelectTransientSpeed?.(spd)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${
                  transientSpeed === spd
                    ? 'bg-accent-soft text-accent-fg font-semibold'
                    : 'text-fg-2 hover:text-fg hover:bg-app'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
          {onExportAnimation && (
            <button
              type="button"
              onClick={onExportAnimation}
              disabled={transientTimes.length < 2}
              title="Export as GIF or video"
              aria-label="Export animation"
              className="shrink-0 p-1.5 rounded text-fg-2 hover:text-fg hover:bg-app disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              <Film className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </>
  );
}

export interface TransientPlayerProps {
  showField: boolean;
  isTransient: boolean;
  onSelectTransientFrame: (index: number) => void;
  transientTimes: number[];
  transientFrameIndex: number;
  onToggleTransientPlay: () => void;
  transientPlaying: boolean;
  onSelectTransientSpeed: (speed: number) => void;
  transientSpeed: number;
  /** Open the animation export. */
  onExportAnimation?: () => void;
}
