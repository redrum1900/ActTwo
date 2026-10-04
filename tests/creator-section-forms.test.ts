import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionEditor from '../apps/web/src/creator/editor/SectionEditor.js';
import { patchManifest, patchLocation, newLocationId, changePeriod, movePeriod, removePeriod,
  newStoryEvent, patchStoryEvent, removeStoryEvent } from '../apps/web/src/creator/model/section-forms.js';
import { setStoryEventGate, setRecordedStoryEvents } from '../apps/web/src/creator/model/story-event-rule.js';
import { referencedStoryEventIds } from '../apps/web/src/creator/model/story-event-references.js';
import { newEntryId, patchEntryById, addEntry, removeEntry } from '../apps/web/src/creator/model/section-forms.js';
import * as locationForms from '../apps/web/src/creator/model/section-forms.js';

test('NPC basic form patches preserve hidden fields and item visibility states', () => {
  const forms = locationForms as typeof locationForms & {
    patchNpcBase?: (content: string, patch: Record<string, unknown>) => string;
    addNpcInitialItems?: (content: string, itemIds: string[]) => string;
    removeNpcInitialItem?: (content: string, itemId: string) => string;
    setNpcItemVisibility?: (content: string, itemId: string, condition: unknown) => string;
  };
  const original = JSON.stringify({ id: 'su-nian', name: '苏念', portrait: 'old.png', accent: '#993366',
    initialItems: ['old'], itemVisibility: {}, custom: { kept: true } });
  const renamed = forms.patchNpcBase?.(original, { name: '新名字', description: '多行\n描述' });
  assert.ok(renamed);
  assert.deepEqual(JSON.parse(renamed), { id: 'su-nian', name: '新名字', description: '多行\n描述', portrait: 'old.png',
    accent: '#993366', initialItems: ['old'], itemVisibility: {}, custom: { kept: true } });
  const added = forms.addNpcInitialItems?.(renamed, ['photo', 'note', 'photo']);
  assert.deepEqual(JSON.parse(added ?? 'null').initialItems, ['old', 'photo', 'note']);
  assert.deepEqual(JSON.parse(added ?? 'null').itemVisibility, { photo: null, note: null });
  const conditioned = forms.setNpcItemVisibility?.(added!, 'photo', { storyEvent: 'met' });
  assert.deepEqual(JSON.parse(conditioned ?? 'null').itemVisibility, { photo: { storyEvent: 'met' }, note: null });
  const hidden = forms.setNpcItemVisibility?.(conditioned!, 'photo', undefined);
  assert.deepEqual(JSON.parse(hidden ?? 'null').itemVisibility, { note: null });
  const removed = forms.removeNpcInitialItem?.(hidden!, 'note');
  assert.deepEqual(JSON.parse(removed ?? 'null').initialItems, ['old', 'photo']);
  assert.deepEqual(JSON.parse(removed ?? 'null').itemVisibility, {});
});

test('NPC basic form uses named options and item tabs without showing internal fields', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'npcs/su-nian/base.json', onChange: () => {},
    content: JSON.stringify({ id: 'su-nian', name: '苏念', description: '第一行\n第二行', initialLocationId: 'home',
      initialItems: ['photo'], itemVisibility: { photo: { storyEvent: 'met' } }, portrait: '', accent: '#993366' }),
    conditionSources: { storyEvents: [{ id: 'met', label: '见面' }], items: [{ id: 'photo', name: '照片' }],
      npcs: [], locations: [{ id: 'home', name: '家中' }], playerIndicators: [], periods: [], playerFields: [], rules: [] } }));
  assert.match(html, /家中/);
  assert.match(html, /简介 \/ 描述/);
  assert.match(html, /<textarea[^>]*>第一行\n第二行<\/textarea>/);
  assert.match(html, /NPC 道具|初始道具/);
  assert.match(html, /道具列表/);
  assert.match(html, /可见条件/);
  assert.match(html, /见面/);
  assert.doesNotMatch(html, /唯一 ID|添加字段|portrait|accent/);
});

