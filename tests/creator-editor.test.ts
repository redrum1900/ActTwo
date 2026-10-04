import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionEditor from '../apps/web/src/creator/editor/SectionEditor.js';
import TabbedEntriesEditor from '../apps/web/src/creator/editor/TabbedEntriesEditor.js';
import { groupedSections, starterEntry } from '../apps/web/src/creator/model/sections.js';
import { workspaceForPath, reviewStatusLabel } from '../apps/web/src/creator/model/review-ui.js';
import { CreatorNavigation } from '../apps/web/src/creator/app/CreatorNavigation.js';
import { ReviewDecision } from '../apps/web/src/creator/workflows/ReviewWorkspace.js';
import { PlayerForm } from '../apps/web/src/app/App.js';

test('creator tabs group script, player and each NPC while editor exposes readable fields', () => {
  const sections = groupedSections(['manifest.json', 'story/indicators.json', 'player/indicators.json', 'npcs/one/base.json', 'npcs/two/base.json']);
  assert.deepEqual(sections.npcIds, ['one', 'two']);
  assert.deepEqual(sections.player, ['player/indicators.json']);
  assert.deepEqual(sections.root, ['manifest.json', 'story/indicators.json']);
  assert.equal(starterEntry('npcs/one/indicators.json', 0).playerVisible, false);
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'manifest.json',
    content: '{"id":"demo","title":"故事","periods":["白天"]}', onChange: () => {} }));
  assert.match(html, /故事设定/);
  assert.match(html, /标题/);
  assert.match(html, /编辑模式/);
});

test('opening form uses compact typed controls and hides editable IDs', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'player-form.json', onChange: () => {},
    content: JSON.stringify([{ id: 'existing-name', label: '你的名字', type: 'input', default: '阿言', required: false }]) }));
  assert.match(html, /你的名字/);
  assert.match(html, /新增问题/);
  assert.match(html, /单行文本/);
  assert.match(html, /高级设置/);
  assert.doesNotMatch(html, /必填/);
  assert.doesNotMatch(html, /唯一 ID|添加字段/);
});

test('player-facing opening form marks legacy date questions required without inventing a birthday', () => {
  const html = renderToStaticMarkup(createElement(PlayerForm, { fields: [
    { id: 'birthday', label: '生日', type: 'date', required: false },
  ], onSubmit: () => {}, busy: false }));
  assert.match(html, /生日<span class="required"> \*<\/span>/);
  assert.match(html, /type="date"[^>]*required=""/);
  assert.match(html, /type="date"[^>]*value=""/);
});

test('story indicator editor hides IDs, keeps the reserved ledger read-only and offers typed values', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'story/indicators.json', onChange: () => {},
    content: JSON.stringify([
      { id: 'ledger', name: '已执行规则', type: 'tags', initial: [], playerVisible: false, systemRole: 'onceRules' },
      { id: 'score', name: '分数', description: '全局分数', type: 'number', initial: 0, min: 0, max: 100, playerVisible: false },
    ]) }));
  assert.match(html, /新增指标/);
  assert.match(html, /系统管理/);
  assert.match(html, /全局分数/);
  assert.doesNotMatch(html, /唯一 ID|添加字段/);
});

test('rule form offers trigger, once toggle, typed effects and event removal', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'player/rules.json', onChange: () => {},
    savedStoryEvents: [{ id: 'event-one', label: '首次见面' }],
    content: JSON.stringify([{ id: 'rule-one', intent: '探索', trigger: 'automatic', once: true,
      effects: [{ type: 'removeStoryEvent', eventId: 'event-one' }] }]) }));
  assert.match(html, /仅触发一次/);
  assert.match(html, /结算效果/);
  assert.match(html, /移除剧情事件/);
  assert.doesNotMatch(html, /添加字段/);
});

test('player and NPC rule editors expose author-only group filtering and single-rule group editing', () => {
  for (const path of ['player/rules.json', 'npcs/su-nian/rules.json']) {
    const html = renderToStaticMarkup(createElement(SectionEditor, { path, onChange: () => {},
      content: JSON.stringify([
        { id: 'one', intent: '第一次见面', trigger: 'automatic', editorGroup: '初遇', effects: [] },
        { id: 'two', intent: '闲聊', trigger: 'automatic', effects: [] },
      ]) }));
    assert.match(html, /筛选分组/);
    assert.match(html, /编辑分组/);
    assert.match(html, /初遇/);
    assert.match(html, /未分组/);
    assert.doesNotMatch(html, /互斥组/);
  }
});

test('filtered rule tabs select a visible entry and keep its original rule number', () => {
  const entries = [{ id: 'one', name: '初遇' }, { id: 'two', name: '闲聊' }];
  const html = renderToStaticMarkup(createElement(TabbedEntriesEditor, { entries, visibleEntries: [entries[1]],
    kind: '规则', layout: 'side', onAdd: () => entries[0], onRemove: () => {}, render: () => null }));
  assert.doesNotMatch(html, /初遇/);
  assert.match(html, /闲聊/);
  assert.match(html, /规则 \/ 02/);
});

test('rule editor treats malformed JSON group metadata as ungrouped instead of crashing', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'player/rules.json', onChange: () => {},
    content: JSON.stringify([{ id: 'one', intent: '闲聊', trigger: 'automatic', editorGroup: 7, effects: [] }]) }));
  assert.match(html, /筛选分组/);
  assert.match(html, /未分组/);
});

