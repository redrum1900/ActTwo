import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import type { GameScript } from '@game/contracts';
import { inspectScriptParts, blankScriptParts, migrateLegacyStatsParts, scriptPartsFromScript, type ScriptParts } from '@game/script/parts';
import { listScripts, type ScriptIssue } from '@game/script';
import { ProjectError } from '../creator/project-store.js';
import { withTransaction } from './mysql.js';

const safeId = /^[a-z0-9][a-z0-9-]*$/;
const safeSection = /^(?:manifest|player-form|items|locations|endings|achievements|stats)\.json$|^story\/indicators\.json$|^player\/(?:indicators|rules)\.json$|^npcs\/[a-z0-9][a-z0-9-]*\/(?:base|indicators|personas|rules|lore)\.json$/;
const now = () => new Date().toISOString();
type Client = Pool | PoolConnection;

interface ProjectRow extends RowDataPacket {
  id: string; owner_id: string; title: string; created_at: string; updated_at: string;
  published_at: string | null; deleted_at: string | null;
}
interface SectionRow extends RowDataPacket { path: string; content: string; revision: number; updated_at: string }
interface ScriptRow extends RowDataPacket { script_json: string }
export interface MysqlProjectSection { content: string; revision: number; updatedAt: string }
export interface MysqlCreatorProject {
  id: string; title: string; createdAt: string; updatedAt: string; publishedAt: string | null;
  sections: Record<string, MysqlProjectSection>;
}

