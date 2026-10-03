import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createSaveStore } from '../apps/api/src/save-store.js';
import { createChatAdapter } from '../apps/api/src/ai-adapter.js';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';
import { createReviewStore } from '../apps/api/src/creator/review-store.js';
import { createScriptRepository } from '../apps/api/src/script-repository.js';

test('draft stays private, published snapshot is playable, and deletion unlists without wiping saves', async () => {
  const creators = createCreatorStore(':memory:');
  const projects = createProjectStore(creators.db);
  const reviews = createReviewStore(creators.db, projects);
  const saves = createSaveStore(':memory:');
  const authorSession = creators.register('author', 'author-password-1');
  const author = authorSession.account.id;
  const admin = creators.createAdmin('moderator', 'moderator-password-1').id;
  projects.create(author, 'public-story', '公开故事');
  const server = createApp(saves, createChatAdapter({}), { scripts: createScriptRepository(projects), creatorStore: creators }).listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const cookie = `gd_creator=${authorSession.token}`;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), false);
    const submitted = reviews.submit(author, 'public-story');
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), false);
    reviews.approve(admin, submitted.id);
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), true);
    assert.equal((await request('/api/games/public-story/new', 'POST', { player: { name: '小夏' } })).status, 200);
    const manifest = projects.get(author, 'public-story')!.sections['manifest.json'];
    projects.putSection(author, 'public-story', 'manifest.json', manifest.content.replace('公开故事', '未发布改动'), manifest.revision);
    assert.equal((await request('/api/games/public-story')).data.title, '公开故事');
    projects.delete(author, 'public-story');
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), false);
    assert.ok(saves.getAuto(author, 'public-story'));
  } finally { server.close(); creators.close(); saves.close(); }
});
