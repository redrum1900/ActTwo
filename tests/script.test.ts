import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectScript, loadScript, parseScriptJson, serializeScript, validateScript } from '../packages/script/src/index.js';
import { createInitialState, deriveNpcSnapshot, makeView } from '../packages/engine/src/index.js';

test('a content package loads as one game script', () => {
  const script = loadScript('sword-and-screen');
  assert.equal(script.id, 'sword-and-screen');
  assert.equal(script.locations.length, 3);
  assert.equal(script.npcs.length, 1);
  assert.ok(script.events.length > 0);
  assert.ok(script.storyEvents.some((entry) => entry.label === '首次告白'));
});

test('story event definitions and references are validated before publishing', () => {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.storyEvents = [...script.storyEvents, { id: script.storyEvents[0].id, label: '重复', detail: '' }];
  assert.match(validateScript(script).join('；'), /剧情事件存在重复 ID/);
  script.storyEvents = script.storyEvents.slice(0, -1);
  script.storyEvents[0].label = '';
  assert.match(validateScript(script).join('；'), /剧情事件.*名称/);
  script.storyEvents[0].label = '有效名称';
  script.storyEvents[0].detail = 42 as unknown as string;
  assert.match(validateScript(script).join('；'), /剧情事件.*详情/);
  script.storyEvents[0].detail = '';
  script.endings[0].condition = { storyEvent: 'missing-event' };
  assert.match(validateScript(script).join('；'), /图鉴.*未知剧情事件 missing-event/);
  script.events[0].effects = [{ type: 'recordStoryEvent', eventId: 'missing-event' }];
  assert.match(validateScript(script).join('；'), /事件.*未知剧情事件 missing-event/);
});

test('new gallery entries without a condition cannot pass publication validation', () => {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.endings = [...script.endings, { id: 'new-ending', name: '新结局', description: '', condition: undefined as never }];
  assert.match(validateScript(script).join('；'), /图鉴 new-ending 缺少触发条件/);
});

test('item image references only accept controlled item-image URLs', () => {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.items[0].image = 'https://example.com/image.png';
  assert.match(validateScript(script).join('；'), /道具.*图片/);
  script.items[0].image = '/api/item-images/11111111-1111-4111-8111-111111111111';
  assert.equal(validateScript(script).some(message => message.includes('图片')), false);
});

test('validation rejects references to items that do not exist', () => {
  const script = loadScript('sword-and-screen');
  const broken = { ...structuredClone(script), npcs: script.npcs.map((npc, index) =>
    index === 0 ? { ...npc, initialItems: [...npc.initialItems, 'missing-item'] } : npc) };
  assert.match(validateScript(broken).join(' '), /missing-item/);
});

test('NPC directory parts assemble into one Su Nian definition', () => {
  const game = loadScript('sword-and-screen');
  assert.equal(game.npcs.length, 1);
  assert.equal(game.stats.some((entry) => entry.owner === 'npc' && entry.id === 'affection'), false);
  assert.ok(game.npcs[0].indicators?.some((entry) => entry.id === 'affection'));
  assert.equal(game.npcs[0].personas?.length, 7);
  assert.equal(game.npcs[0].initialLocationId, 'player-home');
  assert.ok(game.npcs[0].rules?.some((entry) => entry.id === 'confession'));
  assert.ok(game.npcs[0].lore?.some((entry) => entry.id === 'kendo'));
  const view = makeView(game, createInitialState(game, {}));
  assert.deepEqual(view.npcs[0].profile, []);
  assert.match(view.npcs[0].description, /游戏搭档/);
  assert.equal(game.guide, undefined);
  assert.equal(game.events.filter((entry) => entry.npc === 'su-nian').length, game.npcs[0].rules?.length);
});

test('Su Nian combines stable character facts with whichever conditional persona is current', () => {
  const game = loadScript('sword-and-screen');
  const state = createInitialState(game, {});
  const online = deriveNpcSnapshot(game, state, 'su-nian').persona;
  assert.match(online, /通用：.*游戏群认识/);
  assert.match(online, /屏幕两端：.*电脑/);
  state.npcIndicators!['su-nian'].metInPerson.value = true;
  const dinner = deriveNpcSnapshot(game, state, 'su-nian').persona;
  assert.match(dinner, /通用：.*游戏群认识/);
  assert.match(dinner, /初次见面：.*饭店/);
  assert.doesNotMatch(dinner, /屏幕两端：/);
});

test('common persona cannot have a condition', () => {
  const game = structuredClone(loadScript('sword-and-screen'));
  game.npcs[0].personas![0].when = { indicator: { id: 'affection', gte: 50 } };
  assert.match(validateScript(game).join('；'), /通用人格.*不能配置条件/);
});

test('duplicate item names and invalid condition shape report author-facing issues', () => {
  const game = structuredClone(loadScript('sword-and-screen'));
  game.items[1].name = game.items[0].name;
  const report = inspectScript(game);
  assert.ok(report.errors.some((issue) => issue.path === '$.items[1].name'));
  const broken = structuredClone(loadScript('sword-and-screen'));
  broken.locations[0].visibleWhen = { any: [] };
  assert.match(validateScript(broken).join(' '), /any 条件不能为空/);
});

test('canonical JSON export parses without losing split NPC data', () => {
  const game = loadScript('sword-and-screen');
  assert.deepEqual(parseScriptJson(serializeScript(game)), game);
});

test('new NPC configuration rejects unknown indicator and cross-NPC references', () => {
  const game = structuredClone(loadScript('sword-and-screen'));
  game.npcs[0].indicators = [{ id: 'affection', name: '好感', type: 'number', initial: 0, min: 0, max: 100, playerVisible: true }];
  game.npcs[0].personas = [{ id: 'online', name: '线上', content: '完整描述',
    when: { indicator: { npcId: 'missing-npc', id: 'affection', gte: 10 } } }];
  game.npcs[0].initialLocationId = 'missing-place';
  game.events = [...game.events, { id: 'broken-rule', npc: 'su-nian', intent: '测试', trigger: 'semantic',
    effects: [{ type: 'setIndicator', id: 'missing-indicator', value: true }] }];
  const errors = validateScript(game).join('；');
  assert.match(errors, /missing-npc/);
  assert.match(errors, /missing-place/);
  assert.match(errors, /missing-indicator/);
});

test('new indicator definitions reject duplicate IDs and impossible initial values', () => {
  const game = structuredClone(loadScript('sword-and-screen'));
  game.npcs[0].indicators = [...(game.npcs[0].indicators ?? []),
    { id: 'affection', name: '重复', type: 'number', initial: 120, min: 0, max: 100, playerVisible: true },
    { id: 'mood', name: '情绪', type: 'enum', initial: 'lost', options: ['calm'], playerVisible: false }];
  const errors = validateScript(game).join('；');
  assert.match(errors, /重复 ID/);
  assert.match(errors, /数值范围无效/);
  assert.match(errors, /选项无效/);
});

test('new rules reject effects and comparisons incompatible with indicator types', () => {
  const game = structuredClone(loadScript('sword-and-screen'));
  game.events = [...game.events, { id: 'wrong-type', npc: 'su-nian', intent: '测试', trigger: 'semantic',
    condition: { indicator: { id: 'metInPerson', gte: 3 } },
    effects: [{ type: 'changeIndicator', id: 'metInPerson', by: 5 },
      { type: 'setIndicator', id: 'affection', value: 'many' }] }];
  const errors = validateScript(game).join('；');
  assert.match(errors, /不是数字/);
  assert.match(errors, /效果.*类型不匹配/);
});
