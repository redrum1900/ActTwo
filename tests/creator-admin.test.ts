import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { randomUUID } from 'node:crypto';
import { createMysqlPool } from '../apps/api/src/db/mysql.js';

test('existing creator accounts migrate to author role', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'game-creator-role-'));
  const filename = path.join(dir, 'game.sqlite');
  const legacy = new Database(filename);
  legacy.exec(`CREATE TABLE creator_accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO creator_accounts VALUES ('old-id','old_author','salt','hash','2026-01-01');`);
  legacy.close();
  const store = createCreatorStore(filename);
  try {
    const row = store.db.prepare('SELECT role FROM creator_accounts WHERE id=?').get('old-id') as { role: string };
    assert.equal(row.role, 'author');
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});

test('administrator is server-created, login returns role, and password is hashed', () => {
  const store = createCreatorStore(':memory:');
  try {
    const author = store.register('regular', 'regular-pass-123');
    assert.equal(author.account.role, 'author');
    const admin = store.createAdmin('superadmin', 'test-admin-password-1');
    assert.equal(admin.role, 'admin');
    assert.equal(store.login('superadmin', 'test-admin-password-1')?.account.role, 'admin');
    assert.equal(store.accountFor(store.login('superadmin', 'test-admin-password-1')!.token)?.role, 'admin');
    assert.throws(() => store.createAdmin('superadmin', 'another-password-1'), /已存在/);
    const row = store.db.prepare('SELECT password_hash FROM creator_accounts WHERE username=?').get('superadmin') as { password_hash: string };
    assert.notEqual(row.password_hash, 'test-admin-password-1');
    assert.equal(row.password_hash.includes('test-admin-password-1'), false);
  } finally { store.close(); }
});

test('admin CLI reads the password from stdin without echoing it',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
  const username = `test_cli_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const pool = createMysqlPool(process.env);
  try {
    const result = spawnSync('npx', ['tsx', 'scripts/create-admin.ts', username], {
      cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8', input: 'test-cli-password-1\n',
      env: process.env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes('test-cli-password-1'), false);
    const [rows] = await pool.execute('SELECT role FROM creator_accounts WHERE username=?', [username]);
    assert.equal((rows as { role: string }[])[0]?.role, 'admin');
  } finally {
    await pool.execute('DELETE FROM creator_accounts WHERE username=?', [username]);
    await pool.end();
  }
});
