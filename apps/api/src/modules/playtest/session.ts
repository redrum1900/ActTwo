import type { GameScript, GameState } from '@game/contracts';
import { advanceTime, canEnterLocation, discoverPresentNpcs, evaluateCondition, exploreSpot, makeView,
  refreshWorld, searchLocation, takeLocationItem } from '@game/engine';
import { appendActivity, settleWorld, type ActivityAction } from '@game/engine/activity-log';
import type { ChatAdapter } from '../gameplay/chat-service.js';
import type { PlaytestRecord } from '../../infrastructure/mysql/mysql-playtest-store.js';

function draftAsset(projectId: string, url: string | undefined): string | undefined {
  if (!url) return url;
  const cover = /^\/api\/covers\/([a-z0-9-]+)$/.exec(url);
  if (cover) return `/api/creator/projects/${encodeURIComponent(projectId)}/covers/${cover[1]}`;
  const item = /^\/api\/item-images\/([a-z0-9-]+)$/.exec(url);
  return item ? `/api/creator/projects/${encodeURIComponent(projectId)}/item-images/${item[1]}` : url;
}
function draftViewAssets<T>(projectId: string, source: T): T {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
      key === 'image' || key === 'cover' ? draftAsset(projectId, entry as string | undefined) : walk(entry)]));
  };
  return walk(source) as T;
}

export function playtestDetail(record: PlaytestRecord) {
  const game = record.script;
  return { id: game.id, title: game.title, subtitle: game.subtitle, description: game.description,
    version: game.version, cover: draftAsset(record.projectId, game.cover), playerFields: game.playerFields, hasAuto: !!record.auto,
    gallery: gallery(game, record.auto?.state), guide: game.guide };
}

function gallery(game: GameScript, state?: GameState) {
  return [...game.endings.map(entry => ({ ...entry, kind: 'ending' as const })),
    ...game.achievements.map(entry => ({ ...entry, kind: 'achievement' as const }))].map(entry => {
    const unlocked = !!state?.awardedGallery.some(item => item.id === entry.id && item.kind === entry.kind);
    return { id: entry.id, kind: entry.kind, unlocked,
      name: entry.hidden && !unlocked ? '？？？' : entry.name,
      description: entry.hidden && !unlocked ? '继续游戏以解锁' : entry.description };
  });
}

export function playtestPayload(record: PlaytestRecord, adapter: ChatAdapter, extra: object = {}) {
  if (!record.auto) throw new Error('试玩尚未开始');
  const { script } = record;
  const state = refreshWorld(script, record.auto.state);
  const view = draftViewAssets(record.projectId, makeView(script, state));
  const hints: Record<string, { id: string; text: string }[]> = {};
  for (const npc of view.npcs) hints[npc.id] = script.events
    .filter(event => event.npc === npc.id && event.hint && (!event.once || !state.completedEvents.includes(event.id)) &&
      evaluateCondition(event.when ?? event.condition, state, script, npc.id))
    .map(event => ({ id: event.id, text: event.hint! }));
  return { view, revision: record.auto.revision, hints, aiMode: adapter.mode,
    gallery: gallery(script, state), ...extra };
}

export function settlePlaytestAction(game: GameScript, state: GameState, body: Record<string, unknown>) {
  let next = state;
  let text = '';
  let kind: ActivityAction['kind'];
  if (body.type === 'move') {
    const destination = game.locations.find(entry => entry.id === body.locationId);
    if (!destination || !canEnterLocation(game, next, destination.id)) throw new Error('地点当前不可进入');
    next = discoverPresentNpcs(game, { ...structuredClone(next), locationId: destination.id });
    text = `来到了${destination.name}。`; kind = 'move';
  } else if (body.type === 'wait') {
    next = advanceTime(game, next); text = `时间来到第 ${next.day} 天${game.periods[next.periodIndex]}。`; kind = 'wait';
  } else if (body.type === 'explore') {
    const result = exploreSpot(game, next, String(body.spotId ?? ''));
    next = result.state; text = result.text ?? '';
    if (!text) throw new Error('调查点不存在');
    kind = 'explore';
  } else if (body.type === 'search') {
    const result = searchLocation(game, next); next = result.state;
    text = result.discovered.length ? `发现了${result.discovered.map(id => `[${game.items.find(item => item.id === id)?.name ?? id}]`).join('、')}。` : '仔细搜索了一番，暂时没有新的发现。';
    kind = 'search';
  } else if (body.type === 'take') {
    if (!makeView(game, next).location?.items.some(entry => entry.id === body.itemId)) throw new Error('这里没有可获取的道具');
    const result = takeLocationItem(game, next, String(body.itemId ?? '')); next = result.state; text = result.text; kind = 'take';
  } else throw new Error('未知操作');
  const action = { kind, summary: text };
  const settled = settleWorld(game, state, next, action);
  const logged = appendActivity(game, settled.state, action, settled.changes);
  return { state: logged, actionText: text, changes: settled.changes };
}
