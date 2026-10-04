import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { createPublishedAssetsRouter } from '../apps/api/src/modules/creator/assets/published-assets-router.js';

test('published asset routes retain MIME, cache and not-found responses', async () => {
  const app = express();
  const image = { mime: 'image/png', bytes: Buffer.from([137, 80, 78, 71]) };
  app.use('/api', createPublishedAssetsRouter({
    published: async id => { if (id !== 'cover-one') throw new Error('missing'); return image; },
    publishedItem: async id => { if (id !== 'item-one') throw new Error('missing'); return image; },
  }));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const asset of ['covers/cover-one', 'item-images/item-one']) {
      const response = await fetch(`${base}/api/${asset}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), image.bytes);
    }
    const missingCover = await fetch(`${base}/api/covers/missing`);
    assert.equal(missingCover.status, 404);
    assert.deepEqual(await missingCover.json(), { error: '封面不存在' });
    const missingItem = await fetch(`${base}/api/item-images/missing`);
    assert.equal(missingItem.status, 404);
    assert.deepEqual(await missingItem.json(), { error: '道具图片不存在' });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
