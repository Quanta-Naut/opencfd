import React, { useEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, X } from 'lucide-react';

/**
 * App-wide notifications. One look for everything: success, error, warning,
 * info, and long-running work (loading with optional progress that resolves
 * into a success or error in place).
 *
 *   toast.success('Mesh ready', { description: '9 456 nodes' })
 *   const id = toast.loading('Generating mesh', { progress: 0 })
 *   toast.update(id, { progress: 40 })
 *   toast.success('Mesh ready', { id })            // same toast, now done
 *   toast.promise(save(), { loading: 'Saving', success: 'Saved', error: (e) => String(e) })
 *
 * The legacy call `toast(message, kind, durationMs)` still works.
 *
 * Behaviour: the same message shown again bumps a ×N counter instead of
 * stacking; at most MAX_VISIBLE show at once (older ones leave first);
 * hovering pauses every timer; errors stay longer; loading toasts stay until
 * resolved.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Reuse an id to replace / resolve an existing toast in place. */
  id?: string | number;
  description?: React.ReactNode;
  /** ms before auto-dismiss; Infinity keeps it until closed. */
  duration?: number;
  action?: ToastAction;
  /** 0-100 for a determinate bar on loading toasts. */
  progress?: number;
}

interface ToastRow {
  id: string | number;
  kind: ToastKind;
  title: string;
  description?: React.ReactNode;
  action?: ToastAction;
  progress?: number;
  duration: number;
  count: number;
  /** Time left before auto-dismiss, kept so hover can pause and resume. */
  remaining: number;
  startedAt: number;
  expiring: boolean;
}

const EXIT_MS = 220;
const MAX_VISIBLE = 4;
const DEFAULT_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 5000,
  warning: 7000,
  error: 9000,
  loading: Infinity,
};

let rows: ToastRow[] = [];
let nextId = 1;
let paused = false;
const timers = new Map<string | number, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function clearTimer(id: string | number) {
  const t = timers.get(id);
  if (t !== undefined) window.clearTimeout(t);
  timers.delete(id);
}

function schedule(row: ToastRow) {
  clearTimer(row.id);
  if (paused || !Number.isFinite(row.remaining)) return;
  row.startedAt = Date.now();
  timers.set(
    row.id,
    window.setTimeout(() => dismiss(row.id), Math.max(0, row.remaining)),
  );
}

function show(kind: ToastKind, title: string, opts: ToastOptions = {}): string | number {
  const duration =
    opts.duration ?? (opts.action ? Math.max(DEFAULT_MS[kind], 8000) : DEFAULT_MS[kind]);
  const existing =
    opts.id !== undefined
      ? rows.find((r) => r.id === opts.id)
      : rows.find((r) => !r.expiring && r.kind === kind && r.title === title && kind !== 'loading');

  if (existing) {
    // Replace in place: resolves a loading toast, or counts a repeat.
    const repeat = opts.id === undefined;
    Object.assign(existing, {
      kind,
      title,
      description: opts.description ?? (repeat ? existing.description : undefined),
      action: opts.action ?? (repeat ? existing.action : undefined),
      progress: kind === 'loading' ? opts.progress : undefined,
      duration,
      remaining: duration,
      count: repeat ? existing.count + 1 : existing.count,
      expiring: false,
    });
    rows = [...rows];
    schedule(existing);
    emit();
    return existing.id;
  }

  const row: ToastRow = {
    id: opts.id ?? nextId++,
    kind,
    title,
    description: opts.description,
    action: opts.action,
    progress: opts.progress,
    duration,
    count: 1,
    remaining: duration,
    startedAt: Date.now(),
    expiring: false,
  };
  rows = [...rows, row];
  // Too many on screen: retire the oldest ones that are not still working.
  const live = rows.filter((r) => !r.expiring);
  if (live.length > MAX_VISIBLE) {
    live
      .filter((r) => r.kind !== 'loading')
      .slice(0, live.length - MAX_VISIBLE)
      .forEach((r) => dismiss(r.id));
  }
  schedule(row);
  emit();
  return row.id;
}

function dismiss(id?: string | number) {
  const targets = id === undefined ? rows : rows.filter((r) => r.id === id);
  if (!targets.length) return;
  targets.forEach((r) => {
    clearTimer(r.id);
    r.expiring = true;
  });
  rows = [...rows];
  emit();
  window.setTimeout(() => {
    const gone = new Set(targets.map((r) => r.id));
    rows = rows.filter((r) => !(gone.has(r.id) && r.expiring));
    emit();
  }, EXIT_MS);
}

function update(
  id: string | number,
  patch: Partial<Pick<ToastOptions, 'description' | 'progress'>> & { title?: string },
) {
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  Object.assign(row, patch);
  rows = [...rows];
  emit();
}

function setPaused(p: boolean) {
  if (paused === p) return;
  paused = p;
  for (const r of rows) {
    if (r.expiring) continue;
    if (p) {
      if (Number.isFinite(r.remaining)) r.remaining -= Date.now() - r.startedAt;
      clearTimer(r.id);
    } else {
      schedule(r);
    }
  }
}

type LegacyKind = 'success' | 'error' | 'info' | 'warning';

/** Legacy form: toast(message, kind?, durationMs?). Prefer toast.success() etc. */
function toastFn(msg: string, kind: LegacyKind = 'info', durationMs?: number) {
  return show(kind, msg, { duration: durationMs });
}

