import express, { type Request, type Response } from 'express';
import type { ChatAdapter } from './modules/gameplay/chat-service.js';
import { createGameSessionContext } from './modules/gameplay/session.js';
import { createCatalogRouter } from './modules/catalog/router.js';
import { createGameplayRouter } from './modules/gameplay/router.js';
import { AiServiceError } from './infrastructure/ai/ai-adapter.js';
import type { MysqlSaveStore } from './infrastructure/mysql/mysql-save-store.js';
import { createScriptRepository, createMysqlScriptRepository, ScriptNotFoundError, type ScriptRepository, type AsyncScriptRepository } from './script-repository.js';
import { mountCreatorModule, type CreatorModuleOptions } from './modules/creator/router.js';
import { createPublishedAssetsRouter } from './modules/creator/assets/published-assets-router.js';
import { accountForRequest } from './modules/auth/account-session.js';
import { createAiAuditRouter } from './modules/usage/router.js';
import type { MysqlProjectStore } from './infrastructure/mysql/mysql-project-store.js';
export { readPlayer } from './modules/gameplay/read-player.js';

export function createApp(store: MysqlSaveStore, adapter: ChatAdapter, options: CreatorModuleOptions & {
  debugEnabled?: boolean; scripts?: ScriptRepository | AsyncScriptRepository;
} = {}) {
  const app = express();
  const scripts = options.scripts ?? (options.projectStore
    ? createMysqlScriptRepository(options.projectStore)
    : createScriptRepository());
  app.use(express.json({ limit: '2mb' }));
  const covers = mountCreatorModule(app, options, adapter);
  if (covers) app.use('/api', createPublishedAssetsRouter(covers));
  app.use('/api', async (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: '请求来源不匹配' });
      } catch { return res.status(403).json({ error: '请求来源不匹配' }); }
    }
    try {
      res.locals.account = options.creatorStore ? await accountForRequest(req, options.creatorStore) : null;
      next();
    } catch (error) { next(error); }
  });
  if (options.auditStore) app.use('/api/usage', createAiAuditRouter(options.auditStore));

  const session = createGameSessionContext(store, adapter, scripts);
  app.use('/api', createCatalogRouter(session));
  app.use('/api/games/:gameId', createGameplayRouter(session, { debugEnabled: options.debugEnabled }));
  app.use('/api', (error: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    const message = error.message || '服务器错误';
    const status = error instanceof AiServiceError ? error.status : error instanceof ScriptNotFoundError ? 404
      : (error as Error & { status?: number }).status === 413 ? 413
        : message.includes('存档已变化') ? 409 : message.includes('没有自动存档') ? 404 : 400;
    res.status(status).json({ error: message });
  });
  return app;
}
