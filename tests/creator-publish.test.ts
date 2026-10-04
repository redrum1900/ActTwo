import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { createMysqlScriptRepository } from '../apps/api/src/script-repository.js';
import { withCreatorMysql } from './support/creator-mysql.js';

test('draft stays private, published snapshot is playable, and deletion unlists without wiping saves', async () => {
  await withCreatorMysql(async ({ pool, accounts, projects, reviews }) => {
  const saves = createMysqlSaveStore(pool);
  const authorSession = await accounts.register('author', 'author-password-1');
  const author = authorSession.account.id;
  const admin = (await accounts.createAdmin('moderator', 'moderator-password-1')).id;
  await projects.create(author, 'public-story', '公开故事');
  const server = createApp(saves, createChatAdapter({}), { scripts: createMysqlScriptRepository(projects),
    creatorStore: accounts, projectStore: projects, reviewStore: reviews, mysqlPool: pool }).listen(0);
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
    const submitted = await reviews.submit(author, 'public-story');
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), false);
    await reviews.approve(admin, submitted.id);
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), true);
    assert.equal((await request('/api/games/public-story/new', 'POST', { player: { name: '小夏' } })).status, 200);
    const manifest = (await projects.get(author, 'public-story'))!.sections['manifest.json'];
    await projects.putSection(author, 'public-story', 'manifest.json', manifest.content.replace('公开故事', '未发布改动'), manifest.revision);
    assert.equal((await request('/api/games/public-story')).data.title, '公开故事');
    await projects.delete(author, 'public-story');
    assert.equal((await request('/api/catalog')).data.games.some((game: any) => game.id === 'public-story'), false);
    assert.ok(await saves.getAuto(author, 'public-story'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
