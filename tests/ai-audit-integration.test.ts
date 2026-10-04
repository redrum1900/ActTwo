import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { createMainAiClient } from '../apps/api/src/modules/creator/import/import-ai.js';
import { deriveChatContext } from '../apps/api/src/modules/gameplay/chat-service.js';
import { createInitialState } from '@game/engine';
import { loadScript } from '@game/script';
import type { AiCallRecord } from '../apps/api/src/infrastructure/ai/ai-audit.js';

test('every provider attempt is audited with attribution and unknown usage remains null', async () => {
  const prior = globalThis.fetch;
  const rows: AiCallRecord[] = [];
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    if (requests <= 3) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '你好。' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } }), { status: 200 });
  };
  try {
    const script = loadScript('sword-and-screen');
    const context = deriveChatContext(script, createInitialState(script, { name: '测试' }), script.npcs[0], '你好');
    context.audit = { accountId: 'account-1', source: 'formal', storyId: script.id, releaseVersion: '1.0', operationId: 'turn-1' };
    const adapter = createChatAdapter({ apiKey: 'primary-secret', baseUrl: 'https://primary.invalid/v1', model: 'main',
      fallbacks: [{ apiKey: 'backup-secret', baseUrl: 'https://backup.invalid/v1', model: 'backup' }],
      auditSink: { async record(row: AiCallRecord) { rows.push(row); } } });
    assert.equal((await adapter.generate(context)).message, '你好。');
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map(row => row.model), ['main', 'main', 'main', 'backup']);
    assert.deepEqual(rows.map(row => row.outcome), ['http_error', 'http_error', 'http_error', 'success']);
    assert.equal(rows[0].inputTokens, null);
    assert.equal(rows[3].inputTokens, 12);
    assert.equal(rows[3].cacheReadTokens, 4);
    assert.equal(rows[3].accountId, 'account-1');
    assert.equal(rows[3].releaseVersion, '1.0');
    assert.equal(rows[3].operationId, 'turn-1');
    assert.equal(JSON.stringify(rows).includes('primary-secret'), false);
  } finally { globalThis.fetch = prior; }
});

test('audit sink failure never changes AI result', async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '你好。' } }] }), { status: 200 });
  try {
    const script = loadScript('sword-and-screen');
    const context = deriveChatContext(script, createInitialState(script, { name: '测试' }), script.npcs[0], '你好');
    const adapter = createChatAdapter({ apiKey: 'key', auditSink: { async record() { throw new Error('store down'); } } });
    assert.equal((await adapter.generate(context)).message, '你好。');
  } finally { globalThis.fetch = prior; }
});

test('import model call is audited as one attempt', async () => {
  const prior = globalThis.fetch;
  const rows: AiCallRecord[] = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }],
    usage: { prompt_tokens: 40, completion_tokens: 9 } }), { status: 200 });
  try {
    const client = createMainAiClient({ AI_MAIN_API_KEY: 'key', AI_MAIN_BASE_URL: 'https://example.test/v1', AI_MAIN_MODEL: 'main' },
      { async record(row) { rows.push(row); } });
    assert.equal(await client.complete('system', 'user',
      { accountId: 'author', source: 'import', storyId: 'story', operationId: 'job' }), '{"ok":true}');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'import');
    assert.equal(rows[0].outputTokens, 9);
    assert.equal(rows[0].cacheReadTokens, null);
  } finally { globalThis.fetch = prior; }
});
