import React from 'react';

export type BlockTool =
  | 'select'
  | 'draw'
  | 'split'
  | 'delete'
  | 'ogrid'
  | 'mergeV'
  | 'mergeB'
  | 'assoc'
  | 'params'
  | 'match';

export type BlockMsg = { text: string; error: boolean } | null;

/** Length for display: three significant figures, exponent when tiny. */
export const fmtLen = (x: number) =>
  !Number.isFinite(x) ? '-' : Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toPrecision(3);

export const card = 'bg-surface border border-line rounded text-[11px] text-fg';
export const smallBtn =
  'px-2 py-0.5 rounded border border-line bg-surface text-fg-2 hover:text-fg hover:border-line-strong disabled:opacity-40 disabled:pointer-events-none transition-colors';

/** A number box that commits on Enter or blur (one undo step per edit).
 *  Empty commits `undefined` when `optional`. */
export function Field(p: {
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  integer?: boolean;
  optional?: boolean;
  disabled?: boolean;
  placeholder?: string;
  min?: number;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      key={String(p.value)}
      defaultValue={p.value === undefined ? '' : String(p.value)}
      placeholder={p.placeholder}
      disabled={p.disabled}
      onBlur={(ev) => {
        const raw = ev.target.value.trim();
        if (raw === '') {
          if (p.optional) {
            if (p.value !== undefined) p.onCommit(undefined);
          } else ev.target.value = p.value === undefined ? '' : String(p.value);
          return;
        }
        let n = p.integer ? parseInt(raw, 10) : parseFloat(raw);
        if (!Number.isFinite(n)) {
          ev.target.value = p.value === undefined ? '' : String(p.value);
          return;
        }
        if (p.min !== undefined) n = Math.max(p.min, n);
        if (n !== p.value) p.onCommit(n);
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
        if (ev.key === 'Escape') {
          (ev.target as HTMLInputElement).value = p.value === undefined ? '' : String(p.value);
          (ev.target as HTMLInputElement).blur();
        }
        ev.stopPropagation();
      }}
      className="w-full px-1.5 py-1 bg-app border border-line rounded-sm font-mono text-[11px] text-fg focus:outline-none focus:border-accent disabled:opacity-50"
    />
  );
}

export function Labeled(p: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-0.5 min-w-0" title={p.hint}>
      <span className="text-[10px] text-fg-2">{p.label}</span>
      {p.children}
    </label>
  );
}
