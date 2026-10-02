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
  assert.match(html, /标题 · title/);
  assert.match(html, /编辑模式/);
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
