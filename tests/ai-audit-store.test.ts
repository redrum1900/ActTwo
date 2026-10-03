import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { migrateMysql } from '../apps/api/src/db/migrations.js';
import { createMysqlAiAuditStore } from '../apps/api/src/db/mysql-ai-audit-store.js';

test('AI call details include the current story name alongside the story ID', async () => {
  const audit = createMysqlAiAuditStore({ execute: async () => [[{
    id: 'call-1', account_id: 'A', source: 'import', story_id: 'story-one', story_title: '故事名称',
    playtest_deleted: 0, playtest_id: null, release_version: null, operation_id: 'import-1', purpose: 'import',
    model: 'model', provider_index: 0, started_at: '2026-10-03T00:00:00.000Z', duration_ms: 10,
    http_status: 200, outcome: 'success', input_tokens: 7, output_tokens: 9,
    cache_write_tokens: null, cache_read_tokens: null,
  }]] } as unknown as Pool);
  assert.deepEqual((await audit.listOwn('A')).rows.map(row => [row.storyId, row.storyTitle]), [['story-one', '故事名称']]);
});

test('AI audit keeps unknown cache usage null and never stores prompts', async () => {
  const { aiCallRecord } = await import('../apps/api/src/ai-audit.js');
  const row = aiCallRecord({ accountId: 'A', source: 'formal', storyId: 'story', operationId: 'turn',
    purpose: 'reply', model: 'model', providerIndex: 0, startedAt: '2026-10-03T00:00:00.000Z', durationMs: 10,
    httpStatus: 200, outcome: 'success', inputTokens: 7, outputTokens: 9 });
  assert.equal(row.cacheWriteTokens, null);
  assert.equal(row.cacheReadTokens, null);
  assert.equal('prompt' in row, false);
  assert.equal('response' in row, false);
});

test('AI audit writes one detail and one durable monthly total, scoped by account', async () => {
  const statements: { sql: string; params: unknown[] }[] = [];
  const execute = async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    return sql.includes('FROM ai_call_records') && sql.startsWith('SELECT') ? [[{ id: 'row', account_id: 'A', source: 'formal', story_id: 'story',
      playtest_id: null, release_version: null, operation_id: 'turn', purpose: 'reply', model: 'model', provider_index: 0,
      started_at: '2026-10-03T00:00:00.000Z', duration_ms: 10, http_status: 200, outcome: 'success', input_tokens: 7,
      output_tokens: 9, cache_write_tokens: null, cache_read_tokens: null }]] : [[]];
  };
  const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, execute };
  const pool = { getConnection: async () => connection, execute } as unknown as Pool;
  const audit = createMysqlAiAuditStore(pool);
  const { aiCallRecord } = await import('../apps/api/src/ai-audit.js');
  await audit.record(aiCallRecord({ accountId: 'A', source: 'formal', storyId: 'story', operationId: 'turn', purpose: 'reply',
    model: 'model', providerIndex: 0, startedAt: '2026-10-03T00:00:00.000Z', durationMs: 10, httpStatus: 200,
    outcome: 'success', inputTokens: 7, outputTokens: 9 }));
  assert.equal(statements.filter(entry => entry.sql.startsWith('INSERT INTO ai_call_records')).length, 1);
  assert.equal(statements.filter(entry => entry.sql.startsWith('INSERT INTO ai_call_monthly')).length, 1);
  assert.equal((await audit.listOwn('A')).rows[0].accountId, 'A');
  assert.ok(statements.find(entry => entry.sql.includes('FROM ai_call_records') && entry.sql.startsWith('SELECT'))?.params.includes('A'));
  await audit.expireDetails('2026-01-01');
  assert.ok(statements.at(-1)?.sql.includes('DELETE FROM ai_call_records'));
  assert.ok(!statements.at(-1)?.sql.includes('ai_call_monthly'));
  await audit.eraseAccount('A');
  assert.ok(statements.at(-1)?.sql.includes('DELETE FROM ai_call_monthly'));
});

test('monthly date filters select the same full months in detail and rollup queries', async () => {
  const queries: { sql: string; params: unknown[] }[] = [];
  const audit = createMysqlAiAuditStore({ execute: async (sql: string, params: unknown[]) => {
    queries.push({ sql, params }); return [[]];
  } } as unknown as Pool);
  const period = { from: '2026-10', to: '2026-11' };
  await audit.listOwn('A', period);
  await audit.summarizeOwn('A', period);
  assert.ok(queries[0].params.includes('2026-10-01T00:00:00.000Z'));
  assert.ok(queries[0].params.includes('2026-12-01T00:00:00.000Z'));
  assert.ok(queries[1].params.includes('2026-10'));
  assert.ok(queries[1].params.includes('2026-11'));
});

test('fresh and version-four MySQL schemas include AI audit detail and monthly rollups', async () => {
  const freshStatements: string[] = [];
  const fresh = { query: async (sql: string) => {
    freshStatements.push(sql);
    if (sql.includes('SELECT DATABASE()')) return [[{ name: 'test' }]];
    if (sql.includes('information_schema.tables')) return [[{ total: 0 }]];
    return [[]];
  }, execute: async (sql: string) => { freshStatements.push(sql); return [[]]; } } as unknown as Pool;
  await migrateMysql(fresh);
  assert.ok(freshStatements.some(sql => sql.includes('CREATE TABLE') && sql.includes('ai_call_records')));
  assert.ok(freshStatements.some(sql => sql.includes('CREATE TABLE') && sql.includes('ai_call_monthly')));

  const upgradeStatements: string[] = [];
  const upgrade = { query: async (sql: string) => {
    upgradeStatements.push(sql);
    if (sql.includes('SELECT DATABASE()')) return [[{ name: 'test' }]];
    if (sql.includes('FROM schema_migrations')) return [[{ version: 4 }]];
    return [[{ total: 1 }]];
  }, execute: async (sql: string) => { upgradeStatements.push(sql); return [[]]; } } as unknown as Pool;
  await migrateMysql(upgrade);
  assert.ok(upgradeStatements.some(sql => sql.includes('ai_call_records')));
  assert.ok(upgradeStatements.some(sql => sql.includes('version=5')));
});
