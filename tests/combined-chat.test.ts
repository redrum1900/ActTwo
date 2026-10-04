import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombinedChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { runChat } from '../apps/api/src/modules/gameplay/chat-service.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';
const script = loadScript('sword-and-screen');

test('combined stream settles a milestone after the old-scene reply without another request', async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  const state = createInitialState(script, {});
  state.npcIndicators!['su-nian'].affection.value = 29;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    assert.equal(body.response_format.type, 'json_object');
    const parts = ['{"message":"我', '在电脑前听着呢。","proposedEventIds":["close-talk"]}'];
    return new Response(parts.map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const streamed: string[] = [];
    const result = await runChat(script, state, 'su-nian', '我很在意你的感受', createCombinedChatAdapter({ apiKey: 'test' }),
      { onDraft: text => streamed.push(text) });
    assert.equal(calls, 1);
    assert.equal(result.reply, '我在电脑前听着呢。');
    assert.equal(streamed.join(''), result.reply);
    assert.equal(result.state.npcLocations!['su-nian'], 'restaurant');
    assert.equal(result.state.npcIndicators!['su-nian'].affection.value, 31);
    assert.equal(state.npcIndicators!['su-nian'].affection.value, 29);
  } finally { globalThis.fetch = saved; }
});

test('combined invalid or incomplete envelopes fail without repair calls or state writes', async () => {
  const saved = globalThis.fetch;
  try {
    for (const raw of ['你好。', '{"message":"你好。"}', '{"message":"你好。","proposedEventIds":["unknown"]}',
      '{"message":"[2]","proposedEventIds":[]}', '{"message":"你好。","proposedEventIds":[]']) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] })); };
      const state = createInitialState(script, {});
      const before = structuredClone(state);
      await assert.rejects(runChat(script, state, 'su-nian', '你好', createCombinedChatAdapter({ apiKey: 'test' })));
      assert.equal(calls, 1);
      assert.deepEqual(state, before);
    }
  } finally { globalThis.fetch = saved; }
});

test('combined prompt excludes blocked rules and never asks AI to execute effects', async () => {
  const saved = globalThis.fetch;
  let request: any;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"在呢。","proposedEventIds":[]}' }, finish_reason: 'stop' }] }));
  };
  try {
    const state = createInitialState(script, {});
    state.npcIndicators!['su-nian'].metInPerson.value = true;
    await runChat(script, state, 'su-nian', '在吗', createCombinedChatAdapter({ apiKey: 'test' }));
    assert.equal(JSON.stringify(request.messages).includes('share-screenshot'), false);
    assert.equal(JSON.stringify(request.messages).includes('"effects"'), false);
  } finally { globalThis.fetch = saved; }
});
