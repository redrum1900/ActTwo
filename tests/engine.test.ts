import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  evaluateCondition,
  applyEvent,
  exploreSpot,
  advanceTime,
  makeView,
  refreshWorld, searchLocation, takeLocationItem, settlePlayerEvents,
} from '../packages/engine/src/index.js';
import { settleWorld } from '../packages/engine/src/activity-log.js';
import { loadScript } from '../packages/script/src/index.js';

const script = {
  id: 'test-story', version: '1.0.0', title: '测试故事',
  startLocation: 'station', periods: ['早晨', '下午', '夜晚'],
  playerFields: [],
  stats: [{ id: 'trust', owner: 'npc', initial: 0, min: -10, max: 100, visible: true }],
  items: [{ id: 'key', name: '钥匙' }, { id: 'letter', name: '信' }],
  locations: [
    { id: 'station', name: '车站', description: '', spots: [
      { id: 'locker', name: '储物柜', description: '', visibleWhen: null,
        condition: { all: [{ hasItem: { owner: 'player', item: 'key' } }, { stat: { npc: 'ada', id: 'trust', gte: 20 } }] },
        effects: [{ type: 'giveItem', to: 'player', item: 'letter' }, { type: 'discoverNpc', npc: 'eve' }], once: true },
    ] },
    { id: 'garden', name: '花园', description: '', visibleWhen: { flag: 'gardenOpen' }, spots: [] },
  ],
  npcs: [
    { id: 'ada', name: '艾达', description: '', initialLocationId: 'station', visibleWhen: null,
      initialItems: ['key'], itemVisibility: {}, profile: [], personas: [] },
    { id: 'eve', name: '伊芙', description: '', initialLocationId: 'station', visibleWhen: { flag: 'metEve' },
      initialItems: [], itemVisibility: {}, profile: [], personas: [] },
  ],
  events: [
    { id: 'get-key', npc: 'ada', intent: 'ask-key', trigger: 'semantic', priority: 1, once: true,
      condition: { all: [{ location: 'station' }, { stat: { npc: 'ada', id: 'trust', gte: 20 } }] },
      effects: [{ type: 'transferItem', from: 'npc:ada', to: 'player', item: 'key' }, { type: 'setFlag', flag: 'gardenOpen' }] },
  ], storyEvents: [], endings: [], achievements: [],
} as const;

test('new state uses script defaults and keeps NPC inventory private', () => {
  const state = createInitialState(script, { name: '阿宁' });
  assert.equal(state.locationId, 'station');
  assert.equal(state.npcStats.ada.trust, 0);
  assert.equal(state.npcItems.ada.key, 1);
  const view = makeView(script, state);
  assert.deepEqual(view.npcs.map((npc) => npc.id), ['ada']);
  assert.deepEqual(view.npcs[0]?.items, []);
  assert.deepEqual(view.locations.map((location) => location.id), ['station']);
});

test('new NPC indicators initialize typed values and independent runtime visibility', () => {
  const configured = { ...script, npcs: [{ ...script.npcs[0], indicators: [
    { id: 'affection', name: '好感', type: 'number', initial: 2, min: 0, max: 100, playerVisible: true },
    { id: 'mood', name: '心情', type: 'enum', initial: 'calm', options: ['calm', 'nervous'], playerVisible: false },
    { id: 'met', name: '见面', type: 'boolean', initial: false, playerVisible: false, writeOnceTrue: true },
    { id: 'clues', name: '线索', type: 'tags', initial: ['game'], playerVisible: false },
    { id: 'note', name: '备注', type: 'text', initial: '尚未见面', playerVisible: false },
  ] }, script.npcs[1]] } as const;
  const state = createInitialState(configured, { name: '阿宁' });
  assert.deepEqual(state.npcIndicators?.ada, {
    affection: { value: 2, playerVisible: true }, mood: { value: 'calm', playerVisible: false },
    met: { value: false, playerVisible: false }, clues: { value: ['game'], playerVisible: false },
    note: { value: '尚未见面', playerVisible: false },
  });
  state.npcIndicators!.ada.affection.playerVisible = false;
  assert.equal(configured.npcs[0].indicators[0].playerVisible, true);
});

test('new saves initialize an empty player activity timeline', () => {
  const fresh = createInitialState(script, { name: '阿宁' });
  assert.deepEqual(fresh.activityLog, []);
});

