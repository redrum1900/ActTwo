import { randomUUID } from 'node:crypto';
import type { ChatMessage, EventDefinition, GameScript, GameState, NpcDefinition, RuleDiagnostic } from '../../../packages/contracts/src/index.js';
import { deriveNpcSnapshot, evaluateCondition, makeView, settlePlayerEvents } from '../../../packages/engine/src/index.js';
import { appendActivity, settleWorld } from '../../../packages/engine/src/activity-log.js';
import { compressMemory, selectMemory, planCompression } from './memory-policy.js';

export interface CandidateEvent { id: string; intent: string; canApply: boolean; cue?: string; positiveExamples?: readonly string[]; negativeExamples?: readonly string[] }
export interface ChatContext {
  turnId: string;
  script: GameScript;
  state: GameState;
  npc: NpcDefinition;
  text: string;
  history: ChatMessage[];
  candidates: CandidateEvent[];
  appliedEvents: readonly EventDefinition[];
  rejectedIds: string[];
  preTurnPersona?: string;
}
export interface ChatDraft { message: string; proposedEventIds: string[] }
export interface ChatAdapter {
  mode: 'ai' | 'demo';
  settlementTiming?: 'after-reply';
  judge?(context: ChatContext): Promise<string[]>;
  generate(context: ChatContext, onDraft?: (delta: string) => void): Promise<ChatDraft>;
  rewrite(context: ChatContext, draft: string): Promise<string>;
  summarize?(context: ChatContext, messages: ChatMessage[]): Promise<string>;
}

export function deriveChatContext(script: GameScript, state: GameState, npc: NpcDefinition, text: string, turnId: string = randomUUID()): ChatContext {
  const candidates = script.events.filter((event) => event.npc === npc.id && event.trigger === 'semantic' &&
    (!event.once || !state.completedEvents.includes(event.id)) &&
    evaluateCondition(event.candidateWhen, state, script, npc.id)).map((event) => ({
      id: event.id, intent: event.intentDescription ?? event.intent,
      canApply: evaluateCondition(event.when ?? event.condition, state, script, npc.id),
      cue: evaluateCondition(event.when ?? event.condition, state, script, npc.id) ? event.replyCue?.applied : event.replyCue?.blocked,
      positiveExamples: event.positiveExamples, negativeExamples: event.negativeExamples,
    }));
  return { turnId, script, state, npc, text, history: state.chats[npc.id] ?? [], candidates, appliedEvents: [], rejectedIds: [],
    preTurnPersona: deriveNpcSnapshot(script, state, npc.id).persona };
}

export async function runChat(script: GameScript, state: GameState, npcId: string, rawText: string, adapter: ChatAdapter,
  options: { turnId?: string; onDraft?: (delta: string) => void; onStatus?: (text: string) => void } = {}) {
  const text = rawText.trim();
  if (!text || text.length > 2000) throw new Error('请输入 1–2000 字的消息');
  if (!makeView(script, state).npcs.some((npc) => npc.id === npcId)) throw new Error('此 NPC 当前不在场');
  const npc = script.npcs.find((entry) => entry.id === npcId)!;
  const turnId = options.turnId ?? randomUUID();
  if (adapter.summarize && !selectMemory(state.chats[npcId] ?? [], state.memorySegments[npcId] ?? []).document &&
    planCompression(state.chats[npcId] ?? [], state.memorySegments[npcId] ?? [])) {
    options.onStatus?.('正在准备对话记忆…');
    state = await compressMemory(deriveChatContext(script, state, npc, text, turnId), adapter.summarize);
  }
  const base = deriveChatContext(script, state, npc, text, turnId);
  // Adapters with a judge settle first; generate then receives only confirmed facts.
  if (adapter.judge && base.candidates.some((entry) => entry.canApply)) options.onStatus?.('正在理解你的话…');
  const draft = adapter.judge
    ? { message: '', proposedEventIds: await adapter.judge(base) }
    : await adapter.generate(base, options.onDraft);
  if ((!adapter.judge && !draft.message.trim()) || !Array.isArray(draft.proposedEventIds) || draft.proposedEventIds.some((id) => typeof id !== 'string')) throw new Error('AI 返回格式不正确，请重试');
  const validIds = new Set(base.candidates.map((event) => event.id));
  const proposed = [...new Set(draft.proposedEventIds.filter((id) => validIds.has(id)))];
  const settled = settlePlayerEvents(script, state, npcId, proposed);
  const acceptedIds = settled.applied.map((event) => event.id);
  const rejected = [...new Set(draft.proposedEventIds)].flatMap<RuleDiagnostic['rejected'][number]>((id) => {
    if (acceptedIds.includes(id)) return [];
    const candidate = base.candidates.find((entry) => entry.id === id);
    if (!candidate) return [{ id, reason: 'not_candidate' as const }];
    if (!candidate.canApply) return [{ id, reason: 'gate_blocked' as const }];
    const event = script.events.find((entry) => entry.id === id);
    if (event?.exclusiveGroup && settled.applied.some((entry) => entry.exclusiveGroup === event.exclusiveGroup))
      return [{ id, reason: 'exclusive_group' as const }];
    return [{ id, reason: 'effect_rejected' as const }];
  });
  const rejectedIds = rejected.map((entry) => entry.id);
  const world = settleWorld(script, state, settled.state, { kind: 'chat', summary: `与${npc.name}对话`, npcId,
    appliedEventIds: settled.applied.map((event) => event.id) });
  let next = world.state;
  const appliedEvents = [...settled.applied, ...script.events.filter((event) => !state.completedEvents.includes(event.id) &&
    next.completedEvents.includes(event.id) && !settled.applied.some((applied) => applied.id === event.id))];
  const systemApplied = appliedEvents.some((event) => event.trigger === 'automatic');
  const npcDeparted = state.npcLocations?.[npcId] !== undefined && next.npcLocations?.[npcId] !== state.npcLocations[npcId];
  const needsRewrite = adapter.settlementTiming !== 'after-reply' && (rejected.some((entry) => entry.reason !== 'exclusive_group') || systemApplied || npcDeparted ||
    (/(?:给你|交给你|送给你|获得了|进入了|解锁了)/.test(draft.message) && !appliedEvents.length));
  if (!adapter.judge && needsRewrite) options.onStatus?.('正在核对剧情结果…');
  const reply = (adapter.judge
    ? (await adapter.generate({ ...base, state: next, appliedEvents, rejectedIds,
        preTurnPersona: undefined }, options.onDraft)).message
    : needsRewrite ? await adapter.rewrite({ ...base, state: next, appliedEvents, rejectedIds }, draft.message) : draft.message).trim();
  if (!reply) throw new Error('AI 未返回对话内容，请重试');
  const at = new Date().toISOString();
  const playerMessageId = randomUUID();
  next = structuredClone(next);
  next.chats[npcId] = [...base.history, { id: playerMessageId, role: 'player', text, at, turnId: base.turnId },
    { id: randomUUID(), role: 'npc', text: reply, at: new Date().toISOString() }];
  next.turns += 1;
  (next.ruleDiagnostics ??= []).push({ turnId: base.turnId, at, npcId, proposedIds: [...draft.proposedEventIds], acceptedIds,
    rejected, automaticIds: appliedEvents.filter((event) => event.trigger === 'automatic').map((event) => event.id) });
  next = appendActivity(script, next, { kind: 'chat', summary: `与${npc.name}对话`, npcId, chatMessageId: playerMessageId }, world.changes);
  return { state: next, reply, changes: world.changes, appliedEvents: appliedEvents.map(({ id, narration }) => ({ id, narration })) };
}
