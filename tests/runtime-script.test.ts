import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectScript, loadScript, validateScript } from '../packages/script/src/index.js';

test('new story package loads location access gates and optional player parts', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'game-dd-script-'));
  const game = path.join(root, 'fixture');
  const npc = path.join(game, 'npcs', 'guest');
  mkdirSync(npc, { recursive: true });
  const put = (file: string, value: unknown) => writeFileSync(path.join(game, file), JSON.stringify(value));
  try {
    put('manifest.json', { id: 'fixture', version: '1.0.0', title: 'Fixture', startLocation: 'screen', periods: ['夜晚'], storyEvents: [] });
    put('player-form.json', []);
    put('items.json', []);
    put('locations.json', [{ id: 'screen', name: '电脑上', description: '', interactionMode: 'online',
      visibleWhen: { flag: 'screen-visible' }, enterWhen: { flag: 'screen-enterable' }, spots: [] }]);
    put('endings.json', []);
    put('achievements.json', []);
    writeFileSync(path.join(npc, 'base.json'), JSON.stringify({ id: 'guest', name: '来客', description: '', initialLocationId: 'screen', initialItems: [] }));
    writeFileSync(path.join(npc, 'indicators.json'), JSON.stringify([]));
    writeFileSync(path.join(npc, 'personas.json'), JSON.stringify([{ id: 'common', name: '通用', content: '保持礼貌。' }]));
    writeFileSync(path.join(npc, 'rules.json'), JSON.stringify([]));
    const script = loadScript('fixture', root);
    assert.deepEqual(script.locations[0].enterWhen, { flag: 'screen-enterable' });
    assert.deepEqual(script.playerIndicators, []);
    assert.deepEqual(script.playerRules, []);
    assert.equal(script.npcs[0].initialLocationId, 'screen');
    assert.equal(script.locations[0].interactionMode, 'online');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('location access gates validate inside their own definition', () => {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.locations[0].enterWhen = { playerIndicator: { id: 'missing', eq: true } };
  assert.ok(validateScript(script).some((entry) => entry.includes('player-home') && entry.includes('missing')));
});

test('unknown cross-target NPC is reported at its effect path', () => {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.events = script.events.map((event, index) => index === 0 ? { ...event,
    effects: [{ type: 'changeIndicator' as const, target: 'npc:missing' as const, id: 'affection', by: 1 }] } : event);
  const issues = inspectScript(script);
  assert.ok(issues.warnings.some((entry) => entry.path.includes('events[0].effects[0].target') && entry.message.includes('missing')));
});

test('player rules validate self and explicit NPC indicator targets', () => {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.playerIndicators = [{ id: 'cursed', name: '诅咒', type: 'boolean', initial: false, playerVisible: false }];
  script.playerRules = [{ id: 'curse-discovery', intent: '受到诅咒', trigger: 'automatic', effects: [
    { type: 'setIndicator', id: 'cursed', value: true },
    { type: 'setIndicator', target: 'npc:su-nian', id: 'metInPerson', value: true },
  ] }];
  assert.deepEqual(validateScript(script), []);
});

test('player indicator comparisons and initial values are type checked', () => {
  const script = structuredClone(loadScript('sword-and-screen'));
  script.playerIndicators = [
    { id: 'curse', name: '诅咒', type: 'boolean', initial: false, playerVisible: false },
    { id: 'energy', name: '精力', type: 'number', initial: 99, min: 0, max: 10, playerVisible: true },
  ];
  script.playerRules = [{ id: 'wrong-player-rule', intent: '错误类型', trigger: 'automatic',
    when: { playerIndicator: { id: 'curse', gte: 5 } }, effects: [] }];
  const errors = validateScript(script).join('；');
  assert.match(errors, /玩家指标 energy 数值范围无效/);
  assert.match(errors, /玩家指标 curse 不是数字/);
});
