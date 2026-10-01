import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import type { ChatAdapter } from './chat-service.js';
import { runChat } from './chat-service.js';
import { AiServiceError } from './ai-adapter.js';
import type { SaveStore } from './save-store.js';
import type { FieldDefinition, GameScript, GameState } from '@game/contracts';
import { advanceTime, canEnterLocation, createInitialState, discoverPresentNpcs, evaluateCondition, exploreSpot, makeView, refreshWorld, searchLocation, takeLocationItem } from '@game/engine';
import { appendActivity, settleWorld, type ActivityAction } from '@game/engine/activity-log';
import { listScripts, loadScript } from '@game/script';
import { createMemoryWorker } from './memory-worker.js';
import { createCreatorRouter } from './creator/auth-router.js';
import type { CreatorStore } from './creator/auth-store.js';

function readPlayer(fields: readonly FieldDefinition[], input: unknown): GameState['player'] {
  const values = (input && typeof input === 'object' && !Array.isArray(input)) ? input as Record<string, unknown> : {};
  const player: GameState['player'] = {};
  for (const field of fields) {
    const raw = field.editable === false ? field.default : values[field.id] ?? field.default ?? (field.type === 'checkbox' ? [] : '');
    if (field.type === 'checkbox') {
      if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string' || !field.options?.some((option) => option.value === value))) throw new Error(`${field.label}选项无效`);
      if (field.required && raw.length === 0) throw new Error(`请填写${field.label}`);
      player[field.id] = raw as string[];
    } else {
      if (typeof raw !== 'string' || raw.length > 100 || (field.required && !raw.trim())) throw new Error(`请正确填写${field.label}`);
      if (field.type === 'date' && raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${field.label}日期无效`);
      if ((field.type === 'radio' || field.type === 'select') && !field.options?.some((option) => option.value === raw)) throw new Error(`${field.label}选项无效`);
      player[field.id] = raw;
    }
  }
  return player;
}

function visiblePayload(script: GameScript, state: GameState, revision: number, adapter: ChatAdapter) {
  const view = makeView(script, state);
  const hints: Record<string, { id: string; text: string }[]> = {};
  for (const npc of view.npcs) hints[npc.id] = script.events
    .filter((event) => event.npc === npc.id && event.hint && (!event.once || !state.completedEvents.includes(event.id)) && evaluateCondition(event.when ?? event.condition, state, script, npc.id))
    .map((event) => ({ id: event.id, text: event.hint! }));
  return { view, revision, hints, aiMode: adapter.mode };
}

export function createApp(store: SaveStore, adapter: ChatAdapter, options: { debugEnabled?: boolean; creatorStore?: CreatorStore } = {}) {
  const app = express();
  const queueMemory = createMemoryWorker(store, adapter);
  const inFlightTurns = new Map<string, { npcId: string; text: string; task: Promise<{ game: GameScript; save: NonNullable<ReturnType<SaveStore['getAuto']>>; result: Awaited<ReturnType<typeof runChat>> }> }>();
  app.use(express.json({ limit: '2mb' }));
  if (options.creatorStore) app.use('/api/creator', createCreatorRouter(options.creatorStore));
  app.use('/api', (req, res, next) => {
    const cookie = req.headers.cookie?.match(/(?:^|;\s*)gd_guest=([a-f0-9-]{36})(?:;|$)/)?.[1];
    const owner = cookie ?? randomUUID();
    if (!cookie) res.cookie('gd_guest', owner, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 365 * 24 * 60 * 60 * 1000 });
    res.locals.owner = owner;
    next();
  });

  const owner = (res: Response) => res.locals.owner as string;
  const script = (req: Request) => loadScript(req.params.gameId as string);
  const compatible = (game: GameScript, state: GameState) => state.scriptVersion === game.version && state.scriptHash === game.contentHash &&
    game.npcs.every((npc) => !npc.indicators || npc.indicators.every((indicator) => state.npcIndicators?.[npc.id]?.[indicator.id] !== undefined));
  const current = (req: Request, res: Response) => {
    const game = script(req);
    const save = store.getAuto(owner(res), game.id);
    if (!save) throw new Error('没有自动存档，请先开始新游戏');
    if (!compatible(game, save.state)) throw new Error('存档剧本版本与当前安装版本不同');
    return { game, save: { ...save, state: refreshWorld(game, save.state) } };
  };
  const galleryView = (game: GameScript, res: Response) => {
    const unlocked = store.getGallery(owner(res), game.id);
    return [...game.endings.map((entry) => ({ ...entry, kind: 'ending' as const })),
      ...game.achievements.map((entry) => ({ ...entry, kind: 'achievement' as const }))]
      .map((entry) => ({ id: entry.id, kind: entry.kind, unlocked: unlocked.some((value) => value.id === entry.id && value.kind === entry.kind),
        name: entry.hidden && !unlocked.some((value) => value.id === entry.id && value.kind === entry.kind) ? '？？？' : entry.name,
        description: entry.hidden && !unlocked.some((value) => value.id === entry.id && value.kind === entry.kind) ? '继续游戏以解锁' : entry.description }));
  };
  const currentPayload = (res: Response, game: GameScript, save: NonNullable<ReturnType<SaveStore['getAuto']>>, extra: object = {}) => {
    const state = refreshWorld(game, save.state);
    return { ...visiblePayload(game, state, save.revision, adapter), gallery: galleryView(game, res), ...extra };
  };
  const sendCurrent = (res: Response, game: GameScript, save: NonNullable<ReturnType<SaveStore['getAuto']>>, extra: object = {}) =>
    res.json(currentPayload(res, game, save, extra));

  app.get('/api/catalog', (_req, res) => {
    res.json({ games: listScripts().map((game) => ({ id: game.id, version: game.version, title: game.title, subtitle: game.subtitle, cover: game.cover,
      description: game.description, hasAuto: !!store.getAuto(owner(res), game.id) && compatible(game, store.getAuto(owner(res), game.id)!.state) })) });
  });
  app.get('/api/games/:gameId', (req, res) => {
    const game = script(req);
    res.json({ id: game.id, title: game.title, subtitle: game.subtitle, description: game.description, version: game.version, cover: game.cover,
      guide: game.guide ? { intro: game.guide.intro, steps: game.guide.steps.map(({ id, title, text }) => ({ id, title, text })) } : undefined,
      playerFields: game.playerFields, hasAuto: !!store.getAuto(owner(res), game.id) && compatible(game, store.getAuto(owner(res), game.id)!.state), gallery: galleryView(game, res) });
  });
  app.get('/api/games/:gameId/current', (req, res) => { const { game, save } = current(req, res); sendCurrent(res, game, save); });
  app.get('/api/games/:gameId/debug', (req, res) => {
    if (!options.debugEnabled) return res.status(404).json({ error: '诊断接口未开启' });
    const { save } = current(req, res);
    return res.json({ turns: save.state.ruleDiagnostics ?? [] });
  });
  app.post('/api/games/:gameId/new', (req, res) => {
    const game = script(req);
    const state = createInitialState(game, readPlayer(game.playerFields, req.body?.player));
    const save = store.putAuto(owner(res), game.id, state);
    sendCurrent(res, game, save);
  });
  app.get('/api/games/:gameId/slots', (req, res) => {
    const game = script(req);
    res.json({ slots: store.listSlots(owner(res), game.id).filter(({ state }) => compatible(game, state)).map(({ slot, label, updatedAt, state }) => ({
      slot, label, updatedAt, playerName: state.player.name ?? '', day: state.day,
      location: game.locations.find((entry) => entry.id === state.locationId)?.name ?? state.locationId,
    })) });
  });
  app.post('/api/games/:gameId/slots/:slot', (req, res) => {
    const { game, save } = current(req, res);
    const slot = Number(req.params.slot);
    const manual = store.saveManual(owner(res), game.id, slot, String(req.body?.label ?? `存档 ${slot}`), save.state);
    res.json({ slot: manual.slot, label: manual.label, updatedAt: manual.updatedAt });
  });
  app.post('/api/games/:gameId/slots/:slot/load', (req, res) => {
    const game = script(req);
    const manual = store.getSlot(owner(res), game.id, Number(req.params.slot));
    if (manual && !compatible(game, manual.state)) throw new Error('存档剧本版本与当前安装版本不同');
    const loaded = store.loadManual(owner(res), game.id, Number(req.params.slot));
    if (!loaded) throw new Error('存档不存在');
    sendCurrent(res, game, loaded);
  });
  app.delete('/api/games/:gameId/slots/:slot', (req, res) => {
    const game = script(req);
    store.deleteManual(owner(res), game.id, Number(req.params.slot));
    res.json({ ok: true });
  });
  app.get('/api/games/:gameId/slots/:slot/export', (req, res) => {
    const game = script(req);
    const save = store.getSlot(owner(res), game.id, Number(req.params.slot));
    if (!save) throw new Error('存档不存在');
    res.setHeader('Content-Disposition', `attachment; filename="${game.id}-slot-${save.slot}.json"`);
    res.json({ format: 'game-dd-save-v1', gameId: game.id, scriptVersion: save.state.scriptVersion, state: save.state });
  });
  app.post('/api/games/:gameId/import', (req, res) => {
    const game = script(req);
    const state = req.body?.state as GameState | undefined;
    if (req.body?.format !== 'game-dd-save-v1' || req.body?.gameId !== game.id || state?.scriptId !== game.id || !compatible(game, state) || !state.player || !state.chats) throw new Error('存档格式或剧本版本不匹配');
    const save = store.putAuto(owner(res), game.id, state);
    sendCurrent(res, game, save);
  });
  app.post('/api/games/:gameId/action', (req, res) => {
    const { game, save } = current(req, res);
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
    const updated = store.updateAutoWithGallery(owner(res), game.id, save.revision, logged);
    sendCurrent(res, game, updated, { actionText: text, changes: settled.changes });
  });
  app.post('/api/games/:gameId/chat', async (req, res) => {
    const { game, save } = current(req, res);
    if (req.body?.revision !== save.revision) throw new Error('存档已变化，请刷新后重试');
    const result = await runChat(game, save.state, String(req.body?.npcId ?? ''), String(req.body?.text ?? ''), adapter);
    const updated = store.updateAutoWithGallery(owner(res), game.id, save.revision, result.state);
    sendCurrent(res, game, updated, { appliedEvents: result.appliedEvents.map(({ narration }) => ({ narration })), changes: result.changes });
    void queueMemory(owner(res), game, updated, String(req.body?.npcId ?? ''));
  });
  app.post('/api/games/:gameId/chat/stream', async (req, res) => {
    const write = (event: string, value: object) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
    try {
      const game = script(req);
      const turnId = String(req.body?.turnId ?? '');
      if (!turnId || turnId.length > 100) throw new Error('对话轮次 ID 无效');
      const ownerId = owner(res);
      const stored = store.getAuto(ownerId, game.id);
      if (!stored) throw new Error('没有自动存档，请先开始新游戏');
      if (!compatible(game, stored.state)) throw new Error('存档剧本版本与当前安装版本不同');
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
        write('final', { session: currentPayload(res, game, stored, { changes: [] }) });
      } else {
        let task = inFlight?.task;
        if (!task) {
          task = (async () => {
            const result = await runChat(game, stored.state, npcId,
              playerText, adapter, { turnId, onDraft: (delta) => write('draft', { delta }),
                onStatus: (text) => write('status', { text }) });
            const saved = store.updateAutoWithGallery(ownerId, game.id, stored.revision, result.state);
            void queueMemory(ownerId, game, saved, npcId);
            return { game, save: saved, result };
          })();
          inFlightTurns.set(key, { npcId, text: playerText, task });
          void task.finally(() => inFlightTurns.delete(key)).catch(() => {});
        }
        const completed = await task;
        write('final', { session: currentPayload(res, completed.game, completed.save,
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
    const status = error instanceof AiServiceError ? error.status : message.includes('存档已变化') ? 409 : message.includes('没有自动存档') ? 404 : 400;
    res.status(status).json({ error: message });
  });
  return app;
}
