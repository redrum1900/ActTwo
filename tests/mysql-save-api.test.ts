import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createInitialState } from '@game/engine';
import { loadScript } from '@game/script';
import { createMysqlPool } from '../apps/api/src/db/mysql.js';
import type { AddressInfo } from 'node:net';
import { createApp } from '../apps/api/src/app.js';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createMysqlCreatorStore } from '../apps/api/src/db/mysql-auth-store.js';
import { createMysqlProjectStore } from '../apps/api/src/db/mysql-project-store.js';
import { createMysqlReviewStore } from '../apps/api/src/db/mysql-review-store.js';
import { createMysqlSaveStore } from '../apps/api/src/db/mysql-save-store.js';

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

test('MySQL-backed API lists only published projects and persists a new game',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
    const pool = createMysqlPool(process.env);
    const accounts = createMysqlCreatorStore(pool);
    const projects = createMysqlProjectStore(pool);
    const reviews = createMysqlReviewStore(pool, projects);
    const saves = createMysqlSaveStore(pool);
    const suffix = randomUUID().replaceAll('-', '');
    const projectId = `test-${suffix}`;
    const account = await accounts.register(`test_${suffix.slice(0, 20)}`, 'sample-password-123');
    const script = { ...loadScript('sword-and-screen'), id: projectId };
    await projects.create(account.account.id, projectId, 'API 测试');
    await pool.execute(`INSERT INTO published_scripts (project_id,script_json,version,content_hash,published_at)
      VALUES (?,?,?,?,?)`, [projectId, JSON.stringify(script), script.version, script.contentHash ?? '', new Date().toISOString()]);
    await pool.execute(`INSERT INTO published_script_versions
      (project_id,release_sequence,script_json,version,content_hash,published_at)
      VALUES (?,1,?,?,?,?)`, [projectId, JSON.stringify(script), script.version, script.contentHash ?? '', new Date().toISOString()]);
    const server = createApp(saves, createChatAdapter({}), { creatorStore: accounts, projectStore: projects,
      reviewStore: reviews, mysqlPool: pool }).listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let cookie = `gd_creator=${account.token}`;
    const request = async (route: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${base}${route}`, { method,
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
      return { status: response.status, body: await response.json() as any };
    };
    try {
      const catalog = await request('/api/catalog');
      assert.equal(catalog.status, 200);
      assert.ok(catalog.body.games.some((entry: { id: string }) => entry.id === projectId));
      assert.ok(!catalog.body.games.some((entry: { id: string }) => entry.id === 'sword-and-screen'));
      const templates = await fetch(`${base}/api/creator/templates`,
        { headers: { Cookie: `gd_creator=${account.token}` } });
      assert.equal(templates.status, 200);
      assert.deepEqual((await templates.json() as { templates: unknown[] }).templates, []);
      const started = await request(`/api/games/${projectId}/new`, 'POST',
        { player: { name: '测试', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] } });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      assert.equal(started.body.revision, 1);
      const current = await request(`/api/games/${projectId}/current`);
      assert.equal(current.body.revision, 1);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await pool.execute('DELETE FROM gallery WHERE game_id=?', [projectId]);
      await pool.execute('DELETE FROM save_slots WHERE game_id=?', [projectId]);
      await pool.execute('DELETE FROM published_script_versions WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM published_scripts WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM creator_sections WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM creator_projects WHERE id=?', [projectId]);
      await pool.execute('DELETE FROM creator_sessions WHERE account_id=?', [account.account.id]);
      await pool.execute('DELETE FROM creator_accounts WHERE id=?', [account.account.id]);
      await pool.end();
    }
  });