test('story events are recorded once as definition snapshots and can gate later rules', () => {
  const storyEvent = { id: '11111111-1111-4111-8111-111111111111', label: '收到邀请', detail: '艾达邀请玩家。' };
  const configured = { ...script, storyEvents: [storyEvent], events: [
    { id: 'invite', npc: 'ada', intent: 'invite', trigger: 'semantic', once: true,
      effects: [{ type: 'recordStoryEvent', eventId: storyEvent.id }] },
    { id: 'invite-again', npc: 'ada', intent: 'invite-again', trigger: 'semantic',
      effects: [{ type: 'recordStoryEvent', eventId: storyEvent.id },
        { type: 'changeStat', scope: 'npc', npc: 'ada', id: 'trust', by: 1 }] },
  ] } as const;
  const initial = createInitialState(configured, { name: '阿宁' });
  assert.deepEqual(initial.storyEventFlags, []);
  assert.equal(evaluateCondition({ storyEvent: storyEvent.id }, initial), false);
  assert.equal(evaluateCondition({ not: { storyEvent: storyEvent.id } }, initial), true);
  const first = applyEvent(configured, initial, 'invite');
  assert.equal(first.applied, true);
  assert.deepEqual(first.state.storyEventFlags, [storyEvent]);
  assert.notEqual(first.state.storyEventFlags[0], storyEvent);
  assert.equal(evaluateCondition({ storyEvent: storyEvent.id }, first.state), true);
  assert.equal(evaluateCondition({ not: { storyEvent: storyEvent.id } }, first.state), false);
  assert.deepEqual(first.state.completedEvents, ['invite']);
  assert.equal(applyEvent(configured, first.state, 'invite').applied, false);
  const second = applyEvent(configured, first.state, 'invite-again');
  assert.equal(second.applied, true);
  assert.deepEqual(second.state.storyEventFlags, [storyEvent]);
  assert.equal(second.state.npcStats.ada.trust, 1);
});

test('an unknown story event rejects the complete rule without partial changes', () => {
  const configured = { ...script, storyEvents: [], events: [
    { id: 'broken', npc: 'ada', intent: 'broken', trigger: 'semantic', effects: [
      { type: 'changeStat', scope: 'npc', npc: 'ada', id: 'trust', by: 3 },
      { type: 'recordStoryEvent', eventId: 'missing' },
    ] },
  ] } as const;
  const initial = createInitialState(configured, { name: '阿宁' });
  const result = applyEvent(configured, initial, 'broken');
  assert.equal(result.applied, false);
  assert.equal(result.state, initial);
  assert.equal(initial.npcStats.ada.trust, 0);
  assert.deepEqual(initial.storyEventFlags, []);
});

test('nested conditions check item ownership and NPC-specific numeric stats', () => {
  const state = createInitialState(script, { name: '阿宁' });
  const condition = { any: [
    { all: [{ hasItem: { owner: 'player', item: 'key' } }, { stat: { npc: 'ada', id: 'trust', gte: 20 } }] },
    { flag: 'specialPass' },
  ] } as const;
  assert.equal(evaluateCondition(condition, state), false);
  state.itemStates.key.owner = 'player';
  state.npcStats.ada.trust = 20;
  assert.equal(evaluateCondition(condition, state), true);
});

test('an event transfers an item once and applies its other effects atomically', () => {
  const state = createInitialState(script, { name: '阿宁' });
  state.npcStats.ada.trust = 20;
  const first = applyEvent(script, state, 'get-key');
  assert.equal(first.applied, true);
  assert.equal(first.state.playerItems.key, 1);
  assert.equal(first.state.npcItems.ada.key, undefined);
  assert.deepEqual(first.state.flags, ['gardenOpen']);
  const second = applyEvent(script, first.state, 'get-key');
  assert.equal(second.applied, false);
  assert.equal(second.state.playerItems.key, 1);
});

test('exploration obeys conditions and can reveal an NPC', () => {
  const state = createInitialState(script, { name: '阿宁' });
  assert.equal(exploreSpot(script, state, 'locker').applied, false);
  state.itemStates.key.owner = 'player';
  state.npcStats.ada.trust = 20;
  const result = exploreSpot(script, state, 'locker');
  assert.equal(result.applied, true);
  assert.equal(result.state.playerItems.letter, 1);
  assert.deepEqual(result.state.discoveredNpcs, ['ada', 'eve']);
  assert.deepEqual(makeView(script, result.state).npcs.map((npc) => npc.id), ['ada', 'eve']);
});

test('time can be advanced repeatedly without affecting chat turns', () => {
  let state = createInitialState(script, { name: '阿宁' });
  state = advanceTime(script, state);
  assert.equal(state.periodIndex, 1);
  state = advanceTime(script, advanceTime(script, state));
  assert.equal(state.periodIndex, 0);
  assert.equal(state.day, 2);
  assert.equal(state.turns, 0);
});

