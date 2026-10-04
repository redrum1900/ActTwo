import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadScript } from '@game/script';
import { createMysqlPool } from '../apps/api/src/infrastructure/mysql/mysql.js';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';
import { createMysqlProjectStore } from '../apps/api/src/infrastructure/mysql/mysql-project-store.js';

test('MySQL review publishes only the approved frozen snapshot',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
    const { createMysqlReviewStore } = await import('../apps/api/src/infrastructure/mysql/mysql-review-store.js');
    const pool = createMysqlPool(process.env);
    const accounts = createMysqlCreatorStore(pool);
    const projects = createMysqlProjectStore(pool);
    const reviews = createMysqlReviewStore(pool, projects);
    const suffix = randomUUID().replaceAll('-', '');
    const projectId = `test-${suffix}`;
    const author = await accounts.register(`test_${suffix.slice(0, 20)}`, 'sample-password-123');
    const admin = await accounts.createAdmin(`test_${suffix.slice(0, 16)}adm`, 'sample-password-123');
    try {
      await projects.create(author.account.id, projectId, '测试故事', loadScript('sword-and-screen'));
      const submission = await reviews.submit(author.account.id, projectId);
      await assert.rejects(reviews.submit(author.account.id, projectId), /已有待审版本/);
      await assert.rejects(reviews.approve(author.account.id, submission.id), /管理员权限/);
      await pool.execute('UPDATE creator_review_submissions SET content_hash=? WHERE id=?', ['bad-hash', submission.id]);
      await assert.rejects(reviews.approve(admin.id, submission.id), /快照校验失败/);
      await pool.execute('UPDATE creator_review_submissions SET content_hash=? WHERE id=?',
        [submission.contentHash, submission.id]);
      const approved = await reviews.approve(admin.id, submission.id);
      assert.equal(approved.status, 'approved');
      assert.deepEqual(await projects.getPublished(projectId), submission.script);
    } finally {
      await pool.execute('DELETE FROM creator_review_submissions WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM published_scripts WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM creator_sections WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM creator_projects WHERE id=?', [projectId]);
      await pool.execute('DELETE FROM creator_sessions WHERE account_id IN (?,?)', [author.account.id, admin.id]);
      await pool.execute('DELETE FROM creator_accounts WHERE id IN (?,?)', [author.account.id, admin.id]);
      await pool.end();
    }
  });

test('MySQL media metadata serves only images linked to a published project',
  { skip: process.env.MYSQL_REMOTE_SMOKE !== '1' }, async () => {
    const { createMysqlCoverAssets } = await import('../apps/api/src/infrastructure/mysql/mysql-cover-assets.js');
    const pool = createMysqlPool(process.env);
    const accounts = createMysqlCreatorStore(pool);
    const projects = createMysqlProjectStore(pool);
    const suffix = randomUUID().replaceAll('-', '');
    const projectId = `test-${suffix}`;
    const account = await accounts.register(`test_${suffix.slice(0, 20)}`, 'sample-password-123');
    const directory = mkdtempSync(path.join(tmpdir(), 'game-dd-cover-test-'));
    try {
      await projects.create(account.account.id, projectId, '图片测试');
      const covers = createMysqlCoverAssets(pool, directory, projects);
      const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
      const uploaded = await covers.upload(account.account.id, projectId, bytes, 'image/png');
      const assetId = uploaded.cover!.split('/').at(-1)!;
      assert.deepEqual((await covers.draft(account.account.id, projectId, assetId)).bytes, bytes);
      await assert.rejects(covers.published(assetId), /封面不存在/);
      const script = { ...loadScript('sword-and-screen'), id: projectId, cover: uploaded.cover! };
      await pool.execute(`INSERT INTO published_scripts
        (project_id,script_json,version,content_hash,published_at) VALUES (?,?,?,?,?)`,
      [projectId, JSON.stringify(script), script.version, script.contentHash ?? '', new Date().toISOString()]);
      assert.deepEqual((await covers.published(assetId)).bytes, bytes);
    } finally {
      await pool.execute('DELETE FROM creator_cover_assets WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM published_scripts WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM creator_sections WHERE project_id=?', [projectId]);
      await pool.execute('DELETE FROM creator_projects WHERE id=?', [projectId]);
      await pool.execute('DELETE FROM creator_sessions WHERE account_id=?', [account.account.id]);
      await pool.execute('DELETE FROM creator_accounts WHERE id=?', [account.account.id]);
      await pool.end();
      rmSync(directory, { recursive: true, force: true });
    }
  });
