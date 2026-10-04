import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';
import { withTestMysql } from './support/mysql-test-db.js';

test('MySQL accounts without an explicit role default to author', async () => {
  await withTestMysql(async pool => {
    await pool.execute(`INSERT INTO creator_accounts
      (id,username,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)`,
    ['old-id', 'old_author', 'salt', 'hash', '2026-01-01']);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT role FROM creator_accounts WHERE id=?', ['old-id']);
    assert.equal(rows[0].role, 'author');
  });
});

test('administrator is server-created, login returns role, and password is hashed', async () => {
  await withTestMysql(async pool => {
    const store = createMysqlCreatorStore(pool);
    const author = await store.register('regular', 'regular-pass-123');
    assert.equal(author.account.role, 'author');
    const admin = await store.createAdmin('superadmin', 'test-admin-password-1');
    assert.equal(admin.role, 'admin');
    assert.equal((await store.login('superadmin', 'test-admin-password-1'))?.account.role, 'admin');
    assert.equal((await store.accountFor((await store.login('superadmin', 'test-admin-password-1'))!.token))?.role, 'admin');
    await assert.rejects(store.createAdmin('superadmin', 'another-password-1'), /已存在/);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT password_hash FROM creator_accounts WHERE username=?', ['superadmin']);
    assert.notEqual(rows[0].password_hash, 'test-admin-password-1');
    assert.equal(String(rows[0].password_hash).includes('test-admin-password-1'), false);
  });
});

test('admin CLI reads the password from stdin without echoing it and writes only to the test database', async () => {
  await withTestMysql(async pool => {
    const username = `test_cli_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const result = spawnSync('npx', ['tsx', 'scripts/create-admin.ts', username], {
      cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8', input: 'test-cli-password-1\n',
      env: {
        ...process.env,
        MYSQL_HOST: process.env.MYSQL_TEST_HOST,
        MYSQL_PORT: process.env.MYSQL_TEST_PORT,
        MYSQL_DATABASE: process.env.MYSQL_TEST_DATABASE,
        MYSQL_USER: process.env.MYSQL_TEST_USER,
        MYSQL_PASSWORD: process.env.MYSQL_TEST_PASSWORD,
        MYSQL_SSL_CA: process.env.MYSQL_TEST_SSL_CA,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes('test-cli-password-1'), false);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT role FROM creator_accounts WHERE username=?', [username]);
    assert.equal(rows[0]?.role, 'admin');
  });
});
