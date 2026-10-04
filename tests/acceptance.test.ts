import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../apps/api/src/app.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import type { ChatAdapter } from '../apps/api/src/modules/gameplay/chat-service.js';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';
import { withTestMysql } from './support/mysql-test-db.js';

test('Su Nian progresses by semantic indicators through online chat, dinner, home, items, and ending', async () => {
  await withTestMysql(async pool => {
  const adapter: ChatAdapter = {
    mode: 'demo',
    generate: async ({ text, candidates }) => ({ message: `苏念回应：${text}`,
      proposedEventIds: candidates.filter((candidate) => {
        const words: Record<string, string> = {
          'share-screenshot': '截图', confession: '喜欢你', thoughtful: '我记得',
          'give-space-at-dinner': '不用紧张', 'accept-her-two-sides': '两个都是真',
          'ask-kendo': '剑道', 'charm-gift': '御守', 'talk-about-photo': '旧照片',
          'read-practice-note': '翻阅训练笔记', 'understand-practice-note': '真实的你',
          'familiar-teasing': '又嘴硬', 'close-talk': '我很在意你的感受',
        };
        return words[candidate.id] && text.includes(words[candidate.id]);
      }).map((candidate) => candidate.id) }),
    rewrite: async (_context, draft) => draft,
  };
  const store = createMysqlSaveStore(pool);
  const accounts = createMysqlCreatorStore(pool);
  const server = createApp(store, adapter, { creatorStore: accounts, mysqlPool: pool }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = `gd_creator=${(await accounts.register('acceptance_player', 'player-password-1')).token}`;
  let revision = 0;
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}/api/games/sword-and-screen${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie')!.split(';')[0];
    const data = await response.json() as any;
    assert.equal(response.status, 200, JSON.stringify(data));
    if (typeof data.revision === 'number') revision = data.revision;
    return data;
  };
  const action = (payload: object) => request('/action', { ...payload, revision });
  const chat = (text: string) => request('/chat', { npcId: 'su-nian', text, revision });
  try {
    let data = await request('/new', { player: { name: '阿言', birthday: '2000-01-01', playStyle: 'team', hobbies: ['game'] } });
    assert.deepEqual(data.view.locations.map((entry: any) => entry.id), ['player-home']);
    data = await action({ type: 'search' });
    assert.deepEqual(data.view.location.items.map((entry: any) => entry.id), ['game-screenshot']);
    data = await action({ type: 'take', itemId: 'game-screenshot' });
    assert.equal(data.view.items[0].id, 'game-screenshot');
    await chat('我找到了那张截图');
    await chat('我喜欢你');
    await chat('我记得那天你说的话');
    await chat('你又嘴硬了');
    data = await chat('你好');
    assert.equal(data.view.knownNpcs[0].stats.find((entry: any) => entry.id === 'affection').value, 25);
    for (let turn = 0; turn < 3; turn++) data = await chat('我很在意你的感受');
    assert.equal(data.view.npcs.length, 0);
    assert.ok(data.changes.some((entry: any) => entry.kind === 'location_unlocked'));
    assert.deepEqual(data.view.locations.map((entry: any) => entry.id), ['player-home', 'restaurant']);
    data = await action({ type: 'move', locationId: 'restaurant' });
    assert.equal(data.view.npcs[0].channel, 'in-person');
    await chat('不用紧张，慢慢来');
    await chat('线上和线下两个都是真实的你');
    await chat('你练过剑道吗？');
    await chat('我记得你说过的事');
    for (let turn = 0; turn < 3; turn++) data = await chat('我很在意你的感受');
    assert.equal(data.view.npcs.length, 0);
    assert.ok(data.view.locations.some((entry: any) => entry.id === 'her-home'));
    data = await action({ type: 'move', locationId: 'her-home' });
    assert.equal(data.view.npcs[0].channel, 'in-person');
    data = await action({ type: 'search' });
    assert.deepEqual(data.view.location.items.map((entry: any) => entry.id), ['old-photo', 'practice-note']);
    assert.equal(data.view.location.items[0].canTake, false);
    assert.equal(data.view.location.items[1].canTake, false);
    for (let turn = 0; turn < 7; turn++) data = await chat('我很在意你的感受');
    assert.equal(data.view.location.items[0].canTake, true);
    data = await action({ type: 'take', itemId: 'old-photo' });
    assert.equal(data.view.location.items.some((entry: any) => entry.id === 'old-photo'), false);
    await chat('这张旧照片是什么时候拍的？');
    data = await chat('你那个御守为什么一直留着？');
    assert.ok(data.view.items.some((entry: any) => entry.id === 'kendo-charm'));
    for (let turn = 0; turn < 3; turn++) data = await chat('我很在意你的感受');
    data = await action({ type: 'take', itemId: 'practice-note' });
    assert.ok(data.view.items.some((entry: any) => entry.id === 'practice-note'));
    data = await chat('我能翻阅训练笔记吗？');
    assert.match(data.view.items.find((entry: any) => entry.id === 'practice-note').detail, /主动在重要的一页留下批注/);
    data = await chat('我想继续听你说真实的你');
    assert.ok(data.gallery.some((entry: any) => entry.id === 'real-me' && entry.unlocked));
    assert.ok(data.view.knownNpcs[0].stats.find((entry: any) => entry.id === 'affection').value >= 90);
    assert.ok(data.view.chats['su-nian'].length > 20);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  });
});
