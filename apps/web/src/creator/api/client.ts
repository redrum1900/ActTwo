import { api } from '../../app/api.js';

export interface ReviewSummary { id: string; projectId: string; projectTitle: string; authorId: string; authorUsername: string;
  contentHash: string; version: string; status: 'pending' | 'approved' | 'rejected'; submittedAt: string;
  reviewedAt: string | null; reviewerId: string | null; rejectionReason: string | null }
export interface ReviewDetail extends ReviewSummary { script: Record<string, unknown> }
export interface ProjectSummary { id: string; title: string; subtitle?: string; createdAt: string; updatedAt: string; publishedAt: string | null; review: ReviewSummary | null }
export interface Section { content: string; revision: number; updatedAt: string }
export interface Project extends ProjectSummary { sections: Record<string, Section> }
export interface Issue { path: string; message: string }
export interface Report { errors: Issue[]; warnings: Issue[] }
export interface Account { id: string; username: string; role: 'author' | 'admin' }
export interface ImportJob { projectId: string; jobId: string; status: 'running' | 'ready' | 'failed' | 'cancelled' | 'applied';
  progress: string; error: string | null; report: { inferences: string[]; issues: Issue[] } | null;
  parts: Record<string, string> | null }
export interface PlaytestSummary { id: string; projectId: string; createdAt: string; playedAt: string | null;
  started: boolean; scriptHash: string }

const base = '/creator';
export const creatorApi = {
  me: () => api<Account>(`${base}/me`),
  login: (username: string, password: string) => api<Account>(`${base}/login`, { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => api<Account>(`${base}/register`, { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => api<{ ok: boolean }>(`${base}/logout`, { method: 'POST' }),
  list: () => api<{ projects: ProjectSummary[] }>(`${base}/projects`),
  get: (id: string) => api<Project>(`${base}/projects/${encodeURIComponent(id)}`),
  templates: () => api<{ templates: { id: string; title: string; description: string }[] }>(`${base}/templates`),
  create: (title: string, templateId?: string) => api<Project>(`${base}/projects`, { method: 'POST', body: JSON.stringify({ title, templateId }) }),
  save: (id: string, path: string, content: string, revision: number) => api<Section>(`${base}/projects/${encodeURIComponent(id)}/sections`,
    { method: 'PUT', body: JSON.stringify({ path, content, revision }) }),
  migrateStats: (id: string, revisions: Record<string, number>) => api<Project>(`${base}/projects/${encodeURIComponent(id)}/migrate-stats`,
    { method: 'POST', body: JSON.stringify({ revisions }) }),
  uploadImport: async (id: string, file: File | Blob, fileName: string): Promise<{ projectId: string; jobId: string }> => {
    const response = await fetch(`/api${base}/projects/${encodeURIComponent(id)}/import-jobs`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream',
        'X-Import-Filename': encodeURIComponent(fileName) }, body: file });
    const data = await response.json() as { projectId?: string; jobId?: string; error?: string };
    if (!response.ok || !data.jobId || !data.projectId) throw new Error(data.error ?? `导入上传失败 (${response.status})`);
    return { projectId: data.projectId, jobId: data.jobId };
  },
  importJob: (id: string, jobId: string) => api<ImportJob>(`${base}/projects/${encodeURIComponent(id)}/import-jobs/${encodeURIComponent(jobId)}`),
  applyImport: (id: string, jobId: string) => api<{ projectId: string; project: Project }>(
    `${base}/projects/${encodeURIComponent(id)}/import-jobs/${encodeURIComponent(jobId)}/apply`, { method: 'POST' }),
  cancelImport: (id: string, jobId: string) => api<{ ok: boolean }>(
    `${base}/projects/${encodeURIComponent(id)}/import-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),
  listPlaytests: (id: string) => api<{ playtests: PlaytestSummary[] }>(`${base}/projects/${encodeURIComponent(id)}/playtests`),
  createPlaytest: (id: string) => api<PlaytestSummary>(`${base}/projects/${encodeURIComponent(id)}/playtests`, { method: 'POST' }),
  deletePlaytest: (id: string, playtestId: string) => api<{ ok: boolean }>(
    `${base}/projects/${encodeURIComponent(id)}/playtests/${encodeURIComponent(playtestId)}`, { method: 'DELETE' }),
  uploadCover: async (id: string, file: File): Promise<{ cover: string }> => {
    const response = await fetch(`/api${base}/projects/${encodeURIComponent(id)}/cover`, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': file.type }, body: file });
    const data = await response.json() as { cover?: string; error?: string };
    if (!response.ok || !data.cover) throw new Error(data.error ?? `封面上传失败 (${response.status})`);
    return { cover: data.cover };
  },
  discardCover: (id: string, cover: string) => api<{ ok: boolean }>(`${base}/projects/${encodeURIComponent(id)}/covers/${encodeURIComponent(cover.split('/').at(-1) ?? '')}`,
    { method: 'DELETE' }),
  uploadItemImage: async (id: string, file: File): Promise<{ image: string }> => {
    const response = await fetch(`/api${base}/projects/${encodeURIComponent(id)}/item-image`, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': file.type }, body: file });
    const data = await response.json() as { image?: string; error?: string };
    if (!response.ok || !data.image) throw new Error(data.error ?? `道具图片上传失败 (${response.status})`);
    return { image: data.image };
  },
  discardItemImage: (id: string, image: string) => api<{ ok: boolean }>(`${base}/projects/${encodeURIComponent(id)}/item-images/${encodeURIComponent(image.split('/').at(-1) ?? '')}`,
    { method: 'DELETE' }),
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
