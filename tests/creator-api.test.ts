import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';

test('creator API isolates owners and publishes only valid drafts', async () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  const saves = createSaveStore(':memory:');
  const server = createApp(saves, createChatAdapter({}), { creatorStore: creators, projectStore: projects }).listen(0);
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
    const created = await call('/projects', 'POST', { id: 'story-one', title: '第一个故事' });
    assert.equal(created.status, 201);
    assert.equal(created.data.sections['manifest.json'].revision, 1);
    assert.equal((await call('/projects')).data.projects.length, 1);
    const old = created.data.sections['manifest.json'];
    assert.equal((await call('/projects/story-one/sections', 'PUT', { path: 'manifest.json', content: old.content, revision: 1 })).status, 200);
    assert.equal((await call('/projects/story-one/sections', 'PUT', { path: 'manifest.json', content: old.content, revision: 1 })).status, 409);
    assert.equal((await call('/projects/story-one/validate', 'POST')).data.errors.length, 0);
    assert.equal((await call('/projects/story-one/publish', 'POST')).status, 200);
    await call('/logout', 'POST');
    await call('/register', 'POST', { username: 'bobby', password: 'bobby-password-1' });
    assert.equal((await call('/projects/story-one')).status, 404);
    assert.equal((await call('/projects/story-one/validate', 'POST')).status, 404);
    assert.equal((await call('/projects')).data.projects.length, 0);
  } finally { server.close(); creators.close(); saves.close(); }
});
