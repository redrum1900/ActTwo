import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { GameState } from '@game/contracts';
import type { SaveRecord } from '../save-store.js';
import { withTransaction } from './mysql.js';

type Client = Pool | PoolConnection;
interface SaveRow extends RowDataPacket { slot: number; label: string; state_json: string; revision: number; updated_at: string }
interface GalleryRow extends RowDataPacket { kind: string; entry_id: string }
const now = () => new Date().toISOString();
const parse = (row: SaveRow): SaveRecord => ({ slot: row.slot, label: row.label, state: JSON.parse(row.state_json), revision: row.revision, updatedAt: row.updated_at });

export function createMysqlSaveStore(pool: Pool) {
  const get = async (client: Client, owner: string, game: string, slot: number): Promise<SaveRecord | null> => {
    const [rows] = await client.execute<SaveRow[]>('SELECT slot,label,state_json,revision,updated_at FROM save_slots WHERE owner_id=? AND game_id=? AND slot=?', [owner, game, slot]);
    return rows[0] ? parse(rows[0]) : null;
  };
  const put = async (client: Client, owner: string, game: string, slot: number, label: string, state: GameState) => {
    if (!Number.isInteger(slot) || slot < 0 || slot > 5) throw new Error('无效存档槽位');
    await client.execute(`INSERT INTO save_slots (owner_id,game_id,slot,label,state_json,revision,updated_at)
      VALUES (?,?,?,?,?,1,?) ON DUPLICATE KEY UPDATE label=VALUES(label),state_json=VALUES(state_json),
      revision=revision+1,updated_at=VALUES(updated_at)`, [owner, game, slot, label, JSON.stringify(state), now()]);
    return (await get(client, owner, game, slot))!;
  };
  const awardGallery = async (client: Client, owner: string, game: string, state: GameState) => {
    for (const entry of state.awardedGallery) await client.execute(
      'INSERT IGNORE INTO gallery (owner_id,game_id,kind,entry_id,unlocked_at) VALUES (?,?,?,?,?)',
      [owner, game, entry.kind, entry.id, now()]);
  };
  const validManual = (slot: number) => {
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('手动存档槽位必须为 1–5');
  };
  return {
    getAuto: (owner: string, game: string) => get(pool, owner, game, 0),
    getSlot: (owner: string, game: string, slot: number) => get(pool, owner, game, slot),
    putAuto: (owner: string, game: string, state: GameState) => withTransaction(pool, async connection => {
      const saved = await put(connection, owner, game, 0, '自动存档', state);
      await awardGallery(connection, owner, game, state);
      return saved;
    }),
    updateAuto: (owner: string, game: string, revision: number, state: GameState) =>
      withTransaction(pool, async connection => update(connection, owner, game, revision, state, false)),
    updateAutoWithGallery: (owner: string, game: string, revision: number, state: GameState) =>
      withTransaction(pool, async connection => update(connection, owner, game, revision, state, true)),
    async updateDerivedMemory(owner: string, game: string, expected: SaveRecord, derived: GameState): Promise<boolean> {
      return withTransaction(pool, async connection => {
        const [rows] = await connection.execute<SaveRow[]>(
          'SELECT slot,label,state_json,revision,updated_at FROM save_slots WHERE owner_id=? AND game_id=? AND slot=0 FOR UPDATE', [owner, game]);
        const current = rows[0] ? parse(rows[0]) : null;
        if (!current || current.revision !== expected.revision || JSON.stringify(current.state) !== JSON.stringify(expected.state)) return false;
        const state = { ...current.state, memorySegments: derived.memorySegments, memoryCompression: derived.memoryCompression };
        await connection.execute('UPDATE save_slots SET state_json=? WHERE owner_id=? AND game_id=? AND slot=0 AND revision=?',
          [JSON.stringify(state), owner, game, expected.revision]);
        return true;
      });
    },
    saveManual(owner: string, game: string, slot: number, label: string, state: GameState) {
      validManual(slot);
      return put(pool, owner, game, slot, label.trim() || `存档 ${slot}`, state);
    },
    loadManual(owner: string, game: string, slot: number) {
      validManual(slot);
      return withTransaction(pool, async connection => {
        const manual = await get(connection, owner, game, slot);
        if (!manual) return null;
        const saved = await put(connection, owner, game, 0, '自动存档', manual.state);
        await awardGallery(connection, owner, game, manual.state);
        return saved;
      });
    },
    async deleteManual(owner: string, game: string, slot: number) {
      validManual(slot);
      await pool.execute('DELETE FROM save_slots WHERE owner_id=? AND game_id=? AND slot=?', [owner, game, slot]);
    },
    async listSlots(owner: string, game: string) {
      const [rows] = await pool.execute<SaveRow[]>(
        'SELECT slot,label,state_json,revision,updated_at FROM save_slots WHERE owner_id=? AND game_id=? ORDER BY slot', [owner, game]);
      return rows.map(parse);
    },
    async unlockGallery(owner: string, game: string, kind: 'ending' | 'achievement', id: string) {
      await pool.execute('INSERT IGNORE INTO gallery (owner_id,game_id,kind,entry_id,unlocked_at) VALUES (?,?,?,?,?)',
        [owner, game, kind, id, now()]);
    },
    async getGallery(owner: string, game: string) {
      const [rows] = await pool.execute<GalleryRow[]>(
        'SELECT kind,entry_id FROM gallery WHERE owner_id=? AND game_id=? ORDER BY unlocked_at', [owner, game]);
      return rows.map(row => ({ kind: row.kind, id: row.entry_id }));
    },
    close: () => pool.end(),
  };

  async function update(client: Client, owner: string, game: string, revision: number, state: GameState, withGallery: boolean) {
    const [result] = await client.execute<ResultSetHeader>(`UPDATE save_slots SET state_json=?,revision=revision+1,updated_at=?
      WHERE owner_id=? AND game_id=? AND slot=0 AND revision=?`, [JSON.stringify(state), now(), owner, game, revision]);
    if (result.affectedRows !== 1) throw new Error('存档已变化，请刷新后重试');
    if (withGallery) await awardGallery(client, owner, game, state);
    return (await get(client, owner, game, 0))!;
  }
}
export type MysqlSaveStore = ReturnType<typeof createMysqlSaveStore>;
