import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SectionEditor from '../apps/web/src/creator/SectionEditor.js';
import { patchManifest, patchLocation, newLocationId, changePeriod, movePeriod, removePeriod,
  newStoryEvent, patchStoryEvent, removeStoryEvent } from '../apps/web/src/creator/section-forms.js';
import { setStoryEventGate, setRecordedStoryEvents } from '../apps/web/src/creator/story-event-rule.js';
import { referencedStoryEventIds } from '../apps/web/src/creator/story-event-references.js';

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