test('indicator-derived placement is NPC-specific while a location stays unlocked', () => {
  const game = loadScript('sword-and-screen');
  let state = createInitialState(game, { name: '阿言' });
  assert.deepEqual(makeView(game, state).locations.map((place) => place.id), ['player-home']);
  assert.deepEqual(makeView(game, state).npcs.map((npc) => npc.id), ['su-nian']);
  let changed = structuredClone(state);
  changed.npcIndicators!['su-nian'].affection.value = 30;
  state = settleWorld(game, state, changed, { kind: 'chat', summary: '与苏念对话' }, () => 0).state;
  assert.equal(state.npcIndicators?.['su-nian'].metInPerson.value, true);
  assert.deepEqual(makeView(game, state).locations.map((place) => place.id), ['player-home', 'restaurant']);
  assert.equal(makeView(game, state).npcs.length, 0);
  state.locationId = 'restaurant';
  assert.deepEqual(makeView(game, state).npcs.map((npc) => npc.id), ['su-nian']);
  changed = structuredClone(state);
  changed.npcIndicators!['su-nian'].affection.value = 60;
  state = settleWorld(game, state, changed, { kind: 'chat', summary: '与苏念对话' }, () => 0).state;
  assert.equal(state.npcIndicators?.['su-nian'].visitedHerHome.value, true);
  assert.deepEqual(makeView(game, state).locations.map((place) => place.id), ['player-home', 'restaurant', 'her-home']);
  assert.equal(makeView(game, state).npcs.length, 0);
  state.locationId = 'her-home';
  assert.equal(makeView(game, state).npcs[0]?.channel, 'in-person');
});

test('tagged items and cross-NPC rules use canonical runtime state', () => {
  const state = createInitialState(script, { name: '阿宁' });
  state.itemStates.key.owner = 'player';
  state.itemStates.key.tags.push('染血');
  state.npcStats.eve.trust = 40;
  state.npcTags.eve.push('知情');
  const condition = { all: [
    { hasItem: { owner: 'player', item: 'key', tags: ['染血'] } },
    { stat: { npc: 'eve', id: 'trust', gte: 30 } },
    { npcTag: { npc: 'eve', tag: '知情' } },
  ] } as const;
  assert.equal(evaluateCondition(condition, state, script), true);
  assert.deepEqual(script.items[0], { id: 'key', name: '钥匙' });
  const failed = applyEvent(script, state, 'get-key');
  assert.equal(failed.applied, false);
  assert.equal(state.itemStates.key.owner, 'player');
});

test('hidden discovery and taking have separate gates', () => {
  const game = loadScript('sword-and-screen');
  let state = createInitialState(game, { name: '阿言' });
  assert.equal(makeView(game, state).location?.items.length, 0);
  state = searchLocation(game, state).state;
  assert.deepEqual(makeView(game, state).location?.items.map((item) => item.id), ['game-screenshot']);
  state = takeLocationItem(game, state, 'game-screenshot').state;
  assert.equal(state.itemStates['game-screenshot'].owner, 'player');
  state.npcIndicators!['su-nian'].affection.value = 60;
  state.npcIndicators!['su-nian'].metInPerson.value = true;
  state.npcIndicators!['su-nian'].visitedHerHome.value = true;
  state.locationId = 'her-home';
  state = refreshWorld(game, state);
  state = searchLocation(game, state).state;
  assert.deepEqual(makeView(game, state).location?.items.map((item) => item.id), ['old-photo']);
  assert.equal(takeLocationItem(game, state, 'old-photo').applied, false);
  state.flags.push('knows-kendo');
  state = searchLocation(game, state).state;
  assert.ok(makeView(game, state).location?.items.some((item) => item.id === 'practice-note'));
  assert.equal(state.itemStates['practice-note'].owner, 'location:her-home');
});

test('exclusive events select stable priority and pre-turn gates ignore newly acquired items', () => {
  const game = { ...script, events: [
    { id: 'small', npc: 'ada', intent: 'kindness', trigger: 'semantic', priority: 1, exclusiveGroup: 'mood', effects: [{ type: 'changeStat', scope: 'npc', npc: 'ada', id: 'trust', by: 2 }] },
    { id: 'large', npc: 'ada', intent: 'kindness', trigger: 'semantic', priority: 9, exclusiveGroup: 'mood', effects: [{ type: 'changeStat', scope: 'npc', npc: 'ada', id: 'trust', by: 6 }] },
    { id: 'grant', npc: 'ada', intent: 'grant', trigger: 'semantic', effects: [{ type: 'transferItem', from: 'npc:ada', to: 'player', item: 'key' }] },
    { id: 'use', npc: 'ada', intent: 'use', trigger: 'semantic', condition: { hasItem: { owner: 'player', item: 'key' } }, effects: [{ type: 'setFlag', flag: 'used-key' }] },
  ] } as const;
  const state = createInitialState(game, { name: '阿宁' });
  const result = settlePlayerEvents(game, state, 'ada', ['small', 'large', 'grant', 'use']);
  assert.deepEqual(result.applied.map((event) => event.id), ['large', 'grant']);
  assert.equal(result.state.npcStats.ada.trust, 6);
  assert.equal(result.state.itemStates.key.owner, 'player');
  assert.equal(result.state.flags.includes('used-key'), false);
});
