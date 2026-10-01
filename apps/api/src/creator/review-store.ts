import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { GameScript } from '@game/contracts';
import { contentHashOf } from '@game/script';
import { ProjectError, type ProjectStore } from './project-store.js';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export interface ReviewSubmission {
  id: string;
  projectId: string;
  projectTitle: string;
  authorId: string;
  authorUsername: string;
  script: GameScript;
  contentHash: string;
  version: string;
  status: ReviewStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerId: string | null;
  rejectionReason: string | null;
}
export type ReviewSummary = Omit<ReviewSubmission, 'script'>;

interface ReviewRow {
  id: string; project_id: string; project_title: string; author_id: string; author_username: string;
  script_json: string; content_hash: string; version: string; status: ReviewStatus;
  submitted_at: string; reviewed_at: string | null; reviewer_id: string | null; rejection_reason: string | null;
}

export function createReviewStore(db: Database.Database, projects: ProjectStore) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_review_submissions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES creator_projects(id),
      author_id TEXT NOT NULL REFERENCES creator_accounts(id),
      script_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
      submitted_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewer_id TEXT REFERENCES creator_accounts(id),
      rejection_reason TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS creator_one_pending_review ON creator_review_submissions(project_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS creator_review_project_time ON creator_review_submissions(project_id,submitted_at DESC);
  `);
  const selected = `SELECT r.*,p.title AS project_title,a.username AS author_username
    FROM creator_review_submissions r
    JOIN creator_projects p ON p.id=r.project_id
    JOIN creator_accounts a ON a.id=r.author_id`;
  const toSubmission = (row: ReviewRow): ReviewSubmission => ({
    id: row.id, projectId: row.project_id, projectTitle: (JSON.parse(row.script_json) as GameScript).title,
    authorId: row.author_id, authorUsername: row.author_username,
    script: JSON.parse(row.script_json) as GameScript, contentHash: row.content_hash,
    version: row.version, status: row.status, submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at, reviewerId: row.reviewer_id, rejectionReason: row.rejection_reason,
  });
  const summary = ({ script: _script, ...rest }: ReviewSubmission): ReviewSummary => rest;
  const requireAdmin = (id: string) => {
    const role = (db.prepare('SELECT role FROM creator_accounts WHERE id=?').get(id) as { role: string } | undefined)?.role;
    if (role !== 'admin') throw new ProjectError('需要管理员权限', 403);
  };
  const requirePending = (id: string) => {
    const row = db.prepare(`${selected} WHERE r.id=?`).get(id) as ReviewRow | undefined;
    if (!row) throw new ProjectError('审核申请不存在', 404);
    if (row.status !== 'pending') throw new ProjectError('该申请已审核', 409);
    const project = db.prepare('SELECT deleted_at FROM creator_projects WHERE id=?').get(row.project_id) as { deleted_at: string | null } | undefined;
    if (!project || project.deleted_at) throw new ProjectError('故事已删除，不能审核', 409);
    return row;
  };

  const store = {
    submit: db.transaction((ownerId: string, projectId: string): ReviewSubmission => {
      if (!projects.get(ownerId, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      if (db.prepare("SELECT id FROM creator_review_submissions WHERE project_id=? AND status='pending'").get(projectId))
        throw new ProjectError('已有待审版本，请等待审核', 409);
      const script = projects.validatedDraft(ownerId, projectId);
      const id = randomUUID();
      db.prepare(`INSERT INTO creator_review_submissions
        (id,project_id,author_id,script_json,content_hash,version,status,submitted_at)
        VALUES (?,?,?,?,?,?,'pending',?)`)
        .run(id, projectId, ownerId, JSON.stringify(script), script.contentHash, script.version, new Date().toISOString());
      return store.get(id)!;
    }),
    listPending(): ReviewSummary[] {
      return (db.prepare(`${selected} WHERE r.status='pending' AND p.deleted_at IS NULL ORDER BY r.submitted_at ASC`)
        .all() as ReviewRow[]).map(row => summary(toSubmission(row)));
    },
    get(id: string): ReviewSubmission | null {
      const row = db.prepare(`${selected} WHERE r.id=?`).get(id) as ReviewRow | undefined;
      return row ? toSubmission(row) : null;
    },
    latestForProject(ownerId: string, projectId: string): ReviewSummary | null {
      if (!projects.get(ownerId, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      const row = db.prepare(`${selected} WHERE r.project_id=? ORDER BY r.submitted_at DESC,r.rowid DESC LIMIT 1`)
        .get(projectId) as ReviewRow | undefined;
      return row ? summary(toSubmission(row)) : null;
    },
    approve: db.transaction((adminId: string, id: string): ReviewSubmission => {
      requireAdmin(adminId);
      const row = requirePending(id);
      const script = JSON.parse(row.script_json) as GameScript;
      if (contentHashOf(script) !== row.content_hash || script.contentHash !== row.content_hash)
        throw new ProjectError('审核快照校验失败', 409);
      const timestamp = new Date().toISOString();
      db.prepare(`INSERT INTO published_scripts(project_id,script_json,version,content_hash,published_at) VALUES(?,?,?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET script_json=excluded.script_json,version=excluded.version,
        content_hash=excluded.content_hash,published_at=excluded.published_at`)
        .run(row.project_id, row.script_json, row.version, row.content_hash, timestamp);
      db.prepare('UPDATE creator_projects SET published_at=? WHERE id=?').run(timestamp, row.project_id);
      db.prepare("UPDATE creator_review_submissions SET status='approved',reviewer_id=?,reviewed_at=? WHERE id=? AND status='pending'")
        .run(adminId, timestamp, id);
      return store.get(id)!;
    }),
    reject: db.transaction((adminId: string, id: string, reason: string): ReviewSubmission => {
      requireAdmin(adminId);
      if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new ProjectError('请填写驳回原因');
      requirePending(id);
      db.prepare("UPDATE creator_review_submissions SET status='rejected',reviewer_id=?,reviewed_at=?,rejection_reason=? WHERE id=? AND status='pending'")
        .run(adminId, new Date().toISOString(), reason.trim(), id);
      return store.get(id)!;
    }),
  };
  return store;
}

export type ReviewStore = ReturnType<typeof createReviewStore>;
