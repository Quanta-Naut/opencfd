// The Python backend always runs on the local machine: `python run.py` in dev,
// or the bundled Tauri sidecar in the packaged app. In the packaged app the
// webview is served from `tauri.localhost`, so we must pin to loopback rather
// than reuse window.location.hostname. Only a real remote host (LAN dev on a
// phone/another box) keeps its hostname.
function resolveHost(): string {
  if (typeof window === 'undefined') return '127.0.0.1';
  const h = window.location.hostname;
  if (!h || h === 'localhost' || h === '127.0.0.1' || h.endsWith('tauri.localhost')) {
    return '127.0.0.1';
  }
  return h;
}

const HOST = resolveHost();
export const API_BASE = `http://${HOST}:8000`;
export const WS_BASE = `ws://${HOST}:8000`;
