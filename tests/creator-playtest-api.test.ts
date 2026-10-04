import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPlaytestRouter } from '../apps/api/src/modules/playtest/router.js';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';
import { createInitialState } from '@game/engine';

test('creator playtest creation validates draft, owns each snapshot and never touches formal saves', async () => {
  const calls: string[] = [];
  const project = { async validatedDraft(owner: string) { calls.push(`validate:${owner}`); return swordStoryV2; } };
  const playtests = { async list() { return []; }, async create(owner: string, id: string, read: () => Promise<unknown>) {
    calls.push(`create:${owner}:${id}`);
    const script = await read();
    return { id: 'pt-1', projectId: id, ownerId: owner, script, auto: null,
      scriptHash: 'hash', createdAt: '2026-10-03T00:00:00Z', playedAt: null }; } };
  const accounts = { accountFor: async (token?: string) => token ? { id: 'owner', role: 'author' } : null };
  const app = express(); app.use(express.json());
  app.use('/api/creator', createPlaytestRouter(accounts as any, project as any, playtests as any,
    { mode: 'demo', generate: async () => ({ message: '你好', proposedEventIds: [] }), rewrite: async (_: unknown, draft: string) => draft } as any));
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/creator/projects/story/playtests`;
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    const response = await fetch(url, { method: 'POST', headers: { cookie: `gd_creator=${'a'.repeat(43)}` } });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).id, 'pt-1');
    assert.deepEqual(calls, ['create:owner:story', 'validate:owner']);
  } finally { server.close(); }
});

test('playtest keeps its frozen script, isolated auto-save and idempotent chat turn', async () => {
  const frozen = structuredClone(swordStoryV2);
  const state = createInitialState(frozen, { name: '阿言', birthday: '2000-01-01', playStyle: 'team' });
  let saved: any = { id: 'pt-1', projectId: 'story', ownerId: 'owner', script: frozen, scriptHash: 'frozen',
    auto: { slot: 0, label: '试玩自动存档', state, revision: 1, updatedAt: '2026-10-03' },
    createdAt: '2026-10-03', playedAt: '2026-10-03' };
  let generations = 0;
  const store = {
    async get(_owner: string, _project: string, id: string) { return id === saved?.id ? structuredClone(saved) : null; },
    async updateAuto(_owner: string, _project: string, id: string, revision: number, next: unknown) {
      assert.equal(id, 'pt-1');
      if (saved.auto.revision !== revision) throw new Error('stale');
      saved.auto = { ...saved.auto, state: next, revision: revision + 1 };
      return structuredClone(saved);
    },
    async delete() { saved = null; return true; },
  };
  const accounts = { accountFor: async (token?: string) => token ? { id: 'owner', role: 'author' } : null };
  const adapter = { mode: 'demo', async generate() { generations++; return { message: '你好。', proposedEventIds: [] }; },
    async rewrite(_context: unknown, draft: string) { return draft; } };
  const app = express(); app.use(express.json());
  app.use('/api/creator', createPlaytestRouter(accounts as any, { validatedDraft: async () => { throw new Error('should not load live draft'); } } as any,
    store as any, adapter as any));
  const server = app.listen(0);
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/creator/projects/story/playtests/pt-1`;
    const headers = { cookie: `gd_creator=${'a'.repeat(43)}`, 'Content-Type': 'application/json', Connection: 'close' };
    assert.equal((await (await fetch(url, { headers })).json()).detail.title, frozen.title);
    assert.equal((await fetch(`${url}/action`, { method: 'POST', headers,
      body: JSON.stringify({ type: 'wait', revision: 0 }) })).status, 409);
    const first = await fetch(`${url}/chat/stream`, { method: 'POST', headers,
      body: JSON.stringify({ npcId: 'su-nian', text: '你好', revision: 1, turnId: 'turn-1' }) });
    assert.match(await first.text(), /event: final/);
    const again = await fetch(`${url}/chat/stream`, { method: 'POST', headers,
      body: JSON.stringify({ npcId: 'su-nian', text: '你好', revision: 1, turnId: 'turn-1' }) });
    assert.match(await again.text(), /event: final/);
    assert.equal(generations, 1);
    frozen.title = '快照标题';
    assert.equal((await (await fetch(url, { headers })).json()).detail.title, '快照标题');
    await fetch(url, { method: 'DELETE', headers });
    assert.equal((await fetch(url, { headers })).status, 404);
  } finally { server.close(); }
});
