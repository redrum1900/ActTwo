import express from 'express';

export interface PublishedAssetReader {
  published(id: string): Promise<{ mime: string; bytes: Buffer }> | { mime: string; bytes: Buffer };
  publishedItem(id: string): Promise<{ mime: string; bytes: Buffer }> | { mime: string; bytes: Buffer };
}

export function createPublishedAssetsRouter(covers: PublishedAssetReader) {
  const router = express.Router();
  router.get('/covers/:assetId', async (req, res) => {
    try {
      const image = await covers.published(req.params.assetId as string);
      res.type(image.mime).set('Cache-Control', 'public, max-age=86400').send(image.bytes);
    } catch { res.status(404).json({ error: '封面不存在' }); }
  });
  router.get('/item-images/:assetId', async (req, res) => {
    try {
      const image = await covers.publishedItem(req.params.assetId as string);
      res.type(image.mime).set('Cache-Control', 'public, max-age=86400').send(image.bytes);
    } catch { res.status(404).json({ error: '道具图片不存在' }); }
  });
  return router;
}
