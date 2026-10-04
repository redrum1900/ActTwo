export type PlayerRoute =
  | { kind: 'catalog' }
  | { kind: 'story-detail' | 'story-play'; storyId: string }
  | { kind: 'playtest-detail' | 'playtest-play'; projectId: string; playtestId: string }
  | { kind: 'not-found'; pathname: string };

export function parsePlayerRoute(pathname: string): { route: PlayerRoute; canonicalPath?: string } {
  if (pathname === '/') return { route: { kind: 'catalog' } };
  const decodeId = (value: string) => {
    const id = decodeURIComponent(value);
    return id && !id.includes('/') ? id : null;
  };
  try {
    const game = /^\/games\/([^/]+)(?:\/(play|continue))?\/?$/.exec(pathname);
    if (game) {
      const storyId = decodeId(game[1]);
      if (storyId) {
        const route: PlayerRoute = { kind: game[2] ? 'story-play' : 'story-detail', storyId };
        const canonicalPath = playerRoutePath(route);
        return { route, ...(pathname === canonicalPath ? {} : { canonicalPath }) };
      }
    }
    const playtest = /^\/playtest\/([^/]+)\/([^/]+)(?:\/(play))?\/?$/.exec(pathname);
    if (playtest) {
      const projectId = decodeId(playtest[1]);
      const playtestId = decodeId(playtest[2]);
      if (projectId && playtestId) {
        const route: PlayerRoute = { kind: playtest[3] ? 'playtest-play' : 'playtest-detail', projectId, playtestId };
        const canonicalPath = playerRoutePath(route);
        return { route, ...(pathname === canonicalPath ? {} : { canonicalPath }) };
      }
    }
  } catch { /* Malformed percent encoding is not a valid story ID. */ }
  return { route: { kind: 'not-found', pathname } };
}

export function playerRoutePath(route: PlayerRoute): string {
  switch (route.kind) {
    case 'catalog': return '/';
    case 'story-detail': return `/games/${encodeURIComponent(route.storyId)}`;
    case 'story-play': return `/games/${encodeURIComponent(route.storyId)}/play`;
    case 'playtest-detail': return `/playtest/${encodeURIComponent(route.projectId)}/${encodeURIComponent(route.playtestId)}`;
    case 'playtest-play': return `/playtest/${encodeURIComponent(route.projectId)}/${encodeURIComponent(route.playtestId)}/play`;
    case 'not-found': return route.pathname;
  }
}
