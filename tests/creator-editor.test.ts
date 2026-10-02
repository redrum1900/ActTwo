import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionEditor from '../apps/web/src/creator/SectionEditor.js';
import { groupedSections, starterEntry } from '../apps/web/src/creator/sections.js';
import { workspaceForPath, reviewStatusLabel } from '../apps/web/src/creator/review-ui.js';
import { CreatorNavigation } from '../apps/web/src/creator/CreatorNavigation.js';
import { ReviewDecision } from '../apps/web/src/creator/ReviewWorkspace.js';

test('creator tabs group script, player and each NPC while editor exposes readable fields', () => {
  const sections = groupedSections(['manifest.json', 'player/indicators.json', 'npcs/one/base.json', 'npcs/two/base.json']);
  assert.deepEqual(sections.npcIds, ['one', 'two']);
  assert.deepEqual(sections.player, ['player/indicators.json']);
  assert.deepEqual(sections.root, ['manifest.json']);
  assert.equal(starterEntry('npcs/one/indicators.json', 0).playerVisible, false);
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'manifest.json',
    content: '{"id":"demo","title":"故事","periods":["白天"]}', onChange: () => {} }));
  assert.match(html, /故事设定/);
  assert.match(html, /标题/);
  assert.match(html, /编辑模式/);
});

test('story settings expose event definitions without raw IDs', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'manifest.json', onChange: () => {},
    content: JSON.stringify({ title: '故事', startLocation: 'home', periods: ['白天'],
      storyEvents: [{ id: '11111111-1111-4111-8111-111111111111', label: '首次见面', detail: '在饭店见到她' }] }) }));
  assert.match(html, /剧情事件/);
  assert.match(html, /首次见面/);
  assert.match(html, /在饭店见到她/);
  assert.doesNotMatch(html, /11111111-1111-4111-8111-111111111111/);
});

test('rule forms show saved story event labels in selection controls', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'npcs/su-nian/rules.json', onChange: () => {},
    savedStoryEvents: [{ id: '11111111-1111-4111-8111-111111111111', label: '首次告白' }],
    content: JSON.stringify([{ id: 'confession', intent: '告白', trigger: 'semantic', effects: [] }]) }));
  assert.match(html, /需要已发生的剧情事件/);
  assert.match(html, /成功后记录剧情事件/);
});

test('items and gallery use compact tabs without editable IDs or add-field controls', () => {
  const item = renderToStaticMarkup(createElement(SectionEditor, { path: 'items.json', onChange: () => {},
    content: JSON.stringify([{ id: 'item-a', name: '照片', description: '简介', detail: '第一行\n第二行', initialTags: ['回忆'] }]) }));
  assert.match(item, /道具列表/);
  assert.match(item, /新增道具/);
  assert.match(item, /完整详情/);
  assert.match(item, /回忆/);
  assert.doesNotMatch(item, /唯一 ID|添加字段/);
  const ending = renderToStaticMarkup(createElement(SectionEditor, { path: 'endings.json', onChange: () => {},
    content: JSON.stringify([{ id: 'end-a', name: '归来', description: '第一行\n第二行', condition: { flag: 'seen' }, hidden: true }]) }));
  assert.match(ending, /结局列表/);
  assert.match(ending, /隐藏条目/);
  assert.doesNotMatch(ending, /唯一 ID|添加字段/);
});

test('creator status distinguishes pending revisions from a live release', () => {
  assert.equal(reviewStatusLabel({ publishedAt: null, review: null }), '草稿');
  assert.equal(reviewStatusLabel({ publishedAt: null, review: { status: 'pending' } }), '待审核');
  assert.equal(reviewStatusLabel({ publishedAt: '2026-10-01', review: { status: 'pending' } }), '旧版在线 · 新版待审');
  assert.equal(reviewStatusLabel({ publishedAt: '2026-10-01', review: { status: 'rejected' } }), '已驳回 · 旧版在线');
  assert.equal(workspaceForPath('admin', '/creator'), 'library');
  assert.equal(workspaceForPath('admin', '/creator/review'), 'review');
  assert.equal(workspaceForPath('author', '/creator/review'), 'library');
});

test('creator navigation offers stories to everyone and review only to administrators', () => {
  const navigation = renderToStaticMarkup(createElement(CreatorNavigation, { role: 'admin', workspace: 'library',
    onLibrary: () => {}, onReview: () => {} }));
  assert.match(navigation, /故事创作/);
  assert.match(navigation, /审核/);
  assert.match(navigation, /aria-pressed="true"/);
  const author = renderToStaticMarkup(createElement(CreatorNavigation, { role: 'author', workspace: 'library',
    onLibrary: () => {}, onReview: () => {} }));
  assert.match(author, /故事创作/);
  assert.doesNotMatch(author, /审核/);
});

test('moderation panel requires a written reason before rejection', () => {
  const empty = renderToStaticMarkup(createElement(ReviewDecision, { reason: ' ', onReasonChange: () => {},
    onApprove: () => {}, onReject: () => {}, busy: false }));
  assert.match(empty, /驳回/);
  assert.match(empty, /disabled=""/);
  const filled = renderToStaticMarkup(createElement(ReviewDecision, { reason: '人物设定不完整', onReasonChange: () => {},
    onApprove: () => {}, onReject: () => {}, busy: false }));
  assert.equal(filled.includes('disabled=""'), false);
});
