import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from '../packages/script/src/index.js';
import { assembleScriptParts, blankScriptParts, inspectScriptParts, scriptPartsFromScript } from '../packages/script/src/parts.js';
import * as partModule from '../packages/script/src/parts.js';

const migrateLegacyStatsParts = (partModule as typeof partModule & { migrateLegacyStatsParts?: (parts: Record<string, string>) => Record<string, string> }).migrateLegacyStatsParts;
const removeLegacyConditionParts = (partModule as typeof partModule & { removeLegacyConditionParts?: (parts: Record<string, string>) => Record<string, string> }).removeLegacyConditionParts;

test('old creator predicates are removed from nested draft conditions and empty triggers stay blocked', () => {
  const parts = blankScriptParts('cleanup', '清理旧条件');
  parts['achievements.json'] = JSON.stringify([{ id: 'a', name: '成就', description: '', condition: { flag: 'knows-kendo' } }]);
  parts['endings.json'] = JSON.stringify([{ id: 'b', name: '结局', description: '', condition: { all: [
    { storyEvent: 'new-event' }, { flag: 'knows-kendo' }, { not: { completedEvent: 'old-rule' } },
  ] } }]);
  parts['npcs/character/rules.json'] = JSON.stringify([{ id: 'r', intent: '规则', trigger: 'automatic', when: { tag: 'old' }, effects: [] }]);
  const original = structuredClone(parts);
  assert.ok(removeLegacyConditionParts);
  const cleaned = removeLegacyConditionParts(parts);
  assert.deepEqual(JSON.parse(cleaned['achievements.json'])[0].condition, { any: [] });
  assert.deepEqual(JSON.parse(cleaned['endings.json'])[0].condition, { all: [{ storyEvent: 'new-event' }] });
  assert.deepEqual(JSON.parse(cleaned['npcs/character/rules.json'])[0].when, { any: [] });
  assert.deepEqual(parts, original);
});

test('author drafts cannot submit obsolete predicates through JSON mode', () => {
  const parts = blankScriptParts('old-gate', '旧条件');
  parts['achievements.json'] = JSON.stringify([{ id: 'a', name: '旧成就', description: '', condition: { flag: 'knows-kendo' } }]);
  assert.ok(inspectScriptParts(parts).errors.some(issue => issue.path === 'achievements.json' && issue.message.includes('旧条件')));
});

