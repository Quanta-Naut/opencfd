import React, { useEffect, useRef, useState } from 'react';
import {
  FileCode,
  Keyboard,
  LayoutGrid,
  Lock,
  Pencil,
  Ruler,
  Search,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { PreferencesDialog } from '../settings/PreferencesDialog';
import { Kbd } from '../ui/Kbd';
import { Tooltip } from '../ui/Tooltip';
import { MOD_LABEL } from '../../utils/platform';
import { useBackendHealth } from '../../hooks/useBackendHealth';
import { STAGES, type StageId, type StageStatus } from './stages';

interface AppBarProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  onExitHome?: () => void;
  activeStage: StageId;
  onSelectStage: (stage: StageId) => void;
  stageStatus?: Partial<Record<StageId, StageStatus>>;
  onOpenCaseFiles?: () => void;
  caseFilesCount?: number;
  onOpenCommandPalette?: () => void;
  onOpenShortcuts?: () => void;
  /** Measure tool toggle; undefined hides the button (no canvas on this stage). */
  measureOn?: boolean;
  onToggleMeasure?: () => void;
  /** Controlled by App so the command palette can open this dialog too. */
  preferencesOpen?: boolean;
  onPreferencesOpenChange?: (open: boolean) => void;
}

const iconBtn =
  'h-7 w-7 inline-flex items-center justify-center rounded text-fg-2 hover:text-fg hover:bg-surface-3 transition-colors';

/**
 * The single top bar: project identity, the five workflow stages, and global
 * actions. One 44px row replaces the old header, stage strip and status bar,
 * so the viewport gets that height back.
 */
export const AppBar: React.FC<AppBarProps> = ({
  projectName,
  onProjectNameChange,
  onExitHome,
  activeStage,
  onSelectStage,
  stageStatus,
  onOpenCaseFiles,
  caseFilesCount = 0,
  onOpenCommandPalette,
  onOpenShortcuts,
  measureOn,
  onToggleMeasure,
  preferencesOpen,
  onPreferencesOpenChange,
}) => {
  const [internalPrefsOpen, setInternalPrefsOpen] = useState(false);
  const showPreferences = preferencesOpen ?? internalPrefsOpen;
  const setShowPreferences = onPreferencesOpenChange ?? setInternalPrefsOpen;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);
  const inputRef = useRef<HTMLInputElement>(null);
  const health = useBackendHealth();

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
    <header className="h-11 shrink-0 bg-app border-b border-line pl-2 pr-2 flex items-center gap-3 select-none z-30">
      {/* Identity */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        {onExitHome && (
          <Tooltip content="Back to projects">
            <button onClick={onExitHome} className={iconBtn} aria-label="Back to projects">
              <LayoutGrid className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        <div className="w-6 h-6 rounded bg-inverse text-on-inverse flex items-center justify-center shrink-0">
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
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
            className="h-7 w-48 px-1.5 text-[13px] font-semibold text-fg bg-surface border border-accent rounded outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            title="Rename project"
            className="group h-7 px-1.5 -mx-0.5 flex items-center gap-1.5 rounded hover:bg-surface-3 min-w-0 max-w-[220px]"
          >
            <span className="text-[13px] font-semibold text-fg truncate">
              {projectName || 'Untitled project'}
            </span>
            <Pencil className="w-3 h-3 text-fg-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
      </div>

      <span className="h-5 w-px bg-line shrink-0" />

      {/* Workflow stages */}
      <nav className="flex items-center gap-0.5 min-w-0 overflow-x-auto" aria-label="Workflow">
        {STAGES.map((st, idx) => {
          const active = activeStage === st.id;
          const status = stageStatus?.[st.id];
          const locked = !!status?.locked;
          return (
            <Tooltip
              key={st.id}
              content={
                <span className="flex items-center gap-2">
                  <span>{locked ? status?.reason || st.label : st.label}</span>
                  <Kbd>{idx + 1}</Kbd>
                </span>
              }
            >
              <button
                onClick={() => onSelectStage(st.id)}
                aria-current={active ? 'page' : undefined}
                className={clsx(
                  'h-7 px-2.5 inline-flex items-center gap-1.5 rounded text-[12px] font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-surface-3 text-fg'
                    : locked
                      ? 'text-fg-4 hover:text-fg-2 hover:bg-surface-2'
                      : 'text-fg-2 hover:text-fg hover:bg-surface-2',
                )}
              >
                <span
                  className={clsx(
                    'text-[10px] font-mono tabular-nums',
                    active ? 'text-accent' : 'text-fg-4',
                  )}
                >
                  {idx + 1}
                </span>
                {st.label}
                {locked && <Lock className="w-3 h-3 text-fg-5" />}
              </button>
            </Tooltip>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Global actions */}
      <div className="flex items-center gap-1 shrink-0">
        {onOpenCaseFiles && (
          <button
            onClick={onOpenCaseFiles}
            disabled={caseFilesCount === 0}
            title={
              caseFilesCount === 0
                ? 'Case files appear once the case is set up'
                : 'Browse the OpenFOAM case dictionaries'
            }
            className="h-7 inline-flex items-center gap-1.5 rounded px-2 text-[12px] font-medium text-fg-2 hover:text-fg hover:bg-surface-3 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">OpenFOAM Dicts</span>
          </button>
        )}
        {onOpenCommandPalette && (
          <Tooltip
            content={
              <span className="flex items-center gap-2">
                Search commands <Kbd>{MOD_LABEL}</Kbd>
                <Kbd>K</Kbd>
              </span>
            }
          >
            <button onClick={onOpenCommandPalette} className={iconBtn} aria-label="Search commands">
              <Search className="w-4 h-4" />
            </button>
          </Tooltip>
        )}

        <span className="h-5 w-px bg-line mx-1" />

        <Tooltip
          content={
            health === 'online'
              ? 'Backend connected'
              : health === 'offline'
                ? 'Backend not reachable - meshing and solving are unavailable'
                : 'Connecting to the backend'
          }
        >
          <span
            className={clsx(
              'h-7 px-1.5 inline-flex items-center gap-1.5 rounded text-[11px] font-medium',
              health === 'offline' ? 'text-danger' : 'text-fg-3',
            )}
            role="status"
          >
            <span
              className={clsx(
                'w-1.5 h-1.5 rounded-full',
                health === 'online' && 'bg-success',
                health === 'offline' && 'bg-danger',
                health === 'checking' && 'bg-warning',
              )}
            />
            {health === 'offline' && 'Offline'}
          </span>
        </Tooltip>

        {onOpenShortcuts && (
          <Tooltip
            content={
              <span className="flex items-center gap-2">
                Keyboard shortcuts <Kbd>?</Kbd>
              </span>
            }
          >
            <button onClick={onOpenShortcuts} className={iconBtn} aria-label="Keyboard shortcuts">
              <Keyboard className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        {onToggleMeasure && (
          <Tooltip content="Measure distances (D)">
            <button
              onClick={onToggleMeasure}
              aria-label="Measure"
              aria-pressed={!!measureOn}
              className={clsx(
                'h-7 w-7 inline-flex items-center justify-center rounded transition-colors',
                measureOn
                  ? 'bg-accent-soft text-accent-fg'
                  : 'text-fg-2 hover:text-fg hover:bg-surface-3',
              )}
            >
              <Ruler className="w-4 h-4" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Preferences">
          <button
            onClick={() => setShowPreferences(true)}
            className={iconBtn}
            aria-label="Preferences"
          >
            <Settings className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      <PreferencesDialog open={showPreferences} onClose={() => setShowPreferences(false)} />
    </header>
  );
};
