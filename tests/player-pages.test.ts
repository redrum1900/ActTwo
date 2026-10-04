import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import AccountGate from '../apps/web/src/app/AccountGate.js';
import StoryCatalogPage from '../apps/web/src/catalog/StoryCatalogPage.js';
import StoryDetailPage from '../apps/web/src/story-detail/StoryDetailPage.js';
import App, { GameplayPage } from '../apps/web/src/app/App.js';
import { installPlayerDom } from './player-dom.js';

const originalFetch = globalThis.fetch;
const closeDom = installPlayerDom();
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
afterEach(() => { cleanup(); globalThis.fetch = originalFetch; });
after(() => closeDom());
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const account = { id: 'account-1', username: 'reader', role: 'author' };
const detail = { id: 'sword', version: '1.2', title: '剑道故事', subtitle: '副标题', description: '简介',
  hasAuto: false, playerFields: [{ id: 'name', label: '名字', type: 'input', default: '' }], gallery: [] };

test('catalog card opens the selected story detail', async () => {
  window.history.replaceState(null, '', '/');
  const opened: string[] = [];
  globalThis.fetch = async (input) => String(input).includes('/creator/me') ? reply(account) : reply({ games: [detail] });
  try {
    render(React.createElement(AccountGate, { requireLogin: false, children: React.createElement(StoryCatalogPage, { onOpen: id => opened.push(id) }) }));
    await screen.findByText('剑道故事');
    fireEvent.click(screen.getByRole('button', { name: /剑道故事/ }));
    assert.deepEqual(opened, ['sword']);
  } finally { cleanup(); }
});

test('detail shows latest version and keeps the new-game form on the detail URL', async () => {
  window.history.replaceState(null, '', '/games/sword');
  globalThis.fetch = async (input) => String(input).includes('/creator/me') ? reply(account) : reply(detail);
  try {
    render(React.createElement(AccountGate, { requireLogin: false, children: React.createElement(StoryDetailPage,
      { storyId: 'sword', onPlay: () => {}, onBack: () => {} }) }));
    await screen.findByText(/最新发布版本.*1\.2/);
    fireEvent.click(screen.getByRole('button', { name: /新游戏/ }));
    assert.ok(screen.getByText('人物登记表'));
    assert.equal(window.location.pathname, '/games/sword');
  } finally { cleanup(); }
});

test('deleted playtest shows an unavailable page rather than silently redirecting', async () => {
  window.history.replaceState(null, '', '/playtest/project/run');
  globalThis.fetch = async (input) => String(input).includes('/creator/me') ? reply(account) : reply({ error: '试玩记录不存在' }, 404);
  try {
    render(React.createElement(AccountGate, { requireLogin: false, children: React.createElement(StoryDetailPage,
      { storyId: 'project', playtest: { projectId: 'project', playtestId: 'run' }, onPlay: () => {}, onBack: () => {} }) }));
    await screen.findByRole('heading', { name: '试玩记录不可用' });
    assert.ok(screen.getAllByRole('button', { name: /返回创作中心/ }).length > 0);
  } finally { cleanup(); }
});

test('temporary detail failure stays on the URL and offers retry', async () => {
  window.history.replaceState(null, '', '/games/sword');
  let attempts = 0;
  globalThis.fetch = async (input) => {
    if (String(input).includes('/creator/me')) return reply(account);
    attempts++;
    return attempts <= 2 ? reply({ error: '网络暂不可用' }, 503) : reply(detail);
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: false, children: React.createElement(StoryDetailPage,
      { storyId: 'sword', onPlay: () => {}, onBack: () => {} }) }));
    await screen.findByRole('button', { name: /重试/ });
    assert.equal(window.location.pathname, '/games/sword');
    fireEvent.click(screen.getByRole('button', { name: /重试/ }));
    await waitFor(() => assert.ok(screen.getByText(/最新发布版本.*1\.2/)));
    assert.ok(attempts >= 3);
  } finally { cleanup(); }
});

const current = {
  revision: 1, aiMode: 'demo', hints: {}, gallery: [],
  view: {
    script: { title: '剑道故事', version: '1.0' },
    day: 1, period: '早晨', locationId: 'home',
    location: { name: '家', description: '', items: [], spots: [] },
    locations: [], npcs: [], knownNpcs: [], items: [], chats: [], player: {},
    activityLog: [],
  },
};

test('direct play reads the pinned auto-save and never creates a new game', async () => {
  window.history.replaceState(null, '', '/games/sword/play');
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/current')) return reply(current);
    return reply(detail);
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(GameplayPage,
      { storyId: 'sword', onExit: () => {}, onNoSave: () => {} }) }));
    await screen.findByText(/剑道故事 · 1\.0/);
    assert.ok(calls.some(url => url.endsWith('/current')));
    assert.ok(!calls.some(url => url.endsWith('/new')));
    assert.equal(window.location.pathname, '/games/sword/play');
  } finally { cleanup(); }
});

