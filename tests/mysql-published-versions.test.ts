import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'mysql2/promise';
import { loadScript } from '@game/script';
import { createMysqlReviewStore } from '../apps/api/src/db/mysql-review-store.js';
import { createMysqlProjectStore, type MysqlProjectStore } from '../apps/api/src/db/mysql-project-store.js';
import { createMysqlPublishedVersions, releaseVersion } from '../apps/api/src/db/mysql-published-versions.js';
import { migrateMysql } from '../apps/api/src/db/migrations.js';

test('approved release sequence produces stable display versions past 1.9', () => {
  assert.equal(releaseVersion(1), '1.0');
  assert.equal(releaseVersion(2), '1.1');
  assert.equal(releaseVersion(10), '1.9');
  assert.equal(releaseVersion(11), '1.10');
  assert.throws(() => releaseVersion(0));
});

test('project store resolves an exact published version without using latest', async () => {
  const script = loadScript('sword-and-screen');
  const pool = { execute: async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM published_script_versions') && params[1] === script.version && params[2] === script.contentHash)
      return [[{ script_json: JSON.stringify(script) }]];
    return [[]];
  } } as unknown as Pool;
  const projects = createMysqlProjectStore(pool);
  assert.equal((await (projects as any).getPublishedExact(script.id, script.version, script.contentHash))?.version, script.version);
  assert.equal(await (projects as any).getPublishedExact(script.id, script.version, 'wrong'), null);
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
    execute: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('project_id=project_id')) throw new Error("Column 'project_id' in field list is ambiguous");
      return [[]];
    },
  } as unknown as Pool;
  await migrateMysql(pool);
  assert.ok(statements.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS published_script_versions')));
  assert.ok(statements.some(sql => sql.includes('INSERT INTO published_script_versions') && sql.includes('published_scripts')));
  assert.ok(statements.some(sql => sql.includes('UPDATE schema_migrations') && sql.includes('version=2')));
});

test('approval assigns 1.0 instead of publishing the draft placeholder version', async () => {
  const draft = loadScript('sword-and-screen');
  const review = { id: 'review-1', project_id: draft.id, project_title: draft.title,
    author_id: 'author', author_username: 'author', script_json: JSON.stringify(draft),
    content_hash: draft.contentHash!, version: draft.version, status: 'pending',
    submitted_at: '2026-01-01', reviewed_at: null, reviewer_id: null, rejection_reason: null };
  const published: { script: string; version: string }[] = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT role')) return [[{ role: 'admin' }]];
      if (sql.includes('FROM creator_review_submissions r')) return [[review]];
      if (sql.includes('SELECT deleted_at FROM creator_projects')) return [[{ deleted_at: null }]];
      if (sql.includes('MAX(release_sequence)')) return [[{ release_sequence: null }]];
      if (sql.includes('INSERT INTO published_scripts')) published.push({ script: params![1] as string, version: params![2] as string });
      if (sql.includes("SET status='approved'")) { review.status = 'approved'; review.version = params![0] as string; }
      return [[]];
    },
  };
  const pool = { getConnection: async () => connection,
    execute: async (sql: string) => sql.includes('FROM creator_review_submissions r') ? [[review]] : [[]],
  } as unknown as Pool;
  const reviews = createMysqlReviewStore(pool, {} as MysqlProjectStore);
  const approved = await reviews.approve('admin', 'review-1');
  assert.equal(approved.version, '1.0');
  assert.equal(published[0]?.version, '1.0');
  assert.equal(JSON.parse(published[0].script).version, '1.0');
});

test('pending review does not advertise its draft placeholder as a release version', async () => {
  const draft = loadScript('sword-and-screen');
  const row = { id: 'pending', project_id: draft.id, project_title: draft.title, author_id: 'author',
    author_username: 'author', script_json: JSON.stringify(draft), content_hash: draft.contentHash,
    version: draft.version, status: 'pending', submitted_at: '2026-01-01', reviewed_at: null,
    reviewer_id: null, rejection_reason: null };
  const pool = { execute: async () => [[row]] } as unknown as Pool;
  assert.equal((await createMysqlReviewStore(pool, {} as MysqlProjectStore).get('pending'))?.version, '');
});

test('a second approval keeps the first snapshot and assigns 1.1', async () => {
  const draft = loadScript('sword-and-screen');
  const history: { sequence: number; version: string; json: string }[] = [];
  const connection = { execute: async (sql: string, params?: unknown[]) => {
    if (sql.includes('MAX(release_sequence)')) return [[{ release_sequence: history.at(-1)?.sequence ?? null }]];
    if (sql.includes('INSERT INTO published_script_versions')) history.push({
      sequence: params![1] as number, version: params![2] as string, json: params![4] as string });
    return [[]];
  } } as any;
  const publications = createMysqlPublishedVersions({} as Pool);
  await publications.publish(connection, draft.id, 'review-1', draft);
  await publications.publish(connection, draft.id, 'review-2', { ...draft, title: '新版' });
  assert.deepEqual(history.map(entry => entry.version), ['1.0', '1.1']);
  assert.equal(JSON.parse(history[0].json).title, draft.title);
  assert.equal(JSON.parse(history[1].json).title, '新版');
});
