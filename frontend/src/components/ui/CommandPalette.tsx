import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Search, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { Kbd } from './Kbd';

export interface Command {
  id: string;
  title: string;
  /** Section heading in the list - results are grouped by this. */
  group: string;
  subtitle?: string;
  /** Extra words that should match a search but aren't shown. */
  keywords?: string;
  icon?: React.ReactNode;
  /** Key-cap tokens shown on the right, e.g. ['⌘', 'K']. */
  shortcut?: string[];
  disabled?: boolean;
  disabledReason?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/**
 * Subsequence fuzzy score. Every query character must appear in order in the
 * target; contiguous runs and word-boundary starts score higher, so "gm"
 * ranks "Generate Mesh" above "Regenerate Geometry". Null = no match.
 */
function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;

  let qi = 0;
  let score = 0;
  let streak = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    streak = lastIdx === ti - 1 ? streak + 1 : 0;
    score += 1 + streak * 2;
    if (ti === 0 || /[\s\-_/.·]/.test(t[ti - 1])) score += 4; // word start
    lastIdx = ti;
    qi++;
  }
  return qi === q.length ? score : null;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, commands }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => {
    const q = query.trim();
    const scored = commands
      .map((c, i) => {
        const haystacks = [c.title, c.keywords, c.subtitle, c.group].filter(Boolean) as string[];
        let best: number | null = null;
        for (const h of haystacks) {
          const s = fuzzyScore(q, h);
          if (s !== null && (best === null || s > best)) best = s;
        }
        return { c, i, score: best };
      })
      .filter((x): x is { c: Command; i: number; score: number } => x.score !== null);

    scored.sort((a, b) => b.score - a.score || a.i - b.i);

    const map = new Map<string, Command[]>();
    for (const { c } of scored) {
      const bucket = map.get(c.group);
      if (bucket) bucket.push(c);
      else map.set(c.group, [c]);
    }
    return [...map.entries()];
  }, [commands, query]);

  // Flattened order = the exact order ArrowUp/ArrowDown walk.
  const flat = useMemo(() => grouped.flatMap(([, cmds]) => cmds), [grouped]);

  // Navigation skips disabled commands so Enter always has something to run.
  const enabledIdx = useMemo(
    () => flat.map((c, i) => (c.disabled ? -1 : i)).filter((i) => i >= 0),
    [flat],
  );

  useEffect(() => {
    if (enabledIdx.length === 0) return;
    setActiveIndex((i) => (enabledIdx.includes(i) ? i : enabledIdx[0]));
  }, [enabledIdx]);

  // Keep the highlighted row in view as the user arrows past the fold.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, grouped]);

  if (!open || typeof document === 'undefined') return null;

  const runCommand = (cmd: Command) => {
    if (cmd.disabled) return;
    onClose();
    cmd.run();
  };

  const move = (delta: number) => {
    if (enabledIdx.length === 0) return;
    const pos = enabledIdx.indexOf(activeIndex);
    const nextPos = pos === -1 ? 0 : (pos + delta + enabledIdx.length) % enabledIdx.length;
    setActiveIndex(enabledIdx[nextPos]);
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = flat[activeIndex];
      if (cmd) runCommand(cmd);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center pt-[12vh] bg-black/40"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-[600px] max-w-[92vw] bg-white border border-[#D1D5DB] rounded overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Query row */}
        <div className="flex items-center gap-2 px-3 h-11 border-b border-[#E1E4E8]">
          <Search className="w-4 h-4 text-[#8A929E] shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search commands, stages, actions…"
            spellCheck={false}
            className="flex-1 bg-transparent outline-none text-[14px] text-[#171A1F] placeholder:text-[#A5ACB5]"
          />
          <Kbd>Esc</Kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {grouped.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-[#69717D]">
              No matching commands
            </div>
          ) : (
            grouped.map(([group, cmds]) => (
              <div key={group}>
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8A929E]">
                  {group}
                </div>
                {cmds.map((cmd) => {
                  const index = flat.indexOf(cmd);
                  const isActive = index === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      data-active={isActive}
                      disabled={cmd.disabled}
                      onMouseMove={() => !cmd.disabled && setActiveIndex(index)}
                      onClick={() => runCommand(cmd)}
                      className={clsx(
                        'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors',
                        cmd.disabled
                          ? 'text-[#C4C9D0] cursor-not-allowed'
                          : isActive
                            ? 'bg-[#EFF6FF] text-[#171A1F]'
                            : 'text-[#374151] hover:bg-[#F5F6F8]',
                      )}
                    >
                      <span
                        className={clsx(
                          'w-4 h-4 shrink-0 flex items-center justify-center',
                          cmd.disabled ? 'text-[#C4C9D0]' : 'text-[#69717D]',
                        )}
                      >
                        {cmd.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate font-medium">{cmd.title}</span>
                        {(cmd.disabled ? cmd.disabledReason : cmd.subtitle) && (
                          <span className="block truncate text-[11px] text-[#8A929E]">
                            {cmd.disabled ? cmd.disabledReason : cmd.subtitle}
                          </span>
                        )}
                      </span>
                      {cmd.shortcut && cmd.shortcut.length > 0 && (
                        <span className="flex items-center gap-0.5 shrink-0">
                          {cmd.shortcut.map((s) => (
                            <Kbd key={s}>{s}</Kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 h-8 border-t border-[#E1E4E8] bg-[#F5F6F8] text-[11px] text-[#69717D]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd>
                <ArrowUp className="w-3 h-3" />
              </Kbd>
              <Kbd>
                <ArrowDown className="w-3 h-3" />
              </Kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <Kbd>
                <CornerDownLeft className="w-3 h-3" />
              </Kbd>
              run
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Kbd>?</Kbd> all shortcuts
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
