import React from 'react';

export const card =
  'bg-[var(--cs-surface,#fff)] border border-[#E1E4E8] rounded-xl p-5';

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
        {icon && <span className="text-[#2563EB] shrink-0">{icon}</span>}
        <div>
          <h2 className="text-sm font-bold text-[#171A1F]">{title}</h2>
          {hint && <p className="text-[10px] text-[#69717D] mt-1 max-w-md">{hint}</p>}
        </div>
      </div>
      {right}
    </div>
    {children}
  </section>
);

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({
  label,
  hint,
  children,
}) => (
  <label className="block">
    <span className="text-[10px] font-semibold text-[#69717D] block mb-1.5">{label}</span>
    {children}
    {hint && <span className="text-[9px] text-[#A5ACB5] block mt-1">{hint}</span>}
  </label>
);

const inputBase =
  'w-full px-2.5 py-2 bg-white border border-[#DDE2E8] rounded-md font-mono text-xs text-[#171A1F] focus:outline-none focus:border-[#2563EB] disabled:opacity-50 disabled:bg-[#F5F6F8]';

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
  React.useEffect(() => { setDraft(String(value)); }, [value]);
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
      className={`${inputBase} ${unit ? 'rounded-r-none' : ''} ${readOnly ? 'text-[#69717D]' : ''}`}
    />
  );
  if (!unit) return input;
  return (
    <div className="flex">
      {input}
      <span className="px-2 flex items-center text-[10px] text-[#69717D] bg-[#F5F6F8] border border-l-0 border-[#DDE2E8] rounded-r-md font-mono">
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
  <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={inputBase}>
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
  <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    {options.map(([v, label]) => (
      <button
        key={v}
        onClick={() => onChange(v)}
        className={`py-2 rounded-md border text-xs font-medium transition-colors ${
          value === v
            ? 'bg-[#2563EB] border-[#2563EB] text-white'
            : 'border-[#DDE2E8] text-[#69717D] bg-white hover:bg-[#F5F6F8]'
        }`}
      >
        {label}
      </button>
    ))}
  </div>
);

export const Stat: React.FC<{ label: string; value: string; tone?: 'default' | 'warn' | 'good' }> = ({
  label,
  value,
  tone = 'default',
}) => (
  <div className="bg-[#F8FAFC] border border-[#E8EDF1] rounded-lg px-3 py-2">
    <span className="text-[9px] uppercase tracking-wide text-[#8B95A1] block">{label}</span>
    <span
      className={`text-[13px] font-mono font-semibold block mt-0.5 ${
        tone === 'warn' ? 'text-[#B4622D]' : tone === 'good' ? 'text-[#059669]' : 'text-[#171A1F]'
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
  return n.toPrecision(sig).replace(/\.?0+$/, '');
};
