import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { GameScript } from '@game/contracts';
import { createInitialState } from '@game/engine';
import { contentHashOf, loadScript } from '@game/script';
import { createApp } from '../apps/api/src/app.js';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';
import { withTestMysql } from './support/mysql-test-db.js';

test('old auto and manual saves use their own script after a newer release', async () => {
  await withTestMysql(async pool => {
  const fixture = loadScript('sword-and-screen');
  const version = (value: string): GameScript => {
    const script = { ...fixture, version: value };
    script.contentHash = contentHashOf(script);
    return script;
  };
  const old = version('1.0');
  const next = version('1.1');
  let latest = old;
  const scripts = { get: async () => latest, list: async () => [latest],
    getExact: async (_id: string, label: string, hash: string) =>
      [old, next].find(script => script.version === label && script.contentHash === hash) ?? null };
  const store = createMysqlSaveStore(pool);
  const accounts = createMysqlCreatorStore(pool);
  const player = await accounts.register('version_player', 'player-password-1');
  const server = createApp(store, createChatAdapter({}), { scripts, creatorStore: accounts, mysqlPool: pool }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cookie = `gd_creator=${player.token}`;
    const owner = player.account.id;
    const state = createInitialState(old, { name: '测试' });
    await store.putAuto(owner, old.id, state);
    await store.saveManual(owner, old.id, 1, '旧档', state);
    latest = next;
    const current = await fetch(`${base}/api/games/${old.id}/current`, { headers: { Cookie: cookie } });
    assert.equal(current.status, 200);
    assert.equal((await current.json()).view.script.version, '1.0');
    const slots = await fetch(`${base}/api/games/${old.id}/slots`, { headers: { Cookie: cookie } });
    const listed = await slots.json() as { slots: { slot: number; scriptVersion: string }[] };
    assert.equal(listed.slots.find(entry => entry.slot === 1)?.scriptVersion, '1.0');
    old.title = '篡改后的标题';
    const tampered = await fetch(`${base}/api/games/${old.id}/current`, { headers: { Cookie: cookie } });
    assert.notEqual(tampered.status, 200);
    assert.equal((await store.getAuto(owner, old.id))?.state.scriptVersion, '1.0');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  });
});
