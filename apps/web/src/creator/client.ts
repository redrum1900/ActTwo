import { api } from '../api.js';

export interface ReviewSummary { id: string; projectId: string; projectTitle: string; authorId: string; authorUsername: string;
  contentHash: string; version: string; status: 'pending' | 'approved' | 'rejected'; submittedAt: string;
  reviewedAt: string | null; reviewerId: string | null; rejectionReason: string | null }
export interface ReviewDetail extends ReviewSummary { script: Record<string, unknown> }
export interface ProjectSummary { id: string; title: string; createdAt: string; updatedAt: string; publishedAt: string | null; review: ReviewSummary | null }
export interface Section { content: string; revision: number; updatedAt: string }
export interface Project extends ProjectSummary { sections: Record<string, Section> }
export interface Issue { path: string; message: string }
export interface Report { errors: Issue[]; warnings: Issue[] }
export interface Account { id: string; username: string; role: 'author' | 'admin' }

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
  submit: (id: string) => api<ReviewSummary>(`${base}/projects/${encodeURIComponent(id)}/submit`, { method: 'POST' }),
  reviews: () => api<{ reviews: ReviewSummary[] }>(`${base}/reviews`),
  review: (id: string) => api<ReviewDetail>(`${base}/reviews/${encodeURIComponent(id)}`),
  approve: (id: string) => api<ReviewDetail>(`${base}/reviews/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
  reject: (id: string, reason: string) => api<ReviewDetail>(`${base}/reviews/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify({ reason }) }),
  delete: (id: string) => api<{ ok: boolean }>(`${base}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
