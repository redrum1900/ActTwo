import express, { type Request, type Response } from 'express';
import type { CreatorStore } from './auth-store.js';

const cookieName = 'gd_creator';
const cookieOptions = () => ({ httpOnly: true, sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production', path: '/api/creator', maxAge: 30 * 86400_000 });
const tokenFrom = (req: Request) => req.headers.cookie?.match(/(?:^|;\s*)gd_creator=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];

export function creatorAccount(req: Request, store: CreatorStore) {
  return store.accountFor(tokenFrom(req));
}

export function createCreatorRouter(store: CreatorStore) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: '请求来源不匹配' });
      } catch { return res.status(403).json({ error: '请求来源不匹配' }); }
    }
    next();
  });
  const loginResponse = (res: Response, result: { account: { id: string; username: string }; token: string }, status = 200) => {
    res.cookie(cookieName, result.token, cookieOptions());
    return res.status(status).json(result.account);
  };
  router.post('/register', (req, res) => {
    try {
      const { username, password } = req.body ?? {};
      if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ error: '请输入用户名和密码' });
      return loginResponse(res, store.register(username, password), 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : '注册失败';
      return res.status(message === '用户名已存在' ? 409 : 400).json({ error: message });
    }
  });
  router.post('/login', (req, res) => {
    const { username, password } = req.body ?? {};
    const result = typeof username === 'string' && typeof password === 'string' ? store.login(username, password) : null;
    return result ? loginResponse(res, result) : res.status(401).json({ error: '用户名或密码错误' });
  });
  router.get('/me', (req, res) => {
    const account = creatorAccount(req, store);
    return account ? res.json(account) : res.status(401).json({ error: '请先登录创作中心' });
  });
  router.post('/logout', (req, res) => {
    store.logout(tokenFrom(req));
    res.clearCookie(cookieName, cookieOptions());
    res.json({ ok: true });
  });
  return router;
}
