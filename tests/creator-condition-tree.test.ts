import test from 'node:test';
import assert from 'node:assert/strict';
import { patchCondition, conditionIssues, changeConditionKind, type ConditionSources } from '../apps/web/src/creator/condition-tree.js';
import { conditionSourcesFromSections } from '../apps/web/src/creator/condition-sources.js';

const sources: ConditionSources = {
  storyEvents: [{ id: 'event-one', label: '首次见面' }], items: [{ id: 'item-one', name: '照片' }],
  npcs: [{ id: 'npc-one', name: '苏念', indicators: [{ id: 'affection', name: '好感', type: 'number' }] }],
  locations: [{ id: 'home', name: '家' }], playerIndicators: [{ id: 'cursed', name: '诅咒', type: 'boolean' }],
  periods: ['白天'], playerFields: [], rules: [],
};

test('condition patching edits arbitrary depths immutably and preserves siblings', () => {
  const root = { all: [{ storyEvent: 'event-one' }, { any: [{ hasItem: { owner: 'player', item: 'item-one' } }] }] } as const;
  const inserted = patchCondition(root, [1], { type: 'insert', index: 1, value: { not: { storyEvent: 'event-one' } } });
  assert.deepEqual(inserted, { all: [root.all[0], { any: [root.all[1].any[0], { not: { storyEvent: 'event-one' } }] }] });
  assert.equal(root.all[1].any.length, 1);
  const moved = patchCondition(inserted, [1], { type: 'move', from: 1, to: 0 });
  assert.deepEqual((moved as { all: any[] }).all[1].any[0], { not: { storyEvent: 'event-one' } });
  const removed = patchCondition(moved, [1], { type: 'remove', index: 1 });
  assert.deepEqual((removed as { all: any[] }).all[1].any, [{ not: { storyEvent: 'event-one' } }]);
  const replaced = patchCondition(removed, [1, 0, 'not'], { type: 'replace', value: { storyEvent: 'other' } });
  assert.deepEqual((replaced as { all: any[] }).all[1].any[0], { not: { storyEvent: 'other' } });
});

test('groups switch AND/OR without losing children and NOT wraps groups or leaves', () => {
  const root = { all: [{ storyEvent: 'event-one' }, { hasItem: { owner: 'player', item: 'item-one' } }] } as const;
  assert.deepEqual(changeConditionKind(root, 'any'), { any: root.all });
  const wrapped = patchCondition(root, [], { type: 'replace', value: { not: root } });
  assert.deepEqual(wrapped, { not: root });
  assert.deepEqual(patchCondition(wrapped, [], { type: 'replace', value: root }), root);
});

test('empty groups and dangling item, event and indicator references are reported', () => {
  assert.ok(conditionIssues({ all: [] }, sources).some(issue => issue.includes('空')));
  const invalid = { any: [{ storyEvent: 'missing' }, { hasItem: { owner: 'npc:gone', item: 'missing' } },
    { playerIndicator: { id: 'unknown', eq: true } }] } as const;
  const issues = conditionIssues(invalid, sources).join('；');
  assert.match(issues, /剧情事件/);
  assert.match(issues, /道具/);
  assert.match(issues, /持有者/);
  assert.match(issues, /玩家指标/);
});

test('condition options come from saved sections, including items and story event UUIDs', () => {
  const sections = {
    'manifest.json': { content: JSON.stringify({ storyEvents: [{ id: 'event-one', label: '首次见面' }], periods: ['白天'] }) },
    'items.json': { content: JSON.stringify([{ id: 'item-one', name: '照片' }]) },
    'locations.json': { content: JSON.stringify([{ id: 'home', name: '家' }]) },
    'npcs/npc-one/base.json': { content: JSON.stringify({ id: 'npc-one', name: '苏念' }) },
    'npcs/npc-one/indicators.json': { content: JSON.stringify([{ id: 'affection', name: '好感', type: 'number' }]) },
  };
  const built = conditionSourcesFromSections(sections);
  assert.deepEqual(built.storyEvents, [{ id: 'event-one', label: '首次见面' }]);
  assert.deepEqual(built.items, [{ id: 'item-one', name: '照片' }]);
  assert.deepEqual(built.npcs[0].indicators?.[0].id, 'affection');
  assert.deepEqual(conditionIssues({ hasItem: { owner: 'npc:npc-one', item: 'item-one' } }, built), []);
});

test('advanced legacy leaves survive unrelated tree edits unchanged', () => {
  const original = { any: [{ flag: 'legacy' }, { stat: { scope: 'world', id: 'time', gte: 2 } }] } as const;
  const changed = patchCondition(original, [], { type: 'insert', index: 2, value: { storyEvent: 'event-one' } });
  assert.deepEqual((changed as { any: unknown[] }).any.slice(0, 2), original.any);
});

test('indicator comparisons reject operators incompatible with the indicator type', () => {
  assert.match(conditionIssues({ playerIndicator: { id: 'cursed', gte: 90 } }, sources).join('；'), /布尔指标/);
  assert.deepEqual(conditionIssues({ playerIndicator: { id: 'cursed', eq: true } }, sources), []);
});
