import Database from 'better-sqlite3';
import type { GameState } from '../../../packages/contracts/src/index.js';

export interface SaveRecord {
  slot: number;
  label: string;
  state: GameState;
  revision: number;
  updatedAt: string;
}

interface SaveRow {
  slot: number;
  label: string;
  state_json: string;
  revision: number;
  updated_at: string;
}

export function createSaveStore(filename: string) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS save_slots (
      owner_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 5),
      label TEXT NOT NULL,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, game_id, slot)
    );
    CREATE TABLE IF NOT EXISTS gallery (
      owner_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (owner_id, game_id, kind, entry_id)
    );
  `);

  const get = (owner: string, game: string, slot: number): SaveRecord | null => {
    const row = db.prepare('SELECT slot, label, state_json, revision, updated_at FROM save_slots WHERE owner_id = ? AND game_id = ? AND slot = ?')
      .get(owner, game, slot) as SaveRow | undefined;
    return row ? { slot: row.slot, label: row.label, state: JSON.parse(row.state_json) as GameState,
      revision: row.revision, updatedAt: row.updated_at } : null;
  };

  const put = (owner: string, game: string, slot: number, label: string, state: GameState): SaveRecord => {
    if (slot < 0 || slot > 5 || !Number.isInteger(slot)) throw new Error('无效存档槽位');
    db.prepare(`INSERT INTO save_slots (owner_id, game_id, slot, label, state_json, revision, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(owner_id, game_id, slot) DO UPDATE SET
        label = excluded.label, state_json = excluded.state_json,
        revision = save_slots.revision + 1, updated_at = excluded.updated_at`)
      .run(owner, game, slot, label, JSON.stringify(state), new Date().toISOString());
    return get(owner, game, slot)!;
  };

  const awardGallery = (owner: string, game: string, state: GameState): void => {
    const insert = db.prepare('INSERT OR IGNORE INTO gallery (owner_id, game_id, kind, entry_id, unlocked_at) VALUES (?, ?, ?, ?, ?)');
    for (const entry of state.awardedGallery) insert.run(owner, game, entry.kind, entry.id, new Date().toISOString());
  };
  const putWithGallery = db.transaction((owner: string, game: string, slot: number, label: string, state: GameState) => {
    const saved = put(owner, game, slot, label, state);
    awardGallery(owner, game, state);
    return saved;
  });

  return {
    updateDerivedMemory: db.transaction((owner: string, game: string, expected: SaveRecord, derived: GameState): boolean => {
      const current = get(owner, game, 0);
      if (!current || current.revision !== expected.revision || JSON.stringify(current.state) !== JSON.stringify(expected.state)) return false;
      const state = { ...current.state, memorySegments: derived.memorySegments, memoryCompression: derived.memoryCompression };
      db.prepare('UPDATE save_slots SET state_json = ? WHERE owner_id = ? AND game_id = ? AND slot = 0 AND revision = ?')
        .run(JSON.stringify(state), owner, game, expected.revision);
      return true;
    }),
    getAuto: (owner: string, game: string) => get(owner, game, 0),
    getSlot: get,
    putAuto: (owner: string, game: string, state: GameState) => putWithGallery(owner, game, 0, '自动存档', state),
    updateAuto(owner: string, game: string, expectedRevision: number, state: GameState): SaveRecord {
      const result = db.prepare(`UPDATE save_slots SET state_json = ?, revision = revision + 1, updated_at = ?
        WHERE owner_id = ? AND game_id = ? AND slot = 0 AND revision = ?`)
        .run(JSON.stringify(state), new Date().toISOString(), owner, game, expectedRevision);
      if (result.changes !== 1) throw new Error('存档已变化，请刷新后重试');
      return get(owner, game, 0)!;
    },
    updateAutoWithGallery: db.transaction((owner: string, game: string, expectedRevision: number, state: GameState): SaveRecord => {
      const result = db.prepare(`UPDATE save_slots SET state_json = ?, revision = revision + 1, updated_at = ?
        WHERE owner_id = ? AND game_id = ? AND slot = 0 AND revision = ?`)
        .run(JSON.stringify(state), new Date().toISOString(), owner, game, expectedRevision);
      if (result.changes !== 1) throw new Error('存档已变化，请刷新后重试');
      awardGallery(owner, game, state);
      return get(owner, game, 0)!;
    }),
    saveManual: (owner: string, game: string, slot: number, label: string, state: GameState) => {
      if (slot < 1 || slot > 5) throw new Error('手动存档槽位必须为 1–5');
      return put(owner, game, slot, label.trim() || `存档 ${slot}`, state);
    },
    loadManual(owner: string, game: string, slot: number): SaveRecord | null {
      if (slot < 1 || slot > 5) throw new Error('手动存档槽位必须为 1–5');
      return db.transaction(() => {
        const manual = get(owner, game, slot);
        return manual ? putWithGallery(owner, game, 0, '自动存档', manual.state) : null;
      })();
    },
    deleteManual(owner: string, game: string, slot: number): void {
      if (slot < 1 || slot > 5) throw new Error('手动存档槽位必须为 1–5');
      db.prepare('DELETE FROM save_slots WHERE owner_id = ? AND game_id = ? AND slot = ?').run(owner, game, slot);
    },
    listSlots(owner: string, game: string): SaveRecord[] {
      const rows = db.prepare('SELECT slot, label, state_json, revision, updated_at FROM save_slots WHERE owner_id = ? AND game_id = ? ORDER BY slot')
        .all(owner, game) as SaveRow[];
      return rows.map((row) => ({ slot: row.slot, label: row.label, state: JSON.parse(row.state_json) as GameState,
        revision: row.revision, updatedAt: row.updated_at }));
    },
    unlockGallery(owner: string, game: string, kind: 'ending' | 'achievement', id: string): void {
      db.prepare('INSERT OR IGNORE INTO gallery (owner_id, game_id, kind, entry_id, unlocked_at) VALUES (?, ?, ?, ?, ?)')
        .run(owner, game, kind, id, new Date().toISOString());
    },
    getGallery(owner: string, game: string): { kind: string; id: string }[] {
      return (db.prepare('SELECT kind, entry_id FROM gallery WHERE owner_id = ? AND game_id = ? ORDER BY unlocked_at')
        .all(owner, game) as { kind: string; entry_id: string }[]).map((row) => ({ kind: row.kind, id: row.entry_id }));
    },
    close: () => db.close(),
  };
}

export type SaveStore = ReturnType<typeof createSaveStore>;
