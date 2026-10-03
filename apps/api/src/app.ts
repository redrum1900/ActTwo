import express, { type Request, type Response } from 'express';
import type { ChatAdapter } from './chat-service.js';
import { runChat } from './chat-service.js';
import { AiServiceError } from './ai-adapter.js';
import type { SaveRecord, SaveStore } from './save-store.js';
import type { MysqlSaveStore } from './db/mysql-save-store.js';
import type { MysqlCreatorStore } from './db/mysql-auth-store.js';
import type { MysqlProjectStore } from './db/mysql-project-store.js';
import type { MysqlReviewStore } from './db/mysql-review-store.js';
import { createMysqlCoverAssets } from './db/mysql-cover-assets.js';
import type { Pool } from 'mysql2/promise';
import { type GameScript, type GameState } from '@game/contracts';
import { contentHashOf } from '@game/script';
import { advanceTime, canEnterLocation, createInitialState, discoverPresentNpcs, evaluateCondition, exploreSpot, makeView, refreshWorld, searchLocation, takeLocationItem } from '@game/engine';
import { appendActivity, settleWorld, type ActivityAction } from '@game/engine/activity-log';
import { createScriptRepository, createMysqlScriptRepository, ScriptNotFoundError, type ScriptRepository, type AsyncScriptRepository } from './script-repository.js';
import { createMemoryWorker } from './memory-worker.js';
import { createCreatorRouter } from './creator/auth-router.js';
import type { CreatorStore } from './creator/auth-store.js';
import { createProjectRouter } from './creator/project-router.js';
import { createImportRouter } from './creator/import-router.js';
import { createMysqlCreatorImportStore, type MysqlCreatorImportStore } from './db/mysql-creator-import.js';
import type { ProjectStore } from './creator/project-store.js';
import { createReviewRouter } from './creator/review-router.js';
import type { ReviewStore } from './creator/review-store.js';
import { createCoverAssets, defaultCoverDirectory } from './creator/cover-assets.js';
import { accountForRequest } from './account-session.js';
import type { CreatorAccount } from './creator/auth-store.js';
import { randomUUID } from 'node:crypto';
import type { AiAttribution } from './ai-audit.js';
import { createAiAuditRouter } from './ai-audit-router.js';
import type { MysqlAiAuditStore } from './db/mysql-ai-audit-store.js';
import { createPlaytestRouter } from './creator/playtest-router.js';
import type { MysqlPlaytestStore } from './db/mysql-playtest-store.js';
import { readPlayer } from './read-player.js';
export { readPlayer } from './read-player.js';

function visiblePayload(script: GameScript, state: GameState, revision: number, adapter: ChatAdapter) {
  const view = makeView(script, state);
  const hints: Record<string, { id: string; text: string }[]> = {};
  for (const npc of view.npcs) hints[npc.id] = script.events
    .filter((event) => event.npc === npc.id && event.hint && (!event.once || !state.completedEvents.includes(event.id)) && evaluateCondition(event.when ?? event.condition, state, script, npc.id))
    .map((event) => ({ id: event.id, text: event.hint! }));
  return { view, revision, hints, aiMode: adapter.mode };
}

