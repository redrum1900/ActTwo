import express from 'express';
import { createWriteStream } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { CreatorStore } from './auth-store.js';
import type { MysqlCreatorStore } from '../db/mysql-auth-store.js';
import type { MysqlCreatorImportStore } from '../db/mysql-creator-import.js';
import { creatorAccount } from './auth-router.js';
import { createMainAiClient, type MainAiClient } from './import-ai.js';
import { createImportWorker } from './import-worker.js';
import { extractImportText } from './import-extract.js';
import { ProjectError } from './project-store.js';
import type { AiAuditSink } from '../ai-audit.js';

const extensions = new Set(['.txt', '.md', '.doc', '.docx', '.json']);
const ownStatus = (error: unknown) => error instanceof ProjectError ? error.status : 500;
const safeError = (error: unknown, fallback: string) =>
  error instanceof ProjectError || error instanceof Error && error.name === 'ImportAiConfigError' ? error.message : fallback;

export function createImportRouter(accounts: CreatorStore | MysqlCreatorStore, jobs: MysqlCreatorImportStore,
  aiFactory?: () => MainAiClient, auditSink?: AiAuditSink) {
  const router = express.Router();
  const getAi = aiFactory ?? (() => createMainAiClient(process.env, auditSink));
  router.use('/projects/:id/import-jobs', async (req, res, next) => {
    const account = await creatorAccount(req, accounts);
    if (!account) return res.status(401).json({ error: '请先登录创作中心' });
    if (account.role !== 'admin' || account.username !== 'superadmin')
      return res.status(403).json({ error: '仅 superadmin 可使用智能导入' });
    res.locals.creatorId = account.id;
    next();
  });
  router.post('/projects/:id/import-jobs', async (req, res) => {
    let temporaryPath: string | null = null;
    let createdJobId: string | null = null;
    try {
      const owner = res.locals.creatorId as string;
      const projectId = req.params.id as string;
      const fileName = decodeURIComponent(String(req.headers['x-import-filename'] ?? ''));
      if (!extensions.has(path.extname(fileName).toLowerCase()) || fileName.includes('/') || fileName.includes('\\'))
        throw new ProjectError('只支持 txt、md、doc、docx、json 文件');
      const project = await jobs.assertCanStart(owner, projectId);
      let draftVersion = '1.0.0';
      try { draftVersion = JSON.parse(project.sections['manifest.json']?.content ?? '{}').version || draftVersion; }
      catch { /* Existing invalid draft can be replaced; retain the default draft version. */ }
      const ai = getAi();
      temporaryPath = path.join(tmpdir(), `game-import-${randomUUID()}`);
      const job = await jobs.create(owner, projectId, temporaryPath);
      createdJobId = job.id;
      await pipeline(req, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
      const sourcePath = temporaryPath;
      temporaryPath = null;
      void (async () => {
        try {
          const source = await extractImportText(fileName, sourcePath);
          await writeFile(sourcePath, source, { encoding: 'utf8', mode: 0o600 });
          await createImportWorker(jobs, ai).run(owner, projectId, job.id, fileName, source, draftVersion,
            { accountId: owner, source: 'import', storyId: projectId, operationId: job.id });
        } catch {
          await jobs.fail(owner, projectId, job.id, '文件解析失败，请检查格式后重试').catch(() => {});
        }
      })();
      res.status(202).json({ projectId, jobId: job.id });
    } catch (error) {
      if (temporaryPath) await unlink(temporaryPath).catch(() => {});
      if (createdJobId) await jobs.fail(res.locals.creatorId as string, req.params.id as string,
        createdJobId, '上传中断，请重新发起').catch(() => {});
      res.status(ownStatus(error)).json({ error: safeError(error, '导入上传失败，请稍后重试') });
    }
  });
  router.get('/projects/:id/import-jobs/:jobId', async (req, res) => {
    try {
      const job = await jobs.getOwned(res.locals.creatorId as string, req.params.id as string, req.params.jobId as string);
      res.json({ projectId: job.project_id, jobId: job.id, status: job.status, progress: job.progress,
        error: job.error_text, report: job.report_json ? JSON.parse(job.report_json) : null,
        parts: job.status === 'ready' && job.parts_json ? JSON.parse(job.parts_json) : null });
    } catch (error) { res.status(ownStatus(error)).json({ error: safeError(error, '查询失败') }); }
  });
  router.post('/projects/:id/import-jobs/:jobId/apply', async (req, res) => {
    try { res.json(await jobs.apply(res.locals.creatorId as string, req.params.id as string, req.params.jobId as string)); }
    catch (error) { res.status(ownStatus(error)).json({ error: safeError(error, '写入失败') }); }
  });
  router.delete('/projects/:id/import-jobs/:jobId', async (req, res) => {
    try { await jobs.cancel(res.locals.creatorId as string, req.params.id as string, req.params.jobId as string); res.json({ ok: true }); }
    catch (error) { res.status(ownStatus(error)).json({ error: safeError(error, '取消失败') }); }
  });
  return router;
}
