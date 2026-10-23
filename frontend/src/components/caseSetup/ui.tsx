import React from 'react';

export const card = 'bg-surface border border-line rounded p-5';

export const SectionCard: React.FC<{
  title: string;
  hint?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  span2?: boolean;
  children: React.ReactNode;
}> = ({ title, hint, icon, right, span2, children }) => (
  <section className={`${card} space-y-4 ${span2 ? 'xl:col-span-2' : 'self-start'}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-accent shrink-0">{icon}</span>}
        <div>
          <h2 className="text-[13px] font-bold text-fg">{title}</h2>
          {/* moved out of the live UI - see caseSetup/ui.tsx SectionCard, kept for a future tutorial
          {hint && <p className="text-[11px] text-fg-2 mt-1 max-w-md">{hint}</p>}
          */}
        </div>
      </div>
      {right}
    </div>
    {children}
  </section>
);

export const Field: React.FC<{
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <label className="block">
    <span className="text-[11px] font-semibold text-fg-2 block mb-1.5">{label}</span>
    {children}
    {hint && <span className="text-[10px] text-fg-3 block mt-1">{hint}</span>}
  </label>
);

const fieldBase =
  'w-full px-2.5 py-2 bg-surface border border-line rounded-sm text-xs text-fg focus:outline-none focus:border-accent disabled:opacity-50 disabled:bg-app';
// Numbers in mono so digits line up; option labels are prose and stay sans.
const inputBase = `${fieldBase} font-mono`;

export const NumberInput: React.FC<{
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  unit?: string;
  disabled?: boolean;
  readOnly?: boolean;
}> = ({ value, onChange, step = 1, min, unit, disabled, readOnly }) => {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = (s: string) => {
    setDraft(s);
    const n = parseFloat(s);
    if (Number.isFinite(n)) onChange(n);
  };
  const input = (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      step={step}
      disabled={disabled}
      readOnly={readOnly}
      onChange={(e) => commit(e.target.value)}
      onBlur={() => {
        let n = parseFloat(draft);
        if (!Number.isFinite(n)) n = value;
        if (min != null) n = Math.max(min, n);
        onChange(n);
        setDraft(String(n));
      }}
      className={`${inputBase} ${unit ? 'rounded-r-none' : ''} ${readOnly ? 'text-fg-2' : ''}`}
    />
  );
  if (!unit) return input;
  return (
    <div className="flex">
      {input}
      <span className="px-2 flex items-center text-[10px] text-fg-2 bg-app border border-l-0 border-line rounded-r-md font-mono">
        {unit}
      </span>
    </div>
  );
};

export const Select: React.FC<{
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ value, onChange, disabled, children }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value)}
    disabled={disabled}
    className={fieldBase}
  >
    {children}
  </select>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
}) => (
  <div
    className="grid gap-1.5"
    style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
  >
    {options.map(([v, label]) => (
      <button
        key={v}
        onClick={() => onChange(v)}
        className={`py-2 rounded-sm border text-xs font-medium transition-colors ${
          value === v
            ? 'bg-accent-soft border-accent-line text-accent-fg'
            : 'border-line text-fg-2 bg-surface hover:bg-surface-2 hover:text-fg'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

export const Stat: React.FC<{
  label: string;
  value: string;
  tone?: 'default' | 'warn' | 'good';
}> = ({ label, value, tone = 'default' }) => (
  <div className="bg-surface-2 border border-line-soft rounded px-3 py-2">
    <span className="text-[10px] uppercase tracking-wide text-fg-3 block">{label}</span>
    <span
      className={`text-[13px] font-mono font-semibold block mt-0.5 ${
        tone === 'warn' ? 'text-warning' : tone === 'good' ? 'text-success' : 'text-fg'
      }`}
    >
      {value}
    </span>
  </div>
);

export const fmt = (n: number, sig = 3): string => {
  if (!Number.isFinite(n)) return '-';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e5 || abs < 1e-3) return n.toExponential(sig - 1);
  // Strip trailing zeros only AFTER a decimal point - a bare "340" must not
  // become "34" (the old /\.?0+$/ ate significant integer zeros).
  return n
    .toPrecision(sig)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
};
