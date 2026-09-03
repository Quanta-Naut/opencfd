import { API_BASE } from './backend';

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
  return json<{ meta: ProjectMeta; session: any }>(res, 'Open project');
}

export async function saveProjectSession(id: string, session: any): Promise<ProjectMeta> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/session`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  });
  return json<ProjectMeta>(res, 'Save project');
}

export async function renameProject(id: string, name: string): Promise<ProjectMeta> {
  const res = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return json<ProjectMeta>(res, 'Rename project');
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
