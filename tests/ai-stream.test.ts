import test from 'node:test';
import assert from 'node:assert/strict';

function streamResponse(parts: string[]): Response {
  const bytes = parts.map((part) => new TextEncoder().encode(part));
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const part of bytes) controller.enqueue(part); controller.close(); },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('upstream SSE joins split events and returns usage without control data in content', async () => {
  const module = await import('../apps/api/src/infrastructure/ai/ai-stream.js').catch(() => ({} as { readChatCompletionStream?: unknown }));
  assert.equal(typeof module.readChatCompletionStream, 'function');
  const { readChatCompletionStream } = module as typeof import('../apps/api/src/infrastructure/ai/ai-stream.js');
  const parts = [
    'data: {"choices":[{"delta":{"content":"{\\"message\\":\\"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好\\",\\"proposedEventIds\\\":[]}"},"finish_reason":"stop"}]}\n',
    '\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}\n\n',
    'data: [DONE]\n\n',
  ];
  const deltas: string[] = [];
  const result = await readChatCompletionStream(streamResponse(parts), (delta) => deltas.push(delta));
  assert.equal(result.content, '{"message":"你好","proposedEventIds":[]}');
  assert.equal(deltas.join(''), result.content);
  assert.equal(result.usage?.totalTokens, 15);
  assert.equal(result.finishReason, 'stop');
});

test('missing token fields stay unknown while provider cache write and read counts are preserved', async () => {
  const { readChatCompletionStream } = await import('../apps/api/src/infrastructure/ai/ai-stream.js');
  const result = await readChatCompletionStream(new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }],
    usage: { prompt_tokens_details: { cached_tokens: 8, cache_write_tokens: 3 } } })), () => {});
  assert.equal(result.usage?.promptTokens, undefined);
  assert.equal(result.usage?.completionTokens, undefined);
  assert.equal(result.usage?.cachedTokens, 8);
  assert.equal(result.usage?.cacheWriteTokens, 3);
});

test('message extractor emits only decoded NPC text across escaped and UTF-8 fragments', async () => {
  const module = await import('../apps/api/src/infrastructure/ai/ai-stream.js').catch(() => ({} as { createMessageDeltaExtractor?: unknown }));
  assert.equal(typeof module.createMessageDeltaExtractor, 'function');
  const { createMessageDeltaExtractor } = module as typeof import('../apps/api/src/infrastructure/ai/ai-stream.js');
  const deltas: string[] = [];
  const extractor = createMessageDeltaExtractor((delta) => deltas.push(delta));
  for (const part of ['{"proposedEventIds":["secret"],"mes', 'sage":"你\\', 'n好，\\"阿', '言\\"。"}']) extractor.push(part);
  assert.equal(deltas.join(''), '你\n好，"阿言"。');
  assert.equal(deltas.join('').includes('secret'), false);
});

test('message extractor ignores nested message fields and emits only the top-level reply', async () => {
  const { createMessageDeltaExtractor } = await import('../apps/api/src/infrastructure/ai/ai-stream.js');
  const words: string[] = [];
  const extractor = createMessageDeltaExtractor((delta) => words.push(delta));
  extractor.push('{"private":{"message":"隐藏内容"},"message":"你好","proposedEventIds":[]}');
  assert.equal(words.join(''), '你好');
});
