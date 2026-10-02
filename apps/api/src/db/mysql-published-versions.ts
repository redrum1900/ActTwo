import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { GameScript } from '@game/contracts';
import { contentHashOf } from '@game/script';

interface ScriptRow extends RowDataPacket { script_json: string }
interface SequenceRow extends RowDataPacket { release_sequence: number | string | null }

export function releaseVersion(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('发布序号无效');
  return `1.${sequence - 1}`;
}

export function createMysqlPublishedVersions(pool: Pool) {
  const parse = (rows: ScriptRow[]) => rows[0] ? JSON.parse(rows[0].script_json) as GameScript : null;
  return {
    async getLatest(projectId: string): Promise<GameScript | null> {
      const [rows] = await pool.execute<ScriptRow[]>(`SELECT s.script_json FROM published_scripts s
        JOIN creator_projects p ON p.id=s.project_id WHERE s.project_id=? AND p.deleted_at IS NULL`, [projectId]);
      return parse(rows);
    },
    async getExact(projectId: string, version: string, hash: string): Promise<GameScript | null> {
      const [rows] = await pool.execute<ScriptRow[]>(`SELECT s.script_json FROM published_script_versions s
        JOIN creator_projects p ON p.id=s.project_id
        WHERE s.project_id=? AND s.version=? AND s.content_hash=? AND p.deleted_at IS NULL`,
      [projectId, version, hash]);
      return parse(rows);
    },
    async listLatest(): Promise<GameScript[]> {
      const [rows] = await pool.query<ScriptRow[]>(`SELECT s.script_json FROM published_scripts s
        JOIN creator_projects p ON p.id=s.project_id WHERE p.deleted_at IS NULL ORDER BY s.published_at DESC`);
      return rows.map(row => JSON.parse(row.script_json) as GameScript);
    },
    async referencesAsset(projectId: string, reference: string, kind: 'cover' | 'item'): Promise<boolean> {
      const [rows] = await pool.execute<ScriptRow[]>(
        'SELECT script_json FROM published_script_versions WHERE project_id=?', [projectId]);
      return rows.some(row => {
        const script = JSON.parse(row.script_json) as GameScript;
        return kind === 'cover' ? script.cover === reference : script.items.some(item => item.image === reference);
      });
    },
    async publish(connection: PoolConnection, projectId: string, reviewId: string, frozenScript: GameScript): Promise<GameScript> {
      const [rows] = await connection.execute<SequenceRow[]>(
        'SELECT MAX(release_sequence) AS release_sequence FROM published_script_versions WHERE project_id=?', [projectId]);
      const sequence = Number(rows[0]?.release_sequence ?? 0) + 1;
      const script = { ...frozenScript, version: releaseVersion(sequence) };
      script.contentHash = contentHashOf(script);
      const timestamp = new Date().toISOString();
      const serialized = JSON.stringify(script);
      await connection.execute(`INSERT INTO published_script_versions
        (project_id,release_sequence,version,content_hash,script_json,review_id,published_at)
        VALUES (?,?,?,?,?,?,?)`, [projectId, sequence, script.version, script.contentHash, serialized, reviewId, timestamp]);
      await connection.execute(`INSERT INTO published_scripts
        (project_id,script_json,version,content_hash,published_at) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE script_json=VALUES(script_json),version=VALUES(version),
        content_hash=VALUES(content_hash),published_at=VALUES(published_at)`,
      [projectId, serialized, script.version, script.contentHash, timestamp]);
      return script;
    },
  };
}
