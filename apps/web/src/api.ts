import type { FieldDefinition } from '@game/contracts';
import type { makeView } from '@game/engine';

export type GameView = ReturnType<typeof makeView>;
export interface CatalogGame {
  id: string; version: string; title: string; subtitle?: string; description?: string; cover?: string; hasAuto: boolean;
}
export interface GameDetail extends CatalogGame {
  playerFields: FieldDefinition[];
  gallery: GalleryEntry[];
  guide?: { intro: string; steps: { id: string; title: string; text: string }[] };
}
export interface GalleryEntry {
  id: string; kind: 'ending' | 'achievement'; name: string; description: string; unlocked: boolean;
}
export interface SessionPayload {
  view: GameView;
  revision: number;
  hints: Record<string, { id: string; text: string }[]>;
  aiMode: 'ai' | 'demo';
  gallery: GalleryEntry[];
  actionText?: string;
  appliedEvents?: { narration?: string }[];
  changes?: { kind: string; text: string; entityId?: string }[];
}
export interface SlotSummary {
  slot: number; label: string; updatedAt: string; playerName: string | string[]; day: number; location: string;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data as T;
}

export function post<T>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export async function postChatStream(path: string, body: unknown, handlers: { onDraft: (delta: string) => void; onStatus?: (text: string) => void }): Promise<SessionPayload> {
  const response = await fetch(`/api${path}`, { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(problem.error ?? `请求失败 (${response.status})`);
  }
  if (!response.body) throw new Error('聊天连接中断，请重试');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let finalSession: SessionPayload | null = null;
  const receive = (block: string) => {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!raw) return;
    const value = JSON.parse(raw) as { delta?: string; text?: string; session?: SessionPayload; message?: string };
    if (event === 'draft' && value.delta) handlers.onDraft(value.delta);
    if (event === 'status' && value.text) handlers.onStatus?.(value.text);
    if (event === 'final' && value.session) finalSession = value.session;
    if (event === 'error') throw new Error(value.message ?? '对话失败，请重试');
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      pending = pending.replace(/\r\n/g, '\n');
      let end = pending.indexOf('\n\n');
      while (end >= 0) {
        receive(pending.slice(0, end));
        pending = pending.slice(end + 2);
        end = pending.indexOf('\n\n');
      }
    }
    pending += decoder.decode();
    if (pending.trim()) receive(pending);
  } finally { reader.releaseLock(); }
  if (!finalSession) throw new Error('聊天连接中断，请重试');
  return finalSession;
}
