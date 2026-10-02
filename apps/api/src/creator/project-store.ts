import type Database from 'better-sqlite3';
import type { GameScript } from '@game/contracts';
import { inspectScriptParts, blankScriptParts, scriptPartsFromScript, type ScriptParts } from '@game/script/parts';
import { listScripts, type ScriptIssue } from '@game/script';

const safeId = /^[a-z0-9][a-z0-9-]*$/;
const safeSection = /^(?:manifest|player-form|items|locations|endings|achievements|stats)\.json$|^player\/(?:indicators|rules)\.json$|^npcs\/[a-z0-9][a-z0-9-]*\/(?:base|indicators|personas|rules|lore)\.json$/;
const now = () => new Date().toISOString();

export class ProjectError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

interface ProjectRow { id: string; owner_id: string; title: string; created_at: string; updated_at: string; published_at: string | null; deleted_at: string | null }
interface SectionRow { path: string; content: string; revision: number; updated_at: string }
export interface ProjectSection { content: string; revision: number; updatedAt: string }
export interface CreatorProject { id: string; title: string; createdAt: string; updatedAt: string; publishedAt: string | null; sections: Record<string, ProjectSection> }

export function createProjectStore(db: Database.Database) {
  let itemImageValidator: ((projectId: string, script: GameScript) => ScriptIssue[]) | null = null;
  db.exec(`
    CREATE TABLE IF NOT EXISTS creator_projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES creator_accounts(id),
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      published_at TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS creator_projects_owner ON creator_projects(owner_id, deleted_at);
    CREATE TABLE IF NOT EXISTS creator_sections (
      project_id TEXT NOT NULL REFERENCES creator_projects(id),
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(project_id, path)
    );
    CREATE TABLE IF NOT EXISTS published_scripts (
      project_id TEXT PRIMARY KEY REFERENCES creator_projects(id),
      script_json TEXT NOT NULL,
      version TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      published_at TEXT NOT NULL
    );
  `);
  const owned = (owner: string, id: string): ProjectRow | null =>
    db.prepare('SELECT * FROM creator_projects WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(id, owner) as ProjectRow | undefined ?? null;
  const requireOwned = (owner: string, id: string) => {
    const row = owned(owner, id);
    if (!row) throw new ProjectError('项目不存在或无权访问', 404);
    return row;
  };
  const sections = (id: string) => Object.fromEntries((db.prepare('SELECT path,content,revision,updated_at FROM creator_sections WHERE project_id=? ORDER BY path')
    .all(id) as SectionRow[]).map(row => [row.path, { content: row.content, revision: row.revision, updatedAt: row.updated_at }])) as CreatorProject['sections'];
  const project = (row: ProjectRow): CreatorProject => ({ id: row.id, title: row.title, createdAt: row.created_at,
    updatedAt: row.updated_at, publishedAt: row.published_at, sections: sections(row.id) });
  const parts = (id: string): ScriptParts => Object.fromEntries(Object.entries(sections(id)).map(([path, section]) => [path, section.content]));

  const store = {
    setItemImageValidator(validator: (projectId: string, script: GameScript) => ScriptIssue[]) { itemImageValidator = validator; },
    list(owner: string): Omit<CreatorProject, 'sections'>[] {
      return (db.prepare('SELECT * FROM creator_projects WHERE owner_id=? AND deleted_at IS NULL ORDER BY updated_at DESC')
        .all(owner) as ProjectRow[]).map(({ id, title, created_at, updated_at, published_at }) =>
        ({ id, title, createdAt: created_at, updatedAt: updated_at, publishedAt: published_at }));
    },
    get(owner: string, id: string): CreatorProject | null {
      const row = owned(owner, id);
      return row ? project(row) : null;
    },
    create: db.transaction((owner: string, id: string, title: string, template?: GameScript): CreatorProject => {
      if (!safeId.test(id) || id.length > 64) throw new ProjectError('故事 ID 只能使用小写英文字母、数字和短横线，最多 64 位');
      if (!title.trim() || title.length > 100) throw new ProjectError('故事名称须为 1–100 字');
      if (db.prepare('SELECT id FROM creator_projects WHERE id=?').get(id) || listScripts().some(script => script.id === id))
        throw new ProjectError('故事 ID 已存在', 409);
      const timestamp = now();
      db.prepare('INSERT INTO creator_projects (id,owner_id,title,created_at,updated_at) VALUES (?,?,?,?,?)')
        .run(id, owner, title.trim(), timestamp, timestamp);
      const draft = template ? scriptPartsFromScript(template, id, title.trim()) : blankScriptParts(id, title.trim());
      const put = db.prepare('INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,1,?)');
      for (const [path, content] of Object.entries(draft)) put.run(id, path, content, timestamp);
      return store.get(owner, id)!;
    }),
    putSection(owner: string, id: string, path: string, content: string, expectedRevision: number): ProjectSection {
      requireOwned(owner, id);
      if (!safeSection.test(path)) throw new ProjectError('配置项路径无效');
      if (typeof content !== 'string' || content.length > 1_000_000) throw new ProjectError('配置项内容过大');
      const timestamp = now();
      const result = db.prepare('UPDATE creator_sections SET content=?,revision=revision+1,updated_at=? WHERE project_id=? AND path=? AND revision=?')
        .run(content, timestamp, id, path, expectedRevision);
      if (result.changes !== 1) throw new ProjectError('保存冲突：配置项已在其他窗口修改', 409);
      if (path === 'manifest.json') {
        try {
          const parsed = JSON.parse(content) as { title?: unknown };
          if (typeof parsed.title === 'string' && parsed.title.trim())
            db.prepare('UPDATE creator_projects SET title=?,updated_at=? WHERE id=?').run(parsed.title.trim().slice(0, 100), timestamp, id);
        } catch { /* Invalid JSON remains a saveable draft. */ }
      } else db.prepare('UPDATE creator_projects SET updated_at=? WHERE id=?').run(timestamp, id);
      const row = db.prepare('SELECT content,revision,updated_at FROM creator_sections WHERE project_id=? AND path=?').get(id, path) as Omit<SectionRow, 'path'>;
      return { content: row.content, revision: row.revision, updatedAt: row.updated_at };
    },
    addNpc: db.transaction((owner: string, id: string, npcId: string, name: string) => {
      requireOwned(owner, id);
      if (!safeId.test(npcId) || npcId.length > 64) throw new ProjectError('NPC ID 不合法');
      if (!name.trim()) throw new ProjectError('请输入 NPC 名称');
      if (sections(id)[`npcs/${npcId}/base.json`]) throw new ProjectError('NPC ID 已存在', 409);
      let startLocation = 'start';
      try { startLocation = JSON.parse(sections(id)['manifest.json'].content).startLocation || startLocation; } catch { /* draft may be incomplete */ }
      const timestamp = now();
      const put = db.prepare('INSERT INTO creator_sections (project_id,path,content,revision,updated_at) VALUES (?,?,?,1,?)');
      const prefix = `npcs/${npcId}/`;
      put.run(id, `${prefix}base.json`, JSON.stringify({ id: npcId, name: name.trim(), description: '', initialLocationId: startLocation, initialItems: [] }, null, 2), timestamp);
      for (const [file, value] of Object.entries({ 'indicators.json': [], 'personas.json': [{ id: 'common', name: '通用', content: '愿意与玩家交谈。' }],
        'rules.json': [], 'lore.json': [] })) put.run(id, `${prefix}${file}`, JSON.stringify(value, null, 2), timestamp);
      db.prepare('UPDATE creator_projects SET updated_at=? WHERE id=?').run(timestamp, id);
      return store.get(owner, id)!;
    }),
    removeNpc: db.transaction((owner: string, id: string, npcId: string) => {
      requireOwned(owner, id);
      if (!sections(id)[`npcs/${npcId}/base.json`]) throw new ProjectError('NPC 不存在', 404);
      db.prepare('DELETE FROM creator_sections WHERE project_id=? AND path LIKE ?').run(id, `npcs/${npcId}/%`);
      db.prepare('UPDATE creator_projects SET updated_at=? WHERE id=?').run(now(), id);
      return store.get(owner, id)!;
    }),
    validate(owner: string, id: string): { errors: ScriptIssue[]; warnings: ScriptIssue[] } {
      requireOwned(owner, id);
      const report = inspectScriptParts(parts(id));
      if (report.script && report.script.id !== id) report.errors.push({ path: 'manifest.json', message: '剧本 ID 不能更改' });
      if (report.script && itemImageValidator) report.errors.push(...itemImageValidator(id, report.script));
      return { errors: report.errors, warnings: report.warnings };
    },
    validatedDraft(owner: string, id: string): GameScript {
      requireOwned(owner, id);
      const report = inspectScriptParts(parts(id));
      if (report.script && report.script.id !== id) report.errors.push({ path: 'manifest.json', message: '剧本 ID 不能更改' });
      if (report.script && itemImageValidator) report.errors.push(...itemImageValidator(id, report.script));
      if (report.errors.length || !report.script)
        throw new ProjectError(`剧本校验失败：${report.errors.map(issue => `${issue.path} ${issue.message}`).join('；')}`);
      return report.script;
    },
    delete(owner: string, id: string) {
      requireOwned(owner, id);
      db.prepare('UPDATE creator_projects SET deleted_at=?,updated_at=? WHERE id=?').run(now(), now(), id);
    },
    getPublished(id: string): GameScript | null {
      const row = db.prepare(`SELECT s.script_json FROM published_scripts s JOIN creator_projects p ON p.id=s.project_id
        WHERE s.project_id=? AND p.deleted_at IS NULL`).get(id) as { script_json: string } | undefined;
      return row ? JSON.parse(row.script_json) as GameScript : null;
    },
    getArchivedPublished(id: string): GameScript | null {
      const row = db.prepare('SELECT script_json FROM published_scripts WHERE project_id=?').get(id) as { script_json: string } | undefined;
      return row ? JSON.parse(row.script_json) as GameScript : null;
    },
    listPublished(): GameScript[] {
      return (db.prepare(`SELECT s.script_json FROM published_scripts s JOIN creator_projects p ON p.id=s.project_id
        WHERE p.deleted_at IS NULL ORDER BY s.published_at DESC`).all() as { script_json: string }[])
        .map(row => JSON.parse(row.script_json) as GameScript);
    },
  };
  return store;
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
