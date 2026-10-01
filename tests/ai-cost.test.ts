import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCosts } from '../apps/api/src/ai-cost.js';

test('turn costs include every call and retries, and unknown usage is not counted as free', () => {
  const rows = [
    { turnId: 'one', purpose: 'classify', usage: { promptTokens: 1000, cachedTokens: 800, completionTokens: 10 } },
    { turnId: 'one', purpose: 'generate', usage: { promptTokens: 2000, cachedTokens: 1500, completionTokens: 100 } },
    { turnId: 'one', purpose: 'generate', usage: null },
    { turnId: 'two', purpose: 'summarize', usage: { promptTokens: 100, completionTokens: 50 } },
  ];
  const report = summarizeCosts(rows, { input: 0.8, cached: 0.2, output: 1.5 });
  assert.equal(report[0].calls, 3);
  assert.equal(report[0].unknownUsageCalls, 1);
  assert.ok(Math.abs(report[0].estimatedUsd - 0.001185) < 1e-10);
  assert.equal(report[0].uncachedTokens, 700);
  assert.equal(report[1].unknownCacheCalls, 1);
  assert.ok(Math.abs(report[1].estimatedUsd - 0.000155) < 1e-10);
});
