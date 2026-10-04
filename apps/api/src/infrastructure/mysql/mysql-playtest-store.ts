import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { GameScript, GameState } from '@game/contracts';
import type { SaveRecord } from '../../modules/gameplay/save-types.js';
import { ProjectError } from '../../modules/creator/projects/types.js';
import { withTransaction } from './mysql.js';
import { contentHashOf } from '@game/script';

interface Row extends RowDataPacket { id: string; project_id: string; owner_id: string;
  script_json: string; script_hash: string; auto_state_json: string | null; auto_revision: number;
  created_at: string; played_at: string | null }
export interface PlaytestRecord { id: string; projectId: string; ownerId: string; script: GameScript; scriptHash: string;
  auto: SaveRecord | null; createdAt: string; playedAt: string | null }
const now = () => new Date().toISOString();
function record(row: Row): PlaytestRecord {
  return { id: row.id, projectId: row.project_id, ownerId: row.owner_id,
    script: JSON.parse(row.script_json) as GameScript, scriptHash: row.script_hash,
    auto: row.auto_state_json ? { slot: 0, label: '试玩自动存档', state: JSON.parse(row.auto_state_json) as GameState,
      revision: row.auto_revision, updatedAt: row.played_at ?? row.created_at } : null,
    createdAt: row.created_at, playedAt: row.played_at };
}

export function createMysqlPlaytestStore(pool: Pool) {
  const get = async (owner: string, project: string, id: string): Promise<PlaytestRecord | null> => {
    const [rows] = await pool.execute<Row[]>('SELECT * FROM creator_playtests WHERE id=? AND project_id=? AND owner_id=?',
      [id, project, owner]);
    return rows[0] ? record(rows[0]) : null;
  };
  return {
    get,
    async list(owner: string, project: string): Promise<PlaytestRecord[]> {
      const [rows] = await pool.execute<Row[]>('SELECT * FROM creator_playtests WHERE owner_id=? AND project_id=? ORDER BY created_at DESC, id DESC',
        [owner, project]);
      return rows.map(record);
    },
    async create(owner: string, project: string, script: GameScript | ((connection: PoolConnection) => Promise<GameScript>)): Promise<PlaytestRecord> {
      const id = randomUUID();
      const timestamp = now();
      await withTransaction(pool, async connection => {
        const [owned] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM creator_projects WHERE id=? AND owner_id=? AND deleted_at IS NULL FOR UPDATE', [project, owner]);
        if (!owned.length) throw new ProjectError('项目不存在或无权访问', 404);
        const frozen = typeof script === 'function' ? await script(connection) : script;
        await connection.execute(`INSERT INTO creator_playtests
          (id,project_id,owner_id,script_json,script_hash,auto_state_json,auto_revision,created_at,played_at)
          VALUES (?,?,?,?,?,NULL,0,?,NULL)`, [id, project, owner, JSON.stringify(frozen), frozen.contentHash ?? contentHashOf(frozen), timestamp]);
        const [old] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM creator_playtests WHERE owner_id=? AND project_id=? ORDER BY created_at DESC, id DESC LIMIT 18446744073709551615 OFFSET 10',
          [owner, project]);
        for (const row of old) await connection.execute('DELETE FROM creator_playtests WHERE id=? AND owner_id=? AND project_id=?',
          [row.id, owner, project]);
      });
      return (await get(owner, project, id))!;
    },
    async delete(owner: string, project: string, id: string): Promise<boolean> {
      const [result] = await pool.execute<ResultSetHeader>(
        'DELETE FROM creator_playtests WHERE id=? AND project_id=? AND owner_id=?', [id, project, owner]);
      return result.affectedRows === 1;
    },
    async initialize(owner: string, project: string, id: string, state: GameState): Promise<PlaytestRecord> {
      const [result] = await pool.execute<ResultSetHeader>(`UPDATE creator_playtests
        SET auto_state_json=?,auto_revision=1,played_at=?
        WHERE id=? AND project_id=? AND owner_id=? AND auto_state_json IS NULL`,
      [JSON.stringify(state), now(), id, project, owner]);
      if (result.affectedRows !== 1) throw new ProjectError('试玩已经开始或记录不存在', 409);
      return (await get(owner, project, id))!;
    },
    async updateAuto(owner: string, project: string, id: string, expectedRevision: number, state: GameState): Promise<PlaytestRecord> {
      const [result] = await pool.execute<ResultSetHeader>(`UPDATE creator_playtests
        SET auto_state_json=?,auto_revision=auto_revision+1,played_at=?
        WHERE id=? AND project_id=? AND owner_id=? AND auto_revision=? AND auto_state_json IS NOT NULL`,
      [JSON.stringify(state), now(), id, project, owner, expectedRevision]);
      if (result.affectedRows !== 1) throw new ProjectError('试玩存档已变化或记录不存在，请刷新后重试', 409);
      return (await get(owner, project, id))!;
    },
    async updateDerivedMemory(owner: string, project: string, id: string, expected: SaveRecord, derived: GameState): Promise<boolean> {
      return withTransaction(pool, async connection => {
        const [rows] = await connection.execute<Row[]>(
          'SELECT * FROM creator_playtests WHERE id=? AND project_id=? AND owner_id=? FOR UPDATE', [id, project, owner]);
        const current = rows[0] ? record(rows[0]).auto : null;
        if (!current || current.revision !== expected.revision ||
          JSON.stringify(current.state) !== JSON.stringify(expected.state)) return false;
        const state = { ...current.state, memorySegments: derived.memorySegments, memoryCompression: derived.memoryCompression };
        await connection.execute(`UPDATE creator_playtests SET auto_state_json=?
          WHERE id=? AND project_id=? AND owner_id=? AND auto_revision=?`,
        [JSON.stringify(state), id, project, owner, expected.revision]);
        return true;
      });
    },
  };
}
export type MysqlPlaytestStore = ReturnType<typeof createMysqlPlaytestStore>;
