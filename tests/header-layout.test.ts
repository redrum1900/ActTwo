import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const catalog = readFileSync(new URL('../apps/web/src/StoryCatalogPage.tsx', import.meta.url), 'utf8');
const detail = readFileSync(new URL('../apps/web/src/StoryDetailPage.tsx', import.meta.url), 'utf8');
const gameplay = readFileSync(new URL('../apps/web/src/GameplayPage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/web/src/styles.css', import.meta.url), 'utf8');

test('catalog, subpages, and game expose sticky page headers', () => {
  assert.ok([...detail.matchAll(/<header className="subpage-header">/g)].length >= 3);
  assert.match(catalog, /<header className="site-header">/);
  assert.match(gameplay, /<header className="game-header">/);
  assert.match(css, /\.site-header,\s*\.subpage-header,\s*\.game-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(css, /\.subpage-header\s*\{[^}]*background:\s*var\(--paper\);/s);
});
