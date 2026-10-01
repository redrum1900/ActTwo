import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionEditor from '../apps/web/src/creator/SectionEditor.js';
import { groupedSections, starterEntry } from '../apps/web/src/creator/sections.js';

test('creator tabs group script, player and each NPC while editor exposes readable fields', () => {
  const sections = groupedSections(['manifest.json', 'player/indicators.json', 'npcs/one/base.json', 'npcs/two/base.json']);
  assert.deepEqual(sections.npcIds, ['one', 'two']);
  assert.deepEqual(sections.player, ['player/indicators.json']);
  assert.deepEqual(sections.root, ['manifest.json']);
  assert.equal(starterEntry('npcs/one/indicators.json', 0).playerVisible, false);
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'manifest.json',
    content: '{"id":"demo","title":"故事","periods":["白天"]}', onChange: () => {} }));
  assert.match(html, /故事设定/);
  assert.match(html, /标题 · title/);
  assert.match(html, /编辑模式/);
});
