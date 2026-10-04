import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { migrateMysql } from '../apps/api/src/infrastructure/mysql/migrations.js';
import { createMysqlPlaytestStore } from '../apps/api/src/infrastructure/mysql/mysql-playtest-store.js';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';

test('migration creates one-row playtest snapshots for fresh and version-five schemas', async () => {
  const statements: string[] = [];
  const fresh = { query: async (sql: string) => { statements.push(sql);
    if (sql.includes('SELECT DATABASE()')) return [[{ name: 'test' }]];
    if (sql.includes('information_schema.tables')) return [[{ total: 0 }]];
    return [[]]; }, execute: async (sql: string) => { statements.push(sql); return [[]]; } } as unknown as Pool;
  await migrateMysql(fresh);
  assert.ok(statements.some(sql => sql.includes('CREATE TABLE IF NOT EXISTS creator_playtests')));
  assert.ok(statements.some(sql => sql.includes('INSERT INTO schema_migrations') && !sql.includes('version=5')));
  const upgraded: string[] = [];
  const pool = { query: async (sql: string) => { upgraded.push(sql);
    if (sql.includes('SELECT DATABASE()')) return [[{ name: 'test' }]];
    if (sql.includes('information_schema.tables')) return [[{ total: 1 }]];
    if (sql.includes('SELECT version')) return [[{ version: 5 }]];
    return [[]]; }, execute: async (sql: string) => { upgraded.push(sql); return [[]]; } } as unknown as Pool;
  await migrateMysql(pool);
  assert.ok(upgraded.some(sql => sql.includes('version=6 WHERE version=5')));
});

test('store exposes separate create, get, initialize, CAS, list and delete operations', () => {
  const store = createMysqlPlaytestStore({} as Pool);
  for (const key of ['create', 'get', 'initialize', 'updateAuto', 'updateDerivedMemory', 'list', 'delete'])
    assert.equal(typeof store[key as keyof typeof store], 'function');
});

test('playtest list and creation work with the deployed version-six table that has no sequence column', async () => {
  const rows: any[] = [{ id: 'older', project_id: 'story', owner_id: 'owner', script_json: JSON.stringify(swordStoryV2),
    script_hash: 'hash', auto_state_json: null, auto_revision: 0, created_at: '2026-10-02T10:00:00.000Z', played_at: null }];
  const execute = async (sql: string, params: unknown[] = []) => {
    if (/\bsequence\b/i.test(sql)) throw new Error("Unknown column 'sequence' in 'order clause'");
    if (sql.includes('FROM creator_projects')) return [[{ id: 'story' }]];
    if (sql.startsWith('INSERT INTO creator_playtests')) {
      rows.push({ id: params[0], project_id: params[1], owner_id: params[2], script_json: params[3],
        script_hash: params[4], auto_state_json: null, auto_revision: 0, created_at: params[5], played_at: null });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM creator_playtests') && sql.includes('ORDER BY')) {
      assert.match(sql, /ORDER BY created_at DESC, id DESC/);
      return [[...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))];
    }
    if (sql.startsWith('SELECT * FROM creator_playtests')) return [rows.filter(row => row.id === params[0])];
    if (sql.includes('OFFSET 10')) return [[]];
    return [[]];
  };
  const connection = { execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
  const store = createMysqlPlaytestStore({ execute, getConnection: async () => connection } as unknown as Pool);
  assert.deepEqual((await store.list('owner', 'story')).map(row => row.id), ['older']);
  const created = await store.create('owner', 'story', swordStoryV2);
  assert.deepEqual((await store.list('owner', 'story')).map(row => row.id), [created.id, 'older']);
});

