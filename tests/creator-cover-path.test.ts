import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultCoverDirectory } from '../apps/api/src/modules/creator/assets/cover-path.js';

test('default cover storage remains inside the project data directory', () => {
  assert.equal(defaultCoverDirectory(), path.resolve('data/covers'));
});
