import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { deriveChatContext, runChat } from '../apps/api/src/chat-service.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { appendActivity } from '../packages/engine/src/activity-log.js';
import { loadScript } from '../packages/script/src/index.js';

function chatContext() {
  const story = loadScript('sword-and-screen');
  const state = createInitialState(story, { name: '阿宁' });
  return deriveChatContext(story, state, story.npcs[0], '你好');
}

test('generation sends stream true and emits only NPC words from provider SSE', async () => {
  const original = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    const payload = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '{"message":"你好。","proposedEventIds":[]}' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n';
    return new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const words: string[] = [];
    const reply = await createChatAdapter({ apiKey: 'test' }).generate(chatContext(), (delta) => words.push(delta));
    assert.equal(body.stream, true);
    assert.equal(reply.message, '你好。');
    assert.equal(words.join(''), '你好。');
  } finally { globalThis.fetch = original; }
});

test('a saturated AI upstream is retried once and the chat can succeed', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ error: { message: 'upstream load is saturated' } }), { status: 429 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"你好。","proposedEventIds":[]}' } }] }), { status: 200 });
  };
  try {
    const reply = await createChatAdapter({ apiKey: 'test', baseUrl: 'https://example.invalid/v1' }).generate(chatContext());
    assert.equal(reply.message, '你好。');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('persistent AI saturation tries the primary model three times without exposing provider payload', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'private upstream detail' } }), { status: 429 });
  };
  try {
    await assert.rejects(createChatAdapter({ apiKey: 'test', baseUrl: 'https://example.invalid/v1' }).generate(chatContext()),
      (error: Error & { status?: number }) => error.status === 503 && error.message.includes('繁忙') && !error.message.includes('private upstream detail'));
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('AI timeout retries twice before giving a safe manual-retry error', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); };
  try {
    await assert.rejects(createChatAdapter({ apiKey: 'test', baseUrl: 'https://example.invalid/v1' }).generate(chatContext()),
      (error: Error & { status?: number }) => error.status === 504 && error.message.includes('超时') && !error.message.includes('operation was aborted'));
    assert.equal(calls, 3);
  } finally { globalThis.fetch = original; }
});

test('timeout while reading streamed AI tokens also returns retryable timeout', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    controller.error(new DOMException('private stream timeout', 'TimeoutError'));
  } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  try {
    await assert.rejects(createChatAdapter({ apiKey: 'test' }).generate(chatContext()),
      (error: Error & { status?: number }) => error.status === 504 && error.message.includes('超时') && !error.message.includes('private'));
  } finally { globalThis.fetch = original; }
});

test('each upstream attempt logs usage and outcome without conversation or credentials', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'game-dd-ai-log-'));
  const logPath = path.join(directory, 'requests.jsonl');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? new Response('{}', { status: 429 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"你好。","proposedEventIds":[]}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } }), { status: 200 });
  };
  try {
    await createChatAdapter({ apiKey: 'SECRET_KEY', baseUrl: 'https://example.invalid/v1', logPath }).generate(chatContext());
    const contents = await readFile(logPath, 'utf8');
    const rows = contents.trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].purpose, 'generate');
    assert.equal(rows[0].attempt, 1);
    assert.equal(rows[0].httpStatus, 429);
    assert.equal(rows[1].attempt, 2);
    assert.equal(rows[1].httpStatus, 200);
    assert.deepEqual(rows[1].usage, { promptTokens: 123, completionTokens: 45, totalTokens: 168 });
    assert.equal(rows[1].finishReason, 'stop');
    assert.equal(rows[0].turnId, rows[1].turnId);
    assert.ok(rows[1].requestChars > 0);
    assert.ok(rows[1].durationMs >= 0);
    assert.equal(contents.includes('SECRET_KEY'), false);
    assert.equal(contents.includes('你好。'), false);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('judgment and settled generation share one turn ID without milestone rewrite', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'game-dd-ai-log-'));
  const logPath = path.join(directory, 'requests.jsonl');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const content = calls === 1 ? '{"proposedEventIds":["close-talk"]}' : '要不我们见一面？';
    return new Response(JSON.stringify({ choices: [{ message: { content } }],
      usage: { prompt_tokens: 100 * calls, completion_tokens: 10, total_tokens: 100 * calls + 10 } }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    state.npcIndicators!['su-nian'].affection.value = 29;
    await runChat(story, state, 'su-nian', '我很在意你的感受', createChatAdapter({ apiKey: 'test', logPath }));
    const rows = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>);
    assert.deepEqual(rows.map((row) => row.purpose), ['classify', 'generate']);
    assert.equal(new Set(rows.map((row) => row.turnId)).size, 1);
    assert.notEqual(rows[0].callId, rows[1].callId);
    assert.equal(rows[1].usage.totalTokens, 210);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('modern NPC prompt names current persona rather than a built-in stage', async () => {
  const original = globalThis.fetch;
  let system = '';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    system = body.messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"我在听。","proposedEventIds":[]}' } }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    const context = deriveChatContext(story, state, story.npcs[0], '你好');
    await createChatAdapter({ apiKey: 'test' }).generate(context);
    assert.ok(system.includes('当前人格'));
    assert.equal(system.includes('当前阶段'), false);
  } finally { globalThis.fetch = original; }
});

