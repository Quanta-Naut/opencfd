import React from 'react';
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';

interface TransientPlaybackControlsProps {
  times: number[];
  current: number;
  playing: boolean;
  onSelect: (index: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

export const TransientPlaybackControls: React.FC<TransientPlaybackControlsProps> = ({ times, current, playing, onSelect, onPlayingChange }) => {
  if (times.length < 2) return null;
  const seekSeconds = (direction: -1 | 1) => {
    const target = times[current] + direction * 3;
    let next = current;
    if (direction < 0) while (next > 0 && times[next] > target) next -= 1;
    else while (next < times.length - 1 && times[next] < target) next += 1;
    onSelect(next);
  };
  const iconButton = 'w-7 h-7 inline-flex items-center justify-center rounded text-[#69717D] hover:bg-[#F0F4FF] hover:text-[#2563EB] disabled:opacity-35 disabled:hover:bg-transparent';
  return (
    <div className="absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-lg border border-[#E1E4E8] bg-white/95 px-2.5 py-1.5 text-[10px] font-mono text-[#69717D]" style={{ bottom: 'calc(var(--app-bottom-bar, 0px) + 0.75rem)' }}>
      <div className="flex items-center">
        <button className={iconButton} onClick={() => onSelect(0)} title="First frame" disabled={current === 0}><ChevronFirst className="w-4 h-4" /></button>
        <button className={iconButton} onClick={() => onSelect(current - 1)} title="Previous frame" disabled={current === 0}><ChevronLeft className="w-4 h-4" /></button>
        <button className="mx-0.5 w-8 h-8 inline-flex items-center justify-center rounded bg-[#2563EB] text-white hover:bg-[#1D4ED8]" onClick={() => onPlayingChange(!playing)} title={playing ? 'Pause' : 'Play'}>{playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}</button>
        <button className={iconButton} onClick={() => onSelect(current + 1)} title="Next frame" disabled={current === times.length - 1}><ChevronRight className="w-4 h-4" /></button>
        <button className={iconButton} onClick={() => onSelect(times.length - 1)} title="Last frame" disabled={current === times.length - 1}><ChevronLast className="w-4 h-4" /></button>
      </div>
      <div className="h-5 w-px bg-[#E1E4E8]" />
      <span className="whitespace-nowrap text-[#171A1F]">t = {times[current].toPrecision(4)} s</span>
      <input aria-label="Transient result time" className="w-40 accent-[#2563EB]" type="range" min={0} max={times.length - 1} value={current} onChange={(e) => onSelect(Number(e.target.value))} />
      <span className="whitespace-nowrap">{current + 1}/{times.length}</span>
      <div className="h-5 w-px bg-[#E1E4E8]" />
      <button className={iconButton} onClick={() => seekSeconds(-1)} title="Back 3 seconds"><SkipBack className="w-3.5 h-3.5" /></button>
      <button className={iconButton} onClick={() => seekSeconds(1)} title="Forward 3 seconds"><SkipForward className="w-3.5 h-3.5" /></button>
    </div>
  );
};
