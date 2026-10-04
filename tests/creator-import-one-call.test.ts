import test from 'node:test';
import assert from 'node:assert/strict';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';
import { generateImportDraft } from '../apps/api/src/modules/creator/import/import-generate.js';

test('long source reaches the model once and retains its ending', async () => {
  const source = `${'甲'.repeat(90_000)}末尾秘密`;
  const calls: string[] = [];
  const ai = { async complete(_system: string, user: string) { calls.push(user); return JSON.stringify({ story: swordStoryV2, inferences: [] }); } };
  const result = await generateImportDraft('owned-story', source, ai);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes('末尾秘密'));
  assert.ok(result.parts['manifest.json']);
});

test('bad references and missing modules remain editable with local issues, not AI repairs', async () => {
  const story = structuredClone(swordStoryV2) as any;
  story.startLocation = 'missing-place';
  delete story.achievements;
  let calls = 0;
  const ai = { async complete() { calls++; return JSON.stringify({ story, inferences: [] }); } };
  const result = await generateImportDraft('owned-story', '素材', ai);
  assert.equal(calls, 1);
  assert.equal(result.parts['achievements.json'], '[]');
  assert.ok(result.issues.some(issue => /startLocation|achievements/.test(issue.path)));
});

test('unsafe or duplicate NPC IDs reject before writing', async () => {
  const story = structuredClone(swordStoryV2) as any;
  story.npcs[0].id = '../escape';
  await assert.rejects(generateImportDraft('owned-story', '素材', { async complete() {
    return JSON.stringify({ story, inferences: [] });
  } }), /NPC ID/);
  story.npcs[0].id = 'npc';
  story.npcs.push(structuredClone(story.npcs[0]));
  await assert.rejects(generateImportDraft('owned-story', '素材', { async complete() {
    return JSON.stringify({ story, inferences: [] });
  } }), /NPC ID/);
});
