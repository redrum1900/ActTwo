import { patchManifest } from '../model/section-forms.js';

export async function saveWithCover<T>(content: string, file: File,
  upload: (file: File) => Promise<{ cover: string }>, save: (content: string) => Promise<T>,
  discard: (cover: string) => Promise<void>): Promise<{ section: T; content: string }> {
  const { cover } = await upload(file);
  try {
    const withCover = patchManifest(content, { cover });
    return { section: await save(withCover), content: withCover };
  }
  catch (error) { await discard(cover).catch(() => {}); throw error; }
}