test('changing turn state stays after the reusable instruction and chat prefix', async () => {
  const original = globalThis.fetch;
  const requests: { messages: { role: string; content: string }[] }[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: '<<EVENT_IDS:>>\n我在听。' } }] }), { status: 200 });
  };
  try {
    const first = chatContext();
    const second = chatContext();
    second.state.day = 2;
    await createChatAdapter({ apiKey: 'test' }).generate(first);
    await createChatAdapter({ apiKey: 'test' }).generate(second);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].messages[0].content, requests[1].messages[0].content);
    assert.equal(requests[0].messages[0].content.includes('当前状态：'), false);
    assert.ok(requests[0].messages.at(-2)?.content.includes('当前状态：'));
    assert.notEqual(requests[0].messages.at(-2)?.content, requests[1].messages.at(-2)?.content);
    assert.equal(requests[0].messages.at(-1)?.content, '你好');
  } finally { globalThis.fetch = original; }
});

test('first chat after a player move tells AI the old and current scene without implying shared travel', async () => {
  const original = globalThis.fetch;
  let request: any;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '<<EVENT_IDS:>>\n这是我家。' } }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    let state = createInitialState(story, { name: '阿言' });
    state.locationId = 'restaurant';
    state = appendActivity(story, state, { kind: 'move', summary: '来到了老街饭店。' }, []);
    state.locationId = 'her-home';
    state.npcLocations!['su-nian'] = 'her-home';
    state = appendActivity(story, state, { kind: 'move', summary: '来到了苏念家中。' }, []);
    await createChatAdapter({ apiKey: 'test' }).generate(deriveChatContext(story, state, story.npcs[0], '这里是？'));
    const prompt = request.messages.at(-2).content as string;
    if (!prompt.includes('老街饭店') || !prompt.includes('苏念家中') || !prompt.includes('玩家刚从') ||
      !prompt.includes('先回答玩家本轮的问题')) throw new Error('缺少明确的场景过渡或本轮优先指令');
    assert.equal(prompt.includes('你们一起从'), false);
  } finally { globalThis.fetch = original; }
});

