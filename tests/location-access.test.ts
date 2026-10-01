import assert from 'node:assert/strict';
import test from 'node:test';
import { loadScript } from '../packages/script/src/index.js';
import * as engine from '../packages/engine/src/index.js';

const { createInitialState, makeView, refreshWorld } = engine;

function setup() {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.locations = script.locations.map((location) => location.id === 'restaurant' ? { ...location,
    visibleWhen: { playerIndicator: { id: 'cursed', eq: true } },
    enterWhen: { playerIndicator: { id: 'stamina', gte: 50 } } } : location);
  script.playerIndicators = [
    { id: 'cursed', name: '诅咒', type: 'boolean', initial: false, playerVisible: false },
    { id: 'stamina', name: '体力', type: 'number', initial: 40, min: 0, max: 100, playerVisible: true },
  ];
  script.npcs = script.npcs.map((npc) => ({ ...npc, initialLocationId: 'restaurant' }));
  return { script, state: createInitialState(script, { name: '阿言' }) };
}

test('discovered location stays visible while entry is checked from current player state', () => {
  assert.equal(typeof engine.canEnterLocation, 'function');
  const canEnterLocation = engine.canEnterLocation;
  const { script, state } = setup();
  assert.equal(makeView(script, state).locations.some((location) => location.id === 'restaurant'), false);
  state.playerIndicators!.cursed.value = true;
  const discovered = refreshWorld(script, state);
  assert.equal(discovered.unlockedLocations.includes('restaurant'), true);
  assert.equal(makeView(script, discovered).locations.find((location) => location.id === 'restaurant')?.enterable, false);
  assert.equal(canEnterLocation(script, discovered, 'restaurant'), false);
  discovered.playerIndicators!.cursed.value = false;
  discovered.playerIndicators!.stamina.value = 60;
  assert.equal(makeView(script, discovered).locations.find((location) => location.id === 'restaurant')?.enterable, true);
  assert.equal(canEnterLocation(script, discovered, 'restaurant'), true);
  discovered.playerIndicators!.stamina.value = 40;
  discovered.locationId = 'restaurant';
  assert.equal(makeView(script, discovered).locationId, 'restaurant');
  assert.equal(canEnterLocation(script, discovered, 'restaurant'), false);
});

test('NPC actual location is independent of whether the player can enter it', () => {
  const { script, state } = setup();
  assert.equal(state.npcLocations?.['su-nian'], 'restaurant');
  assert.equal(makeView(script, state).npcs.some((npc) => npc.id === 'su-nian'), false);
  const inside = { ...state, locationId: 'restaurant' };
  assert.equal(makeView(script, inside).npcs.some((npc) => npc.id === 'su-nian'), true);
});
