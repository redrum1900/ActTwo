import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionEditor from '../apps/web/src/creator/SectionEditor.js';
import { patchManifest, patchLocation, newLocationId, changePeriod, movePeriod, removePeriod } from '../apps/web/src/creator/section-forms.js';

test('manifest form edits preserve hidden and unknown configuration', () => {
  const original = JSON.stringify({ id: 'story-a', version: '2.0.0', theme: { accent: 'red' }, title: '旧名', custom: 7 });
  const updated = JSON.parse(patchManifest(original, { title: '新名', startLocation: 'cafe' }));
  assert.deepEqual(updated, { id: 'story-a', version: '2.0.0', theme: { accent: 'red' }, title: '新名', custom: 7,
    startLocation: 'cafe' });
});

test('location form edits preserve spots, items and other locations', () => {
  const original = JSON.stringify([{ id: 'cafe', name: '饭店', spots: [{ id: 'menu' }], items: [{ item: 'cup' }], custom: true },
    { id: 'home', name: '家中' }]);
  const updated = JSON.parse(patchLocation(original, 'cafe', { name: '老街饭店', description: '街角小店' }));
  assert.deepEqual(updated[0], { id: 'cafe', name: '老街饭店', spots: [{ id: 'menu' }], items: [{ item: 'cup' }],
    custom: true, description: '街角小店' });
  assert.deepEqual(updated[1], { id: 'home', name: '家中' });
  assert.notEqual(newLocationId(), newLocationId());
});

test('time periods can change order but never become empty', () => {
  assert.deepEqual(changePeriod(['白天', '晚上'], 1, '下午'), ['白天', '下午']);
  assert.deepEqual(movePeriod(['白天', '下午', '晚上'], 2, -1), ['白天', '晚上', '下午']);
  assert.deepEqual(removePeriod(['白天'], 0), ['白天']);
});

test('story settings use saved location names and report a missing start location', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'manifest.json',
    content: '{"id":"story-a","title":"故事","startLocation":"lost","periods":["白天"]}', onChange: () => {},
    savedLocations: [{ id: 'cafe', name: '老街饭店' }] }));
  assert.match(html, /开局地点/);
  assert.match(html, /老街饭店/);
  assert.match(html, /当前开局地点已不存在/);
  assert.doesNotMatch(html, /新增字段/);
  assert.doesNotMatch(html, /唯一 ID/);
});

test('location editor presents one location tab and hides unfinished spots', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'locations.json',
    content: '[{"id":"cafe","name":"饭店","description":"街角","interactionMode":"in-person","spots":[{"id":"door"}]}]',
    onChange: () => {} }));
  assert.match(html, /饭店/);
  assert.match(html, /交流方式/);
  assert.match(html, /新增地点/);
  assert.doesNotMatch(html, /调查点/);
});

test('malformed location entries remain editable as JSON instead of crashing the form', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'locations.json', content: '[null]', onChange: () => {} }));
  assert.match(html, /地点 JSON/);
  assert.match(html, /\[null\]/);
});
