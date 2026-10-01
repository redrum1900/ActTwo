import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../apps/web/src/styles.css', import.meta.url), 'utf8');

test('catalog, subpages, and game expose sticky page headers', () => {
  assert.equal([...app.matchAll(/<header className="subpage-header">/g)].length, 3);
  assert.match(app, /<header className="site-header">/);
  assert.match(app, /<header className="game-header">/);
  assert.match(css, /\.site-header,\s*\.subpage-header,\s*\.game-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(css, /\.subpage-header\s*\{[^}]*background:\s*var\(--paper\);/s);
});
