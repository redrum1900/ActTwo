import test from 'node:test';
import assert from 'node:assert/strict';
import * as channel from '../apps/web/src/gameplay/npc-channel.js';

test('online NPC is labeled as a remote contact, not physically present', () => {
  const label = (channel as { npcChannelLabel?: (value?: string) => string }).npcChannelLabel;
  assert.equal(typeof label, 'function');
  assert.equal(label?.('online'), '电脑私聊');
  assert.equal(label?.('in-person'), '面对面');
});
