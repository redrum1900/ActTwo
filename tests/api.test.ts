import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../apps/api/src/app.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { AiServiceError, createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createInitialState } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { ScriptNotFoundError } from '../apps/api/src/script-repository.js';

test('a removed published story detail responds 404 instead of a retryable bad request', async () => {
  const saves = createSaveStore(':memory:');
  const server = createApp(saves, createChatAdapter({}), { scripts: {
    get: () => { throw new ScriptNotFoundError(); },
    list: () => [],
  } }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(`${base}/api/games/removed`);
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    saves.close();
  }
});

test('AI service failure returns a retryable status and keeps the auto save unchanged', async () => {
  const store = createSaveStore(':memory:');
  const accounts = createCreatorStore(':memory:');
  const adapter = createChatAdapter({});
  adapter.generate = async () => { throw new AiServiceError('AI 服务暂时繁忙，请稍后重试；本次对话未保存。', 503); };
  const server = createApp(store, adapter, { creatorStore: accounts }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = `gd_creator=${accounts.register('api_failure', 'player-password-1').token}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const started = await request('/api/games/sword-and-screen/new', 'POST', { player: { name: '阿言', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] } });
    const failed = await request('/api/games/sword-and-screen/chat', 'POST', { npcId: 'su-nian', text: '你好', revision: started.body.revision });
    assert.equal(failed.status, 503);
    assert.match(failed.body.error, /本次对话未保存/);
    const current = await request('/api/games/sword-and-screen/current');
    assert.equal(current.body.revision, started.body.revision);
    assert.equal(current.body.view.chats['su-nian']?.length ?? 0, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close(); accounts.close();
  }
});

test('the API serves one story, player form, auto save, and manual slots', async () => {
  const store = createSaveStore(':memory:');
  const accounts = createCreatorStore(':memory:');
  const server = createApp(store, createChatAdapter({}), { creatorStore: accounts }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = `gd_creator=${accounts.register('api_story', 'player-password-1').token}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const catalog = await request('/api/catalog');
    assert.deepEqual(catalog.body.games.map((entry: any) => entry.id), ['sword-and-screen']);
    const detail = await request('/api/games/sword-and-screen');
    assert.ok(detail.body.playerFields.length > 0);
    assert.equal(detail.body.hasAuto, false);
    const started = await request('/api/games/sword-and-screen/new', 'POST', { player: { name: '小桥', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] } });
    assert.equal(started.status, 200);
    assert.equal(started.body.view.player.name, '小桥');
    assert.equal(started.body.view.location.name, '电脑上');
    const explored = await request('/api/games/sword-and-screen/action', 'POST', { type: 'search', revision: started.body.revision });
    assert.equal(explored.body.view.location.items[0].id, 'game-screenshot');
    const spoke = await request('/api/games/sword-and-screen/chat', 'POST', {
      npcId: 'su-nian', text: '你好', revision: explored.body.revision,
    });
    assert.equal(spoke.body.aiMode, 'demo');
    assert.equal(spoke.body.view.chats['su-nian'].length, 2);
    const saved = await request('/api/games/sword-and-screen/slots/1', 'POST', { label: '第一次聊天' });
    assert.equal(saved.status, 200);
    const slots = await request('/api/games/sword-and-screen/slots');
    assert.deepEqual(slots.body.slots.map((entry: any) => entry.slot), [0, 1]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close(); accounts.close();
  }
});

test('Su Nian search reveals only eligible items and keeps revision protection', async () => {
  const store = createSaveStore(':memory:');
  const accounts = createCreatorStore(':memory:');
  const server = createApp(store, createChatAdapter({}), { creatorStore: accounts }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = `gd_creator=${accounts.register('api_search', 'player-password-1').token}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const started = await request('/api/games/sword-and-screen/new', 'POST', { player: { name: '阿言', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] } });
    assert.equal(started.status, 200);
    assert.deepEqual(started.body.view.locations.map((entry: any) => entry.id), ['player-home']);
    assert.equal(JSON.stringify(started.body.view).includes('practice-note'), false);
    const searched = await request('/api/games/sword-and-screen/action', 'POST', { type: 'search', revision: started.body.revision });
    assert.deepEqual(searched.body.view.location.items.map((entry: any) => entry.id), ['game-screenshot']);
    assert.equal(searched.body.view.activityLog.length, 1);
    assert.equal(searched.body.view.activityLog[0].kind, 'search');
    assert.deepEqual(searched.body.changes.filter((entry: any) => entry.kind === 'item_discovered').map((entry: any) => entry.entityId), ['game-screenshot']);
    const stale = await request('/api/games/sword-and-screen/action', 'POST', { type: 'search', revision: started.body.revision });
    assert.equal(stale.status, 409);
    const taken = await request('/api/games/sword-and-screen/action', 'POST', { type: 'take', itemId: 'game-screenshot', revision: searched.body.revision });
    assert.equal(taken.body.view.items[0].id, 'game-screenshot');
    assert.equal(taken.body.view.activityLog.length, 2);
    assert.deepEqual(taken.body.changes.filter((entry: any) => entry.kind === 'item_gained').map((entry: any) => entry.entityId), ['game-screenshot']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close(); accounts.close();
  }
});

test('chat SSE drafts before final and a repeated turn ID does not generate twice', async () => {
  const store = createSaveStore(':memory:');
  const accounts = createCreatorStore(':memory:');
  const adapter = createChatAdapter({});
  let calls = 0;
  adapter.generate = async (_context, onDraft) => {
    calls++;
    onDraft?.('你'); onDraft?.('好。');
    return { message: '你好。', proposedEventIds: [] };
  };
  const server = createApp(store, adapter, { creatorStore: accounts }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = `gd_creator=${accounts.register('api_stream', 'player-password-1').token}`;
  const request = async (route: string, body: object) => {
    const response = await fetch(`${base}${route}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
    return response;
  };
  try {
    const started = await (await request('/api/games/sword-and-screen/new', { player: { name: '阿言', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] } })).json() as any;
    const turn = { npcId: 'su-nian', text: '你好', revision: started.revision, turnId: 'turn-unique-1' };
    const first = await request('/api/games/sword-and-screen/chat/stream', turn);
    assert.equal(first.headers.get('content-type')?.includes('text/event-stream'), true);
    const wire = await first.text();
    assert.ok(wire.indexOf('event: draft') < wire.indexOf('event: final'));
    const final = JSON.parse(wire.match(/event: final\ndata: (.*)/)?.[1] ?? '{}') as { session?: any };
    assert.equal(final.session?.view.chats['su-nian'].length, 2);
    assert.equal(final.session?.view.activityLog.length, 1);
    const repeated = await request('/api/games/sword-and-screen/chat/stream', turn);
    assert.match(await repeated.text(), /event: final/);
    assert.equal(calls, 1);
    const wrongReuse = await request('/api/games/sword-and-screen/chat/stream', { ...turn, text: '另一句话' });
    assert.equal(wrongReuse.status, 400);
    assert.match(await wrongReuse.text(), /轮次 ID/);
    assert.equal(calls, 1);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); accounts.close(); }
});

