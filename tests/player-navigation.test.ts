import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerNavigation } from '../apps/web/src/app/player-navigation.js';

function browser(pathname: string) {
  const location = { pathname };
  const calls: [string, string][] = [];
  const listeners = new Map<string, () => void>();
  const history = {
    pushState(_state: unknown, _unused: string, path: string) { calls.push(['push', path]); location.pathname = path; },
    replaceState(_state: unknown, _unused: string, path: string) { calls.push(['replace', path]); location.pathname = path; },
  };
  return { location, history, calls, listeners,
    addEventListener(name: string, callback: () => void) { listeners.set(name, callback); },
    removeEventListener(name: string, _callback: () => void) { listeners.delete(name); },
  };
}

test('navigation pushes story pages and popstate follows browser history without pushing again', () => {
  const host = browser('/');
  const navigation = createPlayerNavigation(host);
  const seen: string[] = [];
  const unsubscribe = navigation.subscribe(() => seen.push(navigation.getSnapshot().kind));
  navigation.navigate({ kind: 'story-detail', storyId: 'sword' });
  assert.deepEqual(host.calls, [['push', '/games/sword']]);
  host.location.pathname = '/';
  host.listeners.get('popstate')?.();
  assert.deepEqual(seen, ['story-detail', 'catalog']);
  assert.deepEqual(host.calls, [['push', '/games/sword']]);
  unsubscribe(); navigation.dispose();
  assert.equal(host.listeners.size, 0);
});

test('legacy continue route replaces history entry with canonical play route', () => {
  const host = browser('/games/sword/continue');
  const navigation = createPlayerNavigation(host);
  assert.deepEqual(host.calls, [['replace', '/games/sword/play']]);
  assert.deepEqual(navigation.getSnapshot(), { kind: 'story-play', storyId: 'sword' });
  navigation.dispose();
});