test('world book keyword input splits commas and deduplicates names', () => {
  const forms = locationForms as typeof locationForms & { splitLoreKeywords?: (text: string, existing: string[]) => string[] };
  assert.deepEqual(forms.splitLoreKeywords?.(' 剑道, 竹剑， 训练 ,,剑道 ', ['家']), ['家', '剑道', '竹剑', '训练']);
});

test('world book uses left tabs, readable names and content textarea without IDs', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'npcs/su-nian/lore.json', onChange: () => {},
    content: JSON.stringify([{ id: 'kendo', name: '剑道背景', type: 'triggered', keywords: ['剑道'], content: '练习多年' }]) }));
  assert.match(html, /creator-side-entry-layout/);
  assert.match(html, /剑道背景/);
  assert.match(html, /<span>类型<\/span>/);
  assert.match(html, /触发/);
  assert.match(html, /触发词/);
  assert.match(html, /<textarea[^>]*>练习多年<\/textarea>/);
  assert.doesNotMatch(html, /唯一 ID|添加字段|编辑完整结构/);
});

test('persona helpers protect common while preserving IDs and advanced fields', () => {
  const forms = locationForms as typeof locationForms & {
    addPersona?: (content: string, common?: boolean) => string;
    patchPersona?: (content: string, id: string, patch: Record<string, unknown>) => string;
    removePersona?: (content: string, id: string) => string;
  };
  const original = JSON.stringify([{ id: 'online', name: '线上', content: '旧内容', custom: 7 },
    { id: 'common', name: '通用', content: '基础' }]);
  const patched = forms.patchPersona?.(original, 'online', { name: '屏幕两端', when: { storyEvent: 'met' } });
  assert.deepEqual(JSON.parse(patched ?? 'null')[0], { id: 'online', name: '屏幕两端', content: '旧内容', custom: 7,
    when: { storyEvent: 'met' } });
  assert.throws(() => forms.patchPersona?.(original, 'common', { when: { storyEvent: 'met' } }), /通用/);
  assert.throws(() => forms.removePersona?.(original, 'common'), /通用/);
  const added = JSON.parse(forms.addPersona?.(original) ?? 'null');
  assert.match(added.at(-1).id, /^[0-9a-f-]{36}$/);
  assert.equal(added.at(-1).content, '');
  assert.deepEqual(JSON.parse(forms.removePersona?.(original, 'online') ?? 'null'), [{ id: 'common', name: '通用', content: '基础' }]);
});

test('persona form pins common first and offers typed conditions only for other entries', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'npcs/su-nian/personas.json', onChange: () => {},
    content: JSON.stringify([{ id: 'online', name: '屏幕两端', content: '保持距离', when: { storyEvent: 'met' } },
      { id: 'common', name: '通用', content: '基础内容' }]),
    conditionSources: { storyEvents: [{ id: 'met', label: '见面' }], items: [], npcs: [{ id: 'su-nian', name: '苏念' }],
      locations: [], playerIndicators: [], periods: [], playerFields: [], rules: [] } }));
  assert.match(html, /creator-side-entry-layout/);
  assert.ok(html.indexOf('>通用</button>') < html.indexOf('>屏幕两端</button>'));
  assert.match(html, /<textarea[^>]*>基础内容<\/textarea>/);
  assert.doesNotMatch(html, /删除性格|唯一 ID|添加字段|生效条件/);
});

test('conditional persona edits conditions with the shared condition builder', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'npcs/su-nian/personas.json', onChange: () => {},
    content: JSON.stringify([{ id: 'online', name: '屏幕两端', content: '保持距离', when: { storyEvent: 'met' } }]),
    conditionSources: { storyEvents: [{ id: 'met', label: '见面' }], items: [], npcs: [{ id: 'su-nian', name: '苏念' }],
      locations: [], playerIndicators: [], periods: [], playerFields: [], rules: [] } }));
  assert.match(html, /生效条件/);
  assert.match(html, /见面/);
  assert.match(html, /创建通用/);
});

