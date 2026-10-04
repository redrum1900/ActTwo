import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRuleEffect, retargetRuleEffect } from '../apps/web/src/creator/model/rule-effects.js';
import type { ConditionSources } from '../apps/web/src/creator/model/condition-tree.js';
import type { Effect } from '@game/contracts';

const sources: ConditionSources = {
  storyEvents: [{ id: 'event-1', label: '初见' }], items: [], npcs: [], locations: [], periods: [], playerFields: [], rules: [],
  storyIndicators: [{ id: 'score', name: '分数', type: 'number' }, { id: 'date', name: '日期', type: 'date' }],
  playerIndicators: [{ id: 'name', name: '称呼', type: 'text' }, { id: 'tags', name: '标签', type: 'tags' }],
};

test('new set effects and target changes use the selected indicator value type', () => {
  assert.deepEqual(makeRuleEffect('setIndicator', sources), { type: 'setIndicator', target: 'player', id: 'name', value: '' });
  const changed = retargetRuleEffect({ type: 'setIndicator', target: 'player', id: 'name', value: '阿言' }, sources, 'story', 'score');
  assert.deepEqual(changed, { type: 'setIndicator', target: 'story', id: 'score', value: 0 });
  assert.deepEqual(retargetRuleEffect(changed, sources, 'story', 'date'), { type: 'setIndicator', target: 'story', id: 'date', value: '' });
});

test('new tag and numeric effects select compatible indicators', () => {
  assert.deepEqual(makeRuleEffect('addIndicatorTag', sources), { type: 'addIndicatorTag', target: 'player', id: 'tags', tag: '' });
  assert.deepEqual(retargetRuleEffect(makeRuleEffect('changeIndicator', sources) as Extract<Effect, { type: 'changeIndicator' }>, sources, 'story'),
    { type: 'changeIndicator', target: 'story', id: 'score', by: 1 });
});
