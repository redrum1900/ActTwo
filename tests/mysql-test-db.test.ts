import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import {
  assertTestMysqlConfig,
  assertTestMysqlDatabase,
  withTestMysql,
} from './support/mysql-test-db.js';

const valid = {
  MYSQL_HOST: 'production.example', MYSQL_DATABASE: 'story',
  MYSQL_TEST_HOST: 'test.example', MYSQL_TEST_PORT: '3306',
  MYSQL_TEST_DATABASE: 'story_test', MYSQL_TEST_USER: 'tester', MYSQL_TEST_PASSWORD: 'test-password',
};

test('test MySQL config refuses missing test credentials without falling back to production', () => {
  assert.throws(() => assertTestMysqlConfig({ ...valid, MYSQL_TEST_HOST: '' }), /MYSQL_TEST_HOST/);
  assert.throws(() => assertTestMysqlConfig({ ...valid, MYSQL_TEST_PASSWORD: '' }), /MYSQL_TEST_PASSWORD/);
  assert.throws(() => assertTestMysqlConfig({ ...valid, MYSQL_DATABASE: '' }), /MYSQL_DATABASE/);
});

test('test MySQL config refuses a production or non-test database', () => {
  assert.throws(() => assertTestMysqlConfig({ ...valid, MYSQL_TEST_DATABASE: 'story' }), /测试库|正式库/);
  assert.throws(() => assertTestMysqlConfig({ ...valid, MYSQL_TEST_DATABASE: 'shadow' }), /test/);
});

test('selected MySQL database must match the guarded test database', async () => {
  const pool = { query: async () => [[{ name: 'story' }]] } as unknown as Pool;
  await assert.rejects(assertTestMysqlDatabase(pool, 'story_test'), /测试库|数据库/);
});

test('guarded MySQL fixture clears only its selected test database', async () => {
  await withTestMysql(async pool => {
    await pool.execute(`INSERT INTO save_slots
      (owner_id,game_id,slot,label,state_json,revision,updated_at)
      VALUES ('guard-test','guard-game',0,'自动存档','{}',1,'2026-01-01')`);
  });
  await withTestMysql(async pool => {
    const [rows] = await pool.execute('SELECT slot FROM save_slots WHERE owner_id=?', ['guard-test']);
    assert.deepEqual(rows, []);
  });
});
