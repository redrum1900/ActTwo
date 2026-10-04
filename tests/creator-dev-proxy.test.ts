import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer as createViteServer } from 'vite';
import viteConfig from '../vite.config.js';
import { createApp } from '../apps/api/src/app.js';
import { createMysqlCreatorStore } from '../apps/api/src/infrastructure/mysql/mysql-auth-store.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';
import { createChatAdapter } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { withTestMysql } from './support/mysql-test-db.js';

test('development proxy preserves browser host for creator login origin check', async () => {
  await withTestMysql(async pool => {
  const creators = createMysqlCreatorStore(pool);
  const saves = createMysqlSaveStore(pool);
  const api = createApp(saves, createChatAdapter({}), { creatorStore: creators, mysqlPool: pool }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => api.once('listening', resolve));
  const apiPort = (api.address() as AddressInfo).port;
  const configuredProxy = viteConfig.server?.proxy?.['/api'];
  assert.ok(configuredProxy);
  const proxy = typeof configuredProxy === 'string' ? `http://127.0.0.1:${apiPort}`
    : { ...configuredProxy, target: `http://127.0.0.1:${apiPort}` };
  const vite = await createViteServer({ configFile: false, server: { host: '127.0.0.1', port: 0, proxy: { '/api': proxy } } });
  try {
    await vite.listen();
    const port = (vite.httpServer!.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    const response = await fetch(`${origin}/api/creator/login`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'not-an-account', password: 'wrong-password' }) });
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { error: string }).error, '用户名或密码错误');
  } finally {
    await vite.close();
    await new Promise<void>((resolve, reject) => api.close(error => error ? reject(error) : resolve()));
  }
  });
});
