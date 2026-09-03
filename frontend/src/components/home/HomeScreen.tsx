import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  Clock,
  Check,
  X,
  Loader2,
  AlertCircle,
  Upload,
  Wind,
  Layers,
  Rocket,
} from 'lucide-react';
import {
  listProjects,
  createProject,
  deleteProject,
  renameProject,
  saveProjectSession,
  ProjectMeta,
  ProjectPreview,
  PreviewShape,
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
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Geometry thumbnail ──────────────────────────────────────────────────────
// Renders each CAD primitive faithfully (a circle stays round, an airfoil keeps
// its curve) inside a light wind-tunnel frame, with flow arrows for external
// cases. Coordinates are CAD-space; SVG y is flipped so"up" is up.

const shapeBounds = (s: PreviewShape): [number, number, number, number] => {
  if (s.kind === 'path') {
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return [s.c[0] - s.r, s.c[1] - s.r, s.c[0] + s.r, s.c[1] + s.r];
};

const GeometryThumb: React.FC<{ preview: ProjectPreview | null; meshed?: boolean }> = ({
  preview,
  meshed,
}) => {
  const entities = preview?.entities ?? [];
  const hasContent = entities.length > 0 || !!preview?.domain;

  if (!preview || !hasContent) {
    return (
      <div className="relative h-44 flex items-center justify-center bg-gradient-to-b from-[#F7F8FA] to-[#EEF0F3] text-[#B7BEC8]">
        <div className="absolute inset-0 opacity-[0.5] [background-image:radial-gradient(circle,#D3D8DF_1px,transparent_1px)] [background-size:14px_14px]" />
        <div className="relative text-center">
          <Pencil className="w-6 h-6 mx-auto mb-1.5" strokeWidth={1.5} />
          <span className="text-[10px] font-medium tracking-wide uppercase">Empty sketch</span>
        </div>
      </div>
    );
  }

  // Frame = union of geometry and (for external flow) the domain box.
  let [minX, minY, maxX, maxY] = preview.bbox;
  const boxes: [number, number, number, number][] = entities.map(shapeBounds);
  if (preview.domain && preview.flow === 'external') boxes.push(preview.domain);
  for (const [bx0, by0, bx1, by1] of boxes) {
    minX = Math.min(minX, bx0);
    minY = Math.min(minY, by0);
    maxX = Math.max(maxX, bx1);
    maxY = Math.max(maxY, by1);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const pad = Math.max(w, h) * 0.12;
  const vx = minX - pad;
  const vy = minY - pad;
  const vw = w + 2 * pad;
  const vh = h + 2 * pad;
  const flipY = (y: number) => minY + maxY - y; // mirror about geometry mid so"up" is up
  const k = Math.max(vw, vh) / 300; // 1px at a ~300u render -> user units (no vector-effect)

  const pathD = (pts: number[][], closed: boolean) => {
    if (pts.length < 2) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${flipY(p[1])}`).join(' ');
    return closed ? `${d} Z` : d;
  };

  const arcD = (s: Extract<PreviewShape, { kind: 'arc' }>) => {
    const [cx, cy] = s.c;
    const p0 = [cx + s.r * Math.cos(s.a0), flipY(cy + s.r * Math.sin(s.a0))];
    const p1 = [cx + s.r * Math.cos(s.a1), flipY(cy + s.r * Math.sin(s.a1))];
    const large = Math.abs(s.a1 - s.a0) % (2 * Math.PI) > Math.PI ? 1 : 0;
    return `M${p0[0]} ${p0[1]} A${s.r} ${s.r} 0 ${large} 0 ${p1[0]} ${p1[1]}`;
  };

  const domRect = preview.domain && preview.flow === 'external' ? preview.domain : null;
  // free-stream arrows down the left edge of the frame
  const arrowRows = [0.28, 0.5, 0.72];
  const ax0 = vx + vw * 0.05;
  const aLen = vw * 0.14;
  const ah = 2.6 * k; // arrowhead half-height

  return (
    <div className="relative h-44 bg-gradient-to-b from-[#F8FAFC] to-[#EDF1F6]">
      <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle,#D5DBE3_1px,transparent_1px)] [background-size:13px_13px]" />
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        preserveAspectRatio="xMidYMid meet"
        className="relative w-full h-full"
      >
        {/* wind-tunnel domain */}
        {domRect && (
          <rect
            x={domRect[0]}
            y={flipY(domRect[3])}
            width={domRect[2] - domRect[0]}
            height={domRect[3] - domRect[1]}
            fill="#FFFFFF"
            fillOpacity={0.45}
            stroke="#AEB8C6"
            strokeWidth={1.1 * k}
            strokeDasharray={`${4 * k} ${3 * k}`}
          />
        )}

        {/* free-stream arrows */}
        {preview.flow === 'external' &&
          arrowRows.map((f, i) => {
            const y = vy + vh - f * vh;
            const tip = ax0 + aLen;
            return (
              <g
                key={i}
                stroke="#93A0B1"
                fill="#93A0B1"
                strokeWidth={1.2 * k}
                strokeLinecap="round"
              >
                <line x1={ax0} y1={y} x2={tip} y2={y} />
                <path
                  d={`M${tip - 2.4 * k} ${y - ah} L${tip + 1.6 * k} ${y} L${tip - 2.4 * k} ${y + ah} Z`}
                  stroke="none"
                />
              </g>
            );
          })}

        {/* geometry */}
        {entities.map((s, i) => {
          const stroke = '#2563EB';
          const fill = 'rgba(37,99,235,0.14)';
          if (s.kind === 'circle') {
            return (
              <circle
                key={i}
                cx={s.c[0]}
                cy={flipY(s.c[1])}
                r={s.r}
                fill={fill}
                stroke={stroke}
                strokeWidth={1.7 * k}
              />
            );
          }
          if (s.kind === 'arc') {
            return (
              <path
                key={i}
                d={arcD(s)}
                fill="none"
                stroke={stroke}
                strokeWidth={1.7 * k}
                strokeLinecap="round"
              />
            );
          }
          return (
            <path
              key={i}
              d={pathD(s.pts, s.closed)}
              fill={s.closed ? fill : 'none'}
              stroke={stroke}
              strokeWidth={1.7 * k}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}
      </svg>

      {meshed && (
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-white/85 backdrop-blur px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#0F766E] border border-[#CBEFE8]">
          <Layers className="w-2.5 h-2.5" />
          Meshed
        </span>
      )}
    </div>
  );
};

// ── Project card ────────────────────────────────────────────────────────────

const ProjectCardView: React.FC<{
  project: ProjectMeta;
  disabled?: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}> = ({ project, disabled, onOpen, onRename, onDelete }) => {
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
  const flow = s.preview?.flow || s.flow;
  const shapeCount = s.preview?.entities?.length ?? s.entityCount ?? 0;

  return (
    <div className="group relative bg-white border border-[#E4E7EC] rounded-xl overflow-hidden hover:border-[#B9CCF3] hover:-translate-y-0.5 transition-all duration-150">
      <button
        onClick={onOpen}
        className="block w-full text-left disabled:cursor-default"
        disabled={editing || disabled}
      >
        <GeometryThumb preview={s.preview ?? null} meshed={s.hasMesh} />
        <div className="p-3.5 border-t border-[#F0F1F4]">
          <div className="flex items-start justify-between gap-3">
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
                className="w-full text-sm font-semibold text-[#171A1F] bg-transparent border-b-2 border-[#2563EB] outline-none"
              />
            ) : (
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#171A1F] truncate">{project.name}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[#8A929E]">
                  {flow === 'internal' ? (
                    <span className="inline-flex items-center gap-1">
                      <Layers className="w-3 h-3" />
                      Internal flow
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Wind className="w-3 h-3" />
                      External flow
                    </span>
                  )}
                  {shapeCount > 0 && (
                    <>
                      <span className="text-[#D0D5DD]">·</span>
                      <span>
                        {shapeCount} {shapeCount === 1 ? 'shape' : 'shapes'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center gap-1 text-[10px] text-[#8A929E] whitespace-nowrap pt-0.5">
              <Clock className="w-3 h-3" />
              <span>{relativeTime(project.modified)}</span>
            </div>
          </div>
        </div>
      </button>

      {!editing && (
        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            title="Rename"
            className="p-1.5 bg-white/95 backdrop-blur border border-[#E4E7EC] rounded-md text-[#69717D] hover:text-[#171A1F] hover:bg-white"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete"
            className="p-1.5 bg-white/95 backdrop-blur border border-[#E4E7EC] rounded-md text-[#69717D] hover:text-[#DC2626] hover:bg-white"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-xs text-[#171A1F] font-medium">
            Delete &ldquo;{project.name}&rdquo;?
          </div>
          <div className="text-[11px] text-[#69717D]">
            This removes the project folder from disk.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 text-xs rounded-md border border-[#E1E4E8] text-[#69717D] hover:bg-[#F5F6F8]"
            >
              <X className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              Cancel
            </button>
            <button
              onClick={() => {
                setConfirmDelete(false);
                onDelete();
              }}
              className="px-3 py-1.5 text-xs rounded-md bg-[#DC2626] text-white hover:bg-[#B91C1C]"
            >
              <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── New-project dialog ──────────────────────────────────────────────────────

const NewProjectDialog: React.FC<{
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}> = ({ busy, onCancel, onCreate }) => {
  const [name, setName] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 0);
  }, []);

  const submit = () => onCreate(name.trim() || 'Untitled project');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0D10]/45 backdrop-blur-[3px] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white border border-[#E4E7EC] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
      >
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#EEF2FF] text-[#2563EB] flex items-center justify-center">
              <Rocket className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 id="new-project-title" className="text-base font-bold text-[#171A1F]">
                New simulation
              </h2>
              <p className="text-xs text-[#69717D] mt-0.5">
                Give it a name — you set up the geometry and flow inside.
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-md text-[#69717D] hover:bg-[#F5F6F8]"
            aria-label="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div>
            <label
              htmlFor="np-name"
              className="block text-[11px] font-semibold uppercase tracking-wide text-[#8A929E] mb-1.5"
            >
              Project name
            </label>
            <input
              id="np-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Two-stage rocket — nose cone study"
              className="w-full px-3 py-2.5 rounded-lg border border-[#E1E4E8] text-sm outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/15 transition"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 bg-[#FAFBFC] border-t border-[#EDEFF3]">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-[#E1E4E8] text-xs font-semibold text-[#69717D] hover:bg-white"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold hover:bg-[#1D4ED8] disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            Create project
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Home screen ─────────────────────────────────────────────────────────────

export const HomeScreen: React.FC<HomeScreenProps> = ({ onOpen, opening, openError }) => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    refresh();
  }, [refresh]);

  const legacySession = useMemo(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, []);

  const handleCreate = async (name: string) => {
    setBusy(true);
    try {
      const meta = await createProject(name);
      setCreating(false);
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

  const empty = !loading && projects.length === 0;

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[#F4F5F7] text-[#171A1F] font-sans">
      <div className="max-w-6xl mx-auto px-6 sm:px-8 py-10">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#171A1F] rounded-xl flex items-center justify-center text-white shrink-0">
            <svg
              className="w-5 h-5"
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
          <div>
            <h1 className="text-xl font-bold tracking-tight">OpenCFD Studio</h1>
            <p className="text-xs text-[#69717D]">
              Simulate airflow over rockets, fins, airfoils — any 2D shape you can sketch.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg px-4 py-2.5 hover:bg-[#1D4ED8] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New project
          </button>
        </div>

        {(error || openError) && (
          <div className="mt-6 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{openError || error}</span>
          </div>
        )}

        {legacySession && projects.length === 0 && !loading && (
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

        {loading ? (
          <div className="mt-16 flex items-center gap-2 text-xs text-[#69717D] justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading projects…
          </div>
        ) : empty ? (
          <div className="mt-10 rounded-2xl border border-dashed border-[#D5DBE3] bg-white/60 p-10 text-center">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#EEF2FF] text-[#2563EB] flex items-center justify-center">
              <Rocket className="w-6 h-6" />
            </div>
            <h2 className="mt-4 text-sm font-bold text-[#171A1F]">Start your first simulation</h2>
            <p className="mt-1.5 text-xs text-[#69717D] max-w-sm mx-auto leading-relaxed">
              Sketch a cross-section, generate a mesh, and watch the flow solve — right on your
              machine. Great for checking a rocket profile before you build it.
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg px-4 py-2.5 hover:bg-[#1D4ED8]"
            >
              <Plus className="w-3.5 h-3.5" />
              New project
            </button>
          </div>
        ) : (
          <>
            <div className="mt-8 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8A929E]">
                {projects.length} {projects.length === 1 ? 'project' : 'projects'}
              </span>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCardView
                  key={p.id}
                  project={p}
                  disabled={opening}
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
              ))}
            </div>
          </>
        )}
      </div>

      {creating && (
        <NewProjectDialog busy={busy} onCancel={() => setCreating(false)} onCreate={handleCreate} />
      )}
    </div>
  );
};

export default HomeScreen;
