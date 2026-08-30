import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Clock,
  FolderOpen,
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
  const days = Math.floor(secs / 86400);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

const GeometryThumb: React.FC<{ preview: ProjectPreview | null }> = ({ preview }) => {
  if (!preview || preview.points.length < 2) {
    return (
      <div className="h-52 flex items-center justify-center bg-[#F5F6F8] text-[#C4C9D0]">
        <div className="text-center"><FolderOpen className="w-8 h-8 mx-auto mb-2" strokeWidth={1.5} /><span className="text-[10px]">No geometry yet</span></div>
      </div>
    );
  }
  const [minX, minY, maxX, maxY] = preview.bbox;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  // Keep the original CAD aspect ratio. Normalising x and y independently into
  // a square viewBox makes every rectangle look square in the card.
  const padX = w * 0.12;
  const padY = h * 0.12;
  const pts = preview.points
    .map(([x, y]) => {
      // SVG's y axis points down, so mirror y around the CAD bounding box.
      return `${x.toFixed(5)},${(minY + maxY - y).toFixed(5)}`;
    })
    .join(' ');
  return (
    <div className="h-52 bg-[#F5F6F8] p-3">
      <svg viewBox={`${(minX - padX).toFixed(5)} ${(minY - padY).toFixed(5)} ${(w + 2 * padX).toFixed(5)} ${(h + 2 * padY).toFixed(5)}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        {/* CAD thumbnails represent closed profiles (rectangles, airfoils, etc.).
            polygon closes the final corner; polyline left that edge invisible. */}
        <polygon points={pts} fill="rgba(37,99,235,0.08)" stroke="#2563EB" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
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
          <div className="flex items-center justify-between gap-3">
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
            <div className="text-sm font-semibold text-[#171A1F] truncate">{project.name}</div>
          )}
          <div className="flex items-center gap-1 text-[10px] text-[#69717D] whitespace-nowrap">
            <Clock className="w-3 h-3" /><span>{relativeTime(project.modified)}</span>
          </div>
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
  const [author, setAuthor] = useState('');
  const [saveLocation, setSaveLocation] = useState('Default OpenCFD projects folder');
  const folderInputRef = useRef<HTMLInputElement>(null);
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
      setAuthor('');
      setSaveLocation('Default OpenCFD projects folder');
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
          <button onClick={() => setCreating(true)} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg px-3.5 py-2 hover:bg-[#1D4ED8] transition-colors"><Plus className="w-3.5 h-3.5" />New project</button>
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

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171A1F]/35 backdrop-blur-[2px] p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setCreating(false); }}>
          <div className="w-full max-w-md rounded-2xl bg-white border border-[#E1E4E8] shadow-xl p-6" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
            <div className="flex items-start justify-between mb-6"><div><h2 id="new-project-title" className="text-lg font-bold">New project</h2><p className="text-xs text-[#69717D] mt-1">Set up the project workspace.</p></div><button onClick={() => setCreating(false)} className="p-1.5 rounded-md text-[#69717D] hover:bg-[#F5F6F8]" aria-label="Cancel"><X className="w-4 h-4" /></button></div>
            <div className="space-y-4">
              <label className="block text-xs font-medium text-[#69717D]">Project title<input ref={newInputRef} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. NACA 0012 study" className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[#E1E4E8] outline-none focus:border-[#2563EB]" /></label>
              <label className="block text-xs font-medium text-[#69717D]">Author <span className="font-normal text-[#A5ACB5]">(optional)</span><input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[#E1E4E8] outline-none focus:border-[#2563EB]" /></label>
              <label className="block text-xs font-medium text-[#69717D]">Save location<input value={saveLocation} readOnly className="mt-1.5 w-full px-3 py-2 rounded-lg border border-[#E1E4E8] bg-[#F5F6F8] text-[#69717D]" /><button type="button" onClick={() => folderInputRef.current?.click()} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"><FolderOpen className="w-3.5 h-3.5" />Browse…</button><input ref={folderInputRef} type="file" className="hidden" {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { const file = e.target.files?.[0]; if (file) setSaveLocation(file.webkitRelativePath?.split('/')[0] || 'Selected folder'); }} /></label>
            </div>
            <div className="flex justify-end gap-2 mt-7"><button onClick={() => { setCreating(false); setNewName(''); }} className="px-4 py-2 rounded-lg border border-[#E1E4E8] text-xs font-medium text-[#69717D] hover:bg-[#F5F6F8]">Cancel</button><button onClick={handleCreate} disabled={busy} className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1D4ED8] disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Create project</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomeScreen;
