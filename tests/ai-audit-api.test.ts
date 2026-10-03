import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAiAuditRouter } from '../apps/api/src/ai-audit-router.js';

test('usage endpoints require login and admin scope', async () => {
  const app = express();
  app.use((req, res, next) => { res.locals.account = req.headers['x-account'] === 'admin'
    ? { id: 'admin', role: 'admin' } : req.headers['x-account'] === 'author' ? { id: 'author', role: 'author' } : null; next(); });
  app.use('/api/usage', createAiAuditRouter({
    async listOwn(accountId: string) { return { rows: [{ accountId }], nextCursor: null }; },
    async listAll() { return { rows: [{ accountId: 'author' }], nextCursor: null }; },
    async summarizeOwn() { return []; }, async summarizeAll() { return []; },
  } as any));
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    assert.equal((await fetch(`${url}/api/usage/me`)).status, 401);
    assert.equal((await fetch(`${url}/api/usage/admin`, { headers: { 'x-account': 'author' } })).status, 403);
    const own = await (await fetch(`${url}/api/usage/me`, { headers: { 'x-account': 'author' } })).json();
    assert.ok(own.rows.every((row: { accountId: string }) => row.accountId === 'author'));
    assert.equal((await fetch(`${url}/api/usage/admin`, { headers: { 'x-account': 'admin' } })).status, 200);
  } finally { server.close(); }
});
