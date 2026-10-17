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
    <div className="p-4 bg-[#F8F9FA] border border-[#E1E4E8] rounded">
      <div className="flex items-center gap-2 mb-1.5">
        <Lock className="w-4 h-4 text-[#69717D]" />
        <span className="text-[12px] font-bold text-[#171A1F]">{title}</span>
      </div>
      {reason && <p className="text-[11px] text-[#69717D] mb-3">{reason}</p>}
      {missing && missing.length > 0 && (
        <ul className="space-y-1.5 mb-3">
          {missing.map((m, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] text-[#171A1F]">
              <span className="mt-0.5 w-3.5 h-3.5 rounded-full border border-[#DC2626] text-[#DC2626] flex items-center justify-center text-[9px] shrink-0">✕</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}
      {onCta && (
        <button
          onClick={onCta}
          className="w-full py-1.5 rounded-sm bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium transition-colors"
        >
          {ctaLabel}
        </button>
      )}
    </div>
  </div>
);
