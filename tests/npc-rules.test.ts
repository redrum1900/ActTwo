import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameScript } from '../packages/contracts/src/index.js';
import { applyEvent, createInitialState, evaluateCondition, settlePlayerEvents, runAutomaticRules } from '../packages/engine/src/index.js';

const script: GameScript = {
  id: 'indicator-test', version: '1', title: '测试', startLocation: 'home', periods: ['白天'],
  playerFields: [], stats: [], items: [{ id: 'gift', name: '礼物' }],
  locations: [{ id: 'home', name: '家', description: '', spots: [] }],
  npcs: [
    { id: 'a', name: '甲', description: '', personas: [], initialLocationId: 'home', initialItems: [], indicators: [
      { id: 'affection', name: '好感', type: 'number', initial: 20, min: 0, max: 100, playerVisible: true },
      { id: 'met', name: '见面', type: 'boolean', initial: false, playerVisible: false, writeOnceTrue: true },
      { id: 'mood', name: '心情', type: 'enum', initial: 'calm', options: ['calm', 'shy'], playerVisible: false },
      { id: 'tags', name: '标签', type: 'tags', initial: ['online'], playerVisible: false },
      { id: 'note', name: '备注', type: 'text', initial: '', playerVisible: false },
    ] },
    { id: 'b', name: '乙', description: '', personas: [], initialLocationId: 'home', initialItems: [], indicators: [
      { id: 'trust', name: '信任', type: 'number', initial: 40, min: 0, max: 100, playerVisible: false },
    ] },
  ],
  events: [
    { id: 'gain-only', npc: 'a', intent: '亲近', trigger: 'semantic', effects: [{ type: 'changeIndicator', id: 'affection', by: 15 }] },
    { id: 'open-up', npc: 'a', intent: '亲近', trigger: 'semantic', effects: [
      { type: 'changeIndicator', id: 'affection', by: 15 },
      { type: 'setIndicator', id: 'met', value: true },
      { type: 'setIndicatorVisibility', id: 'met', visible: true },
      { type: 'addIndicatorTag', id: 'tags', tag: 'trusting' },
    ] },
    { id: 'invalid-rollback', npc: 'a', intent: '无效', trigger: 'semantic', effects: [
      { type: 'changeIndicator', id: 'affection', by: 10 },
      { type: 'setIndicator', id: 'mood', value: 'unknown' },
    ] },
    { id: 'reverse', npc: 'a', intent: '倒退', trigger: 'semantic', effects: [{ type: 'setIndicator', id: 'met', value: false }] },
    { id: 'cross', npc: 'a', intent: '跨角色', trigger: 'semantic', condition: { indicator: { npcId: 'b', id: 'trust', gte: 40 } },
      effects: [{ type: 'changeIndicator', npcId: 'b', id: 'trust', by: 2 }] },
    { id: 'when-alias', npc: 'a', intent: '条件', trigger: 'semantic',
      when: { indicator: { id: 'affection', gte: 30 } },
      effects: [{ type: 'setIndicator', id: 'mood', value: 'shy' }] },
    { id: 'late-gate', npc: 'a', intent: '后置门槛', trigger: 'semantic', condition: { indicator: { id: 'affection', gte: 30 } },
      effects: [{ type: 'setIndicator', id: 'mood', value: 'shy' }] },
    { id: 'action-only', npc: 'a', intent: '只允许操作触发', trigger: 'action',
      effects: [{ type: 'changeIndicator', id: 'affection', by: 50 }] },
    { id: 'auto-met', npc: 'a', intent: '见面', trigger: 'automatic', once: true,
      condition: { indicator: { id: 'affection', gte: 30 } }, effects: [{ type: 'setIndicator', id: 'met', value: true }] },
    { id: 'auto-note', npc: 'a', intent: '备注', trigger: 'automatic', once: true,
      condition: { indicator: { id: 'met', eq: true } }, effects: [{ type: 'setIndicator', id: 'note', value: '已见面' }] },
  ], endings: [], achievements: [],
};