export const toast = Object.assign(toastFn, {
  success: (title: string, opts?: ToastOptions) => show('success', title, opts),
  error: (title: string, opts?: ToastOptions) => show('error', title, opts),
  warning: (title: string, opts?: ToastOptions) => show('warning', title, opts),
  info: (title: string, opts?: ToastOptions) => show('info', title, opts),
  loading: (title: string, opts?: ToastOptions) => show('loading', title, opts),
  update,
  dismiss,
  /**
   * A loading toast for work with no real progress signal (meshing): the bar
   * eases toward 94% and the toast resolves in place when the work ends.
   */
  task(title: string, opts: Omit<ToastOptions, 'progress'> = {}) {
    let progress = 8;
    let done = false;
    const id = show('loading', title, { ...opts, progress });
    const timer = window.setInterval(() => {
      progress = Math.min(94, progress + Math.max(0.5, (94 - progress) * 0.06));
      update(id, { progress });
    }, 140);
    const end = (kind: 'success' | 'error' | 'warning', t: string, o: ToastOptions = {}) => {
      window.clearInterval(timer);
      done = true;
      return show(kind, t, { ...o, id });
    };
    return {
      id,
      success: (t: string, o?: ToastOptions) => end('success', t, o),
      error: (t: string, o?: ToastOptions) => end('error', t, o),
      warning: (t: string, o?: ToastOptions) => end('warning', t, o),
      /** Drop the toast if it never resolved (safe to call in a finally). */
      cancel: () => {
        window.clearInterval(timer);
        if (!done) dismiss(id);
        done = true;
      },
    };
  },
  /** Loading toast that resolves to success / error with the promise. */
  promise<T>(
    p: Promise<T>,
    msgs: {
      loading: string;
      success: string | ((v: T) => string);
      error: string | ((e: unknown) => string);
    },
  ): Promise<T> {
    const id = show('loading', msgs.loading);
    p.then(
      (v) =>
        show('success', typeof msgs.success === 'function' ? msgs.success(v) : msgs.success, {
          id,
        }),
      (e) => show('error', typeof msgs.error === 'function' ? msgs.error(e) : msgs.error, { id }),
    );
    return p;
  },
});

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-success" />,
  error: <AlertCircle className="w-4 h-4 text-danger" />,
  warning: <AlertTriangle className="w-4 h-4 text-warning" />,
  info: <Info className="w-4 h-4 text-accent" />,
  loading: <Loader2 className="w-4 h-4 text-accent animate-spin" />,
};
const EDGE: Record<ToastKind, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
  loading: 'var(--accent)',
};

const ToastItem: React.FC<{ row: ToastRow }> = ({ row }) => {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const urgent = row.kind === 'error' || row.kind === 'warning';
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      data-enter={entered && !row.expiring}
      className="toast-item pointer-events-auto relative w-[360px] max-w-[calc(100vw-2rem)] rounded border border-line bg-surface overflow-hidden"
      style={{ borderLeft: `3px solid ${EDGE[row.kind]}` }}
    >
      <div className="flex items-start gap-3 pl-3.5 pr-2 py-3">
        <span className="mt-px shrink-0">{ICON[row.kind]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium leading-snug text-fg break-words">
              {row.title}
            </span>
            {row.count > 1 && (
              <span className="shrink-0 rounded-sm bg-surface-3 px-1 text-[10px] font-mono text-fg-3">
                ×{row.count}
              </span>
            )}
            {row.kind === 'loading' && row.progress !== undefined && (
              <span className="ml-auto shrink-0 text-[11px] font-mono text-accent">
                {Math.round(row.progress)}%
              </span>
            )}
          </div>
          {row.description && (
            <div className="mt-0.5 text-[12px] leading-snug text-fg-3 break-words whitespace-pre-line">
              {row.description}
            </div>
          )}
          {row.action && (
            <button
              type="button"
              onClick={() => {
                row.action!.onClick();
                dismiss(row.id);
              }}
              className="mt-2 rounded border border-line px-2 py-0.5 text-[12px] font-medium text-fg hover:border-line-strong hover:bg-surface-2 transition-colors"
            >
              {row.action.label}
            </button>
          )}
        </div>
        {row.kind !== 'loading' && (
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => dismiss(row.id)}
            className="shrink-0 -mt-0.5 p-1 text-fg-4 hover:text-fg rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {row.kind === 'loading' && row.progress !== undefined && (
        <div className="h-0.5 w-full bg-accent-soft">
          <div
            className="h-full bg-accent transition-[width] duration-150 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, row.progress))}%` }}
          />
        </div>
      )}
    </div>
  );
};

export const ToastHost: React.FC = () => {
  const [, force] = useReducer((x) => x + 1, 0);
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listeners.add(force);
    const onKey = (e: KeyboardEvent) => {
      // Esc closes the newest toast when focus is inside the stack.
      if (e.key === 'Escape' && hostRef.current?.contains(document.activeElement)) {
        const last = [...rows].reverse().find((r) => !r.expiring && r.kind !== 'loading');
        if (last) dismiss(last.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      listeners.delete(force);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={hostRef}
      aria-label="Notifications"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="fixed z-[10000] flex flex-col gap-2 items-end pointer-events-none"
      // Above the bottom status bar / console strip, clear of the viewport chips.
      style={{ bottom: '1rem', right: '1rem' }}
    >
      {rows.map((r) => (
        <ToastItem key={r.id} row={r} />
      ))}
    </div>,
    document.body,
  );
};

export default ToastHost;
