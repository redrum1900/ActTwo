import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import type { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { ScriptParts } from '@game/script/parts';
import { ProjectError } from '../creator/project-store.js';
import { withTransaction } from './mysql.js';
import { createMysqlProjectStore } from './mysql-project-store.js';
import type { ImportReview } from '../creator/import-review.js';
import { validateSafeImportParts } from '../creator/import-parts.js';

interface JobRow extends RowDataPacket {
  id: string; project_id: string; owner_id: string; status: 'running' | 'ready' | 'failed' | 'cancelled' | 'applied';
  progress: string; source_path: string | null; revisions_json: string; parts_json: string | null;
  report_json: string | null; error_text: string | null; created_at: string; updated_at: string;
}
const now = () => new Date().toISOString();
async function removeTemporary(path: string | null) { if (path) await unlink(path).catch(() => {}); }

export function createMysqlCreatorImportStore(pool: Pool) {
  const projects = createMysqlProjectStore(pool);
  const getOwned = async (ownerId: string, projectId: string, jobId: string): Promise<JobRow> => {
    const [rows] = await pool.execute<JobRow[]>(
      'SELECT * FROM creator_import_jobs WHERE id=? AND project_id=? AND owner_id=?', [jobId, projectId, ownerId]);
    if (!rows[0]) throw new ProjectError('导入任务不存在或无权访问', 404);
    return rows[0];
  };
  return {
    getOwned,
    async assertCanStart(ownerId: string, projectId: string) {
      const project = await projects.get(ownerId, projectId);
      if (!project) throw new ProjectError('项目不存在或无权访问', 404);
      const [active] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM creator_import_jobs WHERE owner_id=? AND status IN ('running','ready') LIMIT 1", [ownerId]);
      if (active.length) throw new ProjectError('你已有进行中或待确认的导入任务', 409);
      return project;
    },
    async create(ownerId: string, projectId: string, sourcePath: string) {
      const project = await this.assertCanStart(ownerId, projectId);
      const id = randomUUID();
      const revisions = Object.fromEntries(Object.entries(project.sections).map(([path, section]) => [path, section.revision]));
      try {
        await pool.execute(`INSERT INTO creator_import_jobs
          (id,project_id,owner_id,status,progress,source_path,revisions_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?)`, [id, projectId, ownerId, 'running', 'reading', sourcePath,
          JSON.stringify(revisions), now(), now()]);
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY')
          throw new ProjectError('此故事已有进行中或待确认的导入任务', 409);
        throw error;
      }
      return { id, projectId, status: 'running' as const };
    },
    async updateProgress(ownerId: string, projectId: string, jobId: string, progress: string) {
      await getOwned(ownerId, projectId, jobId);
      await pool.execute("UPDATE creator_import_jobs SET progress=?,updated_at=? WHERE id=? AND status='running'",
        [progress, now(), jobId]);
    },
    async finish(ownerId: string, projectId: string, jobId: string, parts: ScriptParts,
      report: Record<string, unknown>) {
      const job = await getOwned(ownerId, projectId, jobId);
      if (job.status !== 'running') throw new ProjectError('导入任务不在生成中', 409);
      validateSafeImportParts(parts, projectId);
      await pool.execute(`UPDATE creator_import_jobs SET status='ready',progress='ready',
        parts_json=?,report_json=?,updated_at=? WHERE id=? AND status='running'`,
      [JSON.stringify(parts), JSON.stringify(report), now(), jobId]);
    },
    async updateReview(ownerId: string, projectId: string, jobId: string, review: ImportReview) {
      const job = await getOwned(ownerId, projectId, jobId);
      if (job.status !== 'ready' || !job.report_json) throw new ProjectError('导入结果不在可审查状态', 409);
      const report = { ...JSON.parse(job.report_json), review };
      const [result] = await pool.execute<ResultSetHeader>(
        "UPDATE creator_import_jobs SET report_json=?,updated_at=? WHERE id=? AND status='ready'",
        [JSON.stringify(report), now(), jobId]);
      if (!result.affectedRows)
        throw new ProjectError('导入状态已变化，请刷新后重试', 409);
    },
    async fail(ownerId: string, projectId: string, jobId: string, message: string) {
      const job = await getOwned(ownerId, projectId, jobId);
      await pool.execute(`UPDATE creator_import_jobs SET status='failed',progress='failed',source_path=NULL,
        error_text=?,updated_at=? WHERE id=? AND status='running'`, [message, now(), jobId]);
      await removeTemporary(job.source_path);
    },
    async cancel(ownerId: string, projectId: string, jobId: string) {
      const job = await getOwned(ownerId, projectId, jobId);
      if (job.status === 'applied') throw new ProjectError('已写入的任务不能取消', 409);
      await pool.execute(`UPDATE creator_import_jobs SET status='cancelled',source_path=NULL,parts_json=NULL,updated_at=?
        WHERE id=? AND status IN ('running','ready','failed')`, [now(), jobId]);
      await removeTemporary(job.source_path);
    },
    async apply(ownerId: string, projectId: string, jobId: string) {
      const sourcePath = await withTransaction(pool, async connection => {
        const [jobs] = await connection.execute<JobRow[]>(`SELECT * FROM creator_import_jobs
          WHERE id=? AND project_id=? AND owner_id=? FOR UPDATE`, [jobId, projectId, ownerId]);
        const job = jobs[0];
        if (!job) throw new ProjectError('导入任务不存在或无权访问', 404);
        if (job.status !== 'ready' || !job.parts_json) throw new ProjectError('导入结果未就绪或已取消', 409);
        const [owned] = await connection.execute<RowDataPacket[]>(`SELECT id FROM creator_projects
          WHERE id=? AND owner_id=? AND deleted_at IS NULL FOR UPDATE`, [projectId, ownerId]);
        if (!owned.length) throw new ProjectError('项目不存在或无权访问', 404);
        const [rows] = await connection.execute<RowDataPacket[]>(
          'SELECT path,revision FROM creator_sections WHERE project_id=? FOR UPDATE', [projectId]);
        const current = Object.fromEntries(rows.map(row => [row.path as string, Number(row.revision)]));
        const expected = JSON.parse(job.revisions_json) as Record<string, number>;
        if (JSON.stringify(Object.entries(current).sort()) !== JSON.stringify(Object.entries(expected).sort()))
          throw new ProjectError('保存冲突：导入期间草稿已经改变，请重新生成', 409);
        const parts = JSON.parse(job.parts_json) as ScriptParts;
        const checked = validateSafeImportParts(parts, projectId);
        const timestamp = now();
        await connection.execute('DELETE FROM creator_sections WHERE project_id=?', [projectId]);
        for (const [path, content] of Object.entries(parts)) await connection.execute(
          'INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,?,?)',
          [projectId, path, content, (current[path] ?? 0) + 1, timestamp]);
        if (checked.title) await connection.execute('UPDATE creator_projects SET title=?,updated_at=? WHERE id=? AND owner_id=?',
          [checked.title, timestamp, projectId, ownerId]);
        await connection.execute("UPDATE creator_import_jobs SET status='applied',progress='applied',updated_at=? WHERE id=?",
          [timestamp, jobId]);
        return job.source_path;
      });
      await removeTemporary(sourcePath);
      return { projectId, project: (await projects.get(ownerId, projectId))! };
    },
    async expireOldReady() {
      const [expiredReady] = await pool.execute<JobRow[]>(
        "SELECT * FROM creator_import_jobs WHERE status='ready' AND updated_at<?",
        [new Date(Date.now() - 7 * 86400000).toISOString()]);
      for (const row of expiredReady) {
        await pool.execute("UPDATE creator_import_jobs SET status='failed',progress='expired',parts_json=NULL,source_path=NULL,error_text=?,updated_at=? WHERE id=?",
          ['待确认的导入结果已过期，请重新发起', now(), row.id]);
        await removeTemporary(row.source_path);
      }
      await pool.execute('DELETE FROM creator_import_jobs WHERE updated_at<? AND status IN (?,?)',
        [new Date(Date.now() - 30 * 86400000).toISOString(), 'cancelled', 'failed']);
    },
    async recoverInterrupted() {
      const [rows] = await pool.execute<JobRow[]>("SELECT * FROM creator_import_jobs WHERE status='running'");
      for (const row of rows) {
        await pool.execute("UPDATE creator_import_jobs SET status='failed',progress='failed',source_path=NULL,error_text=?,updated_at=? WHERE id=?",
          ['服务重启中断了导入，请重新发起', now(), row.id]);
        await removeTemporary(row.source_path);
      }
      await this.expireOldReady();
    },
  };
}

export type MysqlCreatorImportStore = ReturnType<typeof createMysqlCreatorImportStore>;
