import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectScriptParts, scriptPartsFromScript } from '@game/script/parts';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';
import { applyEvent, createInitialState, makeView } from '@game/engine';
import { settleWorld } from '@game/engine/activity-log';

test('redesigned Sword story is valid and keeps the online-to-home arc', () => {
  const report = inspectScriptParts(scriptPartsFromScript(swordStoryV2, swordStoryV2.id, swordStoryV2.title));
  assert.deepEqual(report.errors, []);
  assert.ok(report.script);
  assert.equal(report.script.locations.length, 3);
  assert.equal(report.script.npcs[0]?.initialLocationId, 'player-home');
  assert.ok(report.script.npcs[0]?.rules?.some(rule => rule.id === 'meet-at-restaurant'));
  assert.ok(report.script.npcs[0]?.rules?.some(rule => rule.id === 'invite-home'));
  assert.ok(report.script.storyIndicators?.some(indicator => indicator.systemRole === 'onceRules'));
});

test('redesigned mainline unlocks meeting then home through automatic rules', () => {
  const script = inspectScriptParts(scriptPartsFromScript(swordStoryV2, swordStoryV2.id, swordStoryV2.title)).script!;
  const initial = createInitialState(script, { name: '阿言', birthday: '2000-01-01', playStyle: 'team' });
  const readyToMeet = structuredClone(initial);
  readyToMeet.npcIndicators!['su-nian'].affection.value = 30;
  const met = settleWorld(script, initial, readyToMeet,
    { kind: 'chat', summary: '认真交谈', npcId: 'su-nian' }).state;
  assert.equal(met.npcLocations?.['su-nian'], 'restaurant');
  assert.ok(makeView(script, met).locations.some(location => location.id === 'restaurant'));
  const readyToVisit = structuredClone(met);
  readyToVisit.npcIndicators!['su-nian'].affection.value = 60;
  const home = settleWorld(script, met, readyToVisit,
    { kind: 'chat', summary: '继续交谈', npcId: 'su-nian' }).state;
  assert.equal(home.npcLocations?.['su-nian'], 'her-home');
  assert.ok(home.storyEventFlags.some(flag => flag.id === 'bec69731-5114-4fa4-a38c-83b1b51f6da1'));
});

test('new relationship bonuses write their rule IDs to the single-use story indicator', () => {
  const script = inspectScriptParts(scriptPartsFromScript(swordStoryV2, swordStoryV2.id, swordStoryV2.title)).script!;
  const state = createInitialState(script, { name: '阿言', birthday: '2000-01-01', playStyle: 'team' });
  const first = applyEvent(script, state, 'honest-care');
  assert.equal(first.applied, true);
  assert.equal(first.state.storyIndicators?.onceRuleIds?.value instanceof Array, true);
  assert.ok((first.state.storyIndicators?.onceRuleIds?.value as string[]).includes('honest-care'));
  assert.equal(applyEvent(script, first.state, 'honest-care').applied, false);
});
