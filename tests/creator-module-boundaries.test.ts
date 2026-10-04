import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { mountCreatorModule } from '../apps/api/src/modules/creator/router.js';
import { withCreatorMysql } from './support/creator-mysql.js';

test('creator module keeps login, owned drafts and admin reviews on their existing paths', async () => {
  const coversDir = mkdtempSync(path.join(tmpdir(), 'actii-creator-module-'));
  try {
    await withCreatorMysql(async ({ pool, accounts, projects, reviews }) => {
      await accounts.register('writer-one', 'writer-password-1');
      const app = express();
      app.use(express.json());
      mountCreatorModule(app, { creatorStore: accounts, projectStore: projects, reviewStore: reviews,
        mysqlPool: pool, coversDir }, createChatAdapter({}));
      const server = app.listen(0);
      await new Promise<void>(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        assert.equal((await fetch(`${base}/api/creator/projects`)).status, 401);
        const login = await fetch(`${base}/api/creator/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'writer-one', password: 'writer-password-1' }) });
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie')!.split(';')[0];
        const owned = await fetch(`${base}/api/creator/projects`, { headers: { Cookie: cookie } });
        assert.equal(owned.status, 200);
        assert.deepEqual(await owned.json(), { projects: [] });
        assert.equal((await fetch(`${base}/api/creator/reviews`, { headers: { Cookie: cookie } })).status, 403);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  } finally {
    rmSync(coversDir, { recursive: true, force: true });
  }
});
