import { useEffect, useState } from 'react';
import { API_BASE } from '../utils/backend';

export type BackendHealth = 'checking' | 'online' | 'offline';

/** Polls the backend's /api/health so the UI can show a real connection
 *  state (it used to be a hard-coded "Connected"). Checks faster while
 *  offline so recovery shows up quickly. */
export function useBackendHealth(): BackendHealth {
  const [health, setHealth] = useState<BackendHealth>('checking');

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      const ctrl = new AbortController();
      const abort = window.setTimeout(() => ctrl.abort(), 4000);
      let ok = false;
      try {
        const res = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal });
        ok = res.ok;
      } catch {
        ok = false;
      } finally {
        window.clearTimeout(abort);
      }
      if (cancelled) return;
      setHealth(ok ? 'online' : 'offline');
      timer = window.setTimeout(check, ok ? 10000 : 2500);
    };
    check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return health;
}
