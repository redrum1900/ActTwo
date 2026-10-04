import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../apps/api/src/app.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';
import { withTestMysql } from './support/mysql-test-db.js';

test('creator accounts have durable login sessions separate from guest saves', async () => {
  await withTestMysql(async pool => {
  const creators = createMysqlCreatorStore(pool);
  const saves = createMysqlSaveStore(pool);
  const server = createApp(saves, createChatAdapter({}), { creatorStore: creators, mysqlPool: pool }).listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const request = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}/api/creator${path}`, { method, headers: { Cookie: cookie,
      'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie?.startsWith('gd_creator=')) cookie = setCookie.split(';')[0];
    return { response, data: await response.json() as any };
  };
  try {
    assert.equal((await request('/me')).response.status, 401);
    const registration = await request('/register', 'POST', { username: 'author_one', password: 'correct-horse-42', role: 'admin' });
    assert.equal(registration.response.status, 201);
    assert.equal(registration.data.username, 'author_one');
    assert.equal(registration.data.role, 'author');
    assert.match(registration.response.headers.get('set-cookie') ?? '', /HttpOnly/);
    assert.match(registration.response.headers.get('set-cookie') ?? '', /SameSite=Lax/);
    assert.equal((await request('/me')).data.username, 'author_one');
    assert.equal((await request('/logout', 'POST')).response.status, 200);
    assert.equal((await request('/me')).response.status, 401);
    assert.equal((await request('/login', 'POST', { username: 'author_one', password: 'wrong-password' })).response.status, 401);
    assert.equal((await request('/login', 'POST', { username: 'author_one', password: 'correct-horse-42' })).response.status, 200);
    assert.equal((await request('/me')).data.username, 'author_one');
    assert.equal((await request('/register', 'POST', { username: 'AUTHOR_ONE', password: 'different-42' })).response.status, 409);
    assert.equal((await request('/logout', 'POST', undefined, { Origin: 'https://evil.example' })).response.status, 403);
    assert.equal((await request('/me')).response.status, 200);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  });
});
