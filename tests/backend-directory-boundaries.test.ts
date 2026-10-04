import test from 'node:test';
import assert from 'node:assert/strict';
import { createMysqlPool } from '../apps/api/src/infrastructure/mysql/mysql.js';
import { withCreatorMysql } from './support/creator-mysql.js';

test('MySQL infrastructure rejects missing connection settings before opening a pool', () => {
  assert.throws(() => createMysqlPool({}), /MYSQL_HOST 未配置/);
});

test('creator module stores preserve draft ownership', async () => {
  await withCreatorMysql(async ({ accounts, projects }) => {
    const owner = (await accounts.register('draftowner', 'password-123')).account;
    const other = (await accounts.register('otherauthor', 'password-123')).account;
    const created = await projects.create(owner.id, 'owned-draft', 'Owned draft');
    assert.equal((await projects.get(owner.id, created.id))?.title, 'Owned draft');
    assert.equal(await projects.get(other.id, created.id), null);
  });
});
