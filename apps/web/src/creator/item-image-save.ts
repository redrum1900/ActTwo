interface ItemEntry { id: string; [key: string]: unknown }
const format = (value: unknown) => JSON.stringify(value, null, 2);

export function patchItemsImages(content: string, images: Record<string, string>): string {
  const items = JSON.parse(content) as ItemEntry[];
  if (!Array.isArray(items)) throw new Error('道具配置应为数组');
  return format(items.map(item => images[item.id] ? { ...item, image: images[item.id] } : item));
}

export async function saveWithItemImages<T>(content: string, files: Record<string, File>,
  upload: (file: File) => Promise<{ image: string }>, save: (content: string) => Promise<T>,
  discard: (image: string) => Promise<void>): Promise<{ section: T; content: string; uploadedIds: string[]; images: Record<string, string> }> {
  const items = JSON.parse(content) as ItemEntry[];
  if (!Array.isArray(items)) throw new Error('道具配置应为数组');
  const itemIds = new Set(items.map(item => item.id));
  const selected = Object.entries(files).filter((entry): entry is [string, File] => !!entry[1]);
  for (const [id] of selected) if (!itemIds.has(id)) throw new Error(`待上传图片对应的道具 ${id} 已不存在`);
  const images: Record<string, string> = {};
  try {
    for (const [id, file] of selected) images[id] = (await upload(file)).image;
    const updated = patchItemsImages(content, images);
    return { section: await save(updated), content: updated, uploadedIds: selected.map(([id]) => id), images };
  } catch (error) {
    await Promise.allSettled(Object.values(images).map(discard));
    throw error;
  }
}
