import assert from 'node:assert/strict';
import test from 'node:test';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';
import { createMainAiClient } from '../apps/api/src/creator/import-ai.js';
import { generateImportDraft, ImportGenerationError } from '../apps/api/src/creator/import-generate.js';

const valid = JSON.stringify({ story: swordStoryV2, inferences: ['补足开局地点'] });
const client = (answers: string[]) => {
  const calls: { system: string; user: string }[] = [];
  return { calls, complete: async (system: string, user: string) => {
    calls.push({ system, user });
    return answers.shift() ?? valid;
  } };
};

test('complete generation uses the existing project id and all sections', async () => {
  const ai = client([valid]);
  const result = await generateImportDraft('owned-story', '这是角色卡', ai);
  assert.equal(JSON.parse(result.parts['manifest.json']).id, 'owned-story');
  assert.ok(result.parts['npcs/su-nian/rules.json']);
  assert.deepEqual(result.inferences, ['补足开局地点']);
  assert.deepEqual(result.issues, []);
  assert.match(ai.calls[0]!.system, /转换规则/);
});

test('invalid references remain editable and are reported locally', async () => {
  const invalid = structuredClone(swordStoryV2);
  invalid.startLocation = 'missing-place';
  const ai = client([JSON.stringify({ story: invalid, inferences: [] }), valid]);
  const result = await generateImportDraft('owned-story', '素材', ai);
  assert.equal(ai.calls.length, 1);
  assert.ok(result.issues.some(issue => /startLocation/.test(issue.path)));
});

test('legacy condition is reported locally without a second model call', async () => {
  const invalid = structuredClone(swordStoryV2);
  invalid.npcs[0]!.personas[1]!.when = { flag: 'met' };
  const ai = client([JSON.stringify({ story: invalid, inferences: [] }), valid]);
  const result = await generateImportDraft('owned-story', '素材', ai);
  assert.equal(ai.calls.length, 1);
  assert.ok(result.issues.some(issue => /personas\[1\]\.when\.flag/.test(issue.path)));
});

test('empty condition groups are named in local issues', async () => {
  const invalid = structuredClone(swordStoryV2);
  invalid.npcs[0]!.personas[1]!.when = { all: [] };
  const ai = client([JSON.stringify({ story: invalid, inferences: [] }), valid]);
  const result = await generateImportDraft('owned-story', '素材', ai);
  assert.ok(result.issues.some(issue => /personas\[1\]\.when\.all/.test(issue.path) && /空条件组/.test(issue.message)));
});

test('missing nested NPC and location arrays receive field-level local issues', async () => {
  const invalid = structuredClone(swordStoryV2);
  delete (invalid.npcs[0] as unknown as Record<string, unknown>).rules;
  delete (invalid.locations[0] as unknown as Record<string, unknown>).spots;
  const ai = client([JSON.stringify({ story: invalid, inferences: [] }), valid]);
  const result = await generateImportDraft('owned-story', '素材', ai);
  assert.ok(result.issues.some(issue => /story\.npcs\[0\]\.rules/.test(issue.path)));
  assert.ok(result.issues.some(issue => /spots/.test(issue.path)));
});

test('duplicate entity IDs cannot be applied even when another module is missing', async () => {
  const invalid = structuredClone(swordStoryV2) as unknown as Record<string, unknown>;
  delete invalid.playerFields;
  const locations = invalid.locations as { id: string }[];
  locations.push(structuredClone(locations[0]!));
  const ai = client([JSON.stringify({ story: invalid, inferences: [] })]);
  await assert.rejects(generateImportDraft('owned-story', '素材', ai), error =>
    error instanceof ImportGenerationError && error.issues.some(issue => /重复实体 ID/.test(issue.message)));
  assert.equal(ai.calls.length, 1);
});

test('safe missing modules do not hide unrelated reference errors', async () => {
  const invalid = structuredClone(swordStoryV2) as unknown as Record<string, unknown>;
  delete invalid.playerFields;
  (invalid.items as { id: string }[])[0]!.id = 'renamed-item';
  const result = await generateImportDraft('owned-story', '素材', client([JSON.stringify({ story: invalid })]));
  assert.ok(result.issues.some(issue => /playerFields/.test(issue.path)));
  assert.ok(result.issues.some(issue => /item|道具|引用/.test(`${issue.path} ${issue.message}`)));
});

test('missing rule and spot effects receive field-level local issues', async () => {
  const invalid = structuredClone(swordStoryV2);
  delete (invalid.npcs[0]!.rules![0] as unknown as Record<string, unknown>).effects;
  invalid.locations[0]!.spots = [{ id: 'bookshelf', name: '书架', description: '旧书', effects: [] }];
  delete (invalid.locations[0]!.spots[0] as unknown as Record<string, unknown>).effects;
  const ai = client([JSON.stringify({ story: invalid, inferences: [] }), valid]);
  const result = await generateImportDraft('owned-story', '素材', ai);
  assert.ok(result.issues.some(issue => /rules.*effects/.test(issue.path)));
  assert.ok(result.issues.some(issue => /spots.*effects/.test(issue.path)));
});

test('malformed output fails without retry or writeable result', async () => {
  const ai = client(['{}', '{}', '{}']);
  await assert.rejects(generateImportDraft('owned-story', '素材', ai), /导入内容|缺少故事/);
  assert.equal(ai.calls.length, 1);
});

test('code fences are not accepted as valid output', async () => {
  const ai = client([`\`\`\`json\n${valid}\n\`\`\``, valid]);
  await assert.rejects(generateImportDraft('owned-story', '素材', ai));
  assert.equal(ai.calls.length, 1);
});

test('long input reaches generation once without truncating the ending', async () => {
  const source = `${'甲'.repeat(43_000)}末尾关键秘密`;
  const ai = client([]);
  await generateImportDraft('owned-story', source, ai);
  assert.equal(ai.calls.length, 1);
  assert.ok(ai.calls.some(call => call.user.includes('末尾关键秘密')));
  assert.match(ai.calls[0]!.user, /原文/);
});

test('main model requires separate config and never exposes the key', () => {
  assert.throws(() => createMainAiClient({ AI_MAIN_API_KEY: 'private-secret' }), /AI_MAIN_BASE_URL/);
  assert.throws(() => createMainAiClient({ AI_MAIN_API_KEY: 'private-secret', AI_MAIN_BASE_URL: 'http://bad', AI_MAIN_MODEL: 'm' }),
    error => error instanceof Error && !error.message.includes('private-secret'));
});

test('main model consumes streamed JSON completions', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"true}"},"finish_reason":"stop"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const ai = createMainAiClient({ AI_MAIN_API_KEY: 'test-key', AI_MAIN_BASE_URL: 'https://example.test/v1', AI_MAIN_MODEL: 'test-model' });
    assert.equal(await ai.complete('system', 'user'), '{"ok":true}');
    assert.equal(requestBody?.stream, true);
  } finally { globalThis.fetch = originalFetch; }
});
