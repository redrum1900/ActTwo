import express, { type Request } from 'express';
import type { MysqlCreatorStore } from '../../infrastructure/mysql/mysql-auth-store.js';
import type { MysqlProjectStore } from '../../infrastructure/mysql/mysql-project-store.js';
import type { MysqlPlaytestStore, PlaytestRecord } from '../../infrastructure/mysql/mysql-playtest-store.js';
import { creatorAccount } from '../auth/auth-router.js';
import { ProjectError } from '../creator/projects/types.js';
import { AiServiceError } from '../../infrastructure/ai/ai-adapter.js';
import { createInitialState } from '@game/engine';
import { readPlayer } from '../gameplay/read-player.js';
import { playtestDetail, playtestPayload, settlePlaytestAction } from './session.js';
import { runChat, type ChatAdapter } from '../gameplay/chat-service.js';
import { deriveChatContext } from '../gameplay/chat-service.js';
import { compressMemory } from '../gameplay/memory-policy.js';
import type { AiAttribution } from '../../infrastructure/ai/ai-audit.js';

export function createPlaytestRouter(accounts: MysqlCreatorStore,
  projects: Pick<MysqlProjectStore, 'validatedDraft'>, playtests: MysqlPlaytestStore, adapter: ChatAdapter) {
  const router = express.Router();
  const inFlight = new Map<string, { npcId: string; text: string; task: Promise<PlaytestRecord> }>();
  const memoryJobs = new Map<string, Promise<void>>();
  const queueMemory = (found: PlaytestRecord, saved: PlaytestRecord, npcId: string, turnId: string, audit: AiAttribution) => {
    if (!adapter.summarize || !saved.auto) return;
    const npc = found.script.npcs.find(entry => entry.id === npcId);
    if (!npc) return;
    const key = JSON.stringify([found.ownerId, found.projectId, found.id, npcId]);
    if (memoryJobs.has(key)) return;
    const task = Promise.resolve().then(async () => {
      const derived = await compressMemory(deriveChatContext(found.script, saved.auto!.state, npc, '', turnId, audit), adapter.summarize!);
      if (derived !== saved.auto!.state)
        await playtests.updateDerivedMemory(found.ownerId, found.projectId, found.id, saved.auto!, derived);
    }).catch(() => { console.warn('试玩后台记忆任务未完成，原始聊天记录保留'); })
      .finally(() => { memoryJobs.delete(key); });
    memoryJobs.set(key, task);
  };
  router.use(async (req, res, next) => {
    const account = await creatorAccount(req, accounts);
    if (!account) return res.status(401).json({ error: '请先登录创作中心' });
    res.locals.creatorId = account.id;
    next();
  });
  const owner = (req: Request) => req.res!.locals.creatorId as string;
  const ids = (req: Request) => [owner(req), req.params.id as string, req.params.playtestId as string] as const;
  const record = async (req: Request) => {
    const found = await playtests.get(...ids(req));
    if (!found) throw new ProjectError('试玩记录不存在或无权访问', 404);
    return found;
  };
  const handle = (action: (req: Request) => Promise<unknown>, status = 200) => async (req: Request, res: express.Response) => {
    try { res.status(status).json(await action(req)); }
    catch (error) { res.status(error instanceof ProjectError ? error.status : error instanceof AiServiceError ? error.status : 400)
      .json({ error: error instanceof Error ? error.message : '试玩操作失败' }); }
  };
  router.get('/projects/:id/playtests', handle(async req => ({ playtests: (await playtests.list(owner(req), req.params.id as string))
    .map(entry => ({ id: entry.id, projectId: entry.projectId, createdAt: entry.createdAt, playedAt: entry.playedAt,
      started: !!entry.auto, scriptHash: entry.scriptHash })) })));
  router.post('/projects/:id/playtests', handle(async req => {
    const projectId = req.params.id as string;
    const created = await playtests.create(owner(req), projectId,
      connection => projects.validatedDraft(owner(req), projectId, connection));
    return { id: created.id, projectId, createdAt: created.createdAt, started: false, scriptHash: created.scriptHash };
  }, 201));
  router.get('/projects/:id/playtests/:playtestId', handle(async req => {
    const found = await record(req);
    return { id: found.id, projectId: found.projectId, createdAt: found.createdAt, playedAt: found.playedAt,
      started: !!found.auto, scriptHash: found.scriptHash, detail: playtestDetail(found) };
  }));
  router.delete('/projects/:id/playtests/:playtestId', handle(async req => {
    if (!await playtests.delete(...ids(req))) throw new ProjectError('试玩记录不存在或无权访问', 404);
    return { ok: true };
  }));
  router.post('/projects/:id/playtests/:playtestId/new', handle(async req => {
    const found = await record(req);
    const state = createInitialState(found.script, readPlayer(found.script.playerFields, req.body?.player));
    return playtestPayload(await playtests.initialize(...ids(req), state), adapter);
  }));
  router.get('/projects/:id/playtests/:playtestId/current', handle(async req => {
    const found = await record(req);
    if (!found.auto) throw new ProjectError('试玩尚未开始', 404);
    return playtestPayload(found, adapter);
  }));
  router.post('/projects/:id/playtests/:playtestId/action', handle(async req => {
    const found = await record(req);
    if (!found.auto) throw new ProjectError('试玩尚未开始', 404);
    if (req.body?.revision !== found.auto.revision) throw new ProjectError('试玩存档已变化，请刷新后重试', 409);
    const result = settlePlaytestAction(found.script, found.auto.state, req.body ?? {});
    const saved = await playtests.updateAuto(...ids(req), found.auto.revision, result.state);
    return playtestPayload(saved, adapter, { actionText: result.actionText, changes: result.changes });
  }));
  router.post('/projects/:id/playtests/:playtestId/chat/stream', async (req, res) => {
    const write = (event: string, value: object) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
    try {
      const found = await record(req);
      if (!found.auto) throw new ProjectError('试玩尚未开始', 404);
      const turnId = String(req.body?.turnId ?? '');
      if (!turnId || turnId.length > 100) throw new ProjectError('对话轮次 ID 无效');
      const npcId = String(req.body?.npcId ?? '');
      const text = String(req.body?.text ?? '').trim();
      const savedTurn = Object.entries(found.auto.state.chats).flatMap(([id, messages]) => messages
        .filter(message => message.role === 'player' && message.turnId === turnId)
        .map(message => ({ npcId: id, text: message.text }))).at(0);
      const key = JSON.stringify([...ids(req), turnId]);
      const pending = inFlight.get(key);
      if ((savedTurn && (savedTurn.npcId !== npcId || savedTurn.text !== text)) ||
        (pending && (pending.npcId !== npcId || pending.text !== text)))
        throw new ProjectError('对话轮次 ID 已用于其他内容', 409);
      if (!savedTurn && !pending && req.body?.revision !== found.auto.revision)
        throw new ProjectError('试玩存档已变化，请刷新后重试', 409);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.flushHeaders();
      if (savedTurn) write('final', { session: playtestPayload(found, adapter, { changes: [] }) });
      else {
        let task = pending?.task;
        if (!task) {
          task = (async () => {
            const audit: AiAttribution = { accountId: owner(req), source: 'playtest', storyId: found.projectId,
              playtestId: found.id, operationId: turnId };
            const result = await runChat(found.script, found.auto!.state, npcId, text, adapter,
              { turnId, audit,
              onDraft: delta => write('draft', { delta }), onStatus: status => write('status', { text: status }) });
            const saved = await playtests.updateAuto(...ids(req), found.auto!.revision, result.state);
            queueMemory(found, saved, npcId, turnId, audit);
            return saved;
          })();
          inFlight.set(key, { npcId, text, task });
          void task.finally(() => inFlight.delete(key)).catch(() => {});
        }
        write('final', { session: playtestPayload(await task, adapter) });
      }
    } catch (error) {
      const status = error instanceof ProjectError ? error.status : error instanceof AiServiceError ? error.status : 400;
      const message = error instanceof Error ? error.message : '试玩对话失败';
      if (res.headersSent) write('error', { message, status });
      else res.status(status).json({ error: message });
    } finally { if (!res.destroyed && !res.writableEnded) res.end(); }
  });
  return router;
}