test('timed-out upstream attempt is recorded even without provider usage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'game-dd-ai-log-'));
  const logPath = path.join(directory, 'requests.jsonl');
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
  try {
    await assert.rejects(createChatAdapter({ apiKey: 'test', logPath }).generate(chatContext()));
    const rows = (await readFile(logPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, any>);
    assert.equal(rows.length, 3);
    assert.ok(rows.every(row => row.outcome === 'timeout' && row.httpStatus === null && row.usage === null));
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('small judgment precedes plain generation and neither request sets an output cap', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'game-dd-ai-log-'));
  const logPath = path.join(directory, 'requests.jsonl');
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const content = bodies.length === 1 ? '{"proposedEventIds":[]}' : '你好呀。';
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: {
      prompt_tokens: 9000, completion_tokens: 25, total_tokens: 9025,
      prompt_tokens_details: { cached_tokens: 7680 },
    } }), { status: 200 });
  };
  try {
    const ctx = chatContext();
    const reply = await runChat(ctx.script, ctx.state, ctx.npc.id, ctx.text, createChatAdapter({ apiKey: 'test', logPath }));
    assert.equal(reply.reply, '你好呀。');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].temperature, 0.2);
    assert.equal(Object.hasOwn(bodies[0], 'max_tokens'), false);
    assert.equal(bodies[1].temperature, 0.7);
    assert.equal(Object.hasOwn(bodies[1], 'max_tokens'), false);
    assert.ok(JSON.stringify(bodies[0].messages).length < JSON.stringify(bodies[1].messages).length);
    assert.equal(JSON.stringify(bodies[0].messages).includes('当前状态：'), false);
    const rows = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, any>);
    assert.deepEqual(rows.map((row) => row.purpose), ['classify', 'generate']);
    assert.equal(rows[0].outcome, 'success');
    assert.equal(rows[0].formatError, null);
    assert.equal(rows[1].outcome, 'success');
    assert.equal(rows[0].usage.cachedTokens, 7680);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('plain reply needs no classification request when there are no candidate events', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '你好呀。' } }] }), { status: 200 });
  };
  try {
    const context = chatContext();
    context.candidates = [];
    const reply = await createChatAdapter({ apiKey: 'test' }).generate(context);
    assert.deepEqual(reply, { message: '你好呀。', proposedEventIds: [] });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('unexpected legacy metadata in a streamed reply is hidden and cannot propose new events', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 2) return new Response(JSON.stringify({ choices: [{ message: { content: '{"proposedEventIds":["close-talk"]}' } }] }), { status: 200 });
    const parts = ['<<EVENT_IDS:cl', 'ose-talk>>\n', '你说得这么认真，', '我当然会听。'];
    const payload = parts.map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const words: string[] = [];
    const reply = await createChatAdapter({ apiKey: 'test' }).generate(chatContext(), (delta) => words.push(delta));
    assert.equal(calls, 1);
    assert.equal(words.join(''), '你说得这么认真，我当然会听。');
    assert.equal(reply.message, words.join(''));
    assert.deepEqual(reply.proposedEventIds, []);
  } finally { globalThis.fetch = original; }
});

test('a proposed affection event is rejected when independent judgment finds no intent in the player message', async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const content = requests.length === 1 ? '{"proposedEventIds":[]}' : '<<EVENT_IDS:close-talk>>\n这是我家。';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  try {
    const context = chatContext();
    context.text = '这里是？';
    const reply = await runChat(context.script, context.state, context.npc.id, context.text, createChatAdapter({ apiKey: 'test' }));
    assert.equal(reply.reply, '这是我家。');
    assert.equal(reply.state.npcIndicators!['su-nian'].affection.value, 0);
    assert.equal(requests.length, 2);
    const verification = JSON.stringify(requests[0].messages);
    assert.ok(verification.includes('这里是？'));
    assert.equal(verification.includes('这是我家。'), false);
  } finally { globalThis.fetch = original; }
});

test('a long plain reply never triggers another generation or event fallback', async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  const longReply = '她看着你，认真地说了很多。'.repeat(300);
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    const content = bodies.length === 1 ? longReply : '{"proposedEventIds":[]}';
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    const reply = await createChatAdapter({ apiKey: 'test' }).generate(chatContext());
    assert.equal(reply.message, longReply);
    assert.equal(bodies.length, 1);
  } finally { globalThis.fetch = original; }
});

