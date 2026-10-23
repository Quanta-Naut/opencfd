import { API_BASE } from './backend';
import { decodeMesh, encodeMesh, MESH_MEDIA_TYPE } from './meshCodec';

export type PreviewShape =
  | { kind: 'circle'; c: [number, number]; r: number }
  | { kind: 'arc'; c: [number, number]; r: number; a0: number; a1: number }
  | { kind: 'path'; pts: number[][]; closed: boolean };

export interface ProjectPreview {
  entities: PreviewShape[];
  domain: [number, number, number, number] | null;
  domainShape?: string;
  bbox: [number, number, number, number];
  flow: 'external' | 'internal' | string;
  aoa: number;
}

export interface ProjectSummary {
  geometryName: string;
  entityCount: number;
  hasMesh: boolean;
  resolution: string;
  flow?: 'external' | 'internal' | string;
  preview: ProjectPreview | null;
}

export interface ProjectMeta {
  id: string;
  name: string;
  created: string;
  modified: string;
  schemaVersion: number;
  summary: ProjectSummary;
}

async function json<T>(res: Response, action: string): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `${action} failed (${res.status})`);
  }
  const data = await res.json();
  return data.data as T;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await fetch(`${API_BASE}/api/projects`);
  return json<ProjectMeta[]>(res, 'Load projects');
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return json<ProjectMeta>(res, 'Create project');
}

export async function getProject(id: string): Promise<{ meta: ProjectMeta; session: any }> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`);
  const project = await json<{ meta: ProjectMeta; session: any; binaryBlobs?: ProjectBlobKey[] }>(
    res,
    'Open project',
  );
  // The mesh is stored in the binary container and fetched on its own rather
  // than inlined in the session JSON (see project_service).
  for (const key of project.binaryBlobs ?? []) {
    project.session[key] = await getProjectBlob(id, key);
  }
  return { meta: project.meta, session: project.session };
}

async function getProjectBlob(id: string, key: ProjectBlobKey): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/blobs/${key}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Load ${key} failed (${res.status})`);
  if ((res.headers.get('content-type') ?? '').includes(MESH_MEDIA_TYPE)) {
    return decodeMesh(await res.arrayBuffer());
  }
  return res.json();
}

export async function saveProjectSession(id: string, session: any): Promise<ProjectMeta> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/session`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  });
  return json<ProjectMeta>(res, 'Save project');
}

/** Session keys stored server-side in their own file (see project_service). */
export type ProjectBlobKey = 'meshData' | 'fieldData';

/** Write one heavy session value: the mesh in the binary container, the
 * field as a raw JSON body. Stored verbatim either way. */
export async function saveProjectBlob(
  id: string,
  key: ProjectBlobKey,
  value: unknown,
): Promise<void> {
  const binary = key === 'meshData' && value != null;
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/blobs/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': binary ? MESH_MEDIA_TYPE : 'application/json' },
    body: binary ? encodeMesh(value) : JSON.stringify(value ?? null),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Save ${key} failed (${res.status})`);
  }
}

export async function renameProject(id: string, name: string): Promise<ProjectMeta> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return json<ProjectMeta>(res, 'Rename project');
}

export async function duplicateProject(id: string): Promise<ProjectMeta> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
  });
  return json<ProjectMeta>(res, 'Duplicate project');
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Delete project failed (${res.status})`);
  }
}
