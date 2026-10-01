import express, { type Request } from 'express';
import { loadScript, listScripts } from '@game/script';
import type { CreatorStore } from './auth-store.js';
import { creatorAccount } from './auth-router.js';
import { ProjectError, type ProjectStore } from './project-store.js';

export function createProjectRouter(accounts: CreatorStore, projects: ProjectStore) {
  const router = express.Router();
  router.use((req, res, next) => {
    const account = creatorAccount(req, accounts);
    if (!account) return res.status(401).json({ error: '请先登录创作中心' });
    res.locals.creatorId = account.id;
    next();
  });
  const owner = (req: Request) => req.res!.locals.creatorId as string;
  const handle = (action: (req: Request) => unknown, status = 200) => (req: Request, res: express.Response) => {
    try { return res.status(status).json(action(req)); }
    catch (error) { return res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '操作失败' }); }
  };
  router.get('/templates', handle(() => ({ templates: listScripts().map(({ id, title, description }) => ({ id, title, description })) })));
  router.get('/projects', handle(req => ({ projects: projects.list(owner(req)) })));
  router.post('/projects', handle(req => {
    const { id, title, templateId } = req.body ?? {};
    if (typeof id !== 'string' || typeof title !== 'string') throw new ProjectError('请输入故事 ID 和名称');
    let template;
    if (templateId !== undefined) {
      if (typeof templateId !== 'string' || !listScripts().some(script => script.id === templateId)) throw new ProjectError('模板不存在');
      template = loadScript(templateId);
    }
    return projects.create(owner(req), id, title, template);
  }, 201));
  router.get('/projects/:id', handle(req => {
    const project = projects.get(owner(req), req.params.id as string);
    if (!project) throw new ProjectError('项目不存在或无权访问', 404);
    return project;
  }));
  router.put('/projects/:id/sections', handle(req => {
    const { path, content, revision } = req.body ?? {};
    if (typeof path !== 'string' || typeof content !== 'string' || !Number.isSafeInteger(revision) || revision < 1)
      throw new ProjectError('配置项保存参数无效');
    return projects.putSection(owner(req), req.params.id as string, path, content, revision);
  }));
  router.post('/projects/:id/npcs', handle(req => {
    const { id, name } = req.body ?? {};
    if (typeof id !== 'string' || typeof name !== 'string') throw new ProjectError('请输入 NPC ID 和名称');
    return projects.addNpc(owner(req), req.params.id as string, id, name);
  }, 201));
  router.delete('/projects/:id/npcs/:npcId', handle(req => projects.removeNpc(owner(req), req.params.id as string, req.params.npcId as string)));
  router.post('/projects/:id/validate', handle(req => projects.validate(owner(req), req.params.id as string)));
  router.post('/projects/:id/publish', handle(req => {
    const script = projects.publish(owner(req), req.params.id as string);
    return { id: script.id, title: script.title, version: script.version, contentHash: script.contentHash };
  }));
  router.delete('/projects/:id', handle(req => {
    projects.delete(owner(req), req.params.id as string);
    return { ok: true };
  }));
  return router;
}
