import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import AiUsagePage from '../apps/web/src/AiUsagePage.js';

test('usage page distinguishes account/admin and explains unknown usage without prices', () => {
  const own = renderToStaticMarkup(React.createElement(AiUsagePage));
  const admin = renderToStaticMarkup(React.createElement(AiUsagePage, { admin: true }));
  assert.match(own, /我的 AI 用量/);
  assert.match(own, /未知/);
  assert.doesNotMatch(own, /美元|费用|预估价格/);
  assert.match(admin, /用户 ID/);
  assert.match(admin, /全部 AI 调用/);
  assert.match(admin, /起始月份/);
  assert.match(admin, /type="month"/);
});

test('production server serves the usage deep link', () => {
  const source = readFileSync(new URL('../apps/api/src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.get\(\/\^\\\/usage/);
});
