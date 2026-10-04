import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { playtestDeepLink, playtestPath } from '../apps/web/src/gameplay/playtest-client.js';
import PlaytestDrawer, { startPlaytestInNewTab } from '../apps/web/src/creator/workflows/PlaytestDrawer.js';

test('playtest deep link identifies its own immutable run', () => {
  assert.deepEqual(playtestDeepLink('/playtest/story/pt-1'), { projectId: 'story', playtestId: 'pt-1' });
  assert.deepEqual(playtestDeepLink('/playtest/story/pt-1/play'), { projectId: 'story', playtestId: 'pt-1' });
  assert.equal(playtestPath({ projectId: 'story', playtestId: 'pt-1' }), '/creator/projects/story/playtests/pt-1');
});

test('drawer lists newest run first and distinguishes an unstarted snapshot', () => {
  const html = renderToStaticMarkup(React.createElement(PlaytestDrawer, { projectId: 'story',
    onClose: () => {}, unsaved: false, records: [
      { id: 'old', projectId: 'story', createdAt: '2026-10-01', playedAt: null, started: true, scriptHash: 'a' },
      { id: 'new', projectId: 'story', createdAt: '2026-10-03', playedAt: null, started: false, scriptHash: 'b' },
    ] }));
  assert.ok(html.indexOf('new') < html.indexOf('old'));
  assert.match(html, /未开始/);
});

test('new playtest reserves a tab before awaiting creation', async () => {
  const order: string[] = [];
  const tab = { location: { href: '' }, close: () => order.push('close') };
  await startPlaytestInNewTab('story', {
    openBlank: () => { order.push('open'); return tab; },
    create: async () => { order.push('create'); return { id: 'pt-1' }; },
    refresh: async () => { order.push('refresh'); },
  });
  assert.deepEqual(order, ['open', 'create', 'refresh']);
  assert.equal(tab.location.href, '/playtest/story/pt-1');
});
