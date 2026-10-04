import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, scryptSync } from 'node:crypto';
import test from 'node:test';
import { createMysqlPool } from '../apps/api/src/infrastructure/mysql/mysql.js';

test('MySQL creator login accepts the prior scrypt verifier and expires on logout',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
    const { createMysqlCreatorStore } = await import('../apps/api/src/infrastructure/mysql/mysql-auth-store.js');
    const pool = createMysqlPool(process.env);
    const id = randomUUID();
    const username = `test_${id.replaceAll('-', '').slice(0, 20)}`;
    const password = 'sample-password-123';
    const salt = '00112233445566778899aabbccddeeff';
    const hash = scryptSync(password, salt, 64).toString('hex');
    try {
      await pool.execute(`INSERT INTO creator_accounts
        (id,username,password_salt,password_hash,created_at,role) VALUES (?,?,?,?,?,'admin')`,
      [id, username, salt, hash, new Date().toISOString()]);
      const store = createMysqlCreatorStore(pool);
      assert.equal(await store.login(username, 'wrong-password'), null);
      const login = await store.login(username, password);
      assert.equal(login?.account.role, 'admin');
      assert.equal((await store.accountFor(login?.token))?.id, id);
      await store.logout(login?.token);
      assert.equal(await store.accountFor(login?.token), null);
      await assert.rejects(store.register(username, password), /用户名已存在/);
    } finally {
      await pool.execute('DELETE FROM creator_sessions WHERE account_id=?', [id]);
      await pool.execute('DELETE FROM creator_accounts WHERE id=?', [id]);
      await pool.end();
    }
  });

test('concurrent registration keeps one account and reports a readable duplicate error',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
    const { createMysqlCreatorStore } = await import('../apps/api/src/infrastructure/mysql/mysql-auth-store.js');
    const pool = createMysqlPool(process.env);
    const username = `test_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const store = createMysqlCreatorStore(pool);
    try {
      const results = await Promise.allSettled([
        store.register(username, 'sample-password-123'),
        store.register(username, 'sample-password-123'),
      ]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = results.find(result => result.status === 'rejected');
      assert.equal(rejected?.status, 'rejected');
      if (rejected?.status === 'rejected') assert.match(String(rejected.reason), /用户名已存在/);
    } finally {
      await pool.execute('DELETE FROM creator_sessions WHERE account_id IN (SELECT id FROM creator_accounts WHERE username=?)', [username]);
      await pool.execute('DELETE FROM creator_accounts WHERE username=?', [username]);
      await pool.end();
    }
  });
