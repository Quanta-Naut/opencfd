import React, { useState, useRef, useEffect } from 'react';
import { Pencil, LayoutGrid, Settings, Search, Keyboard } from 'lucide-react';
import { PreferencesDialog } from '../settings/PreferencesDialog';
import { Kbd } from '../ui/Kbd';
import { MOD_LABEL } from '../../utils/platform';

interface TopHeaderProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onExitHome?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenShortcuts?: () => void;
  /** Controlled by App so the command palette can open this dialog too. */
  preferencesOpen?: boolean;
  onPreferencesOpenChange?: (open: boolean) => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  projectName,
  onProjectNameChange,
  onExitHome,
  onOpenCommandPalette,
  onOpenShortcuts,
  preferencesOpen,
  onPreferencesOpenChange,
}) => {
  const [internalPrefsOpen, setInternalPrefsOpen] = useState(false);
  const showPreferences = preferencesOpen ?? internalPrefsOpen;
  const setShowPreferences = onPreferencesOpenChange ?? setInternalPrefsOpen;
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
            className="flex items-center gap-1 px-2 py-1 -ml-1 text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] rounded-sm transition-colors shrink-0"
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-xs font-medium">Projects</span>
          </button>
        )}
        <div className="w-7 h-7 bg-[#171A1F] rounded flex items-center justify-center text-white shrink-0">
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 14c4-7 14-8 16-8-2 8-10 10-16 8z" />
            <path d="M7 14c3-3 8-4 12-5" />
          </svg>
        </div>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
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
      <div className="flex items-center gap-1.5">
        {onOpenCommandPalette && (
          <button
            onClick={onOpenCommandPalette}
            title="Search or jump to…"
            className="flex items-center gap-2 h-7 pl-2.5 pr-1.5 border border-[#E1E4E8] bg-[#F5F6F8] hover:bg-white hover:border-[#C4C9D0] rounded-sm text-[#69717D] transition-colors"
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden md:inline text-[12px]">Search or jump to…</span>
            <span className="hidden md:flex items-center gap-0.5 ml-2">
              <Kbd>{MOD_LABEL}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        )}
        {onOpenShortcuts && (
          <button
            onClick={onOpenShortcuts}
            className="p-1.5 text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] rounded transition-colors"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => setShowPreferences(true)}
          className="p-1.5 text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] rounded transition-colors"
          title="Preferences"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>

      <PreferencesDialog
        open={showPreferences}
        onClose={() => setShowPreferences(false)}
      />
    </header>
  );
};
