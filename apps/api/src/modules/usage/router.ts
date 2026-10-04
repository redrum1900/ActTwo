import express from 'express';
import type { MysqlAiAuditStore, AiAuditFilters } from '../../infrastructure/mysql/mysql-ai-audit-store.js';
import { auditHealth } from '../../infrastructure/ai/ai-audit.js';
import type { CreatorAccount } from '../auth/types.js';

function filters(query: Record<string, unknown>): AiAuditFilters {
  const value = (key: string) => typeof query[key] === 'string' ? String(query[key]).slice(0, 160) : undefined;
  const source = value('source');
  const month = (key: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value(key) ?? '') ? value(key) : undefined;
  const limit = Number(value('limit'));
  return { accountId: value('accountId'), storyId: value('storyId'),
    source: source && ['formal', 'playtest', 'import', 'system'].includes(source) ? source as AiAuditFilters['source'] : undefined,
    model: value('model'), purpose: value('purpose'), from: month('from'), to: month('to'), cursor: value('cursor'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : 30 };
}

export function createAiAuditRouter(store: Pick<MysqlAiAuditStore, 'listOwn' | 'listAll' | 'summarizeOwn' | 'summarizeAll'>) {
  const router = express.Router();
  router.use((req, res, next) => {
    const account = res.locals.account as CreatorAccount | null;
    if (!account) return res.status(401).json({ error: '请先登录' });
    next();
  });
  router.get('/me', async (req, res) => {
    try {
      const account = res.locals.account as CreatorAccount;
      const selected = filters(req.query);
      delete selected.accountId;
      const [page, summary] = await Promise.all([store.listOwn(account.id, selected), store.summarizeOwn(account.id, selected)]);
      res.json({ ...page, summary });
    } catch { res.status(500).json({ error: '用量记录暂不可用' }); }
  });
  router.get('/admin', async (req, res) => {
    const account = res.locals.account as CreatorAccount;
    if (account.role !== 'admin') return res.status(403).json({ error: '仅管理员可查看' });
    try {
      const selected = filters(req.query);
      const [page, summary] = await Promise.all([store.listAll(selected), store.summarizeAll(selected)]);
      res.json({ ...page, summary, auditHealth });
    } catch { res.status(500).json({ error: '用量记录暂不可用' }); }
  });
  return router;
}
