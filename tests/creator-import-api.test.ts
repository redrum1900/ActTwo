import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportWorker } from '../apps/api/src/creator/import-worker.js';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';
import express from 'express';
import { createImportRouter } from '../apps/api/src/creator/import-router.js';
import type { MysqlCreatorImportStore } from '../apps/api/src/db/mysql-creator-import.js';
import type { CreatorStore } from '../apps/api/src/creator/auth-store.js';

test('background import generates once without applying the draft', async () => {
  const calls: string[] = [];
  const store = {
    updateProgress: async (_owner: string, _project: string, _job: string, progress: string) => { calls.push(progress); },
    finish: async () => { calls.push('finished'); },
    fail: async () => { calls.push('failed'); },
  };
  let count = 0;
  const ai = { complete: async () => ++count === 1
    ? JSON.stringify({ story: swordStoryV2, inferences: [] })
    : JSON.stringify({ findings: [] }) };
  const worker = createImportWorker(store, ai);
  await worker.run('owner', 'same-story', 'job', 'card.txt', '人物与故事');
  assert.ok(calls.includes('finished'));
  assert.ok(!calls.includes('failed'));
  assert.equal(count, 1);
});

test('worker failure is recorded without exposing source text', async () => {
  let failure = '';
  const worker = createImportWorker({
    updateProgress: async () => {}, finish: async () => {},
    fail: async (_owner: string, _project: string, _job: string, message: string) => { failure = message; },
  }, { complete: async () => { throw new Error('source-secret-token'); } });
  await worker.run('owner', 'same-story', 'job', 'card.txt', 'source-secret-token');
  assert.equal(failure.includes('source-secret-token'), false);
});

test('upload is authenticated and accepts a streamed body beyond the JSON limit', async () => {
  let finished: (() => void) | undefined;
  let importedVersion = '';
  const done = new Promise<void>(resolve => { finished = resolve; });
  const jobs = {
    assertCanStart: async () => ({ sections: { 'manifest.json': { content: '{"version":"2.3.0"}' } } }),
    create: async () => ({ id: 'job-1' }),
    updateProgress: async () => {},
    finish: async (_owner: string, _project: string, _job: string, parts: Record<string, string>) => {
      importedVersion = JSON.parse(parts['manifest.json']).version; finished?.(); },
    fail: async () => { finished?.(); },
  } as unknown as MysqlCreatorImportStore;
  const accounts = { accountFor: async (token?: string) => token
    ? { id: 'owner', username: token.startsWith('a') ? 'superadmin' : 'other-admin',
      role: token.startsWith('b') ? 'author' : 'admin' } : null } as unknown as CreatorStore;
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/creator', createImportRouter(accounts, jobs, () => ({
    complete: async () => JSON.stringify({ story: swordStoryV2, inferences: [] }),
  })));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const url = `http://127.0.0.1:${address.port}/api/creator/projects/story-one/import-jobs`;
    const body = '角色卡段落。'.repeat(400_000);
    const headers = { 'Content-Type': 'application/octet-stream', 'X-Import-Filename': 'card.txt' };
    assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Connection: 'close', cookie: `gd_creator=${'b'.repeat(43)}` }, body: '短素材' })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, cookie: `gd_creator=${'c'.repeat(43)}` }, body: '短素材' })).status, 403);
    const response = await fetch(url, { method: 'POST', headers: { ...headers, cookie: `gd_creator=${'a'.repeat(43)}` }, body });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { projectId: 'story-one', jobId: 'job-1' });
    await done;
    assert.equal(importedVersion, '2.3.0');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
