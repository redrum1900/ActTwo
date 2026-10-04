import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createScriptRepository } from '../apps/api/src/script-repository.js';
import { createGameSessionContext } from '../apps/api/src/modules/gameplay/session.js';
import { createCatalogRouter } from '../apps/api/src/modules/catalog/router.js';
import { createGameplayRouter } from '../apps/api/src/modules/gameplay/router.js';
import { withTestMysql } from './support/mysql-test-db.js';

test('catalog is public while gameplay remains authenticated after route extraction', async () => {
  await withTestMysql(async pool => {
  const store = createMysqlSaveStore(pool);
  const context = createGameSessionContext(store, createChatAdapter({}), createScriptRepository());
  const app = express();
  app.use(express.json());
  app.use('/api', createCatalogRouter(context));
  app.use('/api/games/:gameId', createGameplayRouter(context));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const catalog = await fetch(`${base}/api/catalog`);
    assert.equal(catalog.status, 200);
    assert.deepEqual((await catalog.json() as { games: { id: string }[] }).games.map(game => game.id), ['sword-and-screen']);
    const detail = await fetch(`${base}/api/games/sword-and-screen`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as { id: string }).id, 'sword-and-screen');
    const start = await fetch(`${base}/api/games/sword-and-screen/new`, { method: 'POST' });
    assert.equal(start.status, 401);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  });
});
