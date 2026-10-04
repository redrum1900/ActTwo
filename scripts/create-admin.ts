import 'dotenv/config';
import { createMysqlPool } from '../apps/api/src/infrastructure/mysql/mysql.js';
import { migrateMysql } from '../apps/api/src/infrastructure/mysql/migrations.js';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';

const username = process.argv[2];
if (!username) throw new Error('用法：npm run admin:create -- <用户名>');

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) value += String(chunk);
    return value.replace(/\r?\n$/, '');
  }
  process.stdout.write('管理员密码：');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const receive = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) { process.stdin.off('data', receive); finish(); reject(new Error('已取消')); return; }
        if (byte === 10 || byte === 13) { process.stdin.off('data', receive); finish(); resolve(value); return; }
        if (byte === 127 || byte === 8) { value = value.slice(0, -1); continue; }
        value += String.fromCharCode(byte);
      }
    };
    process.stdin.on('data', receive);
  });
}

const password = await readPassword();
const pool = createMysqlPool(process.env);
try {
  await migrateMysql(pool);
  const account = await createMysqlCreatorStore(pool).createAdmin(username, password);
  process.stdout.write(`已创建管理员 ${account.username}\n`);
} finally { await pool.end(); }
