import test from 'node:test';
import assert from 'node:assert/strict';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';
import { withTestMysql } from './support/mysql-test-db.js';

const script = loadScript('sword-and-screen');

test('derived memory does not bump revision and cannot cross a newer save or loaded slot', async () => {
  await withTestMysql(async pool => {
    const store = createMysqlSaveStore(pool);
    const saved = await store.putAuto('owner', script.id, createInitialState(script, {}));
    const derived = structuredClone(saved.state);
    derived.memorySegments['su-nian'] = [{ throughMessageId: 'test', summary: '记忆' }];
    assert.equal(await store.updateDerivedMemory('owner', script.id, saved, derived), true);
    assert.equal((await store.getAuto('owner', script.id))!.revision, saved.revision);
    assert.equal((await store.getAuto('owner', script.id))!.state.memorySegments['su-nian'][0].summary, '记忆');
    await store.putAuto('owner', script.id, createInitialState(script, { name: 'new' }));
    assert.equal(await store.updateDerivedMemory('owner', script.id, saved, derived), false);
    assert.equal((await store.getAuto('owner', script.id))!.state.player.name, 'new');
    assert.equal((await store.getAuto('owner', script.id))!.state.memorySegments['su-nian'], undefined);
  });
});

test('manual slots are isolated by game and loading one immediately replaces its auto slot', async () => {
  await withTestMysql(async pool => {
    const store = createMysqlSaveStore(pool);
    const first = createInitialState(script, { name: '甲' });
    await store.putAuto('guest-a', script.id, first);
    await store.saveManual('guest-a', script.id, 1, '车站', first);
    await store.putAuto('guest-a', script.id, { ...first, locationId: 'restaurant' });
    const loaded = await store.loadManual('guest-a', script.id, 1);
    assert.equal(loaded?.state.locationId, 'player-home');
    assert.equal((await store.getAuto('guest-a', script.id))?.state.locationId, 'player-home');
    assert.equal(await store.getAuto('guest-b', script.id), null);
    assert.equal(await store.getAuto('guest-a', 'other-story'), null);
  });
});

test('a stale revision cannot overwrite a newer chat turn', async () => {
  await withTestMysql(async pool => {
    const store = createMysqlSaveStore(pool);
    const state = createInitialState(script, { name: '甲' });
    const first = await store.putAuto('guest-a', script.id, state);
    await store.updateAuto('guest-a', script.id, first.revision, { ...state, day: 2 });
    await assert.rejects(store.updateAuto('guest-a', script.id, first.revision, { ...state, day: 3 }), /存档已变化/);
    assert.equal((await store.getAuto('guest-a', script.id))?.state.day, 2);
  });
});

test('gallery unlocks survive new games and manual save loads', async () => {
  await withTestMysql(async pool => {
    const store = createMysqlSaveStore(pool);
    const state = createInitialState(script, { name: '甲' });
    await store.putAuto('guest-a', script.id, state);
    await store.unlockGallery('guest-a', script.id, 'achievement', 'first-clue');
    await store.putAuto('guest-a', script.id, createInitialState(script, { name: '乙' }));
    assert.deepEqual(await store.getGallery('guest-a', script.id), [{ kind: 'achievement', id: 'first-clue' }]);
  });
});

test('auto-save and gallery awards commit atomically and survive manual loads', async () => {
  await withTestMysql(async pool => {
    const store = createMysqlSaveStore(pool);
    const state = createInitialState(script, { name: '甲' });
    const first = await store.putAuto('guest-a', script.id, state);
    const awarded = { ...state, day: 2, awardedGallery: [{ kind: 'achievement' as const, id: 'first-clue' }] };
    await assert.rejects(store.updateAutoWithGallery('guest-a', script.id, first.revision + 1, awarded), /存档已变化/);
    assert.deepEqual(await store.getGallery('guest-a', script.id), []);
    await store.updateAutoWithGallery('guest-a', script.id, first.revision, awarded);
    await store.saveManual('guest-a', script.id, 1, '获奖后', awarded);
    await store.putAuto('guest-a', script.id, state);
    await store.loadManual('guest-a', script.id, 1);
    assert.deepEqual(await store.getGallery('guest-a', script.id), [{ kind: 'achievement', id: 'first-clue' }]);
  });
});

test('story event snapshots survive manual loads and stale revisions cannot overwrite them', async () => {
  await withTestMysql(async pool => {
    const store = createMysqlSaveStore(pool);
    const initial = createInitialState(script, { name: '甲' });
    const first = await store.putAuto('guest-a', script.id, initial);
    const recorded = structuredClone(initial);
    recorded.storyEventFlags.push(structuredClone(script.storyEvents[0]));
    await store.updateAuto('guest-a', script.id, first.revision, recorded);
    await store.saveManual('guest-a', script.id, 1, '告白后', recorded);
    await assert.rejects(store.updateAuto('guest-a', script.id, first.revision, initial), /存档已变化/);
    assert.deepEqual((await store.getAuto('guest-a', script.id))?.state.storyEventFlags, [script.storyEvents[0]]);
    await store.putAuto('guest-a', script.id, initial);
    await store.loadManual('guest-a', script.id, 1);
    assert.deepEqual((await store.getAuto('guest-a', script.id))?.state.storyEventFlags, [script.storyEvents[0]]);
  });
});
