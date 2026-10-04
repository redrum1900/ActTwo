import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionEditor from '../apps/web/src/creator/editor/SectionEditor.js';
import ManifestEditor from '../apps/web/src/creator/editor/ManifestEditor.js';
import LocationsEditor from '../apps/web/src/creator/editor/LocationsEditor.js';
import { patchItemsImages, saveWithItemImages } from '../apps/web/src/creator/session/item-image-save.js';

test('image selection stays local until Save uploads and patches the matching item ID', async () => {
  const original = JSON.stringify([{ id: 'first', name: '第一项' }, { id: 'second', name: '第二项' }]);
  const file = { name: 'photo.png', type: 'image/png' } as File;
  const selected = { second: file };
  const calls: string[] = [];
  const result = await saveWithItemImages(original, selected,
    async chosen => { calls.push(`upload:${chosen.name}`); return { image: '/api/item-images/image-two' }; },
    async content => { calls.push('save'); return { content }; },
    async image => { calls.push(`discard:${image}`); });
  assert.deepEqual(calls, ['upload:photo.png', 'save']);
  assert.equal(JSON.parse(original)[1].image, undefined);
  assert.equal(JSON.parse(result.content)[0].image, undefined);
  assert.equal(JSON.parse(result.content)[1].image, '/api/item-images/image-two');
  assert.deepEqual(result.uploadedIds, ['second']);
});

test('failed save discards only newly uploaded item images and preserves the draft', async () => {
  const original = JSON.stringify([{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]);
  const discarded: string[] = [];
  await assert.rejects(saveWithItemImages(original, { a: {} as File, b: {} as File },
    async () => ({ image: `/api/item-images/${crypto.randomUUID()}` }),
    async () => { throw new Error('保存冲突'); },
    async image => { discarded.push(image); }), /保存冲突/);
  assert.equal(discarded.length, 2);
  assert.equal(JSON.parse(original)[0].image, undefined);
  assert.equal(JSON.parse(original)[1].image, undefined);
});

test('upload failure reclaims earlier uploads and a removed item cannot receive a file', async () => {
  const original = JSON.stringify([{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]);
  const discarded: string[] = [];
  let count = 0;
  await assert.rejects(saveWithItemImages(original, { a: {} as File, b: {} as File },
    async () => { if (++count === 2) throw new Error('上传失败'); return { image: '/api/item-images/first' }; },
    async () => { throw new Error('save must not run'); },
    async image => { discarded.push(image); }), /上传失败/);
  assert.deepEqual(discarded, ['/api/item-images/first']);
  await assert.rejects(saveWithItemImages(original, { gone: {} as File },
    async () => { throw new Error('upload must not run'); },
    async () => { throw new Error('save must not run'); }, async () => {}), /已不存在/);
});

test('late edits are merged by item ID without restoring deleted items', () => {
  const latest = JSON.stringify([{ id: 'b', name: '乙 · 新名字' }]);
  const merged = JSON.parse(patchItemsImages(latest, { a: '/api/item-images/one', b: '/api/item-images/two' }));
  assert.deepEqual(merged, [{ id: 'b', name: '乙 · 新名字', image: '/api/item-images/two' }]);
});

test('item form presents a deferred image upload with the current item', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'items.json', onChange: () => {}, projectId: 'story-a',
    content: JSON.stringify([{ id: 'item-a', name: '照片', description: '' }]) }));
  assert.match(html, /道具图片/);
  assert.match(html, /选择图片/);
  assert.match(html, /点击保存后上传/);
});

test('story start and location interaction use the shared Ant Design select', () => {
  const manifest = renderToStaticMarkup(createElement(ManifestEditor, { content: JSON.stringify({ title: '测试', periods: ['白天'], startLocation: 'home' }),
    onChange: () => {}, savedLocations: [{ id: 'home', name: '家' }] }));
  const locations = renderToStaticMarkup(createElement(LocationsEditor, { content: JSON.stringify([{ id: 'home', name: '家', interactionMode: 'in-person' }]),
    onChange: () => {}, sources: { storyEvents: [], items: [], npcs: [], locations: [], playerIndicators: [], periods: [], playerFields: [], rules: [] } }));
  assert.match(manifest, /ant-select/);
  assert.match(locations, /ant-select/);
  assert.doesNotMatch(manifest, /<select/);
  assert.doesNotMatch(locations, /<select/);
});
