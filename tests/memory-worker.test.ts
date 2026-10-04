import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryWorker } from '../apps/api/src/modules/gameplay/memory-worker.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';
import { withTestMysql } from './support/mysql-test-db.js';
const script = loadScript('sword-and-screen');
test('background compression deduplicates work and discards result after a new game', async () => {
  await withTestMysql(async pool => {
  const store = createMysqlSaveStore(pool);
  const state = createInitialState(script, {});
  state.chats['su-nian'] = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'npc' : 'player', text: '字'.repeat(300), at: 'now' }));
  const saved = await store.putAuto('owner', script.id, state);
  let release!: (value: string) => void;
  let calls = 0;
  const worker = createMemoryWorker(store, { mode: 'demo', generate: async () => ({ message: '', proposedEventIds: [] }), rewrite: async () => '',
    summarize: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = worker('owner', script, saved, 'su-nian');
  const duplicate = worker('owner', script, saved, 'su-nian');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  await store.putAuto('owner', script.id, createInitialState(script, { name: 'new' }));
  release(JSON.stringify({ version: 1, facts: [{ text: '旧事实', sourceMessageIds: ['m0'] }], relationship: [], commitments: [], boundaries: [], openTopics: [] }));
  await Promise.all([first, duplicate]);
  assert.deepEqual((await store.getAuto('owner', script.id))!.state.memorySegments, {});
  });
});
