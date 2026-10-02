import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../packages/script/src/index.js';
import { assembleScriptParts, blankScriptParts, inspectScriptParts, scriptPartsFromScript } from '../packages/script/src/parts.js';

test('blank creator package assembles to a playable story with one character', () => {
  const parts = blankScriptParts('new-story', '新故事');
  const script = assembleScriptParts(parts);
  assert.equal(script.id, 'new-story');
  assert.equal(script.npcs.length, 1);
  assert.equal(script.npcs[0].initialLocationId, script.startLocation);
  assert.deepEqual(script.periods, ['白天', '下午', '晚上']);
  assert.ok(script.contentHash);
});

test('sample story can be copied under another immutable story ID', () => {
  const parts = scriptPartsFromScript(loadScript('sword-and-screen'), 'copy-story', '我的改编');
  const script = assembleScriptParts(parts);
  assert.equal(script.id, 'copy-story');
  assert.equal(script.title, '我的改编');
  assert.equal(script.npcs[0].id, 'su-nian');
  assert.equal(script.events.length, loadScript('sword-and-screen').events.length);
});

test('malformed or broken sections show their path and cannot publish', () => {
  const parts = blankScriptParts('broken-story', '草稿');
  parts['items.json'] = '[';
  assert.ok(inspectScriptParts(parts).errors.some(issue => issue.path === 'items.json'));
  assert.throws(() => assembleScriptParts(parts), /items.json/);
  parts['items.json'] = '[]';
  parts['npcs/character/base.json'] = JSON.stringify({ id: 'character', name: '角色', description: '',
    initialLocationId: 'missing-location', initialItems: [] });
  assert.ok(inspectScriptParts(parts).errors.some(issue => issue.message.includes('missing-location')));
});
