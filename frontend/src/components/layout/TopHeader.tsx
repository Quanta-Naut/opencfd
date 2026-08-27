import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, Save, MoreVertical, RefreshCw, Layers, Database, Pencil } from 'lucide-react';

interface TopHeaderProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  executionStatus: 'idle' | 'meshing' | 'running' | 'completed' | 'error';
  onRunSolver: () => void;
  onStopSolver: () => void;
  onGenerateMesh: () => void;
  isMeshing: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  projectName,
  onProjectNameChange,
  executionStatus,
  onRunSolver,
  onStopSolver,
  onGenerateMesh,
  isMeshing,
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

  const getStatusBadge = () => {
    switch (executionStatus) {
      case 'running':
        return { text: 'RUNNING', dot: 'bg-blue-600 animate-pulse', textColor: 'text-blue-700' };
      case 'meshing':
        return { text: 'MESHING', dot: 'bg-amber-500 animate-pulse', textColor: 'text-amber-700' };
      case 'completed':
        return { text: 'CONVERGED', dot: 'bg-emerald-600', textColor: 'text-emerald-700' };
      case 'error':
        return { text: 'ERROR', dot: 'bg-red-600', textColor: 'text-red-700' };
      default:
        return { text: 'READY', dot: 'bg-emerald-600', textColor: 'text-emerald-700' };
    }
  };

  const status = getStatusBadge();

  return (
    <header className="h-[52px] bg-white border-b border-[#E1E4E8] px-4 flex items-center justify-between select-none z-30 shrink-0">
      {/* Left: Logo + Editable Project Name */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 bg-[#171A1F] rounded-md flex items-center justify-center text-white shadow-xs shrink-0">
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

      {/* Right: Status + Primary Actions */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F5F6F8] border border-[#E1E4E8] text-[11px] font-mono font-semibold">
          <span className={`w-2 h-2 rounded-full ${status.dot}`} />
          <span className={status.textColor}>{status.text}</span>
        </div>

        <button
          onClick={onGenerateMesh}
          disabled={isMeshing || executionStatus === 'running'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-[#171A1F] bg-white hover:bg-[#F5F6F8] border border-[#E1E4E8] transition-colors disabled:opacity-40"
          title="Generate Gmsh Mesh"
        >
          <Layers className="w-3.5 h-3.5 text-[#69717D]" />
          <span>{isMeshing ? 'Meshing...' : 'Mesh'}</span>
        </button>

        {executionStatus === 'running' ? (
          <button
            onClick={onStopSolver}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] transition-colors shadow-xs"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>ABORT</span>
          </button>
        ) : (
          <button
            onClick={onRunSolver}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors shadow-xs"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>RUN</span>
          </button>
        )}

        <div className="w-px h-4 bg-[#E1E4E8]" />

        <button
          className="p-1.5 text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] rounded-md transition-colors"
          title="Save OpenFOAM Case"
        >
          <Save className="w-4 h-4" />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 text-[#69717D] hover:text-[#171A1F] hover:bg-[#F5F6F8] rounded-md transition-colors"
            title="Options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 mt-1 w-48 bg-white border border-[#E1E4E8] rounded-lg shadow-lg py-1 z-50 text-xs text-[#171A1F]">
              <button
                onClick={() => { onGenerateMesh(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#F5F6F8] flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#69717D]" />
                <span>Re-generate All Mesh</span>
              </button>
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
