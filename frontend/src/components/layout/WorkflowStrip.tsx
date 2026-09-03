import React from 'react';
import { Lock, FileCode } from 'lucide-react';

export type StageId = 'geometry' | 'caseSetup' | 'mesh' | 'physics' | 'yplus' | 'solver' | 'results';

export interface StageStatus {
  locked: boolean;
  reason?: string;
  missing?: string[];
}

interface WorkflowStripProps {
  activeStage: StageId;
  onSelectStage: (stage: StageId) => void;
  stageStatus?: Partial<Record<StageId, StageStatus>>;
  onOpenCaseFiles?: () => void;
  caseFilesCount?: number;
}

export const WorkflowStrip: React.FC<WorkflowStripProps> = ({
  activeStage,
  onSelectStage,
  stageStatus,
  onOpenCaseFiles,
  caseFilesCount = 0,
}) => {
  const stages: { id: StageId; num: string; label: string }[] = [
    { id: 'geometry', num: '01', label: 'Geometry' },
    { id: 'caseSetup', num: '02', label: 'Case Setup' },
    { id: 'mesh', num: '03', label: 'Mesh' },
    { id: 'solver', num: '04', label: 'Solver' },
    { id: 'results', num: '05', label: 'Results' },
  ];

  return (
    <nav className="h-9 bg-white border-b border-[#E1E4E8] pl-4 pr-2 flex items-center gap-1 select-none shrink-0 overflow-x-auto">
      {stages.map((st, idx) => {
        const isActive = activeStage === st.id;
        const locked = !!stageStatus?.[st.id]?.locked;
        return (
          <React.Fragment key={st.id}>
            <button
              onClick={() => onSelectStage(st.id)}
              title={locked ? stageStatus?.[st.id]?.reason : undefined}
              className={`relative h-full px-3 flex items-center gap-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'text-[#171A1F] font-semibold'
                  : locked
                  ? 'text-[#A5ACB5] hover:text-[#69717D]'
                  : 'text-[#69717D] hover:text-[#171A1F]'
              }`}
            >
              <span className={`text-[10px] font-mono ${isActive ? 'text-[#2563EB]' : 'text-[#A5ACB5]'}`}>
                {st.num}
              </span>
              <span>{st.label}</span>
              {locked && <Lock className="w-3 h-3 text-[#C4C9D0]" />}

              {/* Active Bottom Indicator Line */}
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-[#2563EB] rounded-t-full" />
              )}
            </button>

            {idx < stages.length - 1 && (
              <span className="text-[#D1D5DB] text-[11px] select-none font-mono">→</span>
            )}
          </React.Fragment>
        );
      })}

      {onOpenCaseFiles && (
        <button
          onClick={onOpenCaseFiles}
          disabled={caseFilesCount === 0}
          title={caseFilesCount === 0 ? 'Case files appear once the case is set up' : 'Browse the OpenFOAM case dictionaries'}
          className="ml-auto shrink-0 h-7 inline-flex items-center gap-1.5 rounded-md border border-[#E1E4E8] px-2.5 text-[11px] font-medium text-[#69717D] hover:text-[#171A1F] hover:border-[#C4D4F5] hover:bg-[#F7F9FF] disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          <FileCode className="w-3.5 h-3.5" />
          OpenFOAM Dicts
        </button>
      )}
    </nav>
  );
};
