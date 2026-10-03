import 'dotenv/config';
import type { RowDataPacket } from 'mysql2/promise';
import { inspectScriptParts, scriptPartsFromScript } from '@game/script/parts';
import { createMysqlPool } from '../apps/api/src/db/mysql.js';
import { migrateMysql } from '../apps/api/src/db/migrations.js';
import { createMysqlProjectStore } from '../apps/api/src/db/mysql-project-store.js';
import { swordStoryV2 } from './sword-story-v2.js';

const report = inspectScriptParts(scriptPartsFromScript(swordStoryV2, swordStoryV2.id, swordStoryV2.title));
if (!report.script || report.errors.length) throw new Error(`新剑道故事配置无效：${JSON.stringify(report.errors)}`);
const pool = createMysqlPool(process.env);
try {
  await migrateMysql(pool);
  const [dbRows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  if (dbRows[0]?.name !== 'mystory') throw new Error('目标不是预期的 mystory 数据库');
  const [accounts] = await pool.execute<(RowDataPacket & { id: string })[]>(
    "SELECT id FROM creator_accounts WHERE username='superadmin' AND role='admin'");
  if (accounts.length !== 1) throw new Error('找不到唯一的 superadmin 管理员');
  const [projects] = await pool.execute<RowDataPacket[]>('SELECT id FROM creator_projects WHERE id=?', [swordStoryV2.id]);
  if (projects.length) throw new Error('剑道故事项目已存在；不会覆盖');
  const store = createMysqlProjectStore(pool);
  await store.create(accounts[0].id, swordStoryV2.id, swordStoryV2.title, report.script);
  const checked = await store.validate(accounts[0].id, swordStoryV2.id);
  if (checked.errors.length) throw new Error(`新故事保存后校验失败：${JSON.stringify(checked.errors)}`);
  process.stdout.write('已在 superadmin 名下创建新版剑道故事草稿；尚未提交审核或发布。\n');
} finally { await pool.end(); }
