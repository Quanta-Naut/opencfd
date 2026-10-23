import React from 'react';
import { Lock } from 'lucide-react';

export const StageGate: React.FC<{
  title: string;
  reason?: string;
  missing?: string[];
  ctaLabel?: string;
  onCta?: () => void;
}> = ({ title, reason, missing, ctaLabel = 'Go to Geometry', onCta }) => (
  <div className="p-4">
    <div className="p-4 bg-surface-2 border border-line rounded">
      <div className="flex items-center gap-2 mb-1.5">
        <Lock className="w-4 h-4 text-fg-2" />
        <span className="text-[12px] font-bold text-fg">{title}</span>
      </div>
      {reason && <p className="text-[11px] text-fg-2 mb-3">{reason}</p>}
      {missing && missing.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {missing.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] text-fg">
              <span className="mt-0.5 w-3.5 h-3.5 rounded-full border border-danger text-danger flex items-center justify-center text-[10px] shrink-0">
                ✕
              </span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}
      {onCta && (
        <button
          onClick={onCta}
          className="w-full py-1.5 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  </div>
);
