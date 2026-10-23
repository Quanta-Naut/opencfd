import { useEffect, useRef } from 'react';

/**
 * Global keyboard shortcuts.
 *
 * Combos are written as `mod+k`, `shift+?`, `mod+enter`, `1`, `escape`, where
 * `mod` is Cmd on macOS and Ctrl elsewhere. A handler only fires when every
 * modifier in the combo matches exactly, so `mod+k` never also fires on
 * `mod+shift+k`.
 *
 * By default a combo is ignored while the user is typing in an input,
 * textarea, select or contenteditable element - pass `allowInInput: true` for
 * the rare case that needs to work there (an always-available toggle).
 */
export interface Hotkey {
  /** e.g. 'mod+k', 'shift+?', 'mod+enter', '1'. */
  combo: string;
  handler: (e: KeyboardEvent) => void;
  allowInInput?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

function normaliseKey(key: string): string {
  if (key === ' ') return 'space';
  return key.toLowerCase();
}

function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const key = parts[parts.length - 1];
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');

  const hasMod = e.metaKey || e.ctrlKey;
  if (wantMod !== hasMod) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;

  return normaliseKey(e.key) === key;
}

export function useGlobalHotkeys(hotkeys: Hotkey[], enabled = true) {
  // Keep the latest handlers without re-registering the listener every render.
  const ref = useRef(hotkeys);
  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const typing = isTypingTarget(e.target);
      for (const hk of ref.current) {
        if (!matches(hk.combo, e)) continue;
        if (typing && !hk.allowInInput) continue;
        hk.handler(e);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
