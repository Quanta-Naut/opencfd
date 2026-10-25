import { useEffect } from 'react';
import { MousePointerClick, X } from 'lucide-react';

export interface PickField {
  label: string;
  /** The picked point as text, or null while nothing is picked. */
  value: string | null;
  /** What the empty field asks for, e.g. "Select point". */
  empty: string;
}

/**
 * The command dialog for picking on the Results field, the same as the block
 * tools' on the mesh: selection fields (the active one takes the next click),
 * OK (Enter) and Cancel (Esc). Sits at the top right of the canvas.
 */
export function PickDialog(p: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: PickField[];
  active: number;
  onActive: (i: number) => void;
  onClear: (i: number) => void;
  hint: string;
  okLabel?: string;
  /** False keeps OK off until the picks are made. */
  ready: boolean;
  /** Left out when the picks apply on their own, as in a line plot. */
  onOk?: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !p.ready || !p.onOk || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      e.preventDefault();
      p.onOk();
    };
    // Capture: Enter must not also press the sidebar button that has focus.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [p.ready, p.onOk]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="absolute top-3 right-3 z-30 w-[268px] select-none bg-surface border border-line rounded text-[11px] text-fg">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-line">
        <p.icon className="w-3.5 h-3.5 text-accent-fg" />
        <span className="font-semibold uppercase tracking-wide text-[10px]">{p.title}</span>
        <button
          type="button"
          onClick={p.onCancel}
          className="ml-auto text-fg-2 hover:text-fg"
          title="Cancel (Esc)"
          aria-label="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="p-2 space-y-1.5">
        {p.fields.map((f, i) => (
          <div key={f.label} className="flex items-center gap-2">
            <span className="w-[72px] shrink-0 text-fg-2">{f.label}</span>
            <button
              type="button"
              onClick={() => p.onActive(i)}
              className={`flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 rounded-sm border text-left transition-colors ${
                p.active === i
                  ? 'border-accent bg-accent-soft text-accent-fg'
                  : 'border-line bg-app text-fg-2 hover:border-line-strong'
              }`}
            >
              <MousePointerClick className="w-3 h-3 shrink-0" />
              <span className="truncate font-mono">{f.value ?? f.empty}</span>
              {f.value !== null && (
                <span
                  role="button"
                  title="Clear"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    p.onClear(i);
                  }}
                  className="ml-auto text-fg-2 hover:text-fg"
                >
                  <X className="w-3 h-3" />
                </span>
              )}
            </button>
          </div>
        ))}
        {p.children}
        <p className="text-[10px] text-fg-2 leading-snug">{p.hint}</p>
      </div>
      <div className="flex justify-end gap-1.5 px-2 pb-2">
        <button
          type="button"
          onClick={p.onCancel}
          className="px-2 py-0.5 rounded border border-line bg-surface text-fg-2 hover:text-fg hover:border-line-strong transition-colors"
        >
          Cancel
        </button>
        {p.onOk && (
          <button
            type="button"
            onClick={p.onOk}
            disabled={!p.ready}
            className="px-3 py-0.5 rounded bg-accent hover:bg-accent-hover text-white font-medium disabled:opacity-40 disabled:pointer-events-none"
          >
            {p.okLabel ?? 'OK'}
          </button>
        )}
      </div>
    </div>
  );
}
