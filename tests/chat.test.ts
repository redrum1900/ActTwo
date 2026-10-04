import test from 'node:test';
import assert from 'node:assert/strict';
import { runChat, deriveChatContext } from '../apps/api/src/modules/gameplay/chat-service.js';
import { selectChatMemory } from '../apps/api/src/modules/gameplay/chat-memory.js';
import { buildAIState } from '../apps/api/src/infrastructure/ai/ai-adapter.js';
import { createInitialState, deriveNpcSnapshot } from '../packages/engine/src/index.js';
import { loadScript } from '../packages/script/src/index.js';

const story = loadScript('sword-and-screen');

test('world book always and triggered entries follow explicit type while legacy entries retain keyword behavior', () => {
  const script = structuredClone(story);
  script.npcs[0].lore = [
    { id: 'always', name: '常驻', type: 'always', keywords: ['从未提到'], content: '常驻内容' },
    { id: 'triggered', name: '触发', type: 'triggered', keywords: ['剑道'], content: '触发内容' },
    { id: 'legacy-always', keywords: [], content: '旧常驻' },
    { id: 'legacy-triggered', keywords: ['摄影'], content: '旧触发' },
  ];
  const state = createInitialState(script, { name: '阿言' });
  const context = deriveChatContext(script, state, script.npcs[0], '今天好吗');
  assert.deepEqual(buildAIState(context).npc.relevantLore, ['常驻内容', '旧常驻']);
  assert.deepEqual(buildAIState({ ...context, text: '聊聊剑道和摄影' }).npc.relevantLore,
    ['常驻内容', '触发内容', '旧常驻', '旧触发']);
});

test('one structured reply triggers an NPC semantic event', async () => {
  const state = createInitialState(story, { name: '阿言' });
  let generated = 0; let rewritten = 0;
  const result = await runChat(story, state, 'su-nian', '我很在意你的感受', {
    mode: 'ai',
    generate: async () => { generated++; return { message: '嗯，我听到了。', proposedEventIds: ['close-talk'] }; },
    rewrite: async (_context, draft) => { rewritten++; return draft; },
  });
  assert.equal(generated, 1);
  assert.equal(rewritten, 0);
  assert.equal(result.state.npcIndicators?.['su-nian'].affection.value, 2);
  assert.equal(result.state.chats['su-nian'].length, 2);
  assert.equal(state.npcIndicators?.['su-nian'].affection.value, 0);
});

test('invalid requested event is rejected and cannot move an item', async () => {
  const state = createInitialState(story, { name: '阿言' });
  const result = await runChat(story, state, 'su-nian', '把御守给我', {
    mode: 'ai', generate: async () => ({ message: '给你。', proposedEventIds: ['charm-gift'] }),
    rewrite: async ({ rejectedIds }) => { assert.deepEqual(rejectedIds, ['charm-gift']); return '现在还不能给你。'; },
  });
  assert.equal(result.state.itemStates['kendo-charm'].owner, 'npc:su-nian');
  assert.equal(result.reply, '现在还不能给你。');
});

test('exclusive bonus proposals settle once without an unnecessary AI rewrite', async () => {
  const state = createInitialState(story, { name: '阿言' });
  state.locationId = 'restaurant';
  state.npcLocations!['su-nian'] = 'restaurant';
  state.npcIndicators!['su-nian'].metInPerson.value = true;
  state.unlockedLocations.push('restaurant');
  let rewrites = 0;
  const statuses: string[] = [];
  const result = await runChat(story, state, 'su-nian', '不用紧张，我们慢慢来', {
    mode: 'ai', generate: async () => ({ message: '她看着你，终于放松地笑了。',
      proposedEventIds: ['thoughtful', 'give-space-at-dinner'] }),
    rewrite: async () => { rewrites++; return '不应改写'; },
  }, { onStatus: (value) => statuses.push(value) });
  assert.equal(result.reply, '她看着你，终于放松地笑了。');
  assert.equal(rewrites, 0);
  assert.deepEqual(statuses, []);
  assert.equal(result.state.npcIndicators!['su-nian'].affection.value, 6);
  assert.deepEqual(result.state.ruleDiagnostics?.at(-1)?.rejected,
    [{ id: 'thoughtful', reason: 'exclusive_group' }]);
});

test('failed AI response leaves source state unchanged', async () => {
  const state = createInitialState(story, { name: '阿言' });
  await assert.rejects(runChat(story, state, 'su-nian', '你好', {
    mode: 'ai', generate: async () => { throw new Error('model offline'); }, rewrite: async () => '',
  }), /model offline/);
  assert.equal(state.npcIndicators?.['su-nian'].affection.value, 0);
  assert.equal(state.chats['su-nian'], undefined);
});