test('direct play without auto-save returns to detail without mutation', async () => {
  window.history.replaceState(null, '', '/games/sword/play');
  let missing = '';
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/current')) return reply({ error: '没有自动存档' }, 404);
    return reply(detail);
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(GameplayPage,
      { storyId: 'sword', onExit: () => {}, onNoSave: message => { missing = message; } }) }));
    await waitFor(() => assert.match(missing, /自动存档/));
    assert.ok(!calls.some(url => url.endsWith('/new')));
  } finally { cleanup(); }
});

test('login on a direct play URL resumes that same auto-save route', async () => {
  window.history.replaceState(null, '', '/games/sword/play');
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/creator/me')) return reply({ error: '请先登录' }, 401);
    if (url.includes('/creator/login')) return reply(account);
    if (url.endsWith('/current')) return reply(current);
    return reply(detail);
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(GameplayPage,
      { storyId: 'sword', onExit: () => {}, onNoSave: () => {} }) }));
    await screen.findByRole('button', { name: /登录并继续/ });
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'reader' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: /登录并继续/ }));
    await screen.findByText(/剑道故事 · 1\.0/);
    assert.equal(window.location.pathname, '/games/sword/play');
    assert.equal(requests.filter(value => value.endsWith('/current')).length, 1);
  } finally { cleanup(); }
});

test('playtest gameplay reads only its own frozen run', async () => {
  window.history.replaceState(null, '', '/playtest/project/run/play');
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/current')) return reply(current);
    return reply({ detail });
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(GameplayPage,
      { storyId: 'project', playtest: { projectId: 'project', playtestId: 'run' },
        onExit: () => {}, onNoSave: () => {} }) }));
    await screen.findByText(/剑道故事 · 1\.0/);
    assert.ok(requests.some(url => url.endsWith('/creator/projects/project/playtests/run/current')));
    assert.ok(!requests.some(url => url.includes('/api/games/')));
  } finally { cleanup(); }
});

test('deleted playtest game stays unavailable rather than redirecting as a missing save', async () => {
  window.history.replaceState(null, '', '/playtest/project/run/play');
  let noSave = false;
  globalThis.fetch = async input => String(input).includes('/creator/me') ? reply(account)
    : reply({ error: '试玩记录不存在' }, 404);
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(GameplayPage,
      { storyId: 'project', playtest: { projectId: 'project', playtestId: 'run' },
        onExit: () => {}, onNoSave: () => { noSave = true; } }) }));
    await screen.findByRole('heading', { name: '试玩记录不可用' });
    assert.equal(noSave, false);
    assert.equal(window.location.pathname, '/playtest/project/run/play');
  } finally { cleanup(); }
});

test('temporary playtest failure stays retryable instead of saying the run was deleted', async () => {
  window.history.replaceState(null, '', '/playtest/project/run/play');
  let attempts = 0;
  globalThis.fetch = async input => {
    if (String(input).includes('/creator/me')) return reply(account);
    attempts++;
    return attempts === 1 ? reply({ error: '服务暂不可用' }, 503)
      : String(input).endsWith('/current') ? reply(current) : reply({ detail });
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(GameplayPage,
      { storyId: 'project', playtest: { projectId: 'project', playtestId: 'run' },
        onExit: () => {}, onNoSave: () => {} }) }));
    await screen.findByRole('button', { name: '重试' });
    assert.ok(screen.getByRole('heading', { name: '游戏暂不可用' }));
    assert.equal(window.location.pathname, '/playtest/project/run/play');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText(/剑道故事 · 1\.0/);
  } finally { cleanup(); }
});

test('unstarted playtest directs to its detail with an explanation', async () => {
  window.history.replaceState(null, '', '/playtest/project/run/play');
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/current')) return reply({ error: '试玩尚未开始' }, 404);
    return reply({ detail: { ...detail, hasAuto: false } });
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(App) }));
    await waitFor(() => assert.equal(window.location.pathname, '/playtest/project/run'));
    await screen.findByText(/还没有试玩自动存档/);
  } finally { cleanup(); }
});

