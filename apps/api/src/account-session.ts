import type { Request, RequestHandler } from 'express';
import type { CreatorAccount, CreatorStore } from './creator/auth-store.js';
import type { MysqlCreatorStore } from './db/mysql-auth-store.js';

type AccountStore = CreatorStore | MysqlCreatorStore;

export function sessionTokenFrom(req: Request): string | undefined {
  return req.headers.cookie?.match(/(?:^|;\s*)gd_creator=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
}

export async function accountForRequest(req: Request, store: AccountStore): Promise<CreatorAccount | null> {
  return await store.accountFor(sessionTokenFrom(req));
}

export function requireAccount(store: AccountStore): RequestHandler {
  return async (req, res, next) => {
    try {
      const account = await accountForRequest(req, store);
      if (!account) return res.status(401).json({ error: '请先登录' });
      res.locals.account = account;
      next();
    } catch (error) { next(error); }
  };
}
