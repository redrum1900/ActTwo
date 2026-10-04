import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlayer } from '../apps/api/src/modules/gameplay/read-player.js';
import { playtestDetail } from '../apps/api/src/modules/playtest/session.js';
import { swordStoryV2 } from '../scripts/sword-story-v2.js';

test('gameplay opening form parser rejects impossible dates at its module boundary', () => {
  const fields = [{ id: 'birthday', label: '生日', type: 'date' as const, required: true }];
  assert.throws(() => readPlayer(fields, { birthday: '2026-02-30' }), /日期无效/);
  assert.deepEqual(readPlayer(fields, { birthday: '2026-02-28' }), { birthday: '2026-02-28' });
});

test('playtest detail rewrites draft cover URLs to creator-owned assets', () => {
  const record = { projectId: 'draft-one', script: { ...swordStoryV2, cover: '/api/covers/abc' }, auto: null };
  const detail = playtestDetail(record as Parameters<typeof playtestDetail>[0]);
  assert.equal(detail.cover, '/api/creator/projects/draft-one/covers/abc');
});
