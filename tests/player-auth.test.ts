import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createCreatorRouter } from '../apps/api/src/creator/auth-router.js';
import { createApp } from '../apps/api/src/app.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';

test('one creator session cookie covers game APIs and clears the old path', async () => {
  const store = createCreatorStore(':memory:');
  const app = express();
  app.use(express.json());
  app.use('/api/creator', createCreatorRouter(store));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const register = await fetch(`${base}/api/creator/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player_one', password: 'player-password-1' }) });
    assert.equal(register.status, 201);
    const cookies = register.headers.getSetCookie();
    assert.ok(cookies.some(cookie => cookie.includes('Path=/api;')));
    assert.ok(cookies.some(cookie => cookie.startsWith('gd_creator=;') && cookie.includes('Path=/api/creator;')));
    const tokenCookie = cookies.find(cookie => cookie.startsWith('gd_creator=') && !cookie.startsWith('gd_creator=;'))!.split(';')[0];
    const logout = await fetch(`${base}/api/creator/logout`, { method: 'POST', headers: { Cookie: tokenCookie } });
    assert.equal(logout.status, 200);
    const cleared = logout.headers.getSetCookie();
    assert.ok(cleared.some(cookie => cookie.startsWith('gd_creator=;') && cookie.includes('Path=/api;')));
    assert.ok(cleared.some(cookie => cookie.startsWith('gd_creator=;') && cookie.includes('Path=/api/creator;')));
    const login = await fetch(`${base}/api/creator/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'player_one', password: 'player-password-1' }) });
    assert.equal(login.status, 200);
    assert.ok(login.headers.getSetCookie().some(cookie => cookie.startsWith('gd_creator=;') && cookie.includes('Path=/api/creator;')));
  } finally { server.close(); store.close(); }
});

test('formal play uses account identity, never the guest cookie', async () => {
  const accounts = createCreatorStore(':memory:');
  const saves = createSaveStore(':memory:');
  const app = createApp(saves, createChatAdapter({}), { creatorStore: accounts });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const game = 'sword-and-screen';
  const forgedGuest = { Cookie: 'gd_guest=22222222-2222-4222-8222-222222222222' };
  try {
    const catalog = await fetch(`${base}/api/catalog`);
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json() as { games: { hasAuto: boolean }[] }).games[0].hasAuto, false);
    for (const endpoint of [`/api/games/${game}/current`, `/api/games/${game}/slots`]) {
      assert.equal((await fetch(`${base}${endpoint}`, { headers: forgedGuest })).status, 401);
    }
    for (const endpoint of [`/api/games/${game}/new`, `/api/games/${game}/action`, `/api/games/${game}/chat/stream`, `/api/games/${game}/import`]) {
      assert.equal((await fetch(`${base}${endpoint}`, { method: 'POST', headers: { ...forgedGuest, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    }
    const a = accounts.register('player_a', 'player-password-a').token;
    const b = accounts.register('player_b', 'player-password-b').token;
    const player = { name: '阿言', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] };
    const started = await fetch(`${base}/api/games/${game}/new`, { method: 'POST', headers: { Cookie: `gd_creator=${a}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ player }) });
    assert.equal(started.status, 200);
    assert.equal((await fetch(`${base}/api/games/${game}/current`, { headers: { Cookie: `gd_creator=${b}` } })).status, 404);
    assert.equal((await fetch(`${base}/api/games/${game}/current`, { headers: { Cookie: `gd_creator=${a}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/games/${game}/new`, { method: 'POST', headers: { Cookie: `gd_creator=${a}`, Origin: 'https://evil.example',
      'Content-Type': 'application/json' }, body: JSON.stringify({ player }) })).status, 403);
  } finally { server.close(); accounts.close(); saves.close(); }
});

test('shared account guard rejects missing and expired sessions', async () => {
  const { requireAccount } = await import('../apps/api/src/account-session.js');
  const store = createCreatorStore(':memory:');
  const app = express();
  app.get('/protected', requireAccount(store), (_req, res) => res.json(res.locals.account));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(`${base}/protected`)).status, 401);
    const issued = store.register('guard_player', 'player-password-1');
    const headers = { Cookie: `gd_creator=${issued.token}` };
    const valid = await fetch(`${base}/protected`, { headers });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json() as { id: string }).id, issued.account.id);
    store.db.prepare('UPDATE creator_sessions SET expires_at=0').run();
    assert.equal((await fetch(`${base}/protected`, { headers })).status, 401);
  } finally { server.close(); store.close(); }
});
