import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlayerRoute, playerRoutePath } from '../apps/web/src/player-route.js';

test('player routes distinguish catalog, detail, and gameplay', () => {
  assert.deepEqual(parsePlayerRoute('/'), { route: { kind: 'catalog' } });
  assert.deepEqual(parsePlayerRoute('/games/sword'), { route: { kind: 'story-detail', storyId: 'sword' } });
  assert.deepEqual(parsePlayerRoute('/games/sword/play'), { route: { kind: 'story-play', storyId: 'sword' } });
  assert.deepEqual(parsePlayerRoute('/games/sword/continue'), {
    route: { kind: 'story-play', storyId: 'sword' }, canonicalPath: '/games/sword/play',
  });
  assert.deepEqual(parsePlayerRoute('/games/sword/'), {
    route: { kind: 'story-detail', storyId: 'sword' }, canonicalPath: '/games/sword',
  });
});

test('playtest pages keep project and run identity in both URLs', () => {
  assert.deepEqual(parsePlayerRoute('/playtest/project-one/run-one'), {
    route: { kind: 'playtest-detail', projectId: 'project-one', playtestId: 'run-one' },
  });
  assert.deepEqual(parsePlayerRoute('/playtest/project-one/run-one/play'), {
    route: { kind: 'playtest-play', projectId: 'project-one', playtestId: 'run-one' },
  });
});

test('player route IDs round-trip encoded characters and reject malformed escapes', () => {
  const route = { kind: 'story-detail' as const, storyId: '剑道 1' };
  assert.equal(playerRoutePath(route), '/games/%E5%89%91%E9%81%93%201');
  assert.deepEqual(parsePlayerRoute(playerRoutePath(route)), { route });
  assert.deepEqual(parsePlayerRoute('/games/%'), { route: { kind: 'not-found', pathname: '/games/%' } });
  assert.deepEqual(parsePlayerRoute('/creator'), { route: { kind: 'not-found', pathname: '/creator' } });
});
