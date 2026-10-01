import express from 'express';
import type { CreatorStore } from './auth-store.js';
import { creatorAccount } from './auth-router.js';
import { ProjectError } from './project-store.js';
import type { ReviewStore } from './review-store.js';

export function createReviewRouter(accounts: CreatorStore, reviews: ReviewStore) {
  const router = express.Router();
  router.use((req, res, next) => {
    const account = creatorAccount(req, accounts);
    if (!account) return res.status(401).json({ error: '请先登录创作中心' });
    if (account.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
    res.locals.adminId = account.id;
    next();
  });
  const handle = (action: (req: express.Request) => unknown) => (req: express.Request, res: express.Response) => {
    try { return res.json(action(req)); }
    catch (error) { return res.status(error instanceof ProjectError ? error.status : 500)
      .json({ error: error instanceof Error ? error.message : '审核操作失败' }); }
  };
  router.get('/', handle(() => ({ reviews: reviews.listPending() })));
  router.get('/:id', handle(req => {
    const review = reviews.get(req.params.id as string);
    if (!review) throw new ProjectError('审核申请不存在', 404);
    return review;
  }));
  router.post('/:id/approve', handle(req => reviews.approve(req.res!.locals.adminId as string, req.params.id as string)));
  router.post('/:id/reject', handle(req => reviews.reject(req.res!.locals.adminId as string, req.params.id as string, req.body?.reason)));
  return router;
}
