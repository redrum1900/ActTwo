import type { Request, Response } from 'express';
import type { GameScript, GameState } from '@game/contracts';
import { evaluateCondition, makeView, refreshWorld } from '@game/engine';
import { contentHashOf } from '@game/script';
import type { ChatAdapter } from './chat-service.js';
import type { SaveRecord } from './save-types.js';
import type { MysqlSaveStore } from '../../infrastructure/mysql/mysql-save-store.js';
import type { ScriptRepository, AsyncScriptRepository } from '../../script-repository.js';
import type { CreatorAccount } from '../auth/types.js';

export type GameStore = MysqlSaveStore;
export type GameScripts = ScriptRepository | AsyncScriptRepository;

function visiblePayload(script: GameScript, state: GameState, revision: number, adapter: ChatAdapter) {
  const view = makeView(script, state);
  const hints: Record<string, { id: string; text: string }[]> = {};
  for (const npc of view.npcs) hints[npc.id] = script.events
    .filter(event => event.npc === npc.id && event.hint && (!event.once || !state.completedEvents.includes(event.id)) &&
      evaluateCondition(event.when ?? event.condition, state, script, npc.id))
    .map(event => ({ id: event.id, text: event.hint! }));
  return { view, revision, hints, aiMode: adapter.mode };
}

export function createGameSessionContext(store: GameStore, adapter: ChatAdapter, scripts: GameScripts) {
  const owner = (res: Response) => (res.locals.account as CreatorAccount).id;
  const script = async (req: Request) => scripts.get(req.params.gameId as string);
  const compatible = (game: GameScript, state: GameState) => state.scriptVersion === game.version && state.scriptHash === game.contentHash &&
    game.npcs.every(npc => !npc.indicators || npc.indicators.every(indicator => state.npcIndicators?.[npc.id]?.[indicator.id] !== undefined));
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
    return [...game.endings.map(entry => ({ ...entry, kind: 'ending' as const })),
      ...game.achievements.map(entry => ({ ...entry, kind: 'achievement' as const }))]
      .map(entry => ({ id: entry.id, kind: entry.kind, unlocked: unlocked.some(value => value.id === entry.id && value.kind === entry.kind),
        name: entry.hidden && !unlocked.some(value => value.id === entry.id && value.kind === entry.kind) ? '？？？' : entry.name,
        description: entry.hidden && !unlocked.some(value => value.id === entry.id && value.kind === entry.kind) ? '继续游戏以解锁' : entry.description }));
  };
  const currentPayload = async (res: Response, game: GameScript, save: SaveRecord, extra: object = {}) => {
    const state = refreshWorld(game, save.state);
    return { ...visiblePayload(game, state, save.revision, adapter), gallery: await galleryView(game, res), ...extra };
  };
  const sendCurrent = async (res: Response, game: GameScript, save: SaveRecord, extra: object = {}) =>
    res.json(await currentPayload(res, game, save, extra));

  return { store, adapter, scripts, owner, script, savedScript, current, galleryView, currentPayload, sendCurrent };
}

export type GameSessionContext = ReturnType<typeof createGameSessionContext>;
