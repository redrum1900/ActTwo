import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import { createMysqlPool, withTransaction } from '../apps/api/src/db/mysql.js';
import { migrateMysql } from '../apps/api/src/db/migrations.js';

interface Account {
  id: string; username: string; password_salt: string; password_hash: string; created_at: string; role: string;
}
const backup = process.argv[2] ?? path.resolve(fileURLToPath(new URL('../data/backups/game-pre-mysql-cutover-2026-10-02.sqlite', import.meta.url)));
const sql = `SELECT id,username,password_salt,password_hash,created_at,role
  FROM creator_accounts WHERE username='superadmin'`;
const source = JSON.parse(execFileSync('sqlite3', ['-readonly', '-json', `file:${backup}?immutable=1`, sql],
  { encoding: 'utf8' })) as Account[];
if (source.length !== 1 || source[0].role !== 'admin') throw new Error('备份中必须恰有一个 superadmin 管理员');

const pool = createMysqlPool(process.env);
try {
  await migrateMysql(pool);
  await withTransaction(pool, async connection => {
    const [dbRows] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    if (dbRows[0]?.name !== 'mystory') throw new Error('目标不是预期的 mystory 数据库');
    for (const table of ['creator_accounts', 'creator_sessions', 'creator_projects', 'creator_sections',
      'creator_review_submissions', 'published_scripts', 'creator_cover_assets', 'creator_item_image_assets',
      'save_slots', 'gallery']) {
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${table}`);
      if (Number(rows[0]?.total) !== 0) throw new Error(`目标表 ${table} 非空，停止导入`);
    }
    const account = source[0];
    await connection.execute(`INSERT INTO creator_accounts
      (id,username,password_salt,password_hash,created_at,role) VALUES (?,?,?,?,?,?)`,
    [account.id, account.username, account.password_salt, account.password_hash, account.created_at, account.role]);
  });
  process.stdout.write('已仅导入 superadmin 凭据；其他业务表保持为空。\n');
} finally { await pool.end(); }
