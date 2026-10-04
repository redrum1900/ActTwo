import express from 'express';
import { creatorAccount } from '../../auth/auth-router.js';
import { ProjectError } from '../projects/types.js';
import type { MysqlCreatorStore } from '../../../infrastructure/mysql/mysql-auth-store.js';
import type { MysqlReviewStore } from '../../../infrastructure/mysql/mysql-review-store.js';

export function createReviewRouter(accounts: MysqlCreatorStore, reviews: MysqlReviewStore) {
  const router = express.Router();
  router.use(async (req, res, next) => {
    const account = await creatorAccount(req, accounts);
    if (!account) return res.status(401).json({ error: '请先登录创作中心' });
    if (account.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    res.locals.adminId = account.id;
    next();
  });
  const handle = (action: (req: express.Request) => unknown) => async (req: express.Request, res: express.Response) => {
    try { return res.json(await action(req)); }
    catch (error) { return res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '审核操作失败' }); }
  };
  router.get('/', handle(async () => ({ reviews: await reviews.listPending() })));
  router.get('/:id', handle(async req => {
    const review = await reviews.get(req.params.id as string);
    if (!review) throw new ProjectError('审核申请不存在', 404);
    return review;
  }));
  router.post('/:id/approve', handle(req => reviews.approve(req.res!.locals.adminId as string, req.params.id as string)));
  router.post('/:id/reject', handle(req => reviews.reject(req.res!.locals.adminId as string, req.params.id as string, req.body?.reason)));
  return router;
}