test('blank creator package assembles to a playable story with one character', () => {
  const parts = blankScriptParts('new-story', '新故事');
  const script = assembleScriptParts(parts);
  assert.equal(script.id, 'new-story');
  assert.equal(script.npcs.length, 1);
  assert.equal(script.npcs[0].initialLocationId, script.startLocation);
  assert.deepEqual(script.periods, ['白天', '下午', '晚上']);
  assert.deepEqual(script.storyEvents, []);
  assert.deepEqual(JSON.parse(parts['manifest.json']).storyEvents, []);
  assert.ok(script.contentHash);
  const storyIndicators = JSON.parse(parts['story/indicators.json']);
  assert.equal(storyIndicators.length, 1);
  assert.match(storyIndicators[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(storyIndicators[0].systemRole, 'onceRules');
  assert.deepEqual(storyIndicators[0].initial, []);
  assert.deepEqual(script.storyIndicators, storyIndicators);
});

test('story indicators survive draft assembly and copy with stable ids', () => {
  const parts = blankScriptParts('indicator-story', '指标');
  const indicators = JSON.parse(parts['story/indicators.json']);
  indicators.push({ id: 'weather', name: '天气', description: '当天的天气', type: 'text', initial: '晴', playerVisible: false });
  parts['story/indicators.json'] = JSON.stringify(indicators);
  const script = assembleScriptParts(parts);
  assert.equal(script.storyIndicators?.[1].id, 'weather');
  assert.deepEqual(JSON.parse(scriptPartsFromScript(script, 'copy', '副本')['story/indicators.json']), indicators);
});

test('new story can remove every opening question and still assemble', () => {
  const parts = blankScriptParts('no-questions', '直接开始');
  parts['player-form.json'] = '[]';
  assert.deepEqual(assembleScriptParts(parts).playerFields, []);
});

test('legacy stat migration rewrites definitions, conditions and effects without changing existing ids', () => {
  const parts = blankScriptParts('migrated-stats', '迁移');
  parts['stats.json'] = JSON.stringify([{ id: 'score', owner: 'world', name: '总分', initial: 2, min: 0, max: 100 }]);
  parts['player/rules.json'] = JSON.stringify([{ id: 'bonus', intent: '加分', trigger: 'automatic', when: { stat: { scope: 'world', id: 'score', gte: 2 } },
    effects: [{ type: 'changeStat', scope: 'world', id: 'score', by: 1 }] }]);
  assert.ok(migrateLegacyStatsParts, 'stats migration should exist');
  const migrated = migrateLegacyStatsParts(parts);
  assert.deepEqual(JSON.parse(migrated['stats.json']), []);
  assert.equal(JSON.parse(migrated['story/indicators.json']).find((entry: { id: string }) => entry.id === 'score').initial, 2);
  const rule = JSON.parse(migrated['player/rules.json'])[0];
  assert.deepEqual(rule.when, { storyIndicator: { id: 'score', gte: 2 } });
  assert.deepEqual(rule.effects, [{ type: 'changeIndicator', target: 'story', id: 'score', by: 1 }]);
  assert.deepEqual(JSON.parse(parts['stats.json']), [{ id: 'score', owner: 'world', name: '总分', initial: 2, min: 0, max: 100 }]);
});

test('legacy stat migration rejects ID collisions without changing original parts', () => {
  const parts = blankScriptParts('collision-stats', '冲突');
  parts['stats.json'] = JSON.stringify([{ id: 'score', owner: 'world', initial: 0, min: 0, max: 100 }]);
  parts['story/indicators.json'] = JSON.stringify([...JSON.parse(parts['story/indicators.json']),
    { id: 'score', name: '已有分数', type: 'number', initial: 0, min: 0, max: 100, playerVisible: false }]);
  const original = structuredClone(parts);
  assert.ok(migrateLegacyStatsParts, 'stats migration should exist');
  assert.throws(() => migrateLegacyStatsParts(parts), /score.*冲突/);
  assert.deepEqual(parts, original);
});

test('drafts with legacy stats report a migration action before publication', () => {
  const parts = blankScriptParts('legacy-draft', '旧草稿');
  parts['stats.json'] = JSON.stringify([{ id: 'score', owner: 'world', initial: 0, min: 0, max: 10 }]);
  assert.ok(inspectScriptParts(parts).errors.some(issue => issue.path === 'stats.json' && issue.message.includes('迁移')));
});

test('sample story can be copied under another immutable story ID', () => {
  const parts = scriptPartsFromScript(loadScript('sword-and-screen'), 'copy-story', '我的改编');
  const script = assembleScriptParts(parts);
  assert.equal(script.id, 'copy-story');
  assert.equal(script.title, '我的改编');
  assert.equal(script.npcs[0].id, 'su-nian');
  assert.equal(script.events.length, loadScript('sword-and-screen').events.length);
  assert.deepEqual(script.storyEvents, loadScript('sword-and-screen').storyEvents);
});

test('malformed or broken sections show their path and cannot publish', () => {
  const parts = blankScriptParts('broken-story', '草稿');
  parts['items.json'] = '[';
  assert.ok(inspectScriptParts(parts).errors.some(issue => issue.path === 'items.json'));
  assert.throws(() => assembleScriptParts(parts), /items.json/);
  parts['items.json'] = '[]';
  parts['npcs/character/base.json'] = JSON.stringify({ id: 'character', name: '角色', description: '',
    initialLocationId: 'missing-location', initialItems: [] });
  assert.ok(inspectScriptParts(parts).errors.some(issue => issue.message.includes('missing-location')));
});

test('a location item without conditions is valid and has no false blocked-taking warning', () => {
  const parts = blankScriptParts('free-item-story', '自由道具');
  parts['items.json'] = JSON.stringify([{ id: 'letter', name: '信' }]);
  parts['locations.json'] = JSON.stringify([{ id: 'start', name: '起点', description: '', spots: [], items: [{ item: 'letter' }] }]);
  const report = inspectScriptParts(parts);
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.some(issue => issue.path.includes('takeWhen')), false);
});

test('obsolete item-tag fields and effects report their exact authoring paths', () => {
  const parts = blankScriptParts('legacy-tags', '旧标签');
  parts['items.json'] = JSON.stringify([{ id: 'note', name: '笔记', initialTags: ['旧'], hiddenTags: ['秘密'],
    variants: [{ when: { hasItem: { owner: 'player', item: 'note', tags: ['已读'] } }, detail: '已读' }] }]);
  parts['npcs/character/rules.json'] = JSON.stringify([{ id: 'read', intent: '阅读', trigger: 'semantic',
    effects: [{ type: 'addItemTag', item: 'note', tag: '已读' }] }]);
  const issues = inspectScriptParts(parts).errors;
  assert.ok(issues.some(issue => issue.path === '$.items[0].initialTags'));
  assert.ok(issues.some(issue => issue.path === '$.items[0].hiddenTags'));
  assert.ok(issues.some(issue => issue.path === '$.items[0].variants[0].when.hasItem.tags'));
  assert.ok(issues.some(issue => issue.path === '$.events[0].effects[0]'));
});
