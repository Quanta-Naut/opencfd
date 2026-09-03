import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical, Database, Pencil, LayoutGrid } from 'lucide-react';

interface TopHeaderProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onExitHome?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  projectName,
  onProjectNameChange,
  onExitHome,
}) => {
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(projectName);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, projectName]);

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed) onProjectNameChange(trimmed);
    setEditing(false);
  };

  return (
    <header className="h-[52px] bg-white border-b border-[#E1E4E8] px-4 flex items-center justify-between select-none z-30 shrink-0">
      {/* Left: Logo + Editable Project Name */}
      <div className="flex items-center gap-3 min-w-0">
        {onExitHome && (
          <button
            onClick={onExitHome}
            title="Back to projects"
            className="flex items-center gap-1 px-2 py-1 -ml-1 text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] rounded-md transition-colors shrink-0"
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-xs font-medium">Projects</span>
          </button>
        )}
        <div className="w-7 h-7 bg-[#171A1F] rounded-md flex items-center justify-center text-white shrink-0">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 14c4-7 14-8 16-8-2 8-10 10-16 8z" />
            <path d="M7 14c3-3 8-4 12-5" />
          </svg>
        </div>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="text-[15px] font-bold text-[#171A1F] tracking-tight bg-transparent border-b-2 border-[#2563EB] outline-none w-56 min-w-[120px] max-w-xs"
            style={{ fontFamily: 'inherit' }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 group cursor-text min-w-0"
            title="Click to rename project"
          >
            <span className="font-bold text-[#171A1F] text-[15px] tracking-tight truncate max-w-xs">
              {projectName || 'Untitled Project'}
            </span>
            <Pencil className="w-3 h-3 text-[#A5ACB5] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
      </div>

      {/* Right: Project actions. Everything autosaves to the project on disk, so
          there is no manual Save; the how-to guide lives on the home screen. */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] rounded-md transition-colors"
            title="Options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-white border border-[#E1E4E8] rounded-lg py-1 z-50 text-xs text-[#171A1F]">
              <button
                onClick={() => setShowMenu(false)}
                className="w-full text-left px-3 py-1.5 hover:bg-[#F5F6F8] flex items-center gap-2"
              >
                <Database className="w-3.5 h-3.5 text-[#69717D]" />
                <span>Export OpenFOAM Case</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
