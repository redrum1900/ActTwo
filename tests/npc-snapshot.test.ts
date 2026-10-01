import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameScript } from '../packages/contracts/src/index.js';
import { createInitialState, deriveNpcSnapshot, makeView } from '../packages/engine/src/index.js';

const script: GameScript = {
  id: 'persona-test', version: '1', title: '角色', startLocation: 'home', periods: ['夜晚'], playerFields: [], stats: [], items: [],
  locations: [{ id: 'home', name: '电脑上', description: '', interactionMode: 'online', spots: [] },
    { id: 'cafe', name: '饭店', description: '', interactionMode: 'in-person', spots: [] }],
  npcs: [{ id: 'a', name: '甲', description: '', initialLocationId: 'home', initialItems: [],
    indicators: [
      { id: 'affection', name: '好感', type: 'number', initial: 10, min: 0, max: 100, playerVisible: true },
      { id: 'met', name: '见面', type: 'boolean', initial: false, playerVisible: false },
    ],
    personas: [
      { id: 'common', name: '通用', content: '长期喜欢逗人。' },
      { id: 'online', name: '线上', when: { not: { indicator: { id: 'met', eq: true } } }, content: '线上说话快。' },
      { id: 'close', name: '亲近', when: { indicator: { id: 'affection', gte: 50 } }, content: '亲近时温柔。' },
    ],
  }], events: [], endings: [], achievements: [],
};

test('NPC snapshot combines common and conditional personas and stores one real location', () => {
  const state = createInitialState(script, {});
  const initial = deriveNpcSnapshot(script, state, 'a');
  assert.equal(initial.locationId, 'home');
  assert.equal(initial.persona, '通用：长期喜欢逗人。\n\n线上：线上说话快。');
  assert.equal(makeView(script, state).npcs[0].channel, 'online');
  state.npcIndicators!.a.affection.value = 60;
  state.npcIndicators!.a.met.value = true;
  state.npcLocations!.a = 'cafe';
  state.locationId = 'cafe';
  const changed = deriveNpcSnapshot(script, state, 'a');
  assert.equal(changed.locationId, 'cafe');
  assert.equal(changed.persona, '通用：长期喜欢逗人。\n\n亲近：亲近时温柔。');
  assert.equal(makeView(script, state).npcs[0].channel, 'in-person');
  assert.equal(makeView(script, state).npcs[0].stats.some((entry) => entry.id === 'met'), false);
});
