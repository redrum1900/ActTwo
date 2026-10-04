import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { CreatorAccount } from '../../modules/auth/types.js';
import { withTransaction } from './mysql.js';

const sessionDays = 30;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const passwordHash = (password: string, salt: string) => scryptSync(password, salt, 64).toString('hex');
const validUsername = (username: string) => /^[a-z][a-z0-9_-]{2,31}$/.test(username);
const validPassword = (password: string) => password.length >= 10 && password.length <= 128;

interface AccountRow extends RowDataPacket, CreatorAccount { password_salt: string; password_hash: string }
interface PublicAccountRow extends RowDataPacket, CreatorAccount {}

export function createMysqlCreatorStore(pool: Pool) {
  const issueSession = async (connection: Pool | PoolConnection, account: CreatorAccount) => {
    const token = randomBytes(32).toString('base64url');
    await connection.execute('INSERT INTO creator_sessions (token_hash, account_id, expires_at) VALUES (?,?,?)',
      [tokenHash(token), account.id, Date.now() + sessionDays * 86400_000]);
    return { account, token };
  };
  const createAccount = async (rawUsername: string, password: string, role: CreatorAccount['role']) => {
    const username = rawUsername.trim().toLowerCase();
    if (!validUsername(username)) throw new Error('用户名须为 3–32 位英文字母、数字、下划线或短横线，并以字母开头');
    if (!validPassword(password)) throw new Error('密码须为 10–128 位');
    try {
      return await withTransaction(pool, async connection => {
        const [existing] = await connection.execute<RowDataPacket[]>('SELECT id FROM creator_accounts WHERE username=?', [username]);
        if (existing.length) throw new Error('用户名已存在');
        const account: CreatorAccount = { id: randomUUID(), username, role };
        const salt = randomBytes(16).toString('hex');
        await connection.execute(`INSERT INTO creator_accounts
          (id,username,password_salt,password_hash,created_at,role) VALUES (?,?,?,?,?,?)`,
        [account.id, username, salt, passwordHash(password, salt), new Date().toISOString(), role]);
        return role === 'admin' ? account : issueSession(connection, account);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new Error('用户名已存在');
      throw error;
    }
  };
  return {
    register: (username: string, password: string) => createAccount(username, password, 'author') as Promise<{ account: CreatorAccount; token: string }>,
    createAdmin: (username: string, password: string) => createAccount(username, password, 'admin') as Promise<CreatorAccount>,
    async login(rawUsername: string, password: string) {
      const [rows] = await pool.execute<AccountRow[]>(
        'SELECT id,username,role,password_salt,password_hash FROM creator_accounts WHERE username=?',
        [rawUsername.trim().toLowerCase()]);
      const row = rows[0];
      if (!row || typeof password !== 'string') return null;
      const actual = Buffer.from(passwordHash(password, row.password_salt), 'hex');
      const expected = Buffer.from(row.password_hash, 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      return issueSession(pool, { id: row.id, username: row.username, role: row.role });
    },
    async accountFor(token: string | undefined): Promise<CreatorAccount | null> {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const [rows] = await pool.execute<PublicAccountRow[]>(`SELECT a.id,a.username,a.role
        FROM creator_sessions s JOIN creator_accounts a ON a.id=s.account_id
        WHERE s.token_hash=? AND s.expires_at>?`, [tokenHash(token), Date.now()]);
      return rows[0] ?? null;
    },
    async logout(token: string | undefined) {
      if (token) await pool.execute('DELETE FROM creator_sessions WHERE token_hash=?', [tokenHash(token)]);
    },
  };
}

export type MysqlCreatorStore = ReturnType<typeof createMysqlCreatorStore>;