export function createMysqlProjectStore(pool: Pool) {
  let itemImageValidator: ((projectId: string, script: GameScript) => Promise<ScriptIssue[]> | ScriptIssue[]) | null = null;
  const owned = async (client: Client, owner: string, id: string): Promise<ProjectRow | null> => {
    const [rows] = await client.execute<ProjectRow[]>(
      'SELECT * FROM creator_projects WHERE id=? AND owner_id=? AND deleted_at IS NULL', [id, owner]);
    return rows[0] ?? null;
  };
  const requireOwned = async (client: Client, owner: string, id: string) => {
    const row = await owned(client, owner, id);
    if (!row) throw new ProjectError('项目不存在或无权访问', 404);
    return row;
  };
  const sections = async (client: Client, id: string): Promise<MysqlCreatorProject['sections']> => {
    const [rows] = await client.execute<SectionRow[]>(
      'SELECT path,content,revision,updated_at FROM creator_sections WHERE project_id=? ORDER BY path', [id]);
    return Object.fromEntries(rows.map(row => [row.path, { content: row.content, revision: row.revision,
      updatedAt: row.updated_at }]));
  };
  const project = async (client: Client, row: ProjectRow): Promise<MysqlCreatorProject> => ({
    id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at,
    publishedAt: row.published_at, sections: await sections(client, row.id),
  });
  const parts = async (client: Client, id: string): Promise<ScriptParts> =>
    Object.fromEntries(Object.entries(await sections(client, id)).map(([path, entry]) => [path, entry.content]));
  const inspected = async (owner: string, id: string) => {
    await requireOwned(pool, owner, id);
    const report = inspectScriptParts(await parts(pool, id));
    if (report.script && report.script.id !== id) report.errors.push({ path: 'manifest.json', message: '剧本 ID 不能更改' });
    if (report.script && itemImageValidator) report.errors.push(...await itemImageValidator(id, report.script));
    return report;
  };

  const store = {
    setItemImageValidator(validator: (projectId: string, script: GameScript) => Promise<ScriptIssue[]> | ScriptIssue[]) {
      itemImageValidator = validator;
    },
    async list(owner: string): Promise<Omit<MysqlCreatorProject, 'sections'>[]> {
      const [rows] = await pool.execute<ProjectRow[]>(
        'SELECT * FROM creator_projects WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC', [owner]);
      return rows.map(row => ({ id: row.id, title: row.title, createdAt: row.created_at,
        updatedAt: row.updated_at, publishedAt: row.published_at }));
    },
    async get(owner: string, id: string): Promise<MysqlCreatorProject | null> {
      const row = await owned(pool, owner, id);
      return row ? project(pool, row) : null;
    },
    async create(owner: string, id: string, title: string, template?: GameScript): Promise<MysqlCreatorProject> {
      if (!safeId.test(id) || id.length > 64) throw new ProjectError('故事 ID 只能使用小写英文字母、数字和短横线，最多 64 位');
      if (!title.trim() || title.length > 100) throw new ProjectError('故事名称须为 1–100 字');
      await withTransaction(pool, async connection => {
        const [existing] = await connection.execute<RowDataPacket[]>('SELECT id FROM creator_projects WHERE id=?', [id]);
        if (existing.length || listScripts().some(script => script.id === id)) throw new ProjectError('故事 ID 已存在', 409);
        const timestamp = now();
        await connection.execute('INSERT INTO creator_projects (id,owner_id,title,created_at,updated_at) VALUES (?,?,?,?,?)',
          [id, owner, title.trim(), timestamp, timestamp]);
        const draft = template ? scriptPartsFromScript(template, id, title.trim()) : blankScriptParts(id, title.trim());
        for (const [path, content] of Object.entries(draft)) await connection.execute(
          'INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,1,?)',
          [id, path, content, timestamp]);
      });
      return (await store.get(owner, id))!;
    },
    async putSection(owner: string, id: string, path: string, content: string, expectedRevision: number): Promise<MysqlProjectSection> {
      if (!safeSection.test(path)) throw new ProjectError('配置项路径无效');
      if (typeof content !== 'string' || content.length > 1_000_000) throw new ProjectError('配置项内容过大');
      return withTransaction(pool, async connection => {
        await requireOwned(connection, owner, id);
        const timestamp = now();
        const [result] = await connection.execute<ResultSetHeader>(`UPDATE creator_sections
          SET content=?,revision=revision+1,updated_at=? WHERE project_id=? AND path=? AND revision=?`,
        [content, timestamp, id, path, expectedRevision]);
        if (result.affectedRows !== 1) throw new ProjectError('保存冲突：配置项已在其他窗口修改', 409);
        if (path === 'manifest.json') {
          try {
            const parsed = JSON.parse(content) as { title?: unknown };
            if (typeof parsed.title === 'string' && parsed.title.trim()) await connection.execute(
              'UPDATE creator_projects SET title=?,updated_at=? WHERE id=?', [parsed.title.trim().slice(0, 100), timestamp, id]);
          } catch { /* Invalid JSON remains a saveable draft. */ }
        } else await connection.execute('UPDATE creator_projects SET updated_at=? WHERE id=?', [timestamp, id]);
        const [rows] = await connection.execute<SectionRow[]>(
          'SELECT path,content,revision,updated_at FROM creator_sections WHERE project_id=? AND path=?', [id, path]);
        return { content: rows[0].content, revision: rows[0].revision, updatedAt: rows[0].updated_at };
      });
    },
    async migrateStats(owner: string, id: string, expectedRevisions: Record<string, number>): Promise<MysqlCreatorProject> {
      await withTransaction(pool, async connection => {
        await requireOwned(connection, owner, id);
        const current = await sections(connection, id);
        for (const [path, section] of Object.entries(current))
          if (expectedRevisions[path] !== section.revision) throw new ProjectError(`迁移冲突：${path} 已在其他窗口修改`, 409);
        let migrated: ScriptParts;
        try { migrated = migrateLegacyStatsParts(await parts(connection, id)); }
        catch (error) { throw new ProjectError(error instanceof Error ? error.message : '属性迁移失败'); }
        if (migrated['stats.json'] === current['stats.json']?.content) throw new ProjectError('没有需要迁移的旧属性');
        const timestamp = now();
        for (const [path, content] of Object.entries(migrated)) {
          if (current[path]?.content === content) continue;
          if (current[path]) await connection.execute(
            'UPDATE creator_sections SET content=?,revision=revision+1,updated_at=? WHERE project_id=? AND path=?',
            [content, timestamp, id, path]);
          else await connection.execute('INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,1,?)',
            [id, path, content, timestamp]);
        }
        await connection.execute('UPDATE creator_projects SET updated_at=? WHERE id=?', [timestamp, id]);
      });
      return (await store.get(owner, id))!;
    },
    async addNpc(owner: string, id: string, npcId: string, name: string): Promise<MysqlCreatorProject> {
      if (!safeId.test(npcId) || npcId.length > 64) throw new ProjectError('NPC ID 不合法');
      if (!name.trim()) throw new ProjectError('请输入 NPC 名称');
      await withTransaction(pool, async connection => {
        await requireOwned(connection, owner, id);
        const current = await sections(connection, id);
        if (current[`npcs/${npcId}/base.json`]) throw new ProjectError('NPC ID 已存在', 409);
        let startLocation = 'start';
        try { startLocation = JSON.parse(current['manifest.json'].content).startLocation || startLocation; }
        catch { /* draft may be incomplete */ }
        const timestamp = now();
        const prefix = `npcs/${npcId}/`;
        const entries = { 'base.json': { id: npcId, name: name.trim(), description: '', initialLocationId: startLocation, initialItems: [] },
          'indicators.json': [], 'personas.json': [{ id: 'common', name: '通用', content: '愿意与玩家交谈。' }],
          'rules.json': [], 'lore.json': [] };
        for (const [file, value] of Object.entries(entries)) await connection.execute(
          'INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,1,?)',
          [id, `${prefix}${file}`, JSON.stringify(value, null, 2), timestamp]);
        await connection.execute('UPDATE creator_projects SET updated_at=? WHERE id=?', [timestamp, id]);
      });
      return (await store.get(owner, id))!;
    },
    async removeNpc(owner: string, id: string, npcId: string): Promise<MysqlCreatorProject> {
      await withTransaction(pool, async connection => {
        await requireOwned(connection, owner, id);
        if (!(await sections(connection, id))[`npcs/${npcId}/base.json`]) throw new ProjectError('NPC 不存在', 404);
        await connection.execute('DELETE FROM creator_sections WHERE project_id=? AND path LIKE ?', [id, `npcs/${npcId}/%`]);
        await connection.execute('UPDATE creator_projects SET updated_at=? WHERE id=?', [now(), id]);
      });
      return (await store.get(owner, id))!;
    },
    async validate(owner: string, id: string): Promise<{ errors: ScriptIssue[]; warnings: ScriptIssue[] }> {
      const report = await inspected(owner, id);
      return { errors: report.errors, warnings: report.warnings };
    },
    async validatedDraft(owner: string, id: string): Promise<GameScript> {
      const report = await inspected(owner, id);
      if (report.errors.length || !report.script)
        throw new ProjectError(`剧本校验失败：${report.errors.map(issue => `${issue.path} ${issue.message}`).join('；')}`);
      return report.script;
    },
    async delete(owner: string, id: string): Promise<void> {
      await requireOwned(pool, owner, id);
      await pool.execute('UPDATE creator_projects SET deleted_at=?,updated_at=? WHERE id=?', [now(), now(), id]);
    },
    async getPublished(id: string): Promise<GameScript | null> {
      const [rows] = await pool.execute<ScriptRow[]>(`SELECT s.script_json FROM published_scripts s
        JOIN creator_projects p ON p.id=s.project_id WHERE s.project_id=? AND p.deleted_at IS NULL`, [id]);
      return rows[0] ? JSON.parse(rows[0].script_json) as GameScript : null;
    },
    async getArchivedPublished(id: string): Promise<GameScript | null> {
      const [rows] = await pool.execute<ScriptRow[]>('SELECT script_json FROM published_scripts WHERE project_id=?', [id]);
      return rows[0] ? JSON.parse(rows[0].script_json) as GameScript : null;
    },
    async listPublished(): Promise<GameScript[]> {
      const [rows] = await pool.query<ScriptRow[]>(`SELECT s.script_json FROM published_scripts s
        JOIN creator_projects p ON p.id=s.project_id WHERE p.deleted_at IS NULL ORDER BY s.published_at DESC`);
      return rows.map(row => JSON.parse(row.script_json) as GameScript);
    },
  };
  return store;
}

export type MysqlProjectStore = ReturnType<typeof createMysqlProjectStore>;
