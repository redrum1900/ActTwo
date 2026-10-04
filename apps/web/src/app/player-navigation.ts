import { useMemo, useSyncExternalStore } from 'react';
import { parsePlayerRoute, playerRoutePath, type PlayerRoute } from './player-route.js';

interface NavigationHost {
  location: { pathname: string };
  history: { pushState(state: unknown, unused: string, path: string): void; replaceState(state: unknown, unused: string, path: string): void };
  addEventListener(name: string, callback: () => void): void;
  removeEventListener(name: string, callback: () => void): void;
}

export function createPlayerNavigation(host: NavigationHost) {
  const listeners = new Set<() => void>();
  const resolve = () => {
    const parsed = parsePlayerRoute(host.location.pathname);
    if (parsed.canonicalPath) host.history.replaceState(null, '', parsed.canonicalPath);
    return parsed.route;
  };
  let current = resolve();
  let listening = false;
  const changed = () => {
    current = resolve();
    for (const callback of listeners) callback();
  };
  const subscribe = (callback: () => void) => {
    listeners.add(callback);
    if (!listening) { host.addEventListener('popstate', changed); listening = true; }
    return () => {
      listeners.delete(callback);
      if (listening && listeners.size === 0) { host.removeEventListener('popstate', changed); listening = false; }
    };
  };
  return {
    getSnapshot: (): PlayerRoute => current,
    subscribe,
    navigate: (route: PlayerRoute, replace = false) => {
      const path = playerRoutePath(route);
      if (replace) host.history.replaceState(null, '', path);
      else host.history.pushState(null, '', path);
      changed();
    },
    dispose: () => {
      listeners.clear();
      if (listening) { host.removeEventListener('popstate', changed); listening = false; }
    },
  };
}

export function usePlayerRoute(): [PlayerRoute, (route: PlayerRoute, replace?: boolean) => void] {
  const navigation = useMemo(() => createPlayerNavigation(typeof window === 'undefined' ? {
    location: { pathname: '/' },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {}, removeEventListener() {},
  } : window), []);
  const route = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, (): PlayerRoute => ({ kind: 'catalog' }));
  return [route, navigation.navigate];
}
