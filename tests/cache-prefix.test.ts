import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAIState, buildCacheFriendlyParts } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { deriveChatContext } from '../apps/api/src/modules/gameplay/chat-service.js';
import { loadScript } from '../packages/script/src/index.js';
import { createInitialState } from '../packages/engine/src/index.js';

test('fixed prompt is unchanged by affection, inventory and once-rule eligibility; dynamic state stays accurate', () => {
  const script = loadScript('sword-and-screen');
  const state = createInitialState(script, { name: '测试' });
  const first = buildCacheFriendlyParts(deriveChatContext(script, state, script.npcs[0], '你好'));
  state.npcIndicators!['su-nian'].affection.value = 22;
  state.completedEvents.push('confession');
  state.storyEventFlags.push(structuredClone(script.storyEvents.find((entry) => entry.label === '首次告白')!));
  const second = buildCacheFriendlyParts(deriveChatContext(script, state, script.npcs[0], '这里是？'));
  assert.equal(first.fixed, second.fixed);
  assert.equal(second.snapshot.npc.indicators.affection, 22);
  assert.equal(second.allowedRuleIds.includes('confession'), false);
  assert.equal(second.allowedRuleIds.includes('confession-again'), true);
  assert.equal(second.fixed.includes('confession-again'), false);
  assert.equal(second.dynamicRules.some(entry => entry.id === 'confession-again'), true);
  assert.equal(second.snapshot.npc.persona.includes('通用：'), false);
  assert.equal(second.fixed.includes('苏念20岁'), true);
  assert.equal(first.fixed.includes('charm-gift'), false);
  assert.equal(JSON.stringify(first).includes('父母经常不在'), false);
  assert.equal(first.fixed.includes('"effects"'), false);
});

test('AI inventory summarizes item ownership without item tags', () => {
  const script = loadScript('sword-and-screen');
  const state = createInitialState(script, {});
  state.itemStates['practice-note'].owner = 'player';
  state.playerItems['practice-note'] = 1;
  const context = deriveChatContext(script, state, script.npcs[0], '你好');
  const inventory = buildAIState(context).player.inventory;
  assert.equal(inventory.some(item => item.name === '训练笔记'), true);
  assert.equal(inventory.every(item => !Object.hasOwn(item, 'tags')), true);
});
