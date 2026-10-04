import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertTestMysqlConfig } from './support/mysql-test-db.js';

test('diagnostic scripts do not open SQLite or invoke its CLI', () => {
  for (const name of ['probe-prompt-layout', 'probe-memory-ten-turns', 'export-prompt-preview']) {
    const source = readFileSync(new URL(`../scripts/${name}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /better-sqlite3|data\/game\.sqlite|\bsqlite3\b/);
  }
});

test('memory probe test-database guard refuses production selection', () => {
  assert.throws(() => assertTestMysqlConfig({ MYSQL_DATABASE: 'story', MYSQL_TEST_DATABASE: 'story',
    MYSQL_TEST_HOST: 'localhost', MYSQL_TEST_PORT: '3306', MYSQL_TEST_USER: 'test', MYSQL_TEST_PASSWORD: 'test' }),
  /测试库不能与正式库相同/);
});
