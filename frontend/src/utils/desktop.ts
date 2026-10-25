import { useEffect, useState } from 'react';
import { IS_MAC } from './platform';

/** True inside the Tauri desktop shell (not in a plain browser). */
export const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Windows and Linux draw their own window buttons in the top bar; macOS keeps
 * its native traffic lights. Decided at run time, never by build target. */
export const CUSTOM_WINDOW_CONTROLS = IS_TAURI && !IS_MAC;

type AppWindow = ReturnType<typeof import('@tauri-apps/api/window').getCurrentWindow>;

let windowPromise: Promise<AppWindow> | null = null;
/** The current Tauri window; the API is only loaded when it is needed. */
export function appWindow(): Promise<AppWindow> {
  windowPromise ??= import('@tauri-apps/api/window').then((m) => m.getCurrentWindow());
  return windowPromise;
}

/** Turns the OS title bar off (once) and tracks whether the window is maximised. */
export function useWindowControls(): { active: boolean; maximized: boolean } {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!CUSTOM_WINDOW_CONTROLS) return;
    let off: (() => void) | undefined;
    let dead = false;
    void appWindow().then(async (w) => {
      try {
        await w.setDecorations(false);
        setMaximized(await w.isMaximized());
        off = await w.onResized(async () => {
          if (!dead) setMaximized(await w.isMaximized());
        });
      } catch {
        /* the window API is not reachable; keep the native title bar */
      }
    });
    return () => {
      dead = true;
      off?.();
    };
  }, []);
  return { active: CUSTOM_WINDOW_CONTROLS, maximized };
}
