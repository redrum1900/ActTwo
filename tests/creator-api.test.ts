import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { withCreatorMysql } from './support/creator-mysql.js';

test('creator API isolates owners and publishes only valid drafts', async () => {
  await withCreatorMysql(async ({ pool, accounts, projects, reviews }) => {
  const saves = createMysqlSaveStore(pool);
  const server = createApp(saves, createChatAdapter({}), { creatorStore: accounts, projectStore: projects,
    reviewStore: reviews, mysqlPool: pool }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api/creator${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie?.startsWith('gd_creator=')) cookie = setCookie.split(';')[0];
    return { status: response.status, data: await response.json() as any };
  };
  try {
    assert.equal((await call('/projects')).status, 401);
    await call('/register', 'POST', { username: 'alice', password: 'alice-password-1' });
    const generated = await call('/projects', 'POST', { title: '自动生成 ID' });
    assert.equal(generated.status, 201);
    assert.match(generated.data.id, /^story-[0-9a-f-]{36}$/);
    assert.equal(JSON.parse(generated.data.sections['manifest.json'].content).id, generated.data.id);
    const copied = await call('/projects', 'POST', { title: '复制示例', templateId: 'sword-and-screen' });
    assert.equal(copied.status, 400);
    assert.match(copied.data.error, /模板不存在/);
    const created = await call('/projects', 'POST', { title: '第一个故事' });
    assert.equal(created.status, 201);
    assert.equal(created.data.sections['manifest.json'].revision, 1);
    assert.equal((await call('/projects')).data.projects.length, 2);
    const storyPath = `/projects/${created.data.id}`;
    const old = created.data.sections['manifest.json'];
    assert.equal((await call(`${storyPath}/sections`, 'PUT', { path: 'manifest.json', content: old.content, revision: 1 })).status, 200);
    assert.equal((await call(`${storyPath}/sections`, 'PUT', { path: 'manifest.json', content: old.content, revision: 1 })).status, 409);
    assert.equal((await call(`${storyPath}/validate`, 'POST')).data.errors.length, 0);
    assert.equal((await call(`${storyPath}/submit`, 'POST')).status, 201);
    assert.equal((await call(storyPath)).data.review.status, 'pending');
    assert.equal((await call(`${storyPath}/npcs`, 'POST', { id: 'friend', name: '朋友' })).data.review.status, 'pending');
    await call('/logout', 'POST');
    await call('/register', 'POST', { username: 'bobby', password: 'bobby-password-1' });
    assert.equal((await call(storyPath)).status, 404);
    assert.equal((await call(`${storyPath}/validate`, 'POST')).status, 404);
    assert.equal((await call('/projects')).data.projects.length, 0);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
