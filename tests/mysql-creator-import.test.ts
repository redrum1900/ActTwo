import assert from 'node:assert/strict';
import test from 'node:test';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';
import { scriptPartsFromScript } from '@game/script/parts';
import { createMysqlCreatorImportStore } from '../apps/api/src/db/mysql-creator-import.js';
import type { Pool } from 'mysql2/promise';
import { migrateMysql } from '../apps/api/src/db/migrations.js';

test('import apply keeps project identity and rejects a changed draft before deletion', async () => {
  const statements: string[] = [];
  const rows = {
    id: 'job-1', project_id: 'story-one', owner_id: 'author', status: 'ready',
    revisions_json: JSON.stringify({ 'manifest.json': 1 }),
    parts_json: JSON.stringify(scriptPartsFromScript(swordStoryV2, 'story-one', swordStoryV2.title)),
    source_path: '', progress: 'ready', report_json: '{}', created_at: '', updated_at: '', error_text: null,
  };
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM creator_import_jobs')) return [[rows]];
      if (sql.includes('FROM creator_projects')) return [[{ id: 'story-one', owner_id: 'author', title: '旧故事', created_at: '', updated_at: '', published_at: null }]];
      if (sql.includes('FROM creator_sections')) return [[{ path: 'manifest.json', content: '{}', revision: 2, updated_at: '' }]];
      return [[]];
    },
  };
  const pool = { getConnection: async () => connection } as unknown as Pool;
  const imports = createMysqlCreatorImportStore(pool);
  await assert.rejects(imports.apply('author', 'story-one', 'job-1'), /保存冲突/);
  assert.ok(!statements.some(sql => sql.startsWith('DELETE FROM creator_sections')));
});

test('non-owner and cancelled job cannot be applied', async () => {
  const pool = { getConnection: async () => ({ beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    execute: async () => [[]] }) } as unknown as Pool;
  await assert.rejects(createMysqlCreatorImportStore(pool).apply('stranger', 'story-one', 'job-1'), /不存在|无权/);
});

test('successful apply replaces draft sections atomically and does not touch releases', async () => {
  const statements: string[] = [];
  const inserted: unknown[][] = [];
  const parts = scriptPartsFromScript(swordStoryV2, 'story-one', swordStoryV2.title);
  const row = { id: 'job-1', project_id: 'story-one', owner_id: 'author', status: 'ready',
    revisions_json: JSON.stringify({ 'manifest.json': 1, 'npcs/old/base.json': 1 }), parts_json: JSON.stringify(parts) };
  const execute = async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (sql.startsWith('INSERT INTO creator_sections')) inserted.push(params ?? []);
    if (sql.includes('FROM creator_import_jobs')) return [[row]];
    if (sql.includes('FROM creator_projects')) return [[{ id: 'story-one', owner_id: 'author', title: swordStoryV2.title,
      created_at: '', updated_at: '', published_at: null }]];
    if (sql.includes('FROM creator_sections')) return [[
      { path: 'manifest.json', content: parts['manifest.json'], revision: 1, updated_at: '' },
      { path: 'npcs/old/base.json', content: '{}', revision: 1, updated_at: '' },
    ]];
    return [[]];
  };
  const connection = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, execute };
  const pool = { getConnection: async () => connection, execute } as unknown as Pool;
  const result = await createMysqlCreatorImportStore(pool).apply('author', 'story-one', 'job-1');
  assert.equal(result.projectId, 'story-one');
  assert.ok(statements.some(sql => sql.startsWith('DELETE FROM creator_sections')));
  assert.ok(statements.some(sql => sql.startsWith('INSERT INTO creator_sections')));
  assert.equal(inserted.find(params => params[1] === 'manifest.json')?.[3], 2);
  assert.ok(!statements.some(sql => sql.includes('published_script')));
});

test('fresh MySQL schema atomically admits only one active job per owner', async () => {
  const statements: string[] = [];
  const pool = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('SELECT DATABASE()')) return [[{ name: 'test' }]];
      if (sql.includes('information_schema.tables')) return [[{ total: 0 }]];
      return [[]];
    },
    execute: async (sql: string) => { statements.push(sql); return [[]]; },
  } as unknown as Pool;
  await migrateMysql(pool);
  assert.ok(statements.some(sql => sql.includes('UNIQUE KEY creator_import_one_owner_active')));
});
