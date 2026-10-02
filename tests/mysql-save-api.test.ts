import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createInitialState } from '@game/engine';
import { loadScript } from '@game/script';
import { createMysqlPool } from '../apps/api/src/db/mysql.js';

test('MySQL save revisions and gallery commit atomically, and manual load restores state',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
    const { createMysqlSaveStore } = await import('../apps/api/src/db/mysql-save-store.js');
    const pool = createMysqlPool(process.env);
    const saves = createMysqlSaveStore(pool);
    const owner = `test-${randomUUID()}`;
    const game = 'test-game';
    const script = loadScript('sword-and-screen');
    const state = createInitialState(script, { name: '测试', birthday: '2000-01-01' });
    try {
      const initial = await saves.putAuto(owner, game, state);
      assert.equal(initial.revision, 1);
      const awarded = { ...state, awardedGallery: [{ kind: 'achievement' as const, id: 'test-award' }] };
      await assert.rejects(saves.updateAutoWithGallery(owner, game, 999, awarded), /存档已变化/);
      assert.equal((await saves.getAuto(owner, game))?.revision, 1);
      assert.deepEqual(await saves.getGallery(owner, game), []);
      const updated = await saves.updateAutoWithGallery(owner, game, 1, awarded);
      assert.equal(updated.revision, 2);
      assert.deepEqual(await saves.getGallery(owner, game), [{ kind: 'achievement', id: 'test-award' }]);
      await saves.saveManual(owner, game, 1, '第一槽', updated.state);
      await saves.putAuto(owner, game, state);
      assert.equal((await saves.loadManual(owner, game, 1))?.state.awardedGallery.length, 1);
      assert.equal(await saves.updateDerivedMemory(owner, game, initial, state), false);
    } finally {
      await pool.execute('DELETE FROM gallery WHERE owner_id=?', [owner]);
      await pool.execute('DELETE FROM save_slots WHERE owner_id=?', [owner]);
      await pool.end();
    }
  });
