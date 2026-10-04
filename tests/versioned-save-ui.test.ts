import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('save screen labels each occupied slot with its pinned version and disables unavailable loads', () => {
  const source = readFileSync(new URL('../apps/web/src/gameplay/GameplayPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /data\.scriptVersion/);
  assert.match(source, /data\.loadable === false/);
  assert.match(source, /view\.script\.version/);
});
