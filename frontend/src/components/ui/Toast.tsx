import React, { useEffect, useReducer, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';
interface ToastRow { id: number; msg: string; kind: ToastKind; expiring: boolean }

let rows: ToastRow[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const EXIT_MS = 300;

/** Fire a toast. Bottom-right, slides in from the right, auto-dismisses. */
export function toast(msg: string, kind: ToastKind = 'info', durationMs = 3600) {
  const id = nextId++;
  rows = [...rows, { id, msg, kind, expiring: false }];
  emit();
  window.setTimeout(() => {
    rows = rows.map((r) => (r.id === id ? { ...r, expiring: true } : r));
    emit();
  }, durationMs);
  window.setTimeout(() => {
    rows = rows.filter((r) => r.id !== id);
    emit();
  }, durationMs + EXIT_MS);
  return id;
}

function dismiss(id: number) {
  rows = rows.map((r) => (r.id === id ? { ...r, expiring: true } : r));
  emit();
  window.setTimeout(() => {
    rows = rows.filter((r) => r.id !== id);
    emit();
  }, EXIT_MS);
}

const ICON = {
  success: <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />,
  error: <AlertCircle className="w-4 h-4 text-[#DC2626]" />,
  info: <Info className="w-4 h-4 text-[#2563EB]" />,
};
const BAR = { success: '#16A34A', error: '#DC2626', info: '#2563EB' };

const ToastItem: React.FC<ToastRow> = ({ id, msg, kind, expiring }) => {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div
      data-enter={entered && !expiring}
      className="toast-item pointer-events-auto flex items-start gap-3 w-[360px] max-w-[86vw] rounded-xl bg-white border border-[#E4E7EC] pl-3.5 pr-3 py-3 overflow-hidden"
      style={{ borderLeft: `3px solid ${BAR[kind]}` }}
    >
      <span className="mt-0.5 shrink-0">{ICON[kind]}</span>
      <span className="flex-1 text-[13px] leading-snug text-[#374151]">{msg}</span>
      <button
        onClick={() => dismiss(id)}
        className="shrink-0 -mr-1 -mt-0.5 p-1 text-[#A5ACB5] hover:text-[#171A1F] rounded transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export const ToastHost: React.FC = () => {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => { listeners.delete(force); };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed z-[10000] flex flex-col gap-2 items-end"
      style={{ bottom: '1.5rem', right: '1rem' }}
    >
      {rows.map((r) => (
        <ToastItem key={r.id} {...r} />
      ))}
    </div>,
    document.body,
  );
};

export default ToastHost;
