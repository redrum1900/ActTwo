import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';
import { createReviewStore } from '../apps/api/src/creator/review-store.js';
import { patchManifest } from '../apps/web/src/creator/section-forms.js';

test('author saves a new location before selecting it as the story start', async () => {
  const accounts = createCreatorStore(':memory:');
  const projects = createProjectStore(accounts.db);
  const reviews = createReviewStore(accounts.db, projects);
  const saves = createSaveStore(':memory:');
  const server = createApp(saves, createChatAdapter({}), { creatorStore: accounts, projectStore: projects, reviewStore: reviews }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/creator`;
  let cookie = '';
  const request = async (url: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${url}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return { status: response.status, value: await response.json() as any };
  };
  try {
    await request('/register', 'POST', { username: 'locationauthor', password: 'author-password-1' });
    const created = await request('/projects', 'POST', { title: '地点测试' });
    assert.equal(created.status, 201);
    const story = `/projects/${created.value.id}`;
    const originalLocations = JSON.parse(created.value.sections['locations.json'].content);
    const newLocations = [...originalLocations, { id: 'cafe', name: '老街饭店', description: '街角小店', interactionMode: 'in-person', spots: [], custom: 'keep' }];
    const savedLocations = await request(`${story}/sections`, 'PUT', { path: 'locations.json',
      content: JSON.stringify(newLocations), revision: 1 });
    assert.equal(savedLocations.status, 200);
    const manifest = created.value.sections['manifest.json'];
    const changed = patchManifest(manifest.content, { startLocation: 'cafe' });
    const savedManifest = await request(`${story}/sections`, 'PUT', { path: 'manifest.json', content: changed, revision: 1 });
    assert.equal(savedManifest.status, 200);
    const reloaded = (await request(story)).value;
    assert.equal(JSON.parse(reloaded.sections['manifest.json'].content).startLocation, 'cafe');
    assert.equal(JSON.parse(reloaded.sections['locations.json'].content)[1].custom, 'keep');
    assert.equal((await request(`${story}/validate`, 'POST')).value.errors.length, 0);
  } finally { server.close(); accounts.close(); saves.close(); }
});