test('rewrite and summary omit output caps and use low temperature', async () => {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: '简短文本' } }] }), { status: 200 });
  };
  try {
    const adapter = createChatAdapter({ apiKey: 'test' });
    const context = chatContext();
    await adapter.rewrite(context, '草稿');
    await adapter.summarize!(context, []);
    assert.deepEqual(bodies.map((body) => Object.hasOwn(body, 'max_tokens')), [false, false]);
    assert.deepEqual(bodies.map((body) => body.temperature), [0.2, 0.2]);
  } finally { globalThis.fetch = original; }
});

test('model sampling can be overridden without adding an output cap', async () => {
  const original = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"好","proposedEventIds":[]}' } }] }), { status: 200 });
  };
  try {
    await createChatAdapter({ apiKey: 'test', temperatures: { generate: 0.5 } }).generate(chatContext());
    assert.equal(Object.hasOwn(body, 'max_tokens'), false);
    assert.equal(body.temperature, 0.5);
  } finally { globalThis.fetch = original; }
});

test('bare date-like model output is rejected without a repair call or saved chat', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'game-dd-ai-log-'));
  const logPath = path.join(directory, 'requests.jsonl');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '[2026.10  ]' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    await assert.rejects(runChat({ ...story, events: [] }, state, 'su-nian', '我想你了', createChatAdapter({ apiKey: 'test', logPath })),
      (error: Error & { status?: number }) => error.status === 502 && error.message.includes('内容异常'));
    assert.equal(calls, 1);
    assert.equal(state.chats['su-nian'], undefined);
    const row = JSON.parse((await readFile(logPath, 'utf8')).trim()) as Record<string, any>;
    assert.equal(row.outcome, 'invalid_content');
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('date-like message inside otherwise valid JSON is also rejected', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"[2026.10  ]","proposedEventIds":[]}' } }] }), { status: 200 });
  };
  try {
    await assert.rejects(createChatAdapter({ apiKey: 'test' }).generate(chatContext()), /内容异常/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('a bracketed number is rejected before format repair can launder it into a saved NPC reply', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const content = calls === 1 ? '[2    ]' : '{"message":"[2    ]","proposedEventIds":[]}';
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    await assert.rejects(runChat({ ...story, events: [] }, state, 'su-nian', '你还在么', createChatAdapter({ apiKey: 'test' })),
      (error: Error & { status?: number }) => error.status === 502 && error.message.includes('内容异常'));
    assert.equal(calls, 1);
    assert.equal(state.chats['su-nian'], undefined);
  } finally { globalThis.fetch = original; }
});

test('a bracketed number inside valid structured JSON is still rejected', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
    content: '{"message":"[3   ]","proposedEventIds":[]}',
  } }] }), { status: 200 });
  try {
    await assert.rejects(createChatAdapter({ apiKey: 'test' }).generate(chatContext()), /内容异常/);
  } finally { globalThis.fetch = original; }
});

test('a bracketed numeric list is rejected rather than saved as NPC dialogue', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: {
      content: '{"message":"[ 2025 , 2 , 22 , 22 ]","proposedEventIds":[]}',
    }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    await assert.rejects(runChat({ ...story, events: [] }, state, 'su-nian', '我在想你', createChatAdapter({ apiKey: 'test' })),
      (error: Error & { status?: number }) => error.status === 502 && error.message.includes('内容异常'));
    assert.equal(calls, 1);
    assert.equal(state.chats['su-nian'], undefined);
  } finally { globalThis.fetch = original; }
});

test('invalid judgment fails closed before any reply or state update', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    const content = calls === 1 ? '不是JSON' : '{"message":"[ 2025 , 2 , 22 , 22 ]","proposedEventIds":[]}';
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    await assert.rejects(runChat(story, state, 'su-nian', '我在想你', createChatAdapter({ apiKey: 'test' })), /事件判断/);
    assert.equal(calls, 1);
    assert.equal(state.chats['su-nian'], undefined);
  } finally { globalThis.fetch = original; }
});

