import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewImport } from '../apps/api/src/modules/creator/import/import-review.js';

const parts = { 'manifest.json': '{"title":"秋日"}', 'npcs/lin/personas.json': '[{"content":"她曾经去过海边"}]' };

test('review reports located concerns and does not mutate generated parts', async () => {
  const before = structuredClone(parts);
  const ai = { complete: async () => JSON.stringify({ findings: [{
    path: 'npcs/lin/personas.json', sourceEvidence: '原文只说想去海边',
    concern: '把愿望写成既成事实', suggestion: '改成想去海边', uncertainty: false,
  }] }) };
  const result = await reviewImport('林秋想去海边', parts, ai);
  assert.equal(result.status, 'complete');
  assert.equal(result.findings[0]?.uncertainty, false);
  assert.deepEqual(parts, before);
});

test('unsupported claims are marked as needing confirmation', async () => {
  const ai = { complete: async () => JSON.stringify({ findings: [{
    path: 'manifest.json', sourceEvidence: '', concern: '可能不符合原文', suggestion: '请核实', uncertainty: false,
  }] }) };
  const result = await reviewImport('素材', parts, ai);
  assert.equal(result.findings[0]?.uncertainty, true);
});

test('review outage is non-destructive and visible', async () => {
  const ai = { complete: async () => { throw new Error('provider failed'); } };
  assert.deepEqual(await reviewImport('素材', parts, ai), { status: 'unavailable', findings: [] });
});

test('review batches small sections while checking the original source tail', async () => {
  const calls: string[] = [];
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`npcs/n${index}/base.json`, '{}']));
  const ai = { complete: async (_system: string, user: string) => { calls.push(user); return '{"findings":[]}'; } };
  const result = await reviewImport(`${'甲'.repeat(20_010)}原文末尾秘密`, many, ai);
  assert.equal(result.status, 'complete');
  assert.ok(calls.length < 30);
  assert.ok(calls.some(call => call.includes('原文末尾秘密')));
});
