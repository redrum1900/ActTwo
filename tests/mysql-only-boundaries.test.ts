import test from 'node:test';
import express from 'express';
import { mountCreatorModule } from '../apps/api/src/modules/creator/router.js';
import type { CreatorModuleOptions } from '../apps/api/src/modules/creator/router.js';
import type { ChatAdapter } from '../apps/api/src/modules/gameplay/chat-service.js';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : filename.endsWith('.ts') ? [filename] : [];
  });
}

test('API runtime source has no SQLite driver dependency', () => {
  const root = path.resolve(import.meta.dirname, '../apps/api/src');
  const offenders = sourceFiles(root).filter(filename => /better-sqlite3|\bsqlite3\b/.test(readFileSync(filename, 'utf8')));
  assert.deepEqual(offenders.map(filename => path.relative(root, filename)), []);
});

test('creator projects refuse startup without the MySQL asset pool', () => {
  const placeholder = {} as NonNullable<CreatorModuleOptions['creatorStore']>;
  const options = { creatorStore: placeholder, projectStore: {} as NonNullable<CreatorModuleOptions['projectStore']>,
    reviewStore: {} as NonNullable<CreatorModuleOptions['reviewStore']> };
  assert.throws(() => mountCreatorModule(express(), options, {} as ChatAdapter), /MySQL/);
});
