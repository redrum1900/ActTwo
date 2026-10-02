import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUnsavedChanges, resolveDirtyChoice, settleSavedDraft } from '../apps/web/src/creator/editor-session.js';

test('a section is dirty only while its draft differs from the last saved content', () => {
  assert.equal(hasUnsavedChanges('{"title":"甲"}', '{"title":"甲"}'), false);
  assert.equal(hasUnsavedChanges('{"title":"乙"}', '{"title":"甲"}'), true);
});

test('cancel and failed save block navigation while discard permits it', async () => {
  let calls = 0;
  const failingSave = async () => { calls++; return false; };
  assert.equal(await resolveDirtyChoice('cancel', failingSave), false);
  assert.equal(await resolveDirtyChoice('save', failingSave), false);
  assert.equal(await resolveDirtyChoice('discard', failingSave), true);
  assert.equal(calls, 1);
});

test('a successful explicit save permits the pending action', async () => {
  assert.equal(await resolveDirtyChoice('save', async () => true), true);
});

test('edits made during an in-flight save remain dirty and block the pending navigation', () => {
  assert.deepEqual(settleSavedDraft('{"title":"甲"}', '{"title":"乙"}', '{"title":"甲"}'),
    { draft: '{"title":"乙"}', canLeave: false });
  assert.deepEqual(settleSavedDraft('{"title":"甲"}', '{"title":"甲"}', '{"title":"甲"}'),
    { draft: '{"title":"甲"}', canLeave: true });
});