export function createApp(store: SaveStore | MysqlSaveStore, adapter: ChatAdapter, options: {
  debugEnabled?: boolean; creatorStore?: CreatorStore | MysqlCreatorStore; projectStore?: ProjectStore | MysqlProjectStore;
  reviewStore?: ReviewStore | MysqlReviewStore; scripts?: ScriptRepository | AsyncScriptRepository;
  coversDir?: string; mysqlPool?: Pool; importStore?: MysqlCreatorImportStore; auditStore?: MysqlAiAuditStore;
  playtestStore?: MysqlPlaytestStore;
} = {}) {
  const app = express();
  const scripts = options.scripts ?? (options.mysqlPool && options.projectStore
    ? createMysqlScriptRepository(options.projectStore as MysqlProjectStore)
    : createScriptRepository(options.projectStore as ProjectStore | undefined));
  const covers = options.creatorStore && options.projectStore
    ? options.mysqlPool
      ? createMysqlCoverAssets(options.mysqlPool, options.coversDir ?? defaultCoverDirectory(), options.projectStore as MysqlProjectStore)
      : createCoverAssets((options.creatorStore as CreatorStore).db, options.coversDir ?? defaultCoverDirectory(), options.projectStore as ProjectStore)
    : null;
  const queueMemory = createMemoryWorker(store, adapter);
  const formalAudit = (accountId: string, game: GameScript, operationId: string): AiAttribution =>
    ({ accountId, source: 'formal', storyId: game.id, releaseVersion: game.version, operationId });
  const inFlightTurns = new Map<string, { npcId: string; text: string; task: Promise<{ game: GameScript; save: SaveRecord; result: Awaited<ReturnType<typeof runChat>> }> }>();
  app.use(express.json({ limit: '2mb' }));
  if (options.creatorStore) app.use('/api/creator', createCreatorRouter(options.creatorStore));
  if (options.creatorStore && options.projectStore && options.reviewStore)
    app.use('/api/creator', createProjectRouter(options.creatorStore, options.projectStore, options.reviewStore, covers!, !options.mysqlPool));
  if (options.creatorStore && options.mysqlPool)
    app.use('/api/creator', createImportRouter(options.creatorStore,
      options.importStore ?? createMysqlCreatorImportStore(options.mysqlPool), undefined, options.auditStore));
  if (options.creatorStore && options.projectStore && options.playtestStore)
    app.use('/api/creator', createPlaytestRouter(options.creatorStore,
      options.projectStore as MysqlProjectStore, options.playtestStore, adapter));
  if (options.creatorStore && options.reviewStore)
    app.use('/api/creator/reviews', createReviewRouter(options.creatorStore, options.reviewStore));
  if (covers) app.get('/api/covers/:assetId', async (req, res) => {
    try {
      const image = await covers.published(req.params.assetId as string);
      res.type(image.mime).set('Cache-Control', 'public, max-age=86400').send(image.bytes);
    } catch { res.status(404).json({ error: '封面不存在' }); }
  });
  if (covers) app.get('/api/item-images/:assetId', async (req, res) => {
    try {
      const image = await covers.publishedItem(req.params.assetId as string);
      res.type(image.mime).set('Cache-Control', 'public, max-age=86400').send(image.bytes);
    } catch { res.status(404).json({ error: '道具图片不存在' }); }
  });
  app.use('/api', async (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: '请求来源不匹配' });
      } catch { return res.status(403).json({ error: '请求来源不匹配' }); }
    }
    try {
      res.locals.account = options.creatorStore ? await accountForRequest(req, options.creatorStore) : null;
      next();
    } catch (error) { next(error); }
  });
  if (options.auditStore) app.use('/api/usage', createAiAuditRouter(options.auditStore));

  const owner = (res: Response) => (res.locals.account as CreatorAccount).id;
  const script = async (req: Request) => scripts.get(req.params.gameId as string);
  const compatible = (game: GameScript, state: GameState) => state.scriptVersion === game.version && state.scriptHash === game.contentHash &&
    game.npcs.every((npc) => !npc.indicators || npc.indicators.every((indicator) => state.npcIndicators?.[npc.id]?.[indicator.id] !== undefined));
  const savedScript = async (gameId: string, state: GameState): Promise<GameScript | null> => {
    if (state.scriptId !== gameId || !state.scriptVersion || !state.scriptHash) return null;
    const game = scripts.getExact
      ? await scripts.getExact(gameId, state.scriptVersion, state.scriptHash)
      : await scripts.get(gameId);
    return game && compatible(game, state) && contentHashOf(game) === state.scriptHash ? game : null;
  };
  const current = async (req: Request, res: Response) => {
    const gameId = req.params.gameId as string;
    const save = await store.getAuto(owner(res), gameId);
    if (!save) throw new Error('没有自动存档，请先开始新游戏');
    const game = await savedScript(gameId, save.state);
    if (!game) throw new Error('存档对应的已发布剧本版本不存在或内容不匹配');
    return { game, save: { ...save, state: refreshWorld(game, save.state) } };
  };
  const galleryView = async (game: GameScript, res: Response) => {
    const unlocked = res.locals.account ? await store.getGallery(owner(res), game.id) : [];
    return [...game.endings.map((entry) => ({ ...entry, kind: 'ending' as const })),
      ...game.achievements.map((entry) => ({ ...entry, kind: 'achievement' as const }))]
      .map((entry) => ({ id: entry.id, kind: entry.kind, unlocked: unlocked.some((value) => value.id === entry.id && value.kind === entry.kind),
        name: entry.hidden && !unlocked.some((value) => value.id === entry.id && value.kind === entry.kind) ? '？？？' : entry.name,
        description: entry.hidden && !unlocked.some((value) => value.id === entry.id && value.kind === entry.kind) ? '继续游戏以解锁' : entry.description }));
  };
  const currentPayload = async (res: Response, game: GameScript, save: SaveRecord, extra: object = {}) => {
    const state = refreshWorld(game, save.state);
    return { ...visiblePayload(game, state, save.revision, adapter), gallery: await galleryView(game, res), ...extra };
  };
  const sendCurrent = async (res: Response, game: GameScript, save: SaveRecord, extra: object = {}) =>
    res.json(await currentPayload(res, game, save, extra));

  app.get('/api/catalog', async (_req, res) => {
    const games = await scripts.list();
    res.json({ games: await Promise.all(games.map(async game => {
      const save = res.locals.account ? await store.getAuto(owner(res), game.id) : null;
      return { id: game.id, version: game.version, title: game.title, subtitle: game.subtitle, cover: game.cover,
        description: game.description, hasAuto: !!save && !!await savedScript(game.id, save.state) };
    })) });
  });
  app.get('/api/games/:gameId', async (req, res) => {
    const game = await script(req);
    const save = res.locals.account ? await store.getAuto(owner(res), game.id) : null;
    res.json({ id: game.id, title: game.title, subtitle: game.subtitle, description: game.description, version: game.version, cover: game.cover,
      guide: game.guide ? { intro: game.guide.intro, steps: game.guide.steps.map(({ id, title, text }) => ({ id, title, text })) } : undefined,
      playerFields: game.playerFields, hasAuto: !!save && !!await savedScript(game.id, save.state), gallery: await galleryView(game, res) });
  });
  app.use('/api/games/:gameId', (_req, res, next) => {
    if (!res.locals.account) return res.status(401).json({ error: '请先登录' });
    next();
  });
  app.get('/api/games/:gameId/current', async (req, res) => { const { game, save } = await current(req, res); await sendCurrent(res, game, save); });
  app.get('/api/games/:gameId/debug', async (req, res) => {
    if (!options.debugEnabled) return res.status(404).json({ error: '诊断接口未开启' });
    const { save } = await current(req, res);
    return res.json({ turns: save.state.ruleDiagnostics ?? [] });
  });
  app.post('/api/games/:gameId/new', async (req, res) => {
    const game = await script(req);
    const state = createInitialState(game, readPlayer(game.playerFields, req.body?.player));
    const save = await store.putAuto(owner(res), game.id, state);
    await sendCurrent(res, game, save);
  });
  app.get('/api/games/:gameId/slots', async (req, res) => {
    const game = await script(req);
    res.json({ slots: await Promise.all((await store.listSlots(owner(res), game.id)).map(async ({ slot, label, updatedAt, state }) => {
      const pinned = await savedScript(game.id, state);
      return { slot, label, updatedAt, scriptVersion: state.scriptVersion, loadable: !!pinned,
        playerName: state.player.name ?? '', day: state.day,
        location: pinned?.locations.find((entry) => entry.id === state.locationId)?.name ?? state.locationId };
    })) });
  });
  app.post('/api/games/:gameId/slots/:slot', async (req, res) => {
    const { game, save } = await current(req, res);
    const slot = Number(req.params.slot);
    const manual = await store.saveManual(owner(res), game.id, slot, String(req.body?.label ?? `存档 ${slot}`), save.state);
    res.json({ slot: manual.slot, label: manual.label, updatedAt: manual.updatedAt });
  });
  app.post('/api/games/:gameId/slots/:slot/load', async (req, res) => {
    const gameId = req.params.gameId as string;
    const manual = await store.getSlot(owner(res), gameId, Number(req.params.slot));
    if (!manual) throw new Error('存档不存在');
    const game = await savedScript(gameId, manual.state);
    if (!game) throw new Error('存档对应的已发布剧本版本不存在或内容不匹配');
    const loaded = await store.loadManual(owner(res), gameId, Number(req.params.slot));
    if (!loaded) throw new Error('存档不存在');
    await sendCurrent(res, game, loaded);
  });
  app.delete('/api/games/:gameId/slots/:slot', async (req, res) => {
    const game = await script(req);
    await store.deleteManual(owner(res), game.id, Number(req.params.slot));
    res.json({ ok: true });
  });
  app.get('/api/games/:gameId/slots/:slot/export', async (req, res) => {
    const game = await script(req);
    const save = await store.getSlot(owner(res), game.id, Number(req.params.slot));
    if (!save) throw new Error('存档不存在');
    res.setHeader('Content-Disposition', `attachment; filename="${game.id}-slot-${save.slot}.json"`);
    res.json({ format: 'game-dd-save-v1', gameId: game.id, scriptVersion: save.state.scriptVersion, state: save.state });
  });
  app.post('/api/games/:gameId/import', async (req, res) => {
    const gameId = req.params.gameId as string;
    const state = req.body?.state as GameState | undefined;
    const game = state && await savedScript(gameId, state);
    if (req.body?.format !== 'game-dd-save-v1' || req.body?.gameId !== gameId || !game || !state.player || !state.chats) throw new Error('存档格式或剧本版本不匹配');
    const save = await store.putAuto(owner(res), gameId, state);
    await sendCurrent(res, game, save);
  });
  app.post('/api/games/:gameId/action', async (req, res) => {
    const { game, save } = await current(req, res);
    if (req.body?.revision !== save.revision) throw new Error('存档已变化，请刷新后重试');
    let next = save.state;
    let text = '';
    let kind: ActivityAction['kind'];
    if (req.body?.type === 'move') {
      const destination = game.locations.find((entry) => entry.id === req.body.locationId);
      if (!destination || !canEnterLocation(game, next, destination.id)) throw new Error('地点当前不可进入');
      next = discoverPresentNpcs(game, { ...structuredClone(next), locationId: destination.id });
      text = `来到了${destination.name}。`;
      kind = 'move';
    } else if (req.body?.type === 'wait') {
      next = advanceTime(game, next);
      text = `时间来到第 ${next.day} 天${game.periods[next.periodIndex]}。`;
      kind = 'wait';
    } else if (req.body?.type === 'explore') {
      const result = exploreSpot(game, next, String(req.body.spotId ?? ''));
      next = result.state;
      text = result.text ?? '';
      if (!text) throw new Error('调查点不存在');
      kind = 'explore';
    } else if (req.body?.type === 'search') {
      const result = searchLocation(game, next);
      next = result.state;
      text = result.discovered.length ? `发现了${result.discovered.map((id) => `[${game.items.find((item) => item.id === id)?.name ?? id}]`).join('、')}。` : '仔细搜索了一番，暂时没有新的发现。';
      kind = 'search';
    } else if (req.body?.type === 'take') {
      if (!makeView(game, next).location?.items.some((entry) => entry.id === req.body.itemId)) throw new Error('这里没有可获取的道具');
      const result = takeLocationItem(game, next, String(req.body.itemId ?? ''));
      next = result.state; text = result.text;
      kind = 'take';
    } else throw new Error('未知操作');
    const action = { kind, summary: text };
    const settled = settleWorld(game, save.state, next, action);
    const logged = appendActivity(game, settled.state, action, settled.changes);
    const updated = await store.updateAutoWithGallery(owner(res), game.id, save.revision, logged);
    await sendCurrent(res, game, updated, { actionText: text, changes: settled.changes });
  });
  app.post('/api/games/:gameId/chat', async (req, res) => {
    const { game, save } = await current(req, res);
    if (req.body?.revision !== save.revision) throw new Error('存档已变化，请刷新后重试');
    const attribution = formalAudit(owner(res), game, randomUUID());
    const result = await runChat(game, save.state, String(req.body?.npcId ?? ''), String(req.body?.text ?? ''), adapter,
      { audit: attribution });
    const updated = await store.updateAutoWithGallery(owner(res), game.id, save.revision, result.state);
    await sendCurrent(res, game, updated, { appliedEvents: result.appliedEvents.map(({ narration }) => ({ narration })), changes: result.changes });
    void queueMemory(owner(res), game, updated, String(req.body?.npcId ?? ''), attribution);
  });
  app.post('/api/games/:gameId/chat/stream', async (req, res) => {
    const write = (event: string, value: object) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
    try {
      const gameId = req.params.gameId as string;
      const turnId = String(req.body?.turnId ?? '');
      if (!turnId || turnId.length > 100) throw new Error('对话轮次 ID 无效');
      const ownerId = owner(res);
      const stored = await store.getAuto(ownerId, gameId);
      if (!stored) throw new Error('没有自动存档，请先开始新游戏');
      const game = await savedScript(gameId, stored.state);
      if (!game) throw new Error('存档对应的已发布剧本版本不存在或内容不匹配');
      const key = JSON.stringify([ownerId, game.id, turnId]);
      const npcId = String(req.body?.npcId ?? '');
      const playerText = String(req.body?.text ?? '').trim();
      const savedTurn = Object.entries(stored.state.chats).flatMap(([id, messages]) => messages
        .filter((message) => message.role === 'player' && message.turnId === turnId)
        .map((message) => ({ npcId: id, text: message.text }))).at(0);
      const inFlight = inFlightTurns.get(key);
      if ((savedTurn && (savedTurn.npcId !== npcId || savedTurn.text !== playerText)) ||
        (inFlight && (inFlight.npcId !== npcId || inFlight.text !== playerText))) throw new Error('对话轮次 ID 已用于其他内容');
      const alreadySaved = !!savedTurn;
      if (!alreadySaved && !inFlightTurns.has(key) && req.body?.revision !== stored.revision) throw new Error('存档已变化，请刷新后重试');
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      if (alreadySaved) {
        write('final', { session: await currentPayload(res, game, stored, { changes: [] }) });
      } else {
        let task = inFlight?.task;
        if (!task) {
          task = (async () => {
            const result = await runChat(game, stored.state, npcId,
              playerText, adapter, { turnId, audit: formalAudit(ownerId, game, turnId), onDraft: (delta) => write('draft', { delta }),
                onStatus: (text) => write('status', { text }) });
            const saved = await store.updateAutoWithGallery(ownerId, game.id, stored.revision, result.state);
            void queueMemory(ownerId, game, saved, npcId, formalAudit(ownerId, game, turnId));
            return { game, save: saved, result };
          })();
          inFlightTurns.set(key, { npcId, text: playerText, task });
          void task.finally(() => inFlightTurns.delete(key)).catch(() => {});
        }
        const completed = await task;
        write('final', { session: await currentPayload(res, completed.game, completed.save,
          { appliedEvents: completed.result.appliedEvents.map(({ narration }) => ({ narration })), changes: completed.result.changes }) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '服务器错误';
      const status = error instanceof AiServiceError ? error.status : message.includes('存档已变化') ? 409 : 400;
      if (res.headersSent) write('error', { message, status });
      else res.status(status).json({ error: message });
    } finally { if (!res.destroyed && !res.writableEnded) res.end(); }
  });
  app.use('/api', (error: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    const message = error.message || '服务器错误';
    const status = error instanceof AiServiceError ? error.status : error instanceof ScriptNotFoundError ? 404
      : (error as Error & { status?: number }).status === 413 ? 413
        : message.includes('存档已变化') ? 409 : message.includes('没有自动存档') ? 404 : 400;
    res.status(status).json({ error: message });
  });
  return app;
}
