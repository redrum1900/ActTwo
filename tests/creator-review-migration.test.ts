import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { blankScriptParts, assembleScriptParts } from '../packages/script/src/parts.js';
import { createCreatorStore } from '../apps/api/src/creator/auth-store.js';
import { createProjectStore } from '../apps/api/src/creator/project-store.js';
import { createReviewStore } from '../apps/api/src/creator/review-store.js';
import { createScriptRepository } from '../apps/api/src/script-repository.js';

test('legacy published story remains in catalog after role and review migrations', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'game-review-migration-'));
  const filename = path.join(dir, 'game.sqlite');
  const script = assembleScriptParts(blankScriptParts('legacy-story', '原有线上故事'));
  const old = new Database(filename);
  old.exec(`CREATE TABLE creator_accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE creator_projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT, deleted_at TEXT);
    CREATE TABLE published_scripts (project_id TEXT PRIMARY KEY, script_json TEXT NOT NULL,
      version TEXT NOT NULL, content_hash TEXT NOT NULL, published_at TEXT NOT NULL);`);
  old.prepare('INSERT INTO creator_accounts VALUES (?,?,?,?,?)').run('old-author', 'legacy_author', 'salt', 'hash', '2026-01-01');
  old.prepare('INSERT INTO creator_projects VALUES (?,?,?,?,?,?,?)').run('legacy-story', 'old-author', '原有线上故事',
    '2026-01-01', '2026-01-01', '2026-01-01', null);
  old.prepare('INSERT INTO published_scripts VALUES (?,?,?,?,?)').run('legacy-story', JSON.stringify(script), script.version,
    script.contentHash, '2026-01-01');
  old.close();
  const accounts = createCreatorStore(filename);
  try {
    const projects = createProjectStore(accounts.db);
    const reviews = createReviewStore(accounts.db, projects);
    const repository = createScriptRepository(projects);
    assert.equal(repository.get('legacy-story').title, '原有线上故事');
    assert.equal(repository.list().some(entry => entry.id === 'legacy-story'), true);
    assert.deepEqual(reviews.listPending(), []);
  } finally { accounts.close(); rmSync(dir, { recursive: true }); }
});