test('catalog, detail and gameplay each have a URL; back and forward restore their pages', async () => {
  window.history.replaceState(null, '', '/');
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/catalog')) return reply({ games: [detail] });
    if (url.endsWith('/new')) return reply(current);
    if (url.endsWith('/current')) return reply(current);
    return reply({ ...detail, playerFields: [] });
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: false, children: React.createElement(App) }));
    await screen.findByText('reader');
    fireEvent.click(screen.getByRole('button', { name: /剑道故事/ }));
    await screen.findByText(/最新发布版本.*1\.2/);
    assert.equal(window.location.pathname, '/games/sword');
    fireEvent.click(screen.getByRole('button', { name: /新游戏/ }));
    await screen.findByText(/剑道故事 · 1\.0/);
    assert.equal(window.location.pathname, '/games/sword/play');
    window.history.back();
    await screen.findByText(/最新发布版本.*1\.2/);
    assert.equal(window.location.pathname, '/games/sword');
    window.history.forward();
    await screen.findByText(/剑道故事 · 1\.0/);
    assert.equal(window.location.pathname, '/games/sword/play');
    assert.equal(requests.filter(value => value.includes('/new')).length, 1);
  } finally { cleanup(); }
});

test('an in-flight new-game response cannot reopen play after leaving detail', async () => {
  window.history.replaceState(null, '', '/games/sword');
  let resolveLatest!: (value: Response) => void;
  const pendingLatest = new Promise<Response>(resolve => { resolveLatest = resolve; });
  let detailReads = 0;
  let newPosts = 0;
  let played = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/new')) { newPosts++; return reply(current); }
    if (url.endsWith('/games/sword') && ++detailReads === 3) return pendingLatest;
    return reply({ ...detail, playerFields: [] });
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: false, children: React.createElement(StoryDetailPage,
      { storyId: 'sword', onPlay: () => { played = true; }, onBack: () => {} }) }));
    await screen.findByText(/最新发布版本.*1\.2/);
    await waitFor(() => assert.equal(detailReads, 2));
    fireEvent.click(screen.getByRole('button', { name: /新游戏/ }));
    await waitFor(() => assert.equal(detailReads, 3));
    cleanup();
    resolveLatest(reply({ ...detail, playerFields: [] }));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(newPosts, 0);
    assert.equal(played, false);
  } finally { cleanup(); }
});

test('manual load syncs auto once; Back and Forward re-read current without reloading the slot', async () => {
  window.history.replaceState(null, '', '/');
  const requests: string[] = [];
  const occupied = { slot: 1, label: '旧档', updatedAt: '2026-10-03T01:00:00Z',
    scriptVersion: '1.0', loadable: true, playerName: '阿言', day: 2, location: '家' };
  globalThis.fetch = async (input, init) => {
    const url = String(input); requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/catalog')) return reply({ games: [{ ...detail, hasAuto: true }] });
    if (url.endsWith('/slots')) return reply({ slots: [occupied] });
    if (url.endsWith('/slots/1/load')) return reply(current);
    if (url.endsWith('/current')) return reply(current);
    return reply({ ...detail, hasAuto: true });
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: false, children: React.createElement(App) }));
    await screen.findByText('reader');
    fireEvent.click(screen.getByRole('button', { name: /剑道故事/ }));
    await screen.findByText(/最新发布版本.*1\.2/);
    fireEvent.click(screen.getByRole('button', { name: /^存档/ }));
    await screen.findByText('旧档');
    fireEvent.click(screen.getByRole('button', { name: '读取' }));
    await screen.findByText(/剑道故事 · 1\.0/);
    window.history.back();
    await screen.findByText(/最新发布版本.*1\.2/);
    window.history.forward();
    await screen.findByText(/剑道故事 · 1\.0/);
    assert.equal(requests.filter(value => value.endsWith('/slots/1/load')).length, 1);
    assert.equal(requests.filter(value => value.endsWith('/current')).length, 2);
  } finally { cleanup(); }
});

test('a late action response cannot replace the detail page after browser Back', async () => {
  window.history.replaceState(null, '', '/');
  window.history.pushState(null, '', '/games/sword');
  window.history.pushState(null, '', '/games/sword/play');
  let resolveAction!: (value: Response) => void;
  const pendingAction = new Promise<Response>(resolve => { resolveAction = resolve; });
  let actionStarted = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/creator/me')) return reply(account);
    if (url.endsWith('/action') && init?.method === 'POST') { actionStarted = true; return pendingAction; }
    if (url.endsWith('/current')) return reply(current);
    return reply(detail);
  };
  try {
    render(React.createElement(AccountGate, { requireLogin: true, children: React.createElement(App) }));
    await screen.findByText(/剑道故事 · 1\.0/);
    fireEvent.click(screen.getByTitle('推进到下一时段'));
    await waitFor(() => assert.ok(actionStarted));
    window.history.back();
    await screen.findByText(/最新发布版本.*1\.2/);
    resolveAction(reply({ ...current, revision: 2 }));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(window.location.pathname, '/games/sword');
    assert.ok(screen.getByText(/最新发布版本.*1\.2/));
  } finally { cleanup(); }
});
