import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { defaultCoverDirectory } from '../apps/api/src/creator/cover-assets.js';

test('default cover storage remains inside the project data directory', () => {
  assert.equal(defaultCoverDirectory(), path.resolve('data/covers'));
});