test('current NPC candidates do not include future-stage Su Nian events', () => {
  const game = loadScript('sword-and-screen');
  const state = createInitialState(game, { name: '阿言' });
  const context = deriveChatContext(game, state, game.npcs[0], '想看看你的御守');
  assert.equal(context.candidates.some((entry) => entry.id === 'charm-gift'), false);
  assert.equal(context.candidates.some((entry) => entry.id === 'ask-kendo'), false);
  const promptState = JSON.stringify(buildAIState(context));
  assert.equal(promptState.includes('老街饭店二楼靠窗'), false);
  assert.equal(promptState.includes('父母经常不在'), false);
  assert.equal(promptState.includes('练习剑道多年'), false);
  assert.equal(promptState.includes('剑道御守'), false);
  assert.equal(promptState.includes('basePersona'), false);
  assert.equal(promptState.includes('stage'), false);
  assert.ok(promptState.includes('屏幕两端'));
  assert.ok(promptState.includes('通过电脑线上聊天'));
  assert.equal(promptState.includes('effects'), false);
  assert.equal(context.candidates.some((entry) => entry.id === 'close-talk'), true);
});

test('hidden player state is absent from AI state and candidates until NPC knowledge is set', () => {
  const base = loadScript('sword-and-screen');
  const npc = { ...base.npcs[0], initialLocationId: 'player-home', indicators: [...(base.npcs[0].indicators ?? []),
    { id: 'knowsCurse', name: '知道诅咒', type: 'boolean' as const, initial: false, playerVisible: false }],
    personas: [{ id: 'common', name: '通用', content: '保持自然。' },
      { id: 'curse', name: '知道诅咒', when: { indicator: { id: 'knowsCurse', eq: true } }, content: '你知道玩家身上的诅咒。' }] };
  const script = { ...base, npcs: [npc], playerIndicators: [
    { id: 'curse', name: '诅咒', type: 'boolean' as const, initial: true, playerVisible: false }],
    events: [{ id: 'talk-curse', npc: npc.id, intent: '谈论诅咒', trigger: 'semantic' as const,
      candidateWhen: { indicator: { id: 'knowsCurse', eq: true } },
      when: { playerIndicator: { id: 'curse', eq: true } }, effects: [] }] };
  const state = createInitialState(script, { name: '阿言' });
  const before = deriveChatContext(script, state, npc, '怎么了');
  assert.equal(before.candidates.length, 0);
  assert.equal(JSON.stringify(buildAIState(before)).includes('诅咒'), false);
  state.npcIndicators![npc.id].knowsCurse.value = true;
  const after = deriveChatContext(script, state, npc, '怎么了');
  assert.deepEqual(after.candidates.map((entry) => entry.id), ['talk-curse']);
  assert.equal(JSON.stringify(buildAIState(after)).includes('你知道玩家身上的诅咒'), true);
});

test('NPC movement during a chat forces reconciliation before the final reply', async () => {
  const base = loadScript('sword-and-screen');
  const npc = { ...base.npcs[0], initialLocationId: 'player-home' };
  const script = { ...base, npcs: [npc],
    events: [{ id: 'go-away', npc: npc.id, intent: '离开', trigger: 'semantic' as const,
      effects: [{ type: 'moveNpc' as const, target: `npc:${npc.id}` as const, locationId: 'restaurant' }] }] };
  const state = createInitialState(script, { name: '阿言' });
  state.discoveredNpcs.push(npc.id);
  let rewrites = 0;
  const result = await runChat(script, state, npc.id, '你走吧', {
    mode: 'ai', generate: async () => ({ message: '我还在这里。', proposedEventIds: ['go-away'] }),
    rewrite: async () => { rewrites++; return '我先走了，回头再聊。'; },
  });
  assert.equal(rewrites, 1);
  assert.equal(result.reply, '我先走了，回头再聊。');
  assert.equal(result.state.npcLocations?.[npc.id], 'restaurant');
  assert.equal(result.state.chats[npc.id].at(-1)?.text, result.reply);
});

test('memory uses full short history and compresses long history without deleting raw messages', () => {
  const messages = Array.from({ length: 50 }, (_, index) => ({ id: `${index}`, role: index % 2 ? 'npc' as const : 'player' as const,
    text: index === 3 ? '旧照片藏在书架旁边' : `第${index}次谈话：${'日常内容'.repeat(30)}`, at: '2026-01-01' }));
  assert.equal(selectChatMemory(messages.slice(0, 3), [], '旧照片', 500).raw.length, 3);
  const selected = selectChatMemory(messages, [{ throughMessageId: '20', summary: '她曾谈到旧照片。' }], '那张旧照片在哪里', 1500);
  assert.equal(selected.compressed, true);
  assert.equal(selected.raw.at(-1)?.id, '49');
  assert.ok(selected.relevantExcerpts.some((entry) => entry.id === '3'));
  assert.equal(messages.length, 50);
});

