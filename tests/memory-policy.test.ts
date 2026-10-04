import test from 'node:test';
import assert from 'node:assert/strict';
import { planCompression, selectMemory, validateMemory, compressMemory } from '../apps/api/src/modules/gameplay/memory-policy.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';
import { deriveChatContext } from '../apps/api/src/modules/gameplay/chat-service.js';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
const script = loadScript('sword-and-screen');
const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'npc' as const : 'player' as const,
  text: `${i}:` + '内容'.repeat(150), at: '2026-01-01' }));
const document = { version: 1, facts: [{ text: '玩家说自己保留截图', sourceMessageIds: ['m0'] }], relationship: [], commitments: [], boundaries: [], openTopics: [] };

test('default compression starts above 5000 characters and preserves complete recent rounds', () => {
  const previous = process.env.AI_MEMORY_TRIGGER_CHARS;
  delete process.env.AI_MEMORY_TRIGGER_CHARS;
  try {
    const history = messages.slice(0, 20).map(m => ({ ...m, text: '字'.repeat(250) }));
    assert.equal(planCompression(history, []), null);
    history[0].text += '字';
    const plan = planCompression(history, []);
    assert.ok(plan);
    assert.equal(plan.messages.at(-1)!.role, 'npc');
    assert.ok(history.length - plan.messages.length >= 8);
  } finally {
    if (previous === undefined) delete process.env.AI_MEMORY_TRIGGER_CHARS;
    else process.env.AI_MEMORY_TRIGGER_CHARS = previous;
  }
});

test('compression keeps whole recent rounds and never deletes unsummarized history', () => {
  const plan = planCompression(messages, []);
  assert.ok(plan);
  assert.equal(plan!.messages[0].id, 'm0');
  assert.equal(plan!.messages.at(-1)!.role, 'npc');
  assert.ok(messages.length - plan!.messages.length >= 8);
  assert.equal(selectMemory(messages, []).raw.length, 30);
  assert.equal(messages.length, 30);
});

test('only covered messages disappear from AI context, and sources are stripped from prompt', () => {
  const segments = [{ throughMessageId: 'm9', summary: '玩家说自己保留截图', document }];
  const selected = selectMemory(messages, segments);
  assert.equal(selected.raw[0].id, 'm10');
  assert.ok(selected.summary.includes('玩家说自己保留截图'));
  assert.equal(selected.summary.includes('m0'), false);
  assert.equal(selectMemory(messages, [{ ...segments[0], throughMessageId: 'missing' }]).raw.length, 30);
});

test('memory schema rejects invented sources, unknown fields and oversized summaries', () => {
  assert.doesNotThrow(() => validateMemory(JSON.stringify(document), ['m0']));
  assert.throws(() => validateMemory(JSON.stringify(document), ['m1']));
  assert.throws(() => validateMemory(JSON.stringify({ ...document, effects: [] }), ['m0']));
  assert.throws(() => validateMemory(JSON.stringify({ ...document, facts: [{ text: '字'.repeat(1600), sourceMessageIds: ['m0'] }] }), ['m0']));
});

test('failed compression preserves all dialogue and waits five NPC turns before retry', async () => {
  const state = createInitialState(script, {});
  state.chats['su-nian'] = structuredClone(messages);
  let calls = 0;
  const summarize = async () => { calls++; throw new Error('offline'); };
  const first = await compressMemory(deriveChatContext(script, state, script.npcs[0], '你好'), summarize);
  assert.equal(calls, 1);
  assert.equal(first.chats['su-nian'].length, 30);
  assert.equal(first.memorySegments['su-nian']?.length ?? 0, 0);
  await compressMemory(deriveChatContext(script, first, script.npcs[0], '你好'), summarize);
  assert.equal(calls, 1);
  for (let i = 0; i < 5; i++) first.chats['su-nian'].push({ id: `p${i}`, role: 'player', text: '继续', at: 'now' }, { id: `n${i}`, role: 'npc', text: '好', at: 'now' });
  await compressMemory(deriveChatContext(script, first, script.npcs[0], '你好'), summarize);
  assert.equal(calls, 2);
  assert.equal(state.memoryCompression, undefined);
});

test('compression appends validated cumulative memory without changing source history', async () => {
  const state = createInitialState(script, {});
  state.chats['su-nian'] = structuredClone(messages);
  const result = await compressMemory(deriveChatContext(script, state, script.npcs[0], '你好'), async () => JSON.stringify(document));
  assert.equal(result.memorySegments['su-nian'].length, 1);
  assert.deepEqual(result.chats, state.chats);
  assert.ok(selectMemory(messages, result.memorySegments['su-nian']).raw.length < 30);
});

test('summary excludes historical numeric error bubbles instead of turning them into facts', async () => {
  const savedFetch = globalThis.fetch;
  let payload: any;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(document) }, finish_reason: 'stop' }] }));
  };
  try {
    const state = createInitialState(script, {});
    const batch = [messages[0], { id: 'bad', role: 'npc' as const, text: '[2025, 2, 22]', at: 'now' }];
    await createChatAdapter({ apiKey: 'test' }).summarize!(deriveChatContext(script, state, script.npcs[0], ''), batch);
    const input = JSON.parse(payload.messages.at(-1).content);
    assert.deepEqual(input.messages.map((m: any) => m.id), ['m0']);
    assert.equal(input.messages[0].speaker, '玩家');
  } finally { globalThis.fetch = savedFetch; }
});
