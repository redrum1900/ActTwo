import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ProjectError } from '../creator/project-store.js';
import type { MysqlProjectStore } from './mysql-project-store.js';

const maxBytes = 5 * 1024 * 1024;
const formats = {
  'image/png': { extension: 'png', matches: (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/jpeg': { extension: 'jpg', matches: (bytes: Buffer) => bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217 },
  'image/webp': { extension: 'webp', matches: (bytes: Buffer) => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
} as const;
interface Asset extends RowDataPacket { id: string; project_id: string; mime: string; extension: string; created_at: string }
type Kind = 'cover' | 'item';

export function createMysqlCoverAssets(pool: Pool, directory: string, projects: MysqlProjectStore) {
  mkdirSync(directory, { recursive: true });
  mkdirSync(path.join(directory, 'items'), { recursive: true });
  const table = (kind: Kind) => kind === 'cover' ? 'creator_cover_assets' : 'creator_item_image_assets';
  const reference = (kind: Kind, id: string) => `/api/${kind === 'cover' ? 'covers' : 'item-images'}/${id}`;
  const filename = (kind: Kind, asset: Asset) => path.join(directory, kind === 'item' ? 'items' : '', `${asset.id}.${asset.extension}`);
  const row = async (kind: Kind, id: string) => {
    const [rows] = await pool.execute<Asset[]>(`SELECT * FROM ${table(kind)} WHERE id=?`, [id]);
    return rows[0] ?? null;
  };
  const linked = async (kind: Kind, asset: Asset, published: boolean) => {
    const script = published ? await projects.getPublished(asset.project_id) : null;
    let content: { cover?: string; items?: readonly { image?: string }[] } | null = script;
    if (!published) {
      const section = kind === 'cover' ? 'manifest.json' : 'items.json';
      const [rows] = await pool.execute<(RowDataPacket & { content: string })[]>(
        'SELECT content FROM creator_sections WHERE project_id=? AND path=?', [asset.project_id, section]);
      try { content = kind === 'cover' ? JSON.parse(rows[0]?.content ?? '{}') : { items: JSON.parse(rows[0]?.content ?? '[]') }; }
      catch { return false; }
    }
    return kind === 'cover' ? content?.cover === reference(kind, asset.id) :
      (content?.items?.some(item => item.image === reference(kind, asset.id)) ?? false);
  };
  const remove = async (kind: Kind, asset: Asset) => {
    await pool.execute(`DELETE FROM ${table(kind)} WHERE id=?`, [asset.id]);
    try { unlinkSync(filename(kind, asset)); } catch { /* Already absent. */ }
  };
  const cleanupOrphans = async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (const kind of ['cover', 'item'] as const) {
      const [rows] = await pool.execute<Asset[]>(`SELECT * FROM ${table(kind)} WHERE created_at<?`, [cutoff]);
      for (const asset of rows) if (!await linked(kind, asset, false) && !await linked(kind, asset, true)) await remove(kind, asset);
    }
  };
  const requireOwner = async (owner: string, projectId: string) => {
    if (!await projects.get(owner, projectId)) throw new ProjectError('项目不存在或无权访问', 404);
  };
  const upload = async (kind: Kind, owner: string, projectId: string, bytes: Buffer, mime: string) => {
    await requireOwner(owner, projectId);
    if (bytes.length > maxBytes) throw new ProjectError(kind === 'cover' ? '封面不能超过 5 MB' : '道具图片不能超过 5 MB', 413);
    const format = formats[mime as keyof typeof formats];
    if (!format || !format.matches(bytes)) throw new ProjectError(kind === 'cover' ? '封面只支持 PNG、JPEG 或 WebP 图片' : '道具图片只支持 PNG、JPEG 或 WebP', 415);
    await cleanupOrphans();
    const asset = { id: randomUUID(), project_id: projectId, mime, extension: format.extension, created_at: new Date().toISOString() } as Asset;
    writeFileSync(filename(kind, asset), bytes, { flag: 'wx' });
    try {
      await pool.execute(`INSERT INTO ${table(kind)} (id,project_id,mime,extension,created_at) VALUES (?,?,?,?,?)`,
        [asset.id, projectId, mime, asset.extension, asset.created_at]);
    } catch (error) { unlinkSync(filename(kind, asset)); throw error; }
    return kind === 'cover' ? { cover: reference(kind, asset.id) } : { image: reference(kind, asset.id) };
  };
  const read = async (kind: Kind, id: string, owner?: string, projectId?: string) => {
    if (owner && projectId) await requireOwner(owner, projectId);
    const asset = await row(kind, id);
    if (!asset || (projectId && asset.project_id !== projectId) || (!owner && !await linked(kind, asset, true)))
      throw new ProjectError(kind === 'cover' ? '封面不存在' : '道具图片不存在', 404);
    return { mime: asset.mime, bytes: readFileSync(filename(kind, asset)) };
  };
  const discard = async (kind: Kind, owner: string, projectId: string, id: string) => {
    await requireOwner(owner, projectId);
    const asset = await row(kind, id);
    if (!asset || asset.project_id !== projectId) throw new ProjectError(kind === 'cover' ? '封面不存在' : '道具图片不存在', 404);
    if (await linked(kind, asset, false) || await linked(kind, asset, true))
      throw new ProjectError(kind === 'cover' ? '正在使用的封面不能删除' : '正在使用的道具图片不能删除', 409);
    await remove(kind, asset);
  };
  projects.setItemImageValidator(async (projectId, script) => {
    const issues = [];
    for (const [index, item] of script.items.entries()) {
      if (!item.image) continue;
      const asset = await row('item', item.image.split('/').at(-1) ?? '');
      if (asset?.project_id !== projectId || !existsSync(filename('item', asset)))
        issues.push({ path: `items.json[${index}].image`, message: `道具 ${item.id} 图片不存在或不属于当前项目` });
    }
    return issues;
  });
  return {
    uploadItem: (owner: string, projectId: string, bytes: Buffer, mime: string) => upload('item', owner, projectId, bytes, mime),
    draftItem: (owner: string, projectId: string, id: string) => read('item', id, owner, projectId),
    publishedItem: (id: string) => read('item', id),
    discardItem: (owner: string, projectId: string, id: string) => discard('item', owner, projectId, id),
    upload: (owner: string, projectId: string, bytes: Buffer, mime: string) => upload('cover', owner, projectId, bytes, mime),
    draft: (owner: string, projectId: string, id: string) => read('cover', id, owner, projectId),
    published: (id: string) => read('cover', id),
    discard: (owner: string, projectId: string, id: string) => discard('cover', owner, projectId, id),
  };
}
export type MysqlCoverAssets = ReturnType<typeof createMysqlCoverAssets>;
