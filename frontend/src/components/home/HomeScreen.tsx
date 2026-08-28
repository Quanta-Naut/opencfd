import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Clock,
  Box,
  Grid3x3,
  Check,
  X,
  Loader2,
  AlertCircle,
  Upload,
} from 'lucide-react';
import {
  listProjects,
  createProject,
  deleteProject,
  renameProject,
  saveProjectSession,
  ProjectMeta,
  ProjectPreview,
} from '../../utils/projectsApi';
import { SESSION_STORAGE_KEY } from '../../App';

interface HomeScreenProps {
  onOpen: (id: string) => void;
  opening?: boolean;
  openError?: string | null;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
}

const GeometryThumb: React.FC<{ preview: ProjectPreview | null }> = ({ preview }) => {
  if (!preview || preview.points.length < 2) {
    return (
      <div className="h-28 flex items-center justify-center bg-[#F5F6F8] text-[#C4C9D0]">
        <Box className="w-8 h-8" strokeWidth={1.5} />
      </div>
    );
  }
  const [minX, minY, maxX, maxY] = preview.bbox;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const pad = 0.12;
  const pts = preview.points
    .map(([x, y]) => {
      const nx = ((x - minX) / w) * (1 - 2 * pad) + pad;
      const ny = 1 - (((y - minY) / h) * (1 - 2 * pad) + pad);
      return `${(nx * 100).toFixed(2)},${(ny * 100).toFixed(2)}`;
    })
    .join(' ');
  return (
    <div className="h-28 bg-[#F5F6F8]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        <polyline points={pts} fill="rgba(37,99,235,0.08)" stroke="#2563EB" strokeWidth={1.4} strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const ProjectCardView: React.FC<{
  project: ProjectMeta;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}> = ({ project, onOpen, onRename, onDelete }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(project.name);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, project.name]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== project.name) onRename(trimmed);
    setEditing(false);
  };

  const s = project.summary || ({} as ProjectMeta['summary']);

  return (
    <div className="group relative bg-white border border-[#E1E4E8] rounded-xl overflow-hidden shadow-2xs hover:shadow-md hover:border-[#C4D4F5] transition-all">
      <button onClick={onOpen} className="block w-full text-left" disabled={editing}>
        <GeometryThumb preview={s.preview ?? null} />
        <div className="p-3.5">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="w-full text-sm font-semibold text-[#171A1F] bg-transparent border-b-2 border-[#2563EB] outline-none mb-1"
            />
          ) : (
            <div className="text-sm font-semibold text-[#171A1F] truncate mb-1">{project.name}</div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-[#69717D]">
            <Clock className="w-3 h-3" />
            <span>{relativeTime(project.modified)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#F5F6F8] text-[#69717D]">
              <Box className="w-3 h-3" />
              {s.entityCount ?? 0} {(s.entityCount ?? 0) === 1 ? 'body' : 'bodies'}
            </span>
            {s.resolution && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#F5F6F8] text-[#69717D] capitalize">
                {s.resolution}
              </span>
            )}
            {s.hasMesh && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                <Grid3x3 className="w-3 h-3" />
                Meshed
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Hover actions */}
      {!editing && (
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            title="Rename"
            className="p-1.5 bg-white/90 backdrop-blur border border-[#E1E4E8] rounded-md text-[#69717D] hover:text-[#171A1F] hover:bg-white"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete"
            className="p-1.5 bg-white/90 backdrop-blur border border-[#E1E4E8] rounded-md text-[#69717D] hover:text-[#DC2626] hover:bg-white"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-xs text-[#171A1F] font-medium">Delete “{project.name}”?</div>
          <div className="text-[11px] text-[#69717D]">This removes the project folder from disk.</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs rounded-md border border-[#E1E4E8] text-[#69717D] hover:bg-[#F5F6F8]"
            >
              <X className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Cancel
            </button>
            <button
              onClick={() => { setConfirmDelete(false); onDelete(); }}
              className="px-3 py-1.5 text-xs rounded-md bg-[#DC2626] text-white hover:bg-[#B91C1C]"
            >
              <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const HomeScreen: React.FC<HomeScreenProps> = ({ onOpen, opening, openError }) => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await listProjects());
    } catch (err: any) {
      setError(err?.message || 'Could not reach the OpenCFD backend on port 8000.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (creating) setTimeout(() => newInputRef.current?.focus(), 0);
  }, [creating]);

  const legacySession = useMemo(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const handleCreate = async () => {
    const name = newName.trim() || 'Untitled project';
    setBusy(true);
    try {
      const meta = await createProject(name);
      setCreating(false);
      setNewName('');
      onOpen(meta.id);
    } catch (err: any) {
      setError(err?.message || 'Could not create the project.');
    } finally {
      setBusy(false);
    }
  };

  const handleImportLegacy = async () => {
    setBusy(true);
    try {
      const meta = await createProject('Imported session');
      await saveProjectSession(meta.id, legacySession);
      localStorage.removeItem(SESSION_STORAGE_KEY);
      onOpen(meta.id);
    } catch (err: any) {
      setError(err?.message || 'Could not import the previous session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[#F5F6F8] text-[#171A1F] font-sans">
      <div className="max-w-5xl mx-auto px-8 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 bg-[#171A1F] rounded-lg flex items-center justify-center text-white shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14c4-7 14-8 16-8-2 8-10 10-16 8z" />
              <path d="M7 14c3-3 8-4 12-5" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">OpenCFD Studio</h1>
            <p className="text-xs text-[#69717D]">Open a project or start a new one</p>
          </div>
          <a href="/tutorial" className="ml-auto text-xs font-medium text-[#2563EB] border border-[#2563EB]/30 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors">
            How-to guide
          </a>
        </div>

        {(error || openError) && (
          <div className="mt-6 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{openError || error}</span>
          </div>
        )}

        {legacySession && !loading && projects.length === 0 && (
          <div className="mt-6 flex items-center justify-between gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-[#1D4ED8]">
            <span className="flex items-center gap-2">
              <Upload className="w-4 h-4 shrink-0" />
              Found a session from a previous version. Import it as a project?
            </span>
            <button
              onClick={handleImportLegacy}
              disabled={busy}
              className="shrink-0 px-3 py-1.5 rounded-md bg-white border border-blue-200 font-medium hover:bg-blue-50 disabled:opacity-50"
            >
              Import
            </button>
          </div>
        )}

        {/* Grid */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* New project tile */}
          <div className="bg-white border-2 border-dashed border-[#D8DCE1] rounded-xl min-h-[13rem] flex flex-col items-center justify-center p-4 hover:border-[#2563EB] transition-colors">
            {creating ? (
              <div className="w-full space-y-2.5">
                <input
                  ref={newInputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Project name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') { setCreating(false); setNewName(''); }
                  }}
                  className="w-full px-2.5 py-1.5 text-sm bg-[#F5F6F8] border border-[#E1E4E8] rounded-md outline-none focus:border-[#2563EB]"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={busy}
                    className="flex-1 py-1.5 text-xs font-medium rounded-md bg-[#2563EB] text-white hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Create
                  </button>
                  <button
                    onClick={() => { setCreating(false); setNewName(''); }}
                    className="px-3 py-1.5 text-xs rounded-md border border-[#E1E4E8] text-[#69717D] hover:bg-[#F5F6F8]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setCreating(true)} className="flex flex-col items-center gap-2 text-[#69717D] hover:text-[#2563EB] transition-colors">
                <div className="w-11 h-11 rounded-full bg-[#F5F6F8] flex items-center justify-center">
                  <Plus className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium">New project</span>
              </button>
            )}
          </div>

          {/* Existing projects */}
          {loading ? (
            <div className="col-span-full flex items-center gap-2 text-xs text-[#69717D] py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading projects…
            </div>
          ) : (
            projects.map((p) => (
              <ProjectCardView
                key={p.id}
                project={p}
                onOpen={() => !opening && onOpen(p.id)}
                onRename={async (name) => {
                  try {
                    await renameProject(p.id, name);
                    setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, name } : x)));
                  } catch (err: any) {
                    setError(err?.message || 'Rename failed.');
                  }
                }}
                onDelete={async () => {
                  try {
                    await deleteProject(p.id);
                    setProjects((prev) => prev.filter((x) => x.id !== p.id));
                  } catch (err: any) {
                    setError(err?.message || 'Delete failed.');
                  }
                }}
              />
            ))
          )}
        </div>

        {!loading && projects.length === 0 && !legacySession && (
          <p className="mt-6 text-center text-xs text-[#A5ACB5]">No projects yet - create your first one above.</p>
        )}
      </div>
    </div>
  );
};

export default HomeScreen;