test('malformed NPC list entries stay in JSON mode instead of crashing form rendering', () => {
  for (const path of ['npcs/su-nian/lore.json', 'npcs/su-nian/personas.json']) {
    const html = renderToStaticMarkup(createElement(SectionEditor, { path, onChange: () => {}, content: '[null,{}]' }));
    assert.match(html, /列表存在缺少 ID/);
    assert.match(html, /aria-label="[^\"]+ JSON"/);
  }
});

test('tabbed entries patch by stable ID and preserve unknown fields across deletion', () => {
  const first = { id: 'a', name: '第一项', description: '第一行\n第二行', variants: [{ when: { flag: 'old' } }] };
  const second = { id: 'b', name: '第二项', hiddenTags: ['secret'] };
  const original = JSON.stringify([first, second]);
  const changed = JSON.parse(patchEntryById(original, 'a', { detail: '完整\n详情' }));
  assert.equal(changed[0].description, first.description);
  assert.equal(changed[0].detail, '完整\n详情');
  assert.deepEqual(changed[0].variants, first.variants);
  assert.deepEqual(changed[1], second);
  assert.deepEqual(JSON.parse(removeEntry(JSON.stringify(changed), 'a')), [second]);
  const id = newEntryId();
  assert.notEqual(id, newEntryId());
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(addEntry(original, { id, name: '第三项' }))[2].id, id);
});

test('reference scan identifies condition and effect IDs without matching unrelated text', () => {
  const sections = {
    'manifest.json': { content: JSON.stringify({ storyEvents: [{ id: 'one', label: 'one', detail: '' }] }) },
    'items.json': { content: JSON.stringify([{ description: 'one' }]) },
    'endings.json': { content: JSON.stringify([{ condition: { storyEvent: 'one' } }]) },
    'npcs/a/rules.json': { content: JSON.stringify([{ effects: [{ type: 'recordStoryEvent', eventId: 'two' }] }]) },
  };
  assert.deepEqual(referencedStoryEventIds(sections), ['one', 'two']);
});

test('story event rule controls preserve unrelated conditions and effects', () => {
  const rule = { id: 'invite', when: { indicator: { id: 'affection', gte: 10 } },
    effects: [{ type: 'changeIndicator', id: 'affection', by: 1 }] };
  const gated = setStoryEventGate(rule, 'event-one');
  assert.deepEqual(gated.when, { all: [rule.when, { storyEvent: 'event-one' }] });
  assert.deepEqual(setStoryEventGate(gated, null).when, rule.when);
  const recorded = setRecordedStoryEvents(rule, ['event-one', 'event-two']);
  assert.deepEqual(recorded.effects, [...rule.effects, { type: 'recordStoryEvent', eventId: 'event-one' },
    { type: 'recordStoryEvent', eventId: 'event-two' }]);
  assert.deepEqual(setRecordedStoryEvents(recorded, []).effects, rule.effects);
});

test('story events get stable UUIDs and edits preserve other manifest fields', () => {
  const first = newStoryEvent();
  const second = newStoryEvent();
  assert.notEqual(first.id, second.id);
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  const original = JSON.stringify({ id: 'story-a', title: '故事', storyEvents: [first, second], theme: { accent: 'red' } });
  const updated = JSON.parse(patchStoryEvent(original, first.id, { label: '见面', detail: '第一次见面' }));
  assert.equal(updated.storyEvents[0].id, first.id);
  assert.equal(updated.storyEvents[0].label, '见面');
  assert.equal(updated.storyEvents[1].id, second.id);
  assert.deepEqual(updated.theme, { accent: 'red' });
  assert.deepEqual(JSON.parse(removeStoryEvent(JSON.stringify(updated), first.id)).storyEvents, [second]);
});

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

