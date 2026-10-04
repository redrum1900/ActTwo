import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { withCreatorMysql } from './support/creator-mysql.js';

test('only admin approves submitted snapshot; old release survives pending and rejection', async () => {
  await withCreatorMysql(async ({ pool, accounts, projects, reviews }) => {
  const saves = createMysqlSaveStore(pool);
  await accounts.createAdmin('superadmin', 'admin-password-1');
  const server = createApp(saves, createChatAdapter({}), { creatorStore: accounts, projectStore: projects,
    reviewStore: reviews, mysqlPool: pool }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (path: string, method = 'GET', body?: unknown, cookie = '') => {
    const response = await fetch(`${base}/api${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, data: text.startsWith('{') ? JSON.parse(text) as any : text,
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? cookie };
  };
  try {
    assert.equal((await call('/creator/reviews')).status, 401);
    const author = await call('/creator/register', 'POST', { username: 'author', password: 'author-password-1', role: 'admin' });
    const authorCookie = author.cookie;
    assert.equal(author.data.role, 'author');
    assert.equal((await call('/creator/reviews', 'GET', undefined, authorCookie)).status, 403);
    const created = await call('/creator/projects', 'POST', { title: '线上初版' }, authorCookie);
    assert.equal(created.status, 201);
    const story = `/creator/projects/${created.data.id}`;
    assert.equal((await call(`${story}/publish`, 'POST', {}, authorCookie)).status, 404);
    const first = await call(`${story}/submit`, 'POST', {}, authorCookie);
    assert.equal(first.status, 201);
    assert.equal((await call('/catalog')).data.games.some((item: any) => item.id === created.data.id), false);
    assert.equal((await call(`/creator/reviews/${first.data.id}/approve`, 'POST', {}, authorCookie)).status, 403);
    const admin = await call('/creator/login', 'POST', { username: 'superadmin', password: 'admin-password-1' });
    const adminCookie = admin.cookie;
    const adminStory = await call('/creator/projects', 'POST', { title: '管理员的故事' }, adminCookie);
    assert.equal(adminStory.status, 201);
    const ownSubmission = await call(`/creator/projects/${adminStory.data.id}/submit`, 'POST', {}, adminCookie);
    assert.equal(ownSubmission.status, 201);
    assert.equal((await call('/catalog')).data.games.some((item: any) => item.id === adminStory.data.id), false);
    assert.equal((await call(`/creator/reviews/${ownSubmission.data.id}/approve`, 'POST', {}, adminCookie)).status, 200);
    assert.equal((await call('/catalog')).data.games.some((item: any) => item.id === adminStory.data.id), true);
    assert.equal((await call('/creator/reviews', 'GET', undefined, adminCookie)).data.reviews[0].id, first.data.id);
    assert.equal((await call(`/creator/reviews/${first.data.id}`, 'GET', undefined, adminCookie)).data.script.title, '线上初版');
    assert.equal((await call(`/creator/reviews/${first.data.id}/approve`, 'POST', {}, adminCookie)).status, 200);
    assert.equal((await call('/catalog')).data.games.some((item: any) => item.id === created.data.id), true);
    assert.equal((await call(`/games/${created.data.id}/new`, 'POST', { player: { name: '小夏' } }, authorCookie)).status, 200);
    const detail = await call(story, 'GET', undefined, authorCookie);
    const manifest = detail.data.sections['manifest.json'];
    await call(`${story}/sections`, 'PUT', {
      path: 'manifest.json', content: manifest.content.replace('线上初版', '待审新版'), revision: manifest.revision,
    }, authorCookie);
    const second = await call(`${story}/submit`, 'POST', {}, authorCookie);
    assert.equal(second.status, 201);
    assert.equal((await call(`/games/${created.data.id}`)).data.title, '线上初版');
    assert.equal((await call(`/creator/reviews/${second.data.id}/reject`, 'POST', { reason: '需要完善说明' }, adminCookie)).status, 200);
    assert.equal((await call(`/games/${created.data.id}`)).data.title, '线上初版');
    assert.equal((await call(story, 'GET', undefined, authorCookie)).data.review.rejectionReason, '需要完善说明');
    const other = await call('/creator/register', 'POST', { username: 'other', password: 'other-password-1' });
    assert.equal((await call(story, 'GET', undefined, other.cookie)).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
