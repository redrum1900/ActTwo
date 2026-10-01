import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';
import { createScriptRepository } from '../apps/api/src/script-repository.js';

test('draft stays private, published snapshot is playable, and deletion unlists without wiping saves', async () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  const saves = createSaveStore(':memory:');
  const author = creators.register('author', 'author-password-1').account.id;
  projects.create(author, 'public-story', '公开故事');
  const server = createApp(saves, createChatAdapter({}), { scripts: createScriptRepository(projects) }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const received = response.headers.get('set-cookie');
    if (received?.startsWith('gd_guest=')) cookie = received.split(';')[0];
    return { status: response.status, data: await response.json() as any };
  };
  try {
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), false);
    projects.publish(author, 'public-story');
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), true);
    assert.equal((await request('/api/games/public-story/new', 'POST', { player: { name: '小夏' } })).status, 200);
    const manifest = projects.get(author, 'public-story')!.sections['manifest.json'];
    projects.putSection(author, 'public-story', 'manifest.json', manifest.content.replace('公开故事', '未发布改动'), manifest.revision);
    assert.equal((await request('/api/games/public-story')).data.title, '公开故事');
    projects.delete(author, 'public-story');
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), false);
    assert.ok(saves.getAuto(cookie.slice(9), 'public-story'));
  } finally { server.close(); creators.close(); saves.close(); }
});
