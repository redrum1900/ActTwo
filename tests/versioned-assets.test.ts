import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool } from 'mysql2/promise';
import { createMysqlCoverAssets } from '../apps/api/src/infrastructure/mysql/mysql-cover-assets.js';
import type { MysqlProjectStore } from '../apps/api/src/infrastructure/mysql/mysql-project-store.js';

test('an image referenced only by an older published snapshot stays public', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'game-version-asset-'));
  const id = 'old-image';
  mkdirSync(path.join(dir, 'items'));
  writeFileSync(path.join(dir, 'items', `${id}.png`), Buffer.from('old-version-image'));
  const pool = { execute: async (sql: string) => {
    if (sql.includes('creator_item_image_assets')) return [[{ id, project_id: 'game', mime: 'image/png', extension: 'png' }]];
    if (sql.includes('published_script_versions')) return [[{ script_json: JSON.stringify({ items: [{ image: `/api/item-images/${id}` }] }) }]];
    return [[]];
  } } as unknown as Pool;
  const projects = { getPublished: async () => ({ items: [] }), setItemImageValidator: () => {} } as unknown as MysqlProjectStore;
  try {
    const assets = createMysqlCoverAssets(pool, dir, projects);
    assert.equal((await assets.publishedItem(id)).bytes.toString(), 'old-version-image');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
