import express, { type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { loadScript, listScripts } from '@game/script';
import { creatorAccount } from '../../auth/auth-router.js';
import { ProjectError } from './types.js';
import type { MysqlCreatorStore } from '../../../infrastructure/mysql/mysql-auth-store.js';
import type { MysqlProjectStore } from '../../../infrastructure/mysql/mysql-project-store.js';
import type { MysqlReviewStore } from '../../../infrastructure/mysql/mysql-review-store.js';
import type { MysqlCoverAssets } from '../../../infrastructure/mysql/mysql-cover-assets.js';

export function createProjectRouter(accounts: MysqlCreatorStore, projects: MysqlProjectStore,
  reviews: MysqlReviewStore, covers: MysqlCoverAssets, builtInTemplates = false) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    const account = await creatorAccount(req, accounts);
    if (!account) return res.status(401).json({ error: '请先登录创作中心' });
    res.locals.creatorId = account.id;
    next();
  });
  const owner = (req: Request) => req.res!.locals.creatorId as string;
  const handle = (action: (req: Request) => unknown, status = 200) => async (req: Request, res: express.Response) => {
    try { return res.status(status).json(await action(req)); }
    catch (error) { return res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '操作失败' }); }
  };
  router.get('/templates', handle(() => ({ templates: builtInTemplates
    ? listScripts().map(({ id, title, description }) => ({ id, title, description })) : [] })));
  router.get('/projects', handle(async req => ({ projects: await Promise.all((await projects.list(owner(req))).map(async project => ({ ...project,
    review: await reviews.latestForProject(owner(req), project.id) }))) })));
  router.post('/projects', handle(async req => {
    const { title, templateId } = req.body ?? {};
    if (typeof title !== 'string') throw new ProjectError('请输入故事名称');
    let template;
    if (templateId !== undefined) {
      if (!builtInTemplates || typeof templateId !== 'string' || !listScripts().some(script => script.id === templateId)) throw new ProjectError('模板不存在');
      template = loadScript(templateId);
    }
    const project = await projects.create(owner(req), `story-${randomUUID()}`, title, template);
    return { ...project, review: null };
  }, 201));
  router.get('/projects/:id', handle(async req => {
    const project = await projects.get(owner(req), req.params.id as string);
    if (!project) throw new ProjectError('项目不存在或无权访问', 404);
    return { ...project, review: await reviews.latestForProject(owner(req), project.id) };
  }));
  router.put('/projects/:id/sections', handle(req => {
    const { path, content, revision } = req.body ?? {};
    if (typeof path !== 'string' || typeof content !== 'string' || !Number.isSafeInteger(revision) || revision < 1)
      throw new ProjectError('配置项保存参数无效');
    return projects.putSection(owner(req), req.params.id as string, path, content, revision);
  }));
  router.post('/projects/:id/migrate-stats', handle(async req => {
    const revisions = req.body?.revisions;
    if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions)) throw new ProjectError('迁移版本参数无效');
    const project = await projects.migrateStats(owner(req), req.params.id as string, revisions);
    return { ...project, review: await reviews.latestForProject(owner(req), project.id) };
  }));
  router.post('/projects/:id/cover', express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
    try {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      return res.status(201).json(await covers.upload(owner(req), req.params.id as string, bytes, req.headers['content-type']?.split(';')[0] ?? ''));
    } catch (error) { return res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '封面上传失败' }); }
  });
  router.get('/projects/:id/covers/:assetId', async (req, res) => {
    try {
      const image = await covers.draft(owner(req), req.params.id as string, req.params.assetId as string);
      res.type(image.mime).set('Cache-Control', 'private, no-store').send(image.bytes);
    } catch (error) { res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '封面读取失败' }); }
  });
  router.delete('/projects/:id/covers/:assetId', handle(async req => {
    await covers.discard(owner(req), req.params.id as string, req.params.assetId as string);
    return { ok: true };
  }));
  router.post('/projects/:id/item-image', express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
    try {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      return res.status(201).json(await covers.uploadItem(owner(req), req.params.id as string, bytes, req.headers['content-type']?.split(';')[0] ?? ''));
    } catch (error) { return res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '道具图片上传失败' }); }
  });
  router.get('/projects/:id/item-images/:assetId', async (req, res) => {
    try {
      const image = await covers.draftItem(owner(req), req.params.id as string, req.params.assetId as string);
      res.type(image.mime).set('Cache-Control', 'private, no-store').send(image.bytes);
    } catch (error) { res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '道具图片读取失败' }); }
  });
  router.delete('/projects/:id/item-images/:assetId', handle(async req => {
    await covers.discardItem(owner(req), req.params.id as string, req.params.assetId as string);
    return { ok: true };
  }));
  router.post('/projects/:id/npcs', handle(async req => {
    const { id, name } = req.body ?? {};
    if (typeof id !== 'string' || typeof name !== 'string') throw new ProjectError('请输入 NPC ID 和名称');
    const project = await projects.addNpc(owner(req), req.params.id as string, id, name);
    return { ...project, review: await reviews.latestForProject(owner(req), project.id) };
  }, 201));
  router.delete('/projects/:id/npcs/:npcId', handle(async req => {
    const project = await projects.removeNpc(owner(req), req.params.id as string, req.params.npcId as string);
    return { ...project, review: await reviews.latestForProject(owner(req), project.id) };
  }));
  router.post('/projects/:id/validate', handle(req => projects.validate(owner(req), req.params.id as string)));
  router.post('/projects/:id/submit', handle(async req => {
    const { script: _script, ...submission } = await reviews.submit(owner(req), req.params.id as string);
    return submission;
  }, 201));
  router.delete('/projects/:id', handle(async req => {
    await projects.delete(owner(req), req.params.id as string);
    return { ok: true };
  }));
  return router;
}
