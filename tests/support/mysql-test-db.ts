import 'dotenv/config';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { createMysqlPool } from '../../apps/api/src/infrastructure/mysql/mysql.js';
import { migrateMysql } from '../../apps/api/src/infrastructure/mysql/migrations.js';

const testTables = [
  'ai_call_monthly', 'ai_call_records', 'creator_playtests', 'creator_import_jobs',
  'published_script_versions', 'creator_review_submissions',
  'creator_item_image_assets', 'creator_cover_assets', 'published_scripts',
  'creator_sections', 'creator_sessions', 'creator_projects',
  'gallery', 'save_slots', 'creator_accounts',
] as const;

export function assertTestMysqlConfig(env: NodeJS.ProcessEnv): string {
  for (const key of ['MYSQL_DATABASE', 'MYSQL_TEST_HOST', 'MYSQL_TEST_PORT',
    'MYSQL_TEST_DATABASE', 'MYSQL_TEST_USER', 'MYSQL_TEST_PASSWORD'] as const)
    if (!env[key]?.trim()) throw new Error(`${key} 未配置，拒绝连接测试库`);
  const database = env.MYSQL_TEST_DATABASE!.trim();
  if (database.toLowerCase() === env.MYSQL_DATABASE!.trim().toLowerCase())
    throw new Error('测试库不能与正式库相同');
  if (!/test/i.test(database)) throw new Error('MYSQL_TEST_DATABASE 名称必须包含 test');
  return database;
}

export async function assertTestMysqlDatabase(pool: Pool | PoolConnection, expected: string): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  if (rows[0]?.name !== expected) throw new Error('实际连接的数据库不是指定测试库，拒绝清理');
}

export async function openTestMysql(): Promise<Pool> {
  const expected = assertTestMysqlConfig(process.env);
  const pool = createMysqlPool({
    MYSQL_HOST: process.env.MYSQL_TEST_HOST,
    MYSQL_PORT: process.env.MYSQL_TEST_PORT,
    MYSQL_DATABASE: expected,
    MYSQL_USER: process.env.MYSQL_TEST_USER,
    MYSQL_PASSWORD: process.env.MYSQL_TEST_PASSWORD,
    MYSQL_SSL_CA: process.env.MYSQL_TEST_SSL_CA,
  });
  try {
    await assertTestMysqlDatabase(pool, expected);
    await migrateMysql(pool);
    return pool;
  } catch (error) {
    await pool.end();
    throw error;
  }
}

export async function resetTestMysqlData(pool: Pool): Promise<void> {
  const expected = assertTestMysqlConfig(process.env);
  await assertTestMysqlDatabase(pool, expected);
  const connection = await pool.getConnection();
  try {
    await assertTestMysqlDatabase(connection, expected);
    for (const table of testTables) await connection.query(`DELETE FROM \`${table}\``);
  } finally {
    connection.release();
  }
}

export async function rebuildTestMysqlSchema(pool: Pool): Promise<void> {
  const expected = assertTestMysqlConfig(process.env);
  await assertTestMysqlDatabase(pool, expected);
  const connection = await pool.getConnection();
  try {
    await assertTestMysqlDatabase(connection, expected);
    await connection.query('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const table of [...testTables, 'schema_migrations'])
        await connection.query(`DROP TABLE IF EXISTS \`${table}\``);
    } finally {
      await connection.query('SET FOREIGN_KEY_CHECKS=1');
    }
  } finally {
    connection.release();
  }
  await migrateMysql(pool);
}

export async function withTestMysql<T>(work: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = await openTestMysql();
  try {
    await resetTestMysqlData(pool);
    return await work(pool);
  } finally {
    await pool.end();
  }
}
