import test from 'node:test';
import assert from 'node:assert/strict';
import { readAiFallbacks } from '../apps/api/src/infrastructure/ai/ai-config.js';
import { summarizeCosts } from '../apps/api/src/infrastructure/ai/ai-cost.js';
import { createAiAuditRouter } from '../apps/api/src/modules/usage/router.js';

test('AI integration keeps empty fallback configuration and empty cost report', () => {
  assert.deepEqual(readAiFallbacks({}), []);
  assert.deepEqual(summarizeCosts([], { input: 0.8, cached: 0.2, output: 1.5 }), []);
});

test('usage module exposes the same HTTP router factory', () => {
  assert.equal(typeof createAiAuditRouter({} as Parameters<typeof createAiAuditRouter>[0]), 'function');
});
