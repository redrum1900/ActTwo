import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { ProjectError, type ProjectStore } from './project-store.js';

export function defaultCoverDirectory(): string { return path.resolve(fileURLToPath(new URL('../../../../data/covers/', import.meta.url))); }

const maxBytes = 5 * 1024 * 1024;
const imageTypes = {
  'image/png': { extension: 'png', matches: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/jpeg': { extension: 'jpg', matches: (bytes: Buffer) => bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217 },
  'image/webp': { extension: 'webp', matches: (bytes: Buffer) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
} as const;

interface AssetRow { id: string; project_id: string; mime: string; extension: string; created_at: string }

export function createCoverAssets(db: Database.Database, directory: string, projects: ProjectStore) {
  mkdirSync(directory, { recursive: true });
  const itemDirectory = path.join(directory, 'items');
  mkdirSync(itemDirectory, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS creator_cover_assets (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, mime TEXT NOT NULL, extension TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS creator_item_image_assets (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, mime TEXT NOT NULL, extension TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  const row = (id: string) => db.prepare('SELECT * FROM creator_cover_assets WHERE id=?').get(id) as AssetRow | undefined;
  const itemRow = (id: string) => db.prepare('SELECT * FROM creator_item_image_assets WHERE id=?').get(id) as AssetRow | undefined;
  const filename = (asset: AssetRow) => path.join(directory, `${asset.id}.${asset.extension}`);
  const itemFilename = (asset: AssetRow) => path.join(itemDirectory, `${asset.id}.${asset.extension}`);
  const reference = (id: string) => `/api/covers/${id}`;
  const itemReference = (id: string) => `/api/item-images/${id}`;
  const inDraft = (asset: AssetRow) => {
    const section = db.prepare('SELECT content FROM creator_sections WHERE project_id=? AND path=?')
      .get(asset.project_id, 'manifest.json') as { content: string } | undefined;
    try { return (JSON.parse(section?.content ?? '{}') as { cover?: string }).cover === reference(asset.id); }
    catch { return false; }
  };
  const inPublished = (asset: AssetRow) => projects.getPublished(asset.project_id)?.cover === reference(asset.id);
  const inDraftItem = (asset: AssetRow) => {
    const section = db.prepare('SELECT content FROM creator_sections WHERE project_id=? AND path=?')
      .get(asset.project_id, 'items.json') as { content: string } | undefined;
    try { const items = JSON.parse(section?.content ?? '[]') as { image?: string }[];
      return Array.isArray(items) && items.some(item => item.image === itemReference(asset.id)); }
    catch { return false; }
  };
  const inPublishedItem = (asset: AssetRow) => projects.getPublished(asset.project_id)?.items.some(item => item.image === itemReference(asset.id)) ?? false;
  const remove = (asset: AssetRow) => {
    db.prepare('DELETE FROM creator_cover_assets WHERE id=?').run(asset.id);
    try { unlinkSync(filename(asset)); } catch { /* File may have already been removed. */ }
  };
  const removeItem = (asset: AssetRow) => {
    db.prepare('DELETE FROM creator_item_image_assets WHERE id=?').run(asset.id);
    try { unlinkSync(itemFilename(asset)); } catch { /* File may have already been removed. */ }
  };
  const cleanupOrphans = () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const old = db.prepare('SELECT * FROM creator_cover_assets WHERE created_at<?').all(cutoff) as AssetRow[];
    for (const asset of old) if (!inDraft(asset) && !inPublished(asset)) remove(asset);
    const itemOld = db.prepare('SELECT * FROM creator_item_image_assets WHERE created_at<?').all(cutoff) as AssetRow[];
    for (const asset of itemOld) if (!inDraftItem(asset) && !inPublishedItem(asset)) removeItem(asset);
  };
  projects.setItemImageValidator((projectId, script) => script.items.flatMap((item, index) => {
    if (!item.image) return [];
    const id = item.image.split('/').at(-1) ?? '';
    const asset = itemRow(id);
    return asset?.project_id === projectId && existsSync(itemFilename(asset)) ? [] :
      [{ path: `items.json[${index}].image`, message: `道具 ${item.id} 图片不存在或不属于当前项目` }];
  }));
  cleanupOrphans();
  return {
    uploadItem(owner: string, projectId: string, bytes: Buffer, mime: string) {
      if (!projects.get(owner, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      if (bytes.length > maxBytes) throw new ProjectError('道具图片不能超过 5 MB', 413);
      const format = imageTypes[mime as keyof typeof imageTypes];
      if (!format || !format.matches(bytes)) throw new ProjectError('道具图片只支持 PNG、JPEG 或 WebP', 415);
      cleanupOrphans();
      const id = randomUUID();
      const asset: AssetRow = { id, project_id: projectId, mime, extension: format.extension, created_at: new Date().toISOString() };
      writeFileSync(itemFilename(asset), bytes, { flag: 'wx' });
      db.prepare('INSERT INTO creator_item_image_assets (id,project_id,mime,extension,created_at) VALUES (?,?,?,?,?)')
        .run(id, projectId, mime, asset.extension, asset.created_at);
      return { image: itemReference(id) };
    },
    draftItem(owner: string, projectId: string, id: string) {
      if (!projects.get(owner, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      const asset = itemRow(id);
      if (!asset || asset.project_id !== projectId) throw new ProjectError('道具图片不存在', 404);
      return { mime: asset.mime, bytes: readFileSync(itemFilename(asset)) };
    },
    publishedItem(id: string) {
      const asset = itemRow(id);
      if (!asset || !inPublishedItem(asset)) throw new ProjectError('道具图片不存在', 404);
      return { mime: asset.mime, bytes: readFileSync(itemFilename(asset)) };
    },
    discardItem(owner: string, projectId: string, id: string) {
      if (!projects.get(owner, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      const asset = itemRow(id);
      if (!asset || asset.project_id !== projectId) throw new ProjectError('道具图片不存在', 404);
      if (inDraftItem(asset) || inPublishedItem(asset)) throw new ProjectError('正在使用的道具图片不能删除', 409);
      removeItem(asset);
    },
    upload(owner: string, projectId: string, bytes: Buffer, mime: string) {
      if (!projects.get(owner, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      if (bytes.length > maxBytes) throw new ProjectError('封面不能超过 5 MB', 413);
      const format = imageTypes[mime as keyof typeof imageTypes];
      if (!format || !format.matches(bytes)) throw new ProjectError('封面只支持 PNG、JPEG 或 WebP 图片', 415);
      cleanupOrphans();
      const id = randomUUID();
      const asset: AssetRow = { id, project_id: projectId, mime, extension: format.extension, created_at: new Date().toISOString() };
      writeFileSync(filename(asset), bytes, { flag: 'wx' });
      db.prepare('INSERT INTO creator_cover_assets (id,project_id,mime,extension,created_at) VALUES (?,?,?,?,?)')
        .run(id, projectId, mime, asset.extension, asset.created_at);
      return { cover: reference(id) };
    },
    draft(owner: string, projectId: string, id: string) {
      if (!projects.get(owner, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      const asset = row(id);
      if (!asset || asset.project_id !== projectId) throw new ProjectError('封面不存在', 404);
      return { mime: asset.mime, bytes: readFileSync(filename(asset)) };
    },
    published(id: string) {
      const asset = row(id);
      if (!asset || !inPublished(asset)) throw new ProjectError('封面不存在', 404);
      return { mime: asset.mime, bytes: readFileSync(filename(asset)) };
    },
    discard(owner: string, projectId: string, id: string) {
      if (!projects.get(owner, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
      const asset = row(id);
      if (!asset || asset.project_id !== projectId) throw new ProjectError('封面不存在', 404);
      if (inDraft(asset) || inPublished(asset)) throw new ProjectError('正在使用的封面不能删除', 409);
      remove(asset);
    },
  };
}
export type CoverAssets = ReturnType<typeof createCoverAssets>;
