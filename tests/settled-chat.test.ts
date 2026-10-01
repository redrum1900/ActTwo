import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { runChat } from '../apps/api/src/chat-service.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';

const script = loadScript('sword-and-screen');
function response(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 80 } } }));
}

test('judge runs before a single settled reply, with no rewrite after automatic NPC movement', async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  const state = createInitialState(script, {});
  state.npcIndicators!['su-nian'].affection.value = 29;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (requests.length === 1) {
      if (!body.response_format) throw new Error('Expected judgment before dialogue');
      return response('{"proposedEventIds":["close-talk"]}');
    }
    const prompt = body.messages.map((m: any) => m.content).join('\n');
    if (!prompt.includes('meet-in-person') || !prompt.includes('restaurant')) throw new Error('Reply lacks settled movement');
    return response('我先去饭店等你。');
  };
  try {
    const streamed: string[] = [];
    const result = await runChat(script, state, 'su-nian', '我很在意你的感受', createChatAdapter({ apiKey: 'test' }),
      { onDraft: text => streamed.push(text) });
    assert.equal(requests.length, 2);
    assert.equal(result.state.npcLocations!['su-nian'], 'restaurant');
    assert.equal(result.state.npcIndicators!['su-nian'].affection.value, 31);
    assert.equal(result.reply, streamed.join(''));
    assert.equal(state.npcIndicators!['su-nian'].affection.value, 29);
  } finally { globalThis.fetch = original; }
});

test('judgment excludes blocked rules and includes recent context for short answers', async () => {
  const original = globalThis.fetch;
  const state = createInitialState(script, {});
  state.npcIndicators!['su-nian'].metInPerson.value = true;
  state.chats['su-nian'] = [{ id: 'previous', role: 'npc', text: '你还喜欢我吗？', at: new Date().toISOString() }];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls++;
    if (calls === 1) {
      const prompt = JSON.stringify(body.messages);
      if (prompt.includes('share-screenshot')) throw new Error('Blocked rule leaked');
      if (!prompt.includes('你还喜欢我吗')) throw new Error('Missing recent context');
      return response('{"proposedEventIds":[]}');
    }
    return response('她轻轻点了点头。');
  };
  try { await runChat(script, state, 'su-nian', '是的', createChatAdapter({ apiKey: 'test' })); }
  finally { globalThis.fetch = original; }
});

test('failed final generation discards provisional semantic and automatic changes', async () => {
  const original = globalThis.fetch;
  const state = createInitialState(script, {});
  const before = structuredClone(state);
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? response('{"proposedEventIds":["close-talk"]}') : response('[2]');
  try {
    await assert.rejects(runChat(script, state, 'su-nian', '我很在意你的感受', createChatAdapter({ apiKey: 'test' })));
    assert.equal(calls, 2);
    assert.deepEqual(state, before);
  } finally { globalThis.fetch = original; }
});

test('no eligible semantic rules means only one plain streamed generation', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response('这里是电脑上的聊天窗口。'); };
  try {
    const game = { ...script, events: [] };
    const result = await runChat(game, createInitialState(game, {}), 'su-nian', '这里是？', createChatAdapter({ apiKey: 'test' }));
    assert.equal(calls, 1);
    assert.equal(result.reply, '这里是电脑上的聊天窗口。');
  } finally { globalThis.fetch = original; }
});