test('background playtest memory update preserves revision and rejects a changed auto save', async () => {
  const statements: string[] = [];
  let live = structuredClone(swordStoryV2);
  const state = (await import('@game/engine')).createInitialState(live, {});
  let stored = JSON.stringify(state);
  const execute = async (sql: string, params: unknown[] = []) => {
    statements.push(sql);
    if (sql.startsWith('SELECT * FROM creator_playtests')) return [[{ id: 'pt', project_id: 'story', owner_id: 'owner',
      script_json: JSON.stringify(live), script_hash: 'hash', auto_state_json: stored, auto_revision: 3,
      created_at: '2026-10-03', played_at: '2026-10-03' }]];
    if (sql.startsWith('UPDATE creator_playtests')) { stored = String(params[0]); return [{ affectedRows: 1 }]; }
    return [[]];
  };
  const connection = { execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
  const pool = { execute, getConnection: async () => connection } as unknown as Pool;
  const save = { slot: 0, label: '试玩自动存档', state, revision: 3, updatedAt: '2026-10-03' };
  const derived = { ...state, memorySegments: { ...state.memorySegments } };
  const store = createMysqlPlaytestStore(pool);
  assert.equal(await store.updateDerivedMemory('owner', 'story', 'pt', save, derived), true);
  assert.ok(statements.some(sql => sql.includes('FOR UPDATE')));
  assert.ok(statements.some(sql => sql.startsWith('UPDATE creator_playtests') && !sql.includes('auto_revision=auto_revision+1')));
  stored = JSON.stringify({ ...state, turns: 1 });
  assert.equal(await store.updateDerivedMemory('owner', 'story', 'pt', save, derived), false);
});

test('new playtest serializes on the project row and trims runs beyond ten in the same transaction', async () => {
  const statements: string[] = [];
  const rows: any[] = [];
  const execute = async (sql: string, params: unknown[] = []) => {
    statements.push(sql);
    if (sql.includes('FROM creator_projects')) return [[{ id: 'story' }]];
    if (sql.startsWith('INSERT INTO creator_playtests')) {
      rows.push({ id: params[0], project_id: params[1], owner_id: params[2], script_json: params[3], script_hash: params[4],
        auto_state_json: null, auto_revision: 0, created_at: params[5], played_at: null });
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('OFFSET 10')) return [rows.slice(0, -10).map(row => ({ id: row.id }))];
    if (sql.startsWith('DELETE FROM creator_playtests')) {
      const index = rows.findIndex(row => row.id === params[0]); if (index >= 0) rows.splice(index, 1);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('SELECT * FROM creator_playtests')) return [rows.filter(row => row.id === params[0])];
    return [[]];
  };
  const connection = { execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
  const pool = { execute, getConnection: async () => connection } as unknown as Pool;
  const store = createMysqlPlaytestStore(pool);
  const ids = [];
  for (let index = 0; index < 11; index++) ids.push((await store.create('owner', 'story', swordStoryV2)).id);
  assert.equal(new Set(ids).size, 11);
  assert.equal(rows.length, 10);
  assert.ok(statements.some(sql => sql.includes('creator_projects') && sql.includes('FOR UPDATE')));
  assert.ok(statements.some(sql => sql.includes('OFFSET 10')));
});

test('playtest validates and reads the draft only after locking its project', async () => {
  const order: string[] = [];
  const execute = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM creator_projects')) { order.push('lock'); return [[{ id: 'story' }]]; }
    if (sql.startsWith('INSERT INTO creator_playtests')) { order.push('insert'); return [{ affectedRows: 1 }]; }
    if (sql.startsWith('SELECT * FROM creator_playtests')) return [[{ id: params[0], project_id: 'story', owner_id: 'owner',
      script_json: JSON.stringify(swordStoryV2), script_hash: 'hash', auto_state_json: null, auto_revision: 0,
      created_at: '2026-10-03', played_at: null }]];
    return [[]];
  };
  const connection = { execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
  const pool = { execute, getConnection: async () => connection } as unknown as Pool;
  await createMysqlPlaytestStore(pool).create('owner', 'story', async client => {
    assert.equal(client, connection); order.push('validate'); return swordStoryV2;
  });
  assert.deepEqual(order, ['lock', 'validate', 'insert']);
});
