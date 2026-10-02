import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'mysql2/promise';
import { releaseVersion } from '../apps/api/src/db/mysql-published-versions.js';
import { migrateMysql } from '../apps/api/src/db/migrations.js';

test('approved release sequence produces stable display versions past 1.9', () => {
  assert.equal(releaseVersion(1), '1.0');
  assert.equal(releaseVersion(2), '1.1');
  assert.equal(releaseVersion(10), '1.9');
  assert.equal(releaseVersion(11), '1.10');
  assert.throws(() => releaseVersion(0));
});

test('existing MySQL v1 schema is upgraded and latest publications are backfilled', async () => {
  const statements: string[] = [];
  const pool = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT DATABASE()')) return [[{ name: 'test' }]];
      if (sql.includes('AS missing')) return [[{ missing: 0 }]];
      if (sql.includes('FROM schema_migrations')) return [[{ version: 1 }]];
      return [[{ total: 1 }]];
    },
    execute: async (sql: string) => { statements.push(sql); return [[]]; },
  } as unknown as Pool;
  await migrateMysql(pool);
  assert.ok(statements.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS published_script_versions')));
  assert.ok(statements.some(sql => sql.includes('INSERT INTO published_script_versions') && sql.includes('published_scripts')));
  assert.ok(statements.some(sql => sql.includes('UPDATE schema_migrations') && sql.includes('version=2')));
});