test('only semantic judgment uses JSON mode, while final dialogue stays plain streamed text', async () => {
  const original = globalThis.fetch;
  const drafts: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body)) as { response_format?: unknown };
    const content = request.response_format ? '{"proposedEventIds":[]}' : '我也在想你。';
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    const result = await runChat(story, state, 'su-nian', '我在想你', createChatAdapter({ apiKey: 'test' }),
      { onDraft: (delta) => drafts.push(delta) });
    assert.equal(result.reply, '我也在想你。');
    assert.equal(result.state.chats['su-nian'].at(-1)?.text, '我也在想你。');
    assert.equal(drafts.join(''), '我也在想你。');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('previous malformed NPC bubbles remain in the save but are omitted from future AI history', async () => {
  const original = globalThis.fetch;
  let request: any;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"在呢，你接着说。","proposedEventIds":[]}' } }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    state.chats['su-nian'] = [
      { id: 'old-player', role: 'player', text: '还在么', at: '2026-10-01T02:33:00Z' },
      { id: 'bad-npc', role: 'npc', text: '[2    ]', at: '2026-10-01T02:33:01Z' },
      { id: 'good-npc', role: 'npc', text: '在呢，我在等你。', at: '2026-10-01T02:33:02Z' },
    ];
    await createChatAdapter({ apiKey: 'test' }).generate(deriveChatContext(story, state, story.npcs[0], '继续说'));
    const history = request.messages.slice(1, -2).map((message: { content: string }) => message.content);
    assert.deepEqual(history, ['还在么', '在呢，我在等你。']);
    assert.equal(state.chats['su-nian'][1].text, '[2    ]');
  } finally { globalThis.fetch = original; }
});

test('NPC move keeps earlier online chat as past context rather than live assistant messages', async () => {
  const original = globalThis.fetch;
  let request: any;
  globalThis.fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: {
      content: '{"message":"她抬起头看着你：就在这里呀。","proposedEventIds":[]}',
    } }] }), { status: 200 });
  };
  try {
    const story = loadScript('sword-and-screen');
    const state = createInitialState(story, { name: '阿言' });
    state.locationId = 'restaurant';
    state.npcLocations!['su-nian'] = 'restaurant';
    state.npcIndicators!['su-nian'].metInPerson.value = true;
    state.activityLog.push({ id: 'move', at: '2026-10-01T02:00:00.000Z', day: 1, period: '夜晚',
      locationId: 'player-home', kind: 'chat', summary: '见面', details: [
        { kind: 'npc_move', entityId: 'su-nian', text: '苏念离开了电脑上' },
      ] });
    state.chats['su-nian'] = [
      { id: 'old-player', role: 'player', text: '给我发张照片', at: '2026-10-01T01:59:00.000Z' },
      { id: 'old-npc', role: 'npc', text: '（对话框显示正在输入，随后她发来一张照片。）', at: '2026-10-01T01:59:01.000Z' },
      { id: 'new-player', role: 'player', text: '这里挺安静', at: '2026-10-01T02:01:00.000Z' },
      { id: 'new-npc', role: 'npc', text: '她抬头看了看菜单，轻轻点头。', at: '2026-10-01T02:01:01.000Z' },
    ];
    await createChatAdapter({ apiKey: 'test' }).generate(deriveChatContext(story, state, story.npcs[0], '描述一下你的样貌'));
    assert.deepEqual(request.messages.filter((entry: { role: string }) => entry.role === 'assistant').map((entry: { content: string }) => entry.content),
      ['她抬头看了看菜单，轻轻点头。']);
    assert.ok(request.messages.some((entry: { content: string }) => entry.content.includes('过去') && entry.content.includes('发来一张照片')));
    assert.ok(request.messages.some((entry: { role: string; content: string }) => entry.role === 'system' && entry.content.includes('面对面') && entry.content.includes('不再')));
  } finally { globalThis.fetch = original; }
});

test('date-like rewrite cannot replace a meaningful draft', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '[2026.10  ]' } }] }), { status: 200 });
  try {
    await assert.rejects(createChatAdapter({ apiKey: 'test' }).rewrite(chatContext(), '我也想你。'), /内容异常/);
  } finally { globalThis.fetch = original; }
});