test('indicator conditions compose and read another NPC by explicit ID', () => {
  const state = createInitialState(script, {});
  assert.equal(evaluateCondition({ all: [
    { indicator: { npcId: 'a', id: 'affection', gte: 20, lte: 30 } },
    { indicator: { npcId: 'b', id: 'trust', eq: 40 } },
    { not: { indicator: { npcId: 'a', id: 'met', eq: true } } },
    { indicator: { npcId: 'a', id: 'tags', has: 'online' } },
  ] }, state, script), true);
  assert.equal(evaluateCondition({ indicator: { npcId: 'missing', id: 'trust', eq: 40 } }, state, script), false);
});

test('semantic gates read the turn-start state and automatic rules run one layer', () => {
  const initial = createInitialState(script, {});
  const semantic = settlePlayerEvents(script, initial, 'a', ['gain-only', 'late-gate']);
  assert.deepEqual(semantic.applied.map((event) => event.id), ['gain-only']);
  assert.equal(semantic.state.npcIndicators?.a.mood.value, 'calm');
  const automatic = runAutomaticRules(script, semantic.state, 'chat');
  assert.deepEqual(automatic.appliedIds, ['auto-met']);
  assert.equal(automatic.state.npcIndicators?.a.note.value, '');
  const nextTurn = runAutomaticRules(script, automatic.state, 'chat');
  assert.deepEqual(nextTurn.appliedIds, ['auto-note']);
});

test('indicator effects change typed values and visibility while invalid bundles roll back', () => {
  const original = createInitialState(script, {});
  const valid = applyEvent(script, original, 'open-up');
  assert.equal(valid.applied, true);
  assert.equal(valid.state.npcIndicators?.a.affection.value, 35);
  assert.deepEqual(valid.state.npcIndicators?.a.tags.value, ['online', 'trusting']);
  assert.deepEqual(valid.state.npcIndicators?.a.met, { value: true, playerVisible: true });
  assert.equal(original.npcIndicators?.a.affection.value, 20);
  assert.equal(applyEvent(script, valid.state, 'invalid-rollback').applied, false);
  assert.equal(valid.state.npcIndicators?.a.affection.value, 35);
  assert.equal(applyEvent(script, valid.state, 'reverse').applied, false);
  assert.equal(applyEvent(script, original, 'cross').state.npcIndicators?.b.trust.value, 42);
});

test('author-facing when condition gates a rule before effects', () => {
  const initial = createInitialState(script, {});
  assert.equal(applyEvent(script, initial, 'when-alias').applied, false);
  initial.npcIndicators!.a.affection.value = 30;
  assert.equal(applyEvent(script, initial, 'when-alias').state.npcIndicators?.a.mood.value, 'shy');
});

test('chat proposals cannot invoke action rules', () => {
  const initial = createInitialState(script, {});
  const settled = settlePlayerEvents(script, initial, 'a', ['action-only']);
  assert.deepEqual(settled.applied, []);
  assert.equal(settled.state.npcIndicators?.a.affection.value, 20);
});

test('automatic rules in one exclusive group apply only the highest priority match', () => {
  const withChoices: GameScript = { ...script, events: [
    { id: 'automatic-low', npc: 'a', intent: '低优先级', trigger: 'automatic', priority: 1, exclusiveGroup: 'choice', once: true,
      effects: [{ type: 'setIndicator', id: 'note', value: '低' }] },
    { id: 'automatic-high', npc: 'a', intent: '高优先级', trigger: 'automatic', priority: 2, exclusiveGroup: 'choice', once: true,
      effects: [{ type: 'setIndicator', id: 'note', value: '高' }] },
  ] };
  const settled = runAutomaticRules(withChoices, createInitialState(withChoices, {}), 'chat');
  assert.deepEqual(settled.appliedIds, ['automatic-high']);
  assert.equal(settled.state.npcIndicators?.a.note.value, '高');
});
