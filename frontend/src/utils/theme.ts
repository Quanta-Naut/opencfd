import { useSyncExternalStore } from 'react';

/** What the user picked in Preferences. 'system' follows the OS. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** What is actually applied (`data-theme` on <html>). */
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'opencfd_theme';
const media =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable: fall through to the default */
  }
  return 'system';
}

let preference: ThemePreference = readPreference();

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return media?.matches ? 'dark' : 'light';
  return pref;
}

let resolved: ResolvedTheme = resolve(preference);

function apply() {
  resolved = resolve(preference);
  document.documentElement.dataset.theme = resolved;
  listeners.forEach((l) => l());
}

media?.addEventListener('change', () => {
  if (preference === 'system') apply();
});

/** Call once at startup (index.html already sets the attribute pre-paint). */
export function initTheme() {
  apply();
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(pref: ThemePreference) {
  preference = pref;
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* not persisted, still applied for this session */
  }
  apply();
}

/** Flip between light and dark, leaving 'system' for an explicit choice. */
export function toggleTheme() {
  setThemePreference(resolved === 'dark' ? 'light' : 'dark');
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** The applied theme; re-renders when it changes. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => resolved,
    () => 'light',
  );
}

/** The stored preference; re-renders when it changes. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribe,
    () => preference,
    () => 'system',
  );
}

/** Read a theme token (e.g. '--fg-4') for canvas drawing, which can't use
 *  CSS classes. Call at draw time and redraw when the theme changes. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