test('gallery condition form exposes story indicators with strict numeric and array operators', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'achievements.json', onChange: () => {},
    conditionSources: { storyEvents: [], items: [], npcs: [], locations: [], playerIndicators: [],
      storyIndicators: [{ id: 'score', name: '总分', type: 'number' }], periods: [], playerFields: [], rules: [] },
    content: JSON.stringify([{ id: 'a', name: '达成', description: '', condition: { storyIndicator: { id: 'score', gt: 5 } } }]) }));
  assert.match(html, /剧本指标/);
  assert.match(html, /总分/);
  assert.match(html, /比较方式/);
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
    content: JSON.stringify([{ id: 'confession', intent: '告白', trigger: 'semantic', exclusiveGroup: 'affection-bonus',
      effects: [{ type: 'recordStoryEvent', eventId: '11111111-1111-4111-8111-111111111111' }] }]) }));
  assert.match(html, /前置条件/);
  assert.match(html, /首次告白/);
  assert.doesNotMatch(html, /成功后记录剧情事件|互斥组/);
});

test('indicator, rule, item, gallery and location editors place add above left-side vertical tabs', () => {
  const indicator = renderToStaticMarkup(createElement(SectionEditor, { path: 'player/indicators.json', onChange: () => {},
    content: JSON.stringify([{ id: 'score', name: '好感度', type: 'number', initial: 0 }]) }));
  const rule = renderToStaticMarkup(createElement(SectionEditor, { path: 'player/rules.json', onChange: () => {},
    content: JSON.stringify([{ id: 'r1', intent: '规则一', trigger: 'automatic', effects: [] }]) }));
  const item = renderToStaticMarkup(createElement(SectionEditor, { path: 'items.json', onChange: () => {},
    content: JSON.stringify([{ id: 'item-a', name: '照片' }]) }));
  const achievement = renderToStaticMarkup(createElement(SectionEditor, { path: 'achievements.json', onChange: () => {},
    content: JSON.stringify([{ id: 'achievement-a', name: '回忆' }]) }));
  const ending = renderToStaticMarkup(createElement(SectionEditor, { path: 'endings.json', onChange: () => {},
    content: JSON.stringify([{ id: 'ending-a', name: '归来' }]) }));
  const location = renderToStaticMarkup(createElement(SectionEditor, { path: 'locations.json', onChange: () => {},
    content: JSON.stringify([{ id: 'location-a', name: '老街' }]) }));
  for (const html of [indicator, rule, item, achievement, ending, location]) {
    assert.match(html, /creator-side-entry-layout/);
    assert.ok(html.indexOf('creator-location-add') < html.indexOf('role="tab"'));
    assert.match(html, /creator-side-entry-nav/);
    assert.ok(html.indexOf('creator-location-add') < html.indexOf('role="tablist"'));
  }
});

test('NPC rule form does not present unsupported action trigger', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'npcs/su-nian/rules.json', onChange: () => {},
    content: JSON.stringify([{ id: 'r1', intent: '旧动作', trigger: 'action', effects: [] }]) }));
  assert.match(html, /请选择有效触发方式/);
  assert.doesNotMatch(html, /title="动作"/);
});

test('items and gallery use compact tabs without editable IDs or add-field controls', () => {
  const item = renderToStaticMarkup(createElement(SectionEditor, { path: 'items.json', onChange: () => {},
    content: JSON.stringify([{ id: 'item-a', name: '照片', description: '简介', detail: '第一行\n第二行', initialTags: ['回忆'] }]) }));
  assert.match(item, /道具列表/);
  assert.match(item, /新增道具/);
  assert.match(item, /完整详情/);
  assert.doesNotMatch(item, /初始标签|添加标签|回忆/);
  assert.doesNotMatch(item, /唯一 ID|添加字段/);
  const ending = renderToStaticMarkup(createElement(SectionEditor, { path: 'endings.json', onChange: () => {},
    content: JSON.stringify([{ id: 'end-a', name: '归来', description: '第一行\n第二行', condition: { flag: 'seen' }, hidden: true }]) }));
  assert.match(ending, /结局列表/);
  assert.match(ending, /隐藏条目/);
  assert.doesNotMatch(ending, /唯一 ID|添加字段/);
});

test('gallery condition tree offers independent AND OR NOT controls and item/event choices', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'endings.json', onChange: () => {},
    savedStoryEvents: [{ id: 'event-one', label: '首次见面' }],
    content: JSON.stringify([{ id: 'end-a', name: '归来', description: '', condition: { all: [{ storyEvent: 'event-one' }] } }]) }));
  assert.match(html, /全部满足/);
  assert.match(html, /分组关系/);
  assert.match(html, /取反/);
  assert.match(html, /剧情事件/);
});

test('creator form removes unsupported old predicate rows instead of showing advanced JSON', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'achievements.json', onChange: () => {},
    content: JSON.stringify([{ id: 'old', name: '旧成就', description: '', condition: { flag: 'knows-kendo' } }]) }));
  assert.doesNotMatch(html, /高级条件|knows-kendo|去 JSON 模式编辑/);
  assert.match(html, /条件分组不能为空/);
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