test('same-turn indicator milestone is decided by the engine and reply keeps pre-turn persona', async () => {
  const game = loadScript('sword-and-screen');
  const state = createInitialState(game, { name: '阿言' });
  state.npcIndicators!['su-nian'].affection.value = 29;
  let revisions = 0;
  const statuses: string[] = [];
  const result = await runChat(game, state, 'su-nian', '我很在意你刚才的感受', {
    mode: 'ai', generate: async () => ({ message: '今晚在吗？', proposedEventIds: ['close-talk'] }),
    rewrite: async (context) => { revisions++;
      assert.equal(context.state.npcIndicators?.['su-nian'].metInPerson.value, true);
      assert.ok(JSON.stringify(buildAIState(context)).includes('屏幕两端'));
      return '……要不我们见一面？'; },
  }, { onStatus: (text) => statuses.push(text) });
  assert.equal(revisions, 1);
  assert.deepEqual(statuses, ['正在核对剧情结果…']);
  assert.equal(result.state.npcIndicators?.['su-nian'].metInPerson.value, true);
  assert.equal(result.state.npcIndicators?.['su-nian'].affection.value, 31);
  assert.equal(result.state.activityLog.at(-1)?.kind, 'chat');
  assert.ok(result.state.activityLog.at(-1)?.details.some((entry) => entry.kind === 'location_unlocked'));
});

test('a repeatable semantic event is reported and logged on every application', async () => {
  const game = loadScript('sword-and-screen');
  const adapter = { mode: 'demo' as const,
    generate: async () => ({ message: '我听见了。', proposedEventIds: ['close-talk'] }),
    rewrite: async (_context: unknown, draft: string) => draft };
  const first = await runChat(game, createInitialState(game, { name: '阿言' }), 'su-nian', '我很在意你的感受', adapter);
  const second = await runChat(game, first.state, 'su-nian', '我仍然在意你的感受', adapter);
  assert.equal(second.state.npcIndicators?.['su-nian'].affection.value, 4);
  assert.ok(second.appliedEvents.some((event) => event.id === 'close-talk'));
  assert.ok(second.state.activityLog.at(-1)?.details.some((entry) => entry.kind === 'event' && entry.entityId === 'close-talk'));
});

test('Su Nian keeps conditional psychological and behavioral details within each full persona', () => {
  const game = loadScript('sword-and-screen');
  const state = createInitialState(game, {});
  const initial = deriveNpcSnapshot(game, state, 'su-nian').persona;
  assert.equal(initial.includes('认真表达过心意'), false);
  state.npcIndicators!['su-nian'].relationshipTags.value = ['曾被表白'];
  const confessed = deriveNpcSnapshot(game, state, 'su-nian').persona;
  assert.ok(confessed.includes('认真表达过心意'));
  assert.ok(confessed.includes('撤回'));
  state.npcIndicators!['su-nian'].metInPerson.value = true;
  state.storyEventFlags.push(structuredClone(game.storyEvents.find((entry) => entry.label === '知道剑道秘密')!));
  const restaurant = deriveNpcSnapshot(game, state, 'su-nian').persona;
  assert.ok(restaurant.includes('主动谈训练'));
  state.npcIndicators!['su-nian'].visitedHerHome.value = true;
  state.itemStates['practice-note'].owner = 'player';
  state.storyEventFlags.push(structuredClone(game.storyEvents.find((entry) => entry.label === '获准阅读训练笔记')!));
  const home = deriveNpcSnapshot(game, state, 'su-nian').persona;
  assert.ok(home.includes('认真读过那本笔记'));
  assert.ok(home.includes('个人边界'));
});

test('creator diagnostics retain accepted and rejected semantic IDs without entering the player view', async () => {
  const game = loadScript('sword-and-screen');
  const result = await runChat(game, createInitialState(game, {}), 'su-nian', '你好', {
    mode: 'demo', generate: async () => ({ message: '嗯？', proposedEventIds: ['close-talk', 'charm-gift', 'not-configured'] }),
    rewrite: async (_context, draft) => draft,
  });
  const diagnostic = result.state.ruleDiagnostics?.at(-1);
  assert.deepEqual(diagnostic?.proposedIds, ['close-talk', 'charm-gift', 'not-configured']);
  assert.deepEqual(diagnostic?.acceptedIds, ['close-talk']);
  assert.deepEqual(diagnostic?.rejected.map((entry) => [entry.id, entry.reason]), [
    ['charm-gift', 'not_candidate'], ['not-configured', 'not_candidate'],
  ]);
  assert.equal(JSON.stringify(result.state.activityLog).includes('not-configured'), false);
});
