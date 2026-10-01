import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScript } from '../packages/script/src/index.js';
import { createInitialState, deriveNpcSnapshot, evaluateCondition } from '../packages/engine/src/index.js';

function story() {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.npcs = script.npcs.map((npc) => npc.id === 'su-nian' ? { ...npc, initialLocationId: 'restaurant' } : npc);
  script.playerIndicators = [
    { id: 'stamina', name: '体力', type: 'number', initial: 40, min: 0, max: 100, playerVisible: true },
    { id: 'cursed', name: '诅咒', type: 'boolean', initial: false, playerVisible: false },
    { id: 'clues', name: '线索', type: 'tags', initial: ['旧照片'], playerVisible: false },
  ];
  return script;
}

test('new game stores player indicators and one canonical NPC location', () => {
  const script = story();
  const state = createInitialState(script, { name: '阿言', playStyle: 'team' });
  assert.equal(state.npcLocations?.['su-nian'], 'restaurant');
  assert.deepEqual(state.playerIndicators?.stamina, { value: 40, playerVisible: true });
  assert.deepEqual(state.playerIndicators?.clues, { value: ['旧照片'], playerVisible: false });
  assert.notEqual(state.playerIndicators?.clues.value, script.playerIndicators?.[2].initial);
  const snapshot = deriveNpcSnapshot(script, state, 'su-nian');
  assert.equal(snapshot.locationId, 'restaurant');
});

test('player field, player indicator and NPC location conditions compose without a stage', () => {
  const script = story();
  const state = createInitialState(script, { name: '阿言', hobbies: ['game'] });
  assert.equal(evaluateCondition({ all: [
    { playerField: { id: 'hobbies', has: 'game' } },
    { playerIndicator: { id: 'stamina', gte: 40 } },
    { npcLocation: { npcId: 'su-nian', locationId: 'restaurant' } },
    { not: { playerIndicator: { id: 'cursed', eq: true } } },
  ] }, state, script), true);
  assert.equal(evaluateCondition({ any: [
    { playerIndicator: { id: 'clues', has: '不存在' } },
    { playerField: { id: 'name', eq: '阿言' } },
  ] }, state, script), true);
});
