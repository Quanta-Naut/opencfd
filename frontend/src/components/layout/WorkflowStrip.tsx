import React from 'react';

export type StageId = 'geometry' | 'caseSetup' | 'mesh' | 'physics' | 'yplus' | 'boundaries' | 'solver' | 'results';

interface WorkflowStripProps {
  activeStage: StageId;
  onSelectStage: (stage: StageId) => void;
}

export const WorkflowStrip: React.FC<WorkflowStripProps> = ({
  activeStage,
  onSelectStage,
}) => {
  const stages: { id: StageId; num: string; label: string }[] = [
    { id: 'geometry', num: '01', label: 'Geometry' },
    { id: 'caseSetup', num: '02', label: 'Case Setup' },
    { id: 'mesh', num: '03', label: 'Mesh' },
    { id: 'boundaries', num: '04', label: 'Boundaries' },
    { id: 'solver', num: '05', label: 'Solver' },
    { id: 'results', num: '06', label: 'Results' },
  ];

  return (
    <nav className="h-9 bg-white border-b border-[#E1E4E8] px-4 flex items-center gap-1 select-none shrink-0 overflow-x-auto">
      {stages.map((st, idx) => {
        const isActive = activeStage === st.id;
        return (
          <React.Fragment key={st.id}>
            <button
              onClick={() => onSelectStage(st.id)}
              className={`relative h-full px-3 flex items-center gap-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'text-[#171A1F] font-semibold'
                  : 'text-[#69717D] hover:text-[#171A1F]'
              }`}
            >
              <span className={`text-[10px] font-mono ${isActive ? 'text-[#2563EB]' : 'text-[#A5ACB5]'}`}>
                {st.num}
              </span>
              <span>{st.label}</span>

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
    </nav>
  );
};
