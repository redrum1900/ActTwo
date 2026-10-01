import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheFriendlyParts } from '../apps/api/src/ai-adapter.js';
import { deriveChatContext } from '../apps/api/src/chat-service.js';
import { loadScript } from '../packages/script/src/index.js';
import { createInitialState } from '../packages/engine/src/index.js';

test('fixed prompt is unchanged by affection, inventory and once-rule eligibility; dynamic state stays accurate', () => {
  const script = loadScript('sword-and-screen');
  const state = createInitialState(script, { name: '测试' });
  const first = buildCacheFriendlyParts(deriveChatContext(script, state, script.npcs[0], '你好'));
  state.npcIndicators!['su-nian'].affection.value = 22;
  state.completedEvents.push('confession');
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