test('obsolete Su Nian saves cannot masquerade as playable slots or overwrite the current auto slot', async () => {
  const store = createSaveStore(':memory:');
  const accounts = createCreatorStore(':memory:');
  const game = loadScript('sword-and-screen');
  const player = accounts.register('api_old', 'player-password-1');
  const owner = player.account.id;
  const old = createInitialState(game, { name: '旧档' });
  old.scriptVersion = '2.0.0';
  store.putAuto(owner, game.id, old);
  store.saveManual(owner, game.id, 1, '旧手动档', old);
  const server = createApp(store, createChatAdapter({}), { creatorStore: accounts }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (route: string, method = 'GET') => {
    const response = await fetch(`${base}${route}`, { method, headers: { Cookie: `gd_creator=${player.token}`, 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    const catalog = await request('/api/catalog');
    assert.equal(catalog.data.games.find((entry: any) => entry.id === game.id).hasAuto, false);
    const detail = await request(`/api/games/${game.id}`);
    assert.equal(detail.data.hasAuto, false);
    const slots = await request(`/api/games/${game.id}/slots`);
    assert.deepEqual(slots.data.slots.map((entry: any) => ({ slot: entry.slot, version: entry.scriptVersion, loadable: entry.loadable })),
      [{ slot: 0, version: '2.0.0', loadable: false }, { slot: 1, version: '2.0.0', loadable: false }]);
    const loaded = await request(`/api/games/${game.id}/slots/1/load`, 'POST');
    assert.notEqual(loaded.status, 200);
    assert.equal(store.getAuto(owner, game.id)?.state.scriptVersion, '2.0.0');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); accounts.close(); }
});

test('creator debug endpoint is opt-in and scoped to the current save owner', async () => {
  const store = createSaveStore(':memory:');
  const accounts = createCreatorStore(':memory:');
  const adapter = createChatAdapter({});
  adapter.generate = async () => ({ message: '嗯？', proposedEventIds: ['close-talk'] });
  const server = createApp(store, adapter, { debugEnabled: true, creatorStore: accounts }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = `gd_creator=${accounts.register('api_debug', 'player-password-1').token}`;
  const request = async (route: string, body?: unknown, otherCookie?: string) => {
    const response = await fetch(`${base}${route}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: otherCookie ?? cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!otherCookie && response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
    return { status: response.status, data: await response.json() as any };
  };
  try {
    const started = await request('/api/games/sword-and-screen/new', { player: { name: '阿言', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] } });
    const chat = await request('/api/games/sword-and-screen/chat', { npcId: 'su-nian', text: '我很在意你的感受', revision: started.data.revision });
    assert.equal(JSON.stringify(chat.data.view).includes('ruleDiagnostics'), false);
    assert.equal(JSON.stringify(chat.data.appliedEvents).includes('close-talk'), false);
    const debug = await request('/api/games/sword-and-screen/debug');
    assert.deepEqual(debug.data.turns[0].acceptedIds, ['close-talk']);
    const outsider = await request('/api/games/sword-and-screen/debug', undefined, 'gd_guest=22222222-2222-4222-8222-222222222222');
    assert.notEqual(outsider.status, 200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); accounts.close(); }
});

test('GET current never awards gallery, and same-version content mismatch rejects saves', async () => {
  const store = createSaveStore(':memory:');
  const accounts = createCreatorStore(':memory:');
  const game = loadScript('sword-and-screen');
  const player = accounts.register('api_gallery', 'player-password-1');
  const owner = player.account.id;
  const state = createInitialState(game, { name: '阿言' });
  state.npcIndicators!['su-nian'].metInPerson.value = true;
  store.putAuto(owner, game.id, state);
  const server = createApp(store, createChatAdapter({}), { creatorStore: accounts }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (route: string) => fetch(`${base}${route}`, { headers: { Cookie: `gd_creator=${player.token}` } });
  try {
    assert.equal((await get(`/api/games/${game.id}/current`)).status, 200);
    assert.deepEqual(store.getGallery(owner, game.id), []);
    const changed = { ...state, scriptHash: '0'.repeat(64) };
    store.putAuto(owner, game.id, changed);
    assert.equal((await get(`/api/games/${game.id}/current`)).status, 400);
    assert.equal((await (await get('/api/catalog')).json() as any).games[0].hasAuto, false);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); store.close(); accounts.close(); }
});
