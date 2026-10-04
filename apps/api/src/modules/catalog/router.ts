import { Router } from 'express';
import type { GameSessionContext } from '../gameplay/session.js';

export function createCatalogRouter({ scripts, store, owner, script, savedScript, galleryView }: GameSessionContext) {
  const router = Router();
  router.get('/catalog', async (_req, res) => {
    const games = await scripts.list();
    res.json({ games: await Promise.all(games.map(async game => {
      const save = res.locals.account ? await store.getAuto(owner(res), game.id) : null;
      return { id: game.id, version: game.version, title: game.title, subtitle: game.subtitle, cover: game.cover,
        description: game.description, hasAuto: !!save && !!await savedScript(game.id, save.state) };
    })) });
  });
  router.get('/games/:gameId', async (req, res) => {
    const game = await script(req);
    const save = res.locals.account ? await store.getAuto(owner(res), game.id) : null;
    res.json({ id: game.id, title: game.title, subtitle: game.subtitle, description: game.description, version: game.version, cover: game.cover,
      guide: game.guide ? { intro: game.guide.intro, steps: game.guide.steps.map(({ id, title, text }) => ({ id, title, text })) } : undefined,
      playerFields: game.playerFields, hasAuto: !!save && !!await savedScript(game.id, save.state), gallery: await galleryView(game, res) });
  });
  return router;
}
