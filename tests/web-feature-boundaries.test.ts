import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayerRoute, playerRoutePath } from '../apps/web/src/app/player-route.js';
import { npcChannelLabel } from '../apps/web/src/gameplay/npc-channel.js';
import { splitLoreKeywords } from '../apps/web/src/creator/model/section-forms.js';

test('feature-local player routing keeps formal and playtest URLs distinct', () => {
  assert.deepEqual(parsePlayerRoute('/games/story-one/play'), {
    route: { kind: 'story-play', storyId: 'story-one' },
  });
  assert.equal(playerRoutePath({ kind: 'playtest-play', projectId: 'draft-one', playtestId: 'run-one' }),
    '/playtest/draft-one/run-one/play');
});

test('feature-local gameplay helpers retain location-specific NPC labels', () => {
  assert.equal(npcChannelLabel('online'), '电脑私聊');
  assert.equal(npcChannelLabel('in-person'), '面对面');
});

test('feature-local creator form helpers keep keyword normalization', () => {
  assert.deepEqual(splitLoreKeywords('剑道，练习,剑道', ['相识']), ['相识', '剑道', '练习']);
});
