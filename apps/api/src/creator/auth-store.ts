import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';

export interface CreatorAccount { id: string; username: string }
const sessionDays = 30;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const passwordHash = (password: string, salt: string) => scryptSync(password, salt, 64).toString('hex');
const validUsername = (username: string) => /^[a-z][a-z0-9_-]{2,31}$/.test(username);
const validPassword = (password: string) => password.length >= 10 && password.length <= 128;

export function createCreatorStore(filename: string) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creator_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES creator_accounts(id),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS creator_sessions_account ON creator_sessions(account_id);
  `);

  const issueSession = (account: CreatorAccount) => {
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO creator_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash(token), account.id, Date.now() + sessionDays * 86400_000);
    return { account, token };
  };
  return {
    db,
    register(rawUsername: string, password: string) {
      const username = rawUsername.trim().toLowerCase();
      if (!validUsername(username)) throw new Error('用户名须为 3–32 位英文字母、数字、下划线或短横线，并以字母开头');
      if (!validPassword(password)) throw new Error('密码须为 10–128 位');
      if (db.prepare('SELECT id FROM creator_accounts WHERE username = ?').get(username)) throw new Error('用户名已存在');
      const account = { id: randomUUID(), username };
      const salt = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO creator_accounts (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(account.id, username, salt, passwordHash(password, salt), new Date().toISOString());
      return issueSession(account);
    },
    login(rawUsername: string, password: string) {
      const row = db.prepare('SELECT id, username, password_salt, password_hash FROM creator_accounts WHERE username = ?')
        .get(rawUsername.trim().toLowerCase()) as (CreatorAccount & { password_salt: string; password_hash: string }) | undefined;
      if (!row || typeof password !== 'string') return null;
      const actual = Buffer.from(passwordHash(password, row.password_salt), 'hex');
      const expected = Buffer.from(row.password_hash, 'hex');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
      return issueSession({ id: row.id, username: row.username });
    },
    accountFor(token: string | undefined): CreatorAccount | null {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const row = db.prepare(`SELECT a.id, a.username FROM creator_sessions s JOIN creator_accounts a ON a.id=s.account_id
        WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token), Date.now()) as CreatorAccount | undefined;
      return row ?? null;
    },
    logout(token: string | undefined) {
      if (token) db.prepare('DELETE FROM creator_sessions WHERE token_hash=?').run(tokenHash(token));
    },
    close() { db.close(); },
  };
}

export type CreatorStore = ReturnType<typeof createCreatorStore>;
