import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { RowDataPacket } from 'mysql2';

test('missing MySQL settings fail instead of falling back to SQLite', async () => {
  const { createMysqlPool } = await import('../apps/api/src/db/mysql.js');
  assert.throws(() => createMysqlPool({}), /MYSQL_HOST/);
});

test('remote connection is encrypted and migration is idempotent', { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
  const { createMysqlPool, withTransaction } = await import('../apps/api/src/db/mysql.js');
  const { migrateMysql } = await import('../apps/api/src/db/migrations.js');
  const pool = createMysqlPool(process.env);
  try {
    const [status] = await pool.query<RowDataPacket[]>("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    assert.ok(status[0]?.Value);
    await migrateMysql(pool);
    await migrateMysql(pool);
    const [versions] = await pool.query<RowDataPacket[]>('SELECT version FROM schema_migrations');
    assert.deepEqual(versions.map(row => row.version), [1]);

    const owner = `mysql-test-${crypto.randomUUID()}`;
    await assert.rejects(withTransaction(pool, async connection => {
      await connection.execute('INSERT INTO gallery (owner_id,game_id,kind,entry_id,unlocked_at) VALUES (?,?,?,?,?)',
        [owner, 'test-game', 'ending', 'test-ending', new Date().toISOString()]);
      throw new Error('force rollback');
    }), /force rollback/);
    const [rows] = await pool.execute<RowDataPacket[]>('SELECT owner_id FROM gallery WHERE owner_id=?', [owner]);
    assert.equal(rows.length, 0);
  } finally {
    await pool.end();
  }
});
