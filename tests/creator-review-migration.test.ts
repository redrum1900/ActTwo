import test from 'node:test';
import assert from 'node:assert/strict';
import { createMysqlScriptRepository } from '../apps/api/src/script-repository.js';
import { migrateMysql } from '../apps/api/src/infrastructure/mysql/migrations.js';
import { withCreatorMysql } from './support/creator-mysql.js';

test('MySQL v1 published story remains in catalog after version migration', async () => {
  await withCreatorMysql(async ({ pool, accounts, projects, reviews }) => {
    const author = (await accounts.register('legacy_author', 'password-password')).account.id;
    const admin = (await accounts.createAdmin('legacy_admin', 'password-password')).id;
    await projects.create(author, 'legacy-story', '原有线上故事');
    await reviews.approve(admin, (await reviews.submit(author, 'legacy-story')).id);
    await pool.execute('DELETE FROM published_script_versions WHERE project_id=?', ['legacy-story']);
    await pool.execute('UPDATE schema_migrations SET version=1 WHERE version=6');
    await migrateMysql(pool);
    const repository = createMysqlScriptRepository(projects);
    assert.equal((await repository.get('legacy-story')).title, '原有线上故事');
    assert.equal((await repository.list()).some(entry => entry.id === 'legacy-story'), true);
    assert.deepEqual(await reviews.listPending(), []);
    const published = (await projects.getPublished('legacy-story'))!;
    assert.equal((await projects.getPublishedExact('legacy-story', published.version, published.contentHash!))?.title, '原有线上故事');
  });
});
