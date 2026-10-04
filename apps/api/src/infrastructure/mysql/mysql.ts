import { readFileSync } from 'node:fs';
import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

export function createMysqlPool(env: NodeJS.ProcessEnv): Pool {
  for (const key of ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'])
    if (!env[key]?.trim()) throw new Error(`${key} 未配置`);
  const port = Number(env.MYSQL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MYSQL_PORT 无效');
  const ca = env.MYSQL_SSL_CA ? readFileSync(env.MYSQL_SSL_CA, 'utf8') : undefined;
  return mysql.createPool({
    host: env.MYSQL_HOST, port, database: env.MYSQL_DATABASE, user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD, waitForConnections: true, connectionLimit: 10,
    charset: 'utf8mb4', dateStrings: true, connectTimeout: 10_000,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
}

export async function withTransaction<T>(pool: Pool, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
