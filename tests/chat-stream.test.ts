import test from 'node:test';
import assert from 'node:assert/strict';

test('a pending turn shows player words immediately, appends one NPC draft, and keeps failed text retryable', async () => {
  const module = await import('../apps/web/src/gameplay/chat-stream.js').catch(() => ({} as { beginPendingTurn?: unknown }));
  assert.equal(typeof module.beginPendingTurn, 'function');
  const { beginPendingTurn, appendPendingDraft, failPendingTurn } = module as typeof import('../apps/web/src/gameplay/chat-stream.js');
  const started = beginPendingTurn('turn-1', 'su-nian', '你好');
  assert.equal(started.playerText, '你好');
  assert.equal(started.npcText, '');
  assert.equal(started.status, 'sending');
  const streaming = appendPendingDraft(appendPendingDraft(started, '你'), '好。');
  assert.equal(streaming.npcText, '你好。');
  const failed = failPendingTurn(streaming);
  assert.equal(failed.playerText, '你好');
  assert.equal(failed.npcText, '');
  assert.equal(failed.status, 'failed');
});

test('browser chat client delivers SSE draft before final session', async () => {
  const { postChatStream } = await import('../apps/web/src/app/api.js');
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('event: draft\ndata: {"delta":"你"}\n\nevent: draft\ndata: {"delta":"好"}\n\nevent: status\ndata: {"text":"正在核对剧情结果…"}\n\nevent: final\ndata: {"session":{"revision":2}}\n\n',
    { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const words: string[] = [];
    const statuses: string[] = [];
    const result = await postChatStream('/games/x/chat/stream', { text: '你好' },
      { onDraft: (delta) => words.push(delta), onStatus: (value) => statuses.push(value) });
    assert.equal(words.join(''), '你好');
    assert.deepEqual(statuses, ['正在核对剧情结果…']);
    assert.equal(result.revision, 2);
  } finally { globalThis.fetch = original; }
});

test('chat closes only when the NPC leaves the same player location after settlement', async () => {
  const { npcLeftCurrentLocation } = await import('../apps/web/src/gameplay/chat-stream.js');
  const before = { locationId: 'home', npcs: [{ id: 'su-nian' }] };
  assert.equal(npcLeftCurrentLocation(before, { locationId: 'home', npcs: [] }, 'su-nian'), true);
  assert.equal(npcLeftCurrentLocation(before, { locationId: 'restaurant', npcs: [] }, 'su-nian'), false);
  assert.equal(npcLeftCurrentLocation(before, { locationId: 'home', npcs: [{ id: 'su-nian' }] }, 'su-nian'), false);
});
