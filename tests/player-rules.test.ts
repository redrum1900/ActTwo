import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScript } from '../packages/script/src/index.js';
import { applyEvent, createInitialState } from '../packages/engine/src/index.js';
import { settleWorld } from '../packages/engine/src/activity-log.js';

function setup() {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.playerIndicators = [
    { id: 'cursed', name: '诅咒', type: 'boolean', initial: false, playerVisible: false },
    { id: 'stamina', name: '体力', type: 'number', initial: 40, min: 0, max: 100, playerVisible: true },
  ];
  script.npcs = script.npcs.map((npc) => ({ ...npc, initialLocationId: 'player-home' }));
  const state = createInitialState(script, { name: '阿言' });
  return { script, state };
}

test('an NPC rule can target player indicators and move itself to a locked place', () => {
  const { script, state } = setup();
  script.events = [...script.events, { id: 'cross-target-test', npc: 'su-nian', intent: '测试', trigger: 'automatic', effects: [
    { type: 'setIndicator', target: 'player', id: 'cursed', value: true },
    { type: 'moveNpc', locationId: 'her-home' },
  ] }];
  const result = applyEvent(script, state, 'cross-target-test');
  assert.equal(result.applied, true);
  assert.equal(result.state.playerIndicators?.cursed.value, true);
  assert.equal(result.state.npcLocations?.['su-nian'], 'her-home');
  assert.equal(result.state.unlockedLocations.includes('her-home'), false);
});

test('missing target skips only its effect and all-skipped once stays available', () => {
  const { script, state } = setup();
  script.playerRules = [
    { id: 'partial-target', intent: '部分目标', trigger: 'automatic', once: true, effects: [
      { type: 'setIndicator', target: 'npc:missing', id: 'knowsCurse', value: true },
      { type: 'setIndicator', id: 'cursed', value: true },
    ] },
    { id: 'all-missing', intent: '全部缺失', trigger: 'automatic', once: true,
      effects: [{ type: 'setIndicator', target: 'npc:missing', id: 'knowsCurse', value: true }] },
  ];
  const result = settleWorld(script, state, state, { kind: 'wait', summary: '等了一会儿' });
  assert.equal(result.state.playerIndicators?.cursed.value, true);
  assert.equal(result.state.completedEvents.includes('partial-target'), true);
  assert.equal(result.state.completedEvents.includes('all-missing'), false);
});

test('player action rules filter actions and automatic rules wait until the next operation to chain', () => {
  const { script, state } = setup();
  script.playerRules = [
    { id: 'explore-curse', intent: '探索时中咒', trigger: 'action', actions: ['explore'], once: true,
      effects: [{ type: 'setIndicator', id: 'cursed', value: true }] },
    { id: 'curse-fatigue', intent: '诅咒消耗体力', trigger: 'automatic', once: true,
      when: { playerIndicator: { id: 'cursed', eq: true } },
      effects: [{ type: 'changeIndicator', id: 'stamina', by: -10 }] },
  ];
  const waited = settleWorld(script, state, state, { kind: 'wait', summary: '等待' });
  assert.equal(waited.state.playerIndicators?.cursed.value, false);
  const explored = settleWorld(script, state, state, { kind: 'explore', summary: '探索' });
  assert.equal(explored.state.playerIndicators?.cursed.value, true);
  assert.equal(explored.state.playerIndicators?.stamina.value, 40);
  const later = settleWorld(script, explored.state, explored.state, { kind: 'wait', summary: '等待' });
  assert.equal(later.state.playerIndicators?.stamina.value, 30);
});
