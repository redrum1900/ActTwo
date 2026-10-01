import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, makeView, searchLocation } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';

test('search records a discovered item but does not invent hidden discoveries', async () => {
  const module = await import('../packages/engine/src/activity-log.js').catch(() => ({} as { settleWorld?: unknown }));
  assert.equal(typeof module.settleWorld, 'function');
  const { settleWorld, appendActivity } = module as typeof import('../packages/engine/src/activity-log.js');
  const script = loadScript('sword-and-screen');
  const initial = createInitialState(script, { name: '阿言' });
  const searched = searchLocation(script, initial).state;
  const result = settleWorld(script, initial, searched, { kind: 'search', summary: '搜索玩家家中' }, () => 0);
  assert.deepEqual(result.changes.filter((entry) => entry.kind === 'item_discovered').map((entry) => entry.entityId), ['game-screenshot']);
  assert.equal(result.changes.some((entry) => entry.entityId === 'practice-note'), false);
  const logged = appendActivity(script, result.state, { kind: 'search', summary: '搜索玩家家中' }, result.changes);
  assert.equal(logged.activityLog.length, 1);
  assert.equal(logged.activityLog[0].summary, '搜索玩家家中');
  assert.equal(logged.activityLog[0].details[0].kind, 'item_discovered');
});

test('an eligible indicator milestone unlocks its location in the same settlement', async () => {
  const module = await import('../packages/engine/src/activity-log.js').catch(() => ({} as { settleWorld?: unknown }));
  assert.equal(typeof module.settleWorld, 'function');
  const { settleWorld } = module as typeof import('../packages/engine/src/activity-log.js');
  const script = loadScript('sword-and-screen');
  const initial = createInitialState(script, { name: '阿言' });
  const after = structuredClone(initial);
  after.npcIndicators!['su-nian'].affection.value = 30;
  const result = settleWorld(script, initial, after, { kind: 'chat', summary: '与苏念对话', npcId: 'su-nian' }, () => 0);
  assert.equal(result.state.npcIndicators?.['su-nian'].metInPerson.value, true);
  assert.deepEqual(result.changes.filter((entry) => entry.kind === 'location_unlocked').map((entry) => entry.entityId), ['restaurant']);
  assert.deepEqual(result.changes.filter((entry) => entry.kind === 'gallery').map((entry) => entry.entityId), ['first-meeting']);
});

test('public log and view show visible player indicators but never hidden ones; NPC moves are logged', async () => {
  const { settleWorld } = await import('../packages/engine/src/activity-log.js');
  const base = loadScript('sword-and-screen');
  const script = { ...base, playerIndicators: [
    { id: 'energy', name: '精力', type: 'number' as const, initial: 2, min: 0, max: 10, playerVisible: true },
    { id: 'curse', name: '诅咒', type: 'boolean' as const, initial: false, playerVisible: false },
  ], npcs: base.npcs.map((npc) => ({ ...npc, initialLocationId: 'player-home' })) };
  const before = createInitialState(script, { name: '阿言' });
  before.discoveredNpcs.push('su-nian');
  const after = structuredClone(before);
  after.playerIndicators!.energy.value = 3;
  after.playerIndicators!.curse.value = true;
  after.npcLocations!['su-nian'] = 'restaurant';
  const result = settleWorld(script, before, after, { kind: 'wait', summary: '等待' });
  assert.equal(result.changes.some((entry) => entry.entityId === 'player:energy'), true);
  assert.equal(result.changes.some((entry) => entry.entityId === 'player:curse'), false);
  assert.equal(result.changes.some((entry) => entry.kind === 'npc_move' && entry.entityId === 'su-nian'), true);
  const publicView = makeView(script, result.state);
  assert.equal(publicView.playerIndicators.some((entry) => entry.id === 'curse'), false);
  assert.equal(publicView.playerIndicators.some((entry) => entry.id === 'energy'), true);
});
