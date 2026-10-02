import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, createInitialState, evaluateCondition, makeView } from '../packages/engine/src/index.js';
import { settleWorld } from '../packages/engine/src/activity-log.js';
import { contentHashOf, listScripts, loadScript } from '../packages/script/src/index.js';

test('Su Nian moves through the online, restaurant and home scenes by rules', () => {
  const script = loadScript('sword-and-screen');
  assert.equal(script.locations.find((entry) => entry.id === script.startLocation)?.name, '电脑上');
  assert.equal(script.npcs[0].initialLocationId, script.startLocation);
  assert.equal(script.locations.find((entry) => entry.id === 'restaurant')?.visibleWhen !== undefined, true);
  const initial = createInitialState(script, { name: '阿言' });
  assert.equal(initial.npcLocations?.['su-nian'], script.startLocation);
  assert.deepEqual(makeView(script, initial).locations.map((entry) => entry.id), [script.startLocation]);
  const nearMeeting = structuredClone(initial);
  nearMeeting.npcIndicators!['su-nian'].affection.value = 30;
  const met = settleWorld(script, initial, nearMeeting, { kind: 'chat', summary: '交谈', npcId: 'su-nian' }).state;
  assert.equal(met.npcLocations?.['su-nian'], 'restaurant');
  assert.equal(makeView(script, met).locations.some((entry) => entry.id === 'restaurant'), true);
  const nearHome = structuredClone(met);
  nearHome.npcIndicators!['su-nian'].affection.value = 60;
  const home = settleWorld(script, met, nearHome, { kind: 'chat', summary: '交谈', npcId: 'su-nian' }).state;
  assert.equal(home.npcLocations?.['su-nian'], 'her-home');
  assert.equal(makeView(script, home).locations.some((entry) => entry.id === 'her-home'), true);
});

test('Su Nian confession records a reusable story event while once stays internal', () => {
  const script = loadScript('sword-and-screen');
  const initial = createInitialState(script, { name: '阿言' });
  const first = applyEvent(script, initial, 'confession');
  assert.equal(first.applied, true);
  assert.equal(first.state.storyEventFlags.length, 1);
  assert.equal(first.state.storyEventFlags[0].label, '首次告白');
  assert.equal(first.state.completedEvents.includes('confession'), true);
  assert.equal(applyEvent(script, first.state, 'confession-again').applied, true);
  const again = script.events.find((entry) => entry.id === 'confession-again')!;
  assert.equal(evaluateCondition(again.when, first.state, script), true);
});

test('catalog contains only the current Su Nian story', () => {
  assert.deepEqual(listScripts().map((script) => script.id), ['sword-and-screen']);
});

test('script content hash changes even when the version stays the same', () => {
  const first = loadScript('sword-and-screen');
  assert.match(first.contentHash ?? '', /^[a-f0-9]{64}$/);
  const changed = structuredClone(first);
  changed.locations[0].description += '另一版文字';
  assert.notEqual(first.contentHash, contentHashOf(changed));
});
