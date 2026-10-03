import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScript } from '../packages/script/src/index.js';
import { applyEvent, createInitialState, makeView, searchLocation } from '../packages/engine/src/index.js';
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

test('new-format story settles two once-only scores, removes an event, reveals an item and awards typed gallery', () => {
  const { script } = setup();
  script.playerFields = [];
  script.storyEvents = [{ id: 'event-first', label: '第一次', detail: '' }];
  script.storyIndicators = [
    { id: 'ledger', name: '已执行规则', type: 'tags', initial: [], playerVisible: false, systemRole: 'onceRules' },
    { id: 'score', name: '分数', type: 'number', initial: 0, min: 0, max: 100, playerVisible: false },
  ];
  script.playerRules = [
    { id: 'first-score', intent: '第一次加分', trigger: 'action', actions: ['wait'], once: true,
      effects: [{ type: 'changeIndicator', target: 'story', id: 'score', by: 2 }, { type: 'recordStoryEvent', eventId: 'event-first' }] },
    { id: 'second-score', intent: '第二次加分', trigger: 'action', actions: ['wait'], once: true,
      effects: [{ type: 'changeIndicator', target: 'story', id: 'score', by: 3 }, { type: 'removeStoryEvent', eventId: 'event-first' }] },
  ];
  script.locations = script.locations.map(location => location.id === script.startLocation ? {
    ...location, items: [{ item: 'game-screenshot', discoverWhen: { storyIndicator: { id: 'score', gte: 5 } },
      takeWhen: { storyIndicator: { id: 'score', eq: 5 } } }],
  } : location);
  script.achievements = [{ id: 'score-five', name: '五分', description: '',
    condition: { storyIndicator: { id: 'score', gte: 5 } } }];
  const start = createInitialState(script, {});
  assert.deepEqual(start.player, {});
  const first = settleWorld(script, start, start, { kind: 'wait', summary: '等待' });
  assert.equal(first.state.storyIndicators?.score.value, 5);
  assert.deepEqual(first.state.storyIndicators?.ledger.value, ['first-score', 'second-score']);
  assert.deepEqual(first.state.storyEventFlags, []);
  assert.ok(first.state.awardedGallery.some(entry => entry.id === 'score-five'));
  const found = searchLocation(script, first.state);
  assert.deepEqual(found.discovered, ['game-screenshot']);
  assert.equal(makeView(script, found.state).location?.items[0]?.canTake, true);
  const again = settleWorld(script, found.state, found.state, { kind: 'wait', summary: '再次等待' });
  assert.equal(again.state.storyIndicators?.score.value, 5);
});
