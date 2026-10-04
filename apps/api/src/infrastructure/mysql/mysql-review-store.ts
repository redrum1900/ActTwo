import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { GameScript } from '@game/contracts';
import { contentHashOf } from '@game/script';
import { ProjectError } from '../../modules/creator/projects/types.js';
import type { ReviewSubmission, ReviewSummary, ReviewStatus } from '../../modules/creator/review/types.js';
import type { MysqlProjectStore } from './mysql-project-store.js';
import { withTransaction } from './mysql.js';
import { createMysqlPublishedVersions } from './mysql-published-versions.js';

interface ReviewRow extends RowDataPacket {
  id: string; project_id: string; project_title: string; author_id: string; author_username: string;
  script_json: string; content_hash: string; version: string; status: ReviewStatus;
  submitted_at: string; reviewed_at: string | null; reviewer_id: string | null; rejection_reason: string | null;
}
const selected = `SELECT r.*,p.title AS project_title,a.username AS author_username
  FROM creator_review_submissions r JOIN creator_projects p ON p.id=r.project_id
  JOIN creator_accounts a ON a.id=r.author_id`;
const toSubmission = (row: ReviewRow): ReviewSubmission => {
  const script = JSON.parse(row.script_json) as GameScript;
  return { id: row.id, projectId: row.project_id, projectTitle: script.title,
    authorId: row.author_id, authorUsername: row.author_username, script,
    contentHash: row.content_hash, version: row.status === 'approved' ? row.version : '', status: row.status,
    submittedAt: row.submitted_at, reviewedAt: row.reviewed_at,
    reviewerId: row.reviewer_id, rejectionReason: row.rejection_reason };
};
const summary = ({ script: _script, ...rest }: ReviewSubmission): ReviewSummary => rest;

export function createMysqlReviewStore(pool: Pool, projects: MysqlProjectStore) {
  const publications = createMysqlPublishedVersions(pool);
  const requireAdmin = async (connection: PoolConnection, id: string) => {
    const [rows] = await connection.execute<RowDataPacket[]>('SELECT role FROM creator_accounts WHERE id=?', [id]);
    if (rows[0]?.role !== 'admin') throw new ProjectError('需要管理员权限', 403);
  };
  const requirePending = async (connection: PoolConnection, id: string): Promise<ReviewRow> => {
    const [rows] = await connection.execute<ReviewRow[]>(`${selected} WHERE r.id=? FOR UPDATE`, [id]);
    const row = rows[0];
    if (!row) throw new ProjectError('审核申请不存在', 404);
    if (row.status !== 'pending') throw new ProjectError('该申请已审核', 409);
    const [projects] = await connection.execute<RowDataPacket[]>(
      'SELECT deleted_at FROM creator_projects WHERE id=? FOR UPDATE', [row.project_id]);
    if (!projects[0] || projects[0].deleted_at) throw new ProjectError('故事已删除，不能审核', 409);
    return row;
  };
  const store = {
    async submit(ownerId: string, projectId: string): Promise<ReviewSubmission> {
      if (!await projects.get(ownerId, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      const script = await projects.validatedDraft(ownerId, projectId);
      const id = randomUUID();
      try {
        await withTransaction(pool, async connection => {
          const [projectRows] = await connection.execute<RowDataPacket[]>(
            'SELECT id FROM creator_projects WHERE id=? AND owner_id=? AND deleted_at IS NULL FOR UPDATE', [projectId, ownerId]);
          if (!projectRows.length) throw new ProjectError('项目不存在或无权访问', 404);
          const [pending] = await connection.execute<RowDataPacket[]>(
            "SELECT id FROM creator_review_submissions WHERE project_id=? AND status='pending'", [projectId]);
          if (pending.length) throw new ProjectError('已有待审版本，请等待审核', 409);
          await connection.execute(`INSERT INTO creator_review_submissions
            (id,project_id,author_id,script_json,content_hash,version,status,submitted_at)
            VALUES (?,?,?,?,?,?,'pending',?)`,
          [id, projectId, ownerId, JSON.stringify(script), script.contentHash ?? '', script.version, new Date().toISOString()]);
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ProjectError('已有待审版本，请等待审核', 409);
        throw error;
      }
      return (await store.get(id))!;
    },
    async listPending(): Promise<ReviewSummary[]> {
      const [rows] = await pool.query<ReviewRow[]>(
        `${selected} WHERE r.status='pending' AND p.deleted_at IS NULL ORDER BY r.submitted_at ASC`);
      return rows.map(row => summary(toSubmission(row)));
    },
    async get(id: string): Promise<ReviewSubmission | null> {
      const [rows] = await pool.execute<ReviewRow[]>(`${selected} WHERE r.id=?`, [id]);
      return rows[0] ? toSubmission(rows[0]) : null;
    },
    async latestForProject(ownerId: string, projectId: string): Promise<ReviewSummary | null> {
      if (!await projects.get(ownerId, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      const [rows] = await pool.execute<ReviewRow[]>(
        `${selected} WHERE r.project_id=? ORDER BY r.submitted_at DESC,r.id DESC LIMIT 1`, [projectId]);
      return rows[0] ? summary(toSubmission(rows[0])) : null;
    },
    async approve(adminId: string, id: string): Promise<ReviewSubmission> {
      await withTransaction(pool, async connection => {
        await requireAdmin(connection, adminId);
        const row = await requirePending(connection, id);
        const script = JSON.parse(row.script_json) as GameScript;
        if (contentHashOf(script) !== row.content_hash || script.contentHash !== row.content_hash)
          throw new ProjectError('审核快照校验失败', 409);
        const published = await publications.publish(connection, row.project_id, row.id, script);
        const timestamp = new Date().toISOString();
        await connection.execute('UPDATE creator_projects SET published_at=? WHERE id=?', [timestamp, row.project_id]);
        await connection.execute(`UPDATE creator_review_submissions
          SET status='approved',version=?,reviewer_id=?,reviewed_at=? WHERE id=? AND status='pending'`,
        [published.version, adminId, timestamp, id]);
      });
      return (await store.get(id))!;
    },
    async reject(adminId: string, id: string, reason: string): Promise<ReviewSubmission> {
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new ProjectError('请填写驳回原因');
      await withTransaction(pool, async connection => {
        await requireAdmin(connection, adminId);
        await requirePending(connection, id);
        await connection.execute(`UPDATE creator_review_submissions SET status='rejected',reviewer_id=?,
          reviewed_at=?,rejection_reason=? WHERE id=? AND status='pending'`,
        [adminId, new Date().toISOString(), reason.trim(), id]);
      });
      return (await store.get(id))!;
    },
  };
  return store;
}

export type MysqlReviewStore = ReturnType<typeof createMysqlReviewStore>;
