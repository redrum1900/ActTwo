import type { ChatMessage, MemoryDocument, MemorySegment } from '@game/contracts';
import type { ChatContext } from './chat-service.js';

const categories = ['facts', 'relationship', 'commitments', 'boundaries', 'openTopics'] as const;
const budget = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};
export const memoryText = (document: MemoryDocument) => JSON.stringify(Object.fromEntries(
  categories.map(key => [key, document[key].map(entry => entry.text)])));

export function selectMemory(history: ChatMessage[], segments: MemorySegment[]) {
  const latest = [...segments].reverse().find(segment => segment.document?.version === 1 && history.some(m => m.id === segment.throughMessageId));
  const through = latest ? history.findIndex(m => m.id === latest.throughMessageId) : -1;
  return { raw: history.slice(through + 1), summary: latest?.document ? memoryText(latest.document) : '', document: latest?.document };
}

function rounds(messages: ChatMessage[]) {
  const groups: ChatMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'player' || !groups.length) groups.push([]);
    groups.at(-1)!.push(message);
  }
  return groups;
}

export function planCompression(history: ChatMessage[], segments: MemorySegment[]) {
  const selected = selectMemory(history, segments);
  if (selected.summary.length + selected.raw.reduce((sum, m) => sum + m.text.length, 0) <= budget('AI_MEMORY_TRIGGER_CHARS', 5000)) return null;
  const groups = rounds(selected.raw);
  let keep = 0, chars = 0;
  while (keep < groups.length && (keep < 4 || chars < budget('AI_MEMORY_RECENT_CHARS', 3500))) {
    chars += groups[groups.length - 1 - keep].reduce((sum, m) => sum + m.text.length, 0);
    keep++;
  }
  const older = groups.slice(0, groups.length - keep);
  const messages: ChatMessage[] = [];
  let used = 0;
  for (const group of older) {
    const size = group.reduce((sum, m) => sum + m.text.length, 0);
    if (messages.length && used + size > budget('AI_MEMORY_BATCH_CHARS', 8000)) break;
    messages.push(...group); used += size;
  }
  return messages.length ? { messages, previous: selected.document } : null;
}

export function validateMemory(raw: string, sourceIds: string[]): MemoryDocument {
  const parsed = JSON.parse(raw);
  const keys = ['version', ...categories];
  if (!parsed || parsed.version !== 1 || Object.keys(parsed).some(key => !keys.includes(key))) throw new Error('摘要结构不正确');
  const allowed = new Set(sourceIds);
  let total = 0;
  for (const key of categories) {
    if (!Array.isArray(parsed[key]) || parsed[key].length > 30) throw new Error('摘要分类不正确');
    for (const entry of parsed[key]) {
      if (!entry || Object.keys(entry).some(k => !['text', 'sourceMessageIds'].includes(k)) ||
        typeof entry.text !== 'string' || !entry.text.trim() || !Array.isArray(entry.sourceMessageIds) || !entry.sourceMessageIds.length ||
        entry.sourceMessageIds.some((id: unknown) => typeof id !== 'string' || !allowed.has(id))) throw new Error('摘要来源不正确');
      total += entry.text.length;
    }
  }
  if (total > 1500) throw new Error('摘要超出长度限制');
  return parsed as MemoryDocument;
}

export async function compressMemory(context: ChatContext, summarize: (context: ChatContext, messages: ChatMessage[]) => Promise<string>) {
  const { state, npc } = context;
  const history = state.chats[npc.id] ?? [];
  const count = history.filter(m => m.role === 'player').length;
  if ((state.memoryCompression?.[npc.id]?.retryAfterTurn ?? 0) > count) return state;
  const segments = state.memorySegments[npc.id] ?? [];
  const plan = planCompression(history, segments);
  if (!plan) return state;
  const next = structuredClone(state);
  try {
    const sources = [...plan.messages.map(m => m.id), ...categories.flatMap(key => plan.previous?.[key].flatMap(f => f.sourceMessageIds) ?? [])];
    const document = validateMemory(await summarize(context, plan.messages), sources);
    next.memorySegments[npc.id] = [...segments, { throughMessageId: plan.messages.at(-1)!.id, summary: memoryText(document), document }];
    (next.memoryCompression ??= {})[npc.id] = { retryAfterTurn: 0 };
  } catch {
    (next.memoryCompression ??= {})[npc.id] = { retryAfterTurn: count + 5, lastError: '摘要生成或校验失败' };
  }
  return next;
}
