import { api } from '../api.js';

export interface ProjectSummary { id: string; title: string; createdAt: string; updatedAt: string; publishedAt: string | null }
export interface Section { content: string; revision: number; updatedAt: string }
export interface Project extends ProjectSummary { sections: Record<string, Section> }
export interface Issue { path: string; message: string }
export interface Report { errors: Issue[]; warnings: Issue[] }
export interface Account { id: string; username: string }

const base = '/creator';
export const creatorApi = {
  me: () => api<Account>(`${base}/me`),
  login: (username: string, password: string) => api<Account>(`${base}/login`, { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => api<Account>(`${base}/register`, { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => api<{ ok: boolean }>(`${base}/logout`, { method: 'POST' }),
  list: () => api<{ projects: ProjectSummary[] }>(`${base}/projects`),
  get: (id: string) => api<Project>(`${base}/projects/${encodeURIComponent(id)}`),
  templates: () => api<{ templates: { id: string; title: string; description: string }[] }>(`${base}/templates`),
  create: (id: string, title: string, templateId?: string) => api<Project>(`${base}/projects`, { method: 'POST', body: JSON.stringify({ id, title, templateId }) }),
  save: (id: string, path: string, content: string, revision: number) => api<Section>(`${base}/projects/${encodeURIComponent(id)}/sections`,
    { method: 'PUT', body: JSON.stringify({ path, content, revision }) }),
  addNpc: (id: string, npcId: string, name: string) => api<Project>(`${base}/projects/${encodeURIComponent(id)}/npcs`,
    { method: 'POST', body: JSON.stringify({ id: npcId, name }) }),
  removeNpc: (id: string, npcId: string) => api<Project>(`${base}/projects/${encodeURIComponent(id)}/npcs/${encodeURIComponent(npcId)}`, { method: 'DELETE' }),
  validate: (id: string) => api<Report>(`${base}/projects/${encodeURIComponent(id)}/validate`, { method: 'POST' }),
  publish: (id: string) => api<{ id: string; title: string; version: string }>(`${base}/projects/${encodeURIComponent(id)}/publish`, { method: 'POST' }),
  delete: (id: string) => api<{ ok: boolean }>(`${base}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
