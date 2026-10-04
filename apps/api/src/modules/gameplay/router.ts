import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { type GameScript, type GameState } from '@game/contracts';
import { advanceTime, canEnterLocation, createInitialState, discoverPresentNpcs, exploreSpot, makeView, searchLocation, takeLocationItem } from '@game/engine';
import { appendActivity, settleWorld, type ActivityAction } from '@game/engine/activity-log';
import { runChat } from './chat-service.js';
import { AiServiceError } from '../../infrastructure/ai/ai-adapter.js';
import { createMemoryWorker } from './memory-worker.js';
import { readPlayer } from './read-player.js';
import type { AiAttribution } from '../../infrastructure/ai/ai-audit.js';
import type { SaveRecord } from './save-types.js';
import type { GameSessionContext } from './session.js';

export function createGameplayRouter(context: GameSessionContext, { debugEnabled = false }: { debugEnabled?: boolean } = {}) {
  const router = Router({ mergeParams: true });
  const { store, adapter, owner, script, savedScript, current, currentPayload, sendCurrent } = context;
  const queueMemory = createMemoryWorker(store, adapter);
  const formalAudit = (accountId: string, game: GameScript, operationId: string): AiAttribution =>
    ({ accountId, source: 'formal', storyId: game.id, releaseVersion: game.version, operationId });
  const inFlightTurns = new Map<string, { npcId: string; text: string; task: Promise<{ game: GameScript; save: SaveRecord; result: Awaited<ReturnType<typeof runChat>> }> }>();
  router.use('/', (_req, res, next) => {
    if (!res.locals.account) return res.status(401).json({ error: '请先登录' });
    next();
  });
  router.get('/current', async (req, res) => { const { game, save } = await current(req, res); await sendCurrent(res, game, save); });
  router.get('/debug', async (req, res) => {
    if (!debugEnabled) return res.status(404).json({ error: '诊断接口未开启' });
    const { save } = await current(req, res);
    return res.json({ turns: save.state.ruleDiagnostics ?? [] });
  });
  router.post('/new', async (req, res) => {
    const game = await script(req);
    const state = createInitialState(game, readPlayer(game.playerFields, req.body?.player));
    const save = await store.putAuto(owner(res), game.id, state);
    await sendCurrent(res, game, save);
  });
  router.get('/slots', async (req, res) => {
    const game = await script(req);
    res.json({ slots: await Promise.all((await store.listSlots(owner(res), game.id)).map(async ({ slot, label, updatedAt, state }) => {
      const pinned = await savedScript(game.id, state);
      return { slot, label, updatedAt, scriptVersion: state.scriptVersion, loadable: !!pinned,
        playerName: state.player.name ?? '', day: state.day,
        location: pinned?.locations.find((entry) => entry.id === state.locationId)?.name ?? state.locationId };
    })) });
  });
  router.post('/slots/:slot', async (req, res) => {
    const { game, save } = await current(req, res);
    const slot = Number(req.params.slot);
    const manual = await store.saveManual(owner(res), game.id, slot, String(req.body?.label ?? `存档 ${slot}`), save.state);
    res.json({ slot: manual.slot, label: manual.label, updatedAt: manual.updatedAt });
  });
  router.post<{ gameId: string; slot: string }>('/slots/:slot/load', async (req, res) => {
    const gameId = req.params.gameId as string;
    const manual = await store.getSlot(owner(res), gameId, Number(req.params.slot));
    if (!manual) throw new Error('存档不存在');
    const game = await savedScript(gameId, manual.state);
    if (!game) throw new Error('存档对应的已发布剧本版本不存在或内容不匹配');
    const loaded = await store.loadManual(owner(res), gameId, Number(req.params.slot));
    if (!loaded) throw new Error('存档不存在');
    await sendCurrent(res, game, loaded);
  });
  router.delete('/slots/:slot', async (req, res) => {
    const game = await script(req);
    await store.deleteManual(owner(res), game.id, Number(req.params.slot));
    res.json({ ok: true });
  });
  router.get('/slots/:slot/export', async (req, res) => {
    const game = await script(req);
    const save = await store.getSlot(owner(res), game.id, Number(req.params.slot));
    if (!save) throw new Error('存档不存在');
    res.setHeader('Content-Disposition', `attachment; filename="${game.id}-slot-${save.slot}.json"`);
    res.json({ format: 'game-dd-save-v1', gameId: game.id, scriptVersion: save.state.scriptVersion, state: save.state });
  });
  router.post<{ gameId: string }>('/import', async (req, res) => {
    const gameId = req.params.gameId as string;
    const state = req.body?.state as GameState | undefined;
    const game = state && await savedScript(gameId, state);
    if (req.body?.format !== 'game-dd-save-v1' || req.body?.gameId !== gameId || !game || !state.player || !state.chats) throw new Error('存档格式或剧本版本不匹配');
    const save = await store.putAuto(owner(res), gameId, state);
    await sendCurrent(res, game, save);
  });
  router.post('/action', async (req, res) => {
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
  router.post('/chat', async (req, res) => {
    const { game, save } = await current(req, res);
    if (req.body?.revision !== save.revision) throw new Error('存档已变化，请刷新后重试');
    const attribution = formalAudit(owner(res), game, randomUUID());
    const result = await runChat(game, save.state, String(req.body?.npcId ?? ''), String(req.body?.text ?? ''), adapter,
      { audit: attribution });
    const updated = await store.updateAutoWithGallery(owner(res), game.id, save.revision, result.state);
    await sendCurrent(res, game, updated, { appliedEvents: result.appliedEvents.map(({ narration }) => ({ narration })), changes: result.changes });
    void queueMemory(owner(res), game, updated, String(req.body?.npcId ?? ''), attribution);
  });
  router.post<{ gameId: string }>('/chat/stream', async (req, res) => {
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
  return router;
}
