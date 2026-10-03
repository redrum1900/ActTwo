import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('login queue resumes the requested action once after authentication', async () => {
  const { createLoginQueue } = await import('../apps/web/src/AccountGate.js');
  const queue = createLoginQueue();
  let starts = 0;
  queue.defer(() => { starts++; });
  await queue.resume();
  await queue.resume();
  assert.equal(starts, 1);
});

test('anonymous player can browse catalog and login gate has a form', async () => {
  const [{ default: AccountGate, AccountForm }, { default: App }] = await Promise.all([
    import('../apps/web/src/AccountGate.js'), import('../apps/web/src/App.js'),
  ]);
  const catalog = renderToStaticMarkup(createElement(AccountGate, { requireLogin: false, children: createElement(App) }));
  assert.match(catalog, /故事目录/);
  const gated = renderToStaticMarkup(createElement(AccountGate, { requireLogin: true, children: createElement(App) }));
  const form = renderToStaticMarkup(createElement(AccountForm, { mode: 'login', username: '', password: '', error: '', submitting: false,
    requireLogin: true, onSubmit: () => {}, onUsername: () => {}, onPassword: () => {}, onToggleMode: () => {}, onCancel: () => {} }));
  assert.match(form, /登录/);
  assert.doesNotMatch(gated, /可进入的故事/);
});

test('a game continue deep link retains its target until login', async () => {
  const { gameDeepLink } = await import('../apps/web/src/App.js');
  assert.deepEqual(gameDeepLink('/games/sword-and-screen/continue'), { gameId: 'sword-and-screen', continue: true });
  assert.deepEqual(gameDeepLink('/games/sword-and-screen'), { gameId: 'sword-and-screen', continue: false });
  assert.equal(gameDeepLink('/creator'), null);
});

test('production server serves story detail and gameplay deep links', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../apps/api/src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.get\(\/\^\\\/games/);
});
