import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CoverArtwork from '../apps/web/src/shared/cover-artwork.js';
import { saveWithCover } from '../apps/web/src/creator/session/cover-save.js';

test('published image cover renders an image while legacy text cover remains text', () => {
  const image = renderToStaticMarkup(createElement(CoverArtwork, { cover: '/api/covers/abc', fallback: '故' }));
  assert.match(image, /<img/);
  assert.match(image, /src="\/api\/covers\/abc"/);
  const legacy = renderToStaticMarkup(createElement(CoverArtwork, { cover: '剑', fallback: '故' }));
  assert.match(legacy, />剑</);
  assert.doesNotMatch(legacy, /<img/);
});

test('failed section save removes only the newly uploaded cover and keeps original draft', async () => {
  const original = '{"id":"story-a","title":"故事"}';
  const discarded: string[] = [];
  await assert.rejects(saveWithCover(original, {} as File,
    async () => ({ cover: '/api/covers/new-id' }),
    async () => { throw new Error('保存冲突'); },
    async cover => { discarded.push(cover); }), /保存冲突/);
  assert.deepEqual(discarded, ['/api/covers/new-id']);
  assert.equal(JSON.parse(original).cover, undefined);
});

test('invalid JSON after image selection also discards its uploaded temporary asset', async () => {
  const discarded: string[] = [];
  await assert.rejects(saveWithCover('{', {} as File,
    async () => ({ cover: '/api/covers/temporary' }),
    async () => { throw new Error('save must not run'); },
    async cover => { discarded.push(cover); }), /JSON/);
  assert.deepEqual(discarded, ['/api/covers/temporary']);
});