test('location item edits preserve other fields and reject a second initial placement', () => {
  const forms = locationForms as typeof locationForms & {
    addLocationPlacement?: (content: string, locationId: string, itemId: string) => string;
    patchLocationPlacement?: (content: string, locationId: string, itemId: string, fields: Record<string, unknown>) => string;
    removeLocationPlacement?: (content: string, locationId: string, itemId: string) => string;
    availableLocationPlacementItems?: (content: string, items: { id: string; name: string }[], npcItems: string[]) => { id: string; name: string }[];
  };
  const original = JSON.stringify([{ id: 'home', spots: [{ id: 'desk' }], items: [] }, { id: 'cafe', items: [] }]);
  const added = forms.addLocationPlacement?.(original, 'home', 'photo');
  assert.ok(added, 'adding a location item should return updated content');
  assert.deepEqual(JSON.parse(added)[0].items, [{ item: 'photo' }]);
  assert.throws(() => forms.addLocationPlacement?.(added!, 'cafe', 'photo'), /已放置/);
  const patched = forms.patchLocationPlacement?.(added!, 'home', 'photo', { discoverWhen: { storyEvent: 'met' }, blockedHint: '稍后再拿' });
  assert.deepEqual(JSON.parse(patched ?? 'null')[0].items, [{ item: 'photo', discoverWhen: { storyEvent: 'met' }, blockedHint: '稍后再拿' }]);
  const cleared = forms.patchLocationPlacement?.(patched!, 'home', 'photo', { discoverWhen: undefined });
  assert.deepEqual(JSON.parse(cleared ?? 'null')[0].items, [{ item: 'photo', blockedHint: '稍后再拿' }]);
  const removed = forms.removeLocationPlacement?.(cleared!, 'home', 'photo');
  assert.deepEqual(JSON.parse(removed ?? 'null'), JSON.parse(original));
  assert.deepEqual(forms.availableLocationPlacementItems?.(added!, [
    { id: 'photo', name: '照片' }, { id: 'charm', name: '御守' }, { id: 'note', name: '笔记' },
  ], ['charm']), [{ id: 'note', name: '笔记' }]);
});

test('location form shows one item tab with optional discovery and taking conditions', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'locations.json', onChange: () => {},
    content: JSON.stringify([{ id: 'home', name: '家', spots: [], items: [{ item: 'photo', discoverWhen: { storyEvent: 'met' } }] }]),
    conditionSources: { storyEvents: [{ id: 'met', label: '已经见面' }], items: [{ id: 'photo', name: '照片' }],
      npcs: [], locations: [{ id: 'home', name: '家' }], playerIndicators: [], periods: [], playerFields: [], rules: [] } }));
  assert.match(html, /地点道具/);
  assert.match(html, /道具列表/);
  assert.match(html, /照片/);
  assert.match(html, /发现条件/);
  assert.match(html, /获取条件/);
  assert.match(html, /添加道具/);
  assert.match(html, /已经见面/);
});

test('a newly added unsaved location is valid in its own item condition editor', () => {
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'locations.json', onChange: () => {},
    content: JSON.stringify([{ id: 'new-home', name: '新家', spots: [], items: [{ item: 'photo', takeWhen: { location: 'new-home' } }] }]),
    conditionSources: { storyEvents: [], items: [{ id: 'photo', name: '照片' }], npcs: [], locations: [],
      playerIndicators: [], periods: [], playerFields: [], rules: [] } }));
  assert.doesNotMatch(html, /未知地点/);
});

test('time periods can change order but never become empty', () => {
  assert.deepEqual(changePeriod(['白天', '晚上'], 1, '下午'), ['白天', '下午']);
  assert.deepEqual(movePeriod(['白天', '下午', '晚上'], 2, -1), ['白天', '晚上', '下午']);
  assert.deepEqual(removePeriod(['白天'], 0), ['白天']);
});

test('story settings use saved location names and report a missing start location', () => {
  const selected = renderToStaticMarkup(createElement(SectionEditor, { path: 'manifest.json',
    content: '{"id":"story-a","title":"故事","startLocation":"cafe","periods":["白天"]}', onChange: () => {},
    savedLocations: [{ id: 'cafe', name: '老街饭店' }] }));
  const html = renderToStaticMarkup(createElement(SectionEditor, { path: 'manifest.json',
    content: '{"id":"story-a","title":"故事","startLocation":"lost","periods":["白天"]}', onChange: () => {},
    savedLocations: [{ id: 'cafe', name: '老街饭店' }] }));
  assert.match(html, /开局地点/);
  assert.match(selected, /老街饭店/);
  assert.match(selected, /ant-select/);
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
