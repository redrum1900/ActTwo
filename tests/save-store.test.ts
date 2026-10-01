import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';

const script = loadScript('sword-and-screen');

test('derived memory does not bump revision and cannot cross a newer save or loaded slot', () => {
  const store = createSaveStore(':memory:');
  const saved = store.putAuto('owner', script.id, createInitialState(script, {}));
  const derived = structuredClone(saved.state);
  derived.memorySegments['su-nian'] = [{ throughMessageId: 'test', summary: '记忆' }];
  assert.equal(store.updateDerivedMemory('owner', script.id, saved, derived), true);
  assert.equal(store.getAuto('owner', script.id)!.revision, saved.revision);
  assert.equal(store.getAuto('owner', script.id)!.state.memorySegments['su-nian'][0].summary, '记忆');
  store.putAuto('owner', script.id, createInitialState(script, { name: 'new' }));
  assert.equal(store.updateDerivedMemory('owner', script.id, saved, derived), false);
  assert.equal(store.getAuto('owner', script.id)!.state.player.name, 'new');
  assert.equal(store.getAuto('owner', script.id)!.state.memorySegments['su-nian'], undefined);
  store.close();
});

test('manual slots are isolated by game and loading one immediately replaces its auto slot', () => {
  const store = createSaveStore(':memory:');
  const first = createInitialState(script, { name: '甲' });
  store.putAuto('guest-a', script.id, first);
  store.saveManual('guest-a', script.id, 1, '车站', first);
  const changed = { ...first, locationId: 'restaurant' };
  store.putAuto('guest-a', script.id, changed);
  const loaded = store.loadManual('guest-a', script.id, 1);
  assert.equal(loaded?.state.locationId, 'player-home');
  assert.equal(store.getAuto('guest-a', script.id)?.state.locationId, 'player-home');
  assert.equal(store.getAuto('guest-b', script.id), null);
  assert.equal(store.getAuto('guest-a', 'other-story'), null);
  store.close();
});

test('a stale revision cannot overwrite a newer chat turn', () => {
  const store = createSaveStore(':memory:');
  const state = createInitialState(script, { name: '甲' });
  const first = store.putAuto('guest-a', script.id, state);
  store.updateAuto('guest-a', script.id, first.revision, { ...state, day: 2 });
  assert.throws(() => store.updateAuto('guest-a', script.id, first.revision, { ...state, day: 3 }), /存档已变化/);
  assert.equal(store.getAuto('guest-a', script.id)?.state.day, 2);
  store.close();
});

test('gallery unlocks survive new games and manual save loads', () => {
  const store = createSaveStore(':memory:');
  const state = createInitialState(script, { name: '甲' });
  store.putAuto('guest-a', script.id, state);
  store.unlockGallery('guest-a', script.id, 'achievement', 'first-clue');
  store.putAuto('guest-a', script.id, createInitialState(script, { name: '乙' }));
  assert.deepEqual(store.getGallery('guest-a', script.id), [{ kind: 'achievement', id: 'first-clue' }]);
  store.close();
});

test('auto-save and gallery awards commit atomically and survive manual loads', () => {
  const store = createSaveStore(':memory:');
  const state = createInitialState(script, { name: '甲' });
  const first = store.putAuto('guest-a', script.id, state);
  const awarded = { ...state, day: 2, awardedGallery: [{ kind: 'achievement' as const, id: 'first-clue' }] };
  assert.throws(() => store.updateAutoWithGallery('guest-a', script.id, first.revision + 1, awarded), /存档已变化/);
  assert.deepEqual(store.getGallery('guest-a', script.id), []);
  store.updateAutoWithGallery('guest-a', script.id, first.revision, awarded);
  store.saveManual('guest-a', script.id, 1, '获奖后', awarded);
  store.putAuto('guest-a', script.id, state);
  store.loadManual('guest-a', script.id, 1);
  assert.deepEqual(store.getGallery('guest-a', script.id), [{ kind: 'achievement', id: 'first-clue' }]);
  store.close();
});
