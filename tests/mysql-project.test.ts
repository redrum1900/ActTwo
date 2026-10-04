import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createMysqlPool } from '../apps/api/src/infrastructure/mysql/mysql.js';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';

test('MySQL project preserves sections, ownership, and optimistic revision',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
    const { createMysqlProjectStore } = await import('../apps/api/src/infrastructure/mysql/mysql-project-store.js');
    const pool = createMysqlPool(process.env);
    const accounts = createMysqlCreatorStore(pool);
    const projects = createMysqlProjectStore(pool);
    const suffix = randomUUID().replaceAll('-', '');
    const projectId = `test-${suffix}`;
    const account = await accounts.register(`test_${suffix.slice(0, 20)}`, 'sample-password-123');
    try {
      const created = await projects.create(account.account.id, projectId, '测试故事');
      assert.equal(created.sections['manifest.json'].revision, 1);
      assert.equal((await projects.get(account.account.id, projectId))?.title, '测试故事');
      await assert.rejects(projects.putSection(randomUUID(), projectId, 'manifest.json', '{}', 1), /无权访问/);

      const first = JSON.stringify({ id: projectId, title: '版本甲' });
      const second = JSON.stringify({ id: projectId, title: '版本乙' });
      const writes = await Promise.allSettled([
        projects.putSection(account.account.id, projectId, 'manifest.json', first, 1),
        projects.putSection(account.account.id, projectId, 'manifest.json', second, 1),
      ]);
      assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = writes.find(result => result.status === 'rejected');
      assert.equal(rejected?.status, 'rejected');
      if (rejected?.status === 'rejected') assert.match(String(rejected.reason), /保存冲突/);
      assert.equal((await projects.get(account.account.id, projectId))?.sections['manifest.json'].revision, 2);

      const withNpc = await projects.addNpc(account.account.id, projectId, 'test-npc', '测试角色');
      assert.ok(withNpc.sections['npcs/test-npc/base.json']);
      const withoutNpc = await projects.removeNpc(account.account.id, projectId, 'test-npc');
      assert.equal(withoutNpc.sections['npcs/test-npc/base.json'], undefined);
    } finally {
      await pool.execute('DELETE FROM creator_sections WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM creator_projects WHERE id=?', [projectId]);
      await pool.execute('DELETE FROM creator_sessions WHERE account_id=?', [account.account.id]);
      await pool.execute('DELETE FROM creator_accounts WHERE id=?', [account.account.id]);
      await pool.end();
    }
  });
