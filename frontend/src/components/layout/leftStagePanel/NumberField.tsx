import React, { useEffect, useRef, useState } from 'react';

/**
 * Number input that lets you actually type. It keeps a free-form draft string
 * (so "0", "0.", "0.02", "" and "-" are all allowed while editing), commits any
 * finite value on the fly, and only clamps to [min,max] / falls back on blur.
 * Never snaps mid-keystroke the way `parseFloat(v) || fallback` does.
 */
export const NumberField: React.FC<{
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: string;
  integer?: boolean;
  /** empty field / 0 is a valid value meaning "auto" - commit 0, show blank */
  allowEmpty?: boolean;
  /** value to restore when the field is blurred empty/invalid (defaults to current value) */
  fallback?: number;
  className?: string;
  placeholder?: string;
}> = ({ value, onChange, min, max, step, integer, allowEmpty, fallback, className, placeholder }) => {
  const fmt = (n: number) => (allowEmpty && !n ? '' : String(n));
  const [draft, setDraft] = useState(() => fmt(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, allowEmpty]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      step={step}
      value={draft}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => {
        const raw = e.target.value;
        // digits, one dot, optional leading minus, optional scientific exponent
        if (!/^-?\d*\.?\d*(?:[eE][-+]?\d*)?$/.test(raw)) return;
        setDraft(raw);
        const n = integer ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isFinite(n)) onChange(n);
        else if (raw === '' && allowEmpty) onChange(0);
      }}
      onBlur={(e) => {
        editing.current = false;
        const raw = e.target.value.trim();
        let n = integer ? parseInt(raw, 10) : parseFloat(raw);
        if (!Number.isFinite(n)) {
          if (allowEmpty) { onChange(0); setDraft(''); return; }
          n = fallback ?? value;
        }
        if (min != null && n < min) n = min;
        if (max != null && n > max) n = max;
        onChange(n);
        setDraft(fmt(n));
      }}
    />
  );
};
