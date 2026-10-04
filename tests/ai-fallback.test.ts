import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { readAiFallbacks } from '../apps/api/src/infrastructure/ai/ai-config.js';
import { deriveChatContext } from '../apps/api/src/modules/gameplay/chat-service.js';
import { createInitialState } from '@game/engine';
import { loadScript } from '@game/script';

test('three primary failures fall through to a configured backup model', async () => {
  const previous = globalThis.fetch;
  const calls: { url: string; model: string; auth: string }[] = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push({ url: String(url), model: body.model, auth: String((init?.headers as Record<string, string>).Authorization) });
    if (String(url).includes('primary.invalid')) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '你好。' } }] }), { status: 200 });
  };
  try {
    const script = loadScript('sword-and-screen');
    const context = deriveChatContext(script, createInitialState(script, { name: '测试' }), script.npcs[0], '你好');
    const adapter = createChatAdapter({ apiKey: 'primary-secret', baseUrl: 'https://primary.invalid/v1', model: 'main',
      fallbacks: [{ apiKey: 'backup-secret', baseUrl: 'https://backup.invalid/v1', model: 'backup' }] } as any);
    let reply;
    try { reply = await adapter.generate(context); }
    catch (error) { assert.fail(`${String(error)}; calls=${JSON.stringify(calls)}`); }
    assert.equal(reply.message, '你好。');
    assert.deepEqual(calls.map(call => call.model), ['main', 'main', 'main', 'backup']);
    assert.equal(calls[3].auth, 'Bearer backup-secret');
  } finally { globalThis.fetch = previous; }
});

test('only fully configured backup slots are enabled', () => {
  assert.deepEqual(readAiFallbacks({ AI_FALLBACK_1_API_KEY: 'key', AI_FALLBACK_1_BASE_URL: 'https://backup.invalid/v1',
    AI_FALLBACK_1_MODEL: 'backup', AI_FALLBACK_2_API_KEY: '', AI_FALLBACK_2_BASE_URL: '', AI_FALLBACK_2_MODEL: '' }),
  [{ apiKey: 'key', baseUrl: 'https://backup.invalid/v1', model: 'backup' }]);
  assert.throws(() => readAiFallbacks({ AI_FALLBACK_1_API_KEY: 'key' }), /AI_FALLBACK_1/);
});
