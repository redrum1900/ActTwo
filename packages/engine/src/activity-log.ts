import { randomUUID } from 'node:crypto';
import type { ActivityDetail, ActivityEntry, GameScript, GameState } from '../../contracts/src/index.js';
import { evaluateCondition, refreshWorld, runAutomaticRules } from './index.js';

export interface ActivityAction {
  kind: ActivityEntry['kind'];
  summary: string;
  npcId?: string;
  chatMessageId?: string;
  appliedEventIds?: readonly string[];
}

export interface VisibleChange {
  kind: ActivityDetail['kind'];
  text: string;
  entityId?: string;
}

function changesBetween(script: GameScript, before: GameState, after: GameState, appliedEventIds: readonly string[] = []): VisibleChange[] {
  const changes: VisibleChange[] = [];
  for (const event of script.events) if (appliedEventIds.includes(event.id) || (!before.completedEvents.includes(event.id) && after.completedEvents.includes(event.id))) {
    changes.push({ kind: 'event', entityId: event.id, text: event.narration ?? `触发了「${event.intent}」` });
  }
  for (const npc of script.npcs) {
    const oldLocation = before.npcLocations?.[npc.id];
    const newLocation = after.npcLocations?.[npc.id];
    if (oldLocation && newLocation && oldLocation !== newLocation && before.discoveredNpcs.includes(npc.id))
      changes.push({ kind: 'npc_move', entityId: npc.id, text: `${npc.name}离开了${script.locations.find((entry) => entry.id === oldLocation)?.name ?? oldLocation}` });
    for (const indicator of npc.indicators ?? []) {
      const oldRuntime = before.npcIndicators?.[npc.id]?.[indicator.id];
      const newRuntime = after.npcIndicators?.[npc.id]?.[indicator.id];
      if (!newRuntime?.playerVisible || !oldRuntime || !before.discoveredNpcs.includes(npc.id)) continue;
      const visibleNow = !oldRuntime.playerVisible;
      if (!visibleNow && JSON.stringify(oldRuntime.value) === JSON.stringify(newRuntime.value)) continue;
      const delta = typeof oldRuntime.value === 'number' && typeof newRuntime.value === 'number' && !visibleNow
        ? ` ${newRuntime.value - oldRuntime.value > 0 ? '+' : ''}${newRuntime.value - oldRuntime.value}`
        : `：${Array.isArray(newRuntime.value) ? newRuntime.value.join('、') : String(newRuntime.value)}`;
      changes.push({ kind: 'stat', entityId: `${npc.id}:${indicator.id}`, text: `${npc.name}的${indicator.name}${delta}` });
    }
    for (const stat of script.stats.filter((entry) => entry.owner === 'npc' && entry.visible)) {
      const oldValue = before.npcStats[npc.id]?.[stat.id];
      const newValue = after.npcStats[npc.id]?.[stat.id];
      if (oldValue !== undefined && newValue !== undefined && oldValue !== newValue &&
        (before.discoveredNpcs.includes(npc.id) || after.discoveredNpcs.includes(npc.id)))
        changes.push({ kind: 'stat', entityId: `${npc.id}:${stat.id}`, text: `${npc.name}的${stat.name ?? stat.id} ${newValue > oldValue ? '+' : ''}${newValue - oldValue}` });
    }
    if (!before.discoveredNpcs.includes(npc.id) && after.discoveredNpcs.includes(npc.id))
      changes.push({ kind: 'npc_discovered', entityId: npc.id, text: `认识了${npc.name}` });
  }
  for (const indicator of script.playerIndicators ?? []) {
    const oldRuntime = before.playerIndicators?.[indicator.id];
    const newRuntime = after.playerIndicators?.[indicator.id];
    if (!oldRuntime || !newRuntime?.playerVisible) continue;
    const visibleNow = !oldRuntime.playerVisible;
    if (!visibleNow && JSON.stringify(oldRuntime.value) === JSON.stringify(newRuntime.value)) continue;
    const delta = typeof oldRuntime.value === 'number' && typeof newRuntime.value === 'number' && !visibleNow
      ? ` ${newRuntime.value - oldRuntime.value > 0 ? '+' : ''}${newRuntime.value - oldRuntime.value}`
      : `：${Array.isArray(newRuntime.value) ? newRuntime.value.join('、') : String(newRuntime.value)}`;
    changes.push({ kind: 'stat', entityId: `player:${indicator.id}`, text: `${indicator.name}${delta}` });
  }
  for (const stat of script.stats.filter((entry) => entry.owner === 'player' && entry.visible)) {
    const oldValue = before.playerStats[stat.id];
    const newValue = after.playerStats[stat.id];
    if (oldValue !== undefined && newValue !== undefined && oldValue !== newValue)
      changes.push({ kind: 'stat', entityId: `player:${stat.id}`, text: `${stat.name ?? stat.id} ${newValue > oldValue ? '+' : ''}${newValue - oldValue}` });
  }
  for (const location of script.locations) if (!before.unlockedLocations.includes(location.id) && after.unlockedLocations.includes(location.id))
    changes.push({ kind: 'location_unlocked', entityId: location.id, text: `新地点「${location.name}」已解锁` });
  for (const item of script.items) {
    const oldRuntime = before.itemStates[item.id];
    const newRuntime = after.itemStates[item.id];
    if (!oldRuntime || !newRuntime) continue;
    if (oldRuntime.owner !== 'player' && newRuntime.owner === 'player')
      changes.push({ kind: 'item_gained', entityId: item.id, text: `获得了[${item.name}]` });
    else if (oldRuntime.owner === 'player' && newRuntime.owner !== 'player')
      changes.push({ kind: 'item_removed', entityId: item.id, text: `失去了[${item.name}]` });
    else if (!oldRuntime.discovered && newRuntime.discovered && newRuntime.owner?.startsWith('location:'))
      changes.push({ kind: 'item_discovered', entityId: item.id, text: `发现了[${item.name}]` });
  }
  for (const entry of [...script.endings.map((value) => ({ ...value, kind: 'ending' as const })),
    ...script.achievements.map((value) => ({ ...value, kind: 'achievement' as const }))]) {
    const unlockedBefore = before.awardedGallery.some((value) => value.kind === entry.kind && value.id === entry.id);
    const unlockedAfter = after.awardedGallery.some((value) => value.kind === entry.kind && value.id === entry.id);
    if (!unlockedBefore && unlockedAfter) changes.push({ kind: 'gallery', entityId: entry.id, text: `获得${entry.kind === 'ending' ? '结局' : '成就'}「${entry.name}」` });
  }
  return changes;
}

/** Runs exactly once after an action's own effects; callers commit the returned state. */
export function settleWorld(script: GameScript, before: GameState, afterEffects: GameState, action: ActivityAction,
  _random: () => number = Math.random): { state: GameState; changes: VisibleChange[] } {
  let next = runAutomaticRules(script, structuredClone(afterEffects), action.kind).state;
  next = refreshWorld(script, next);
  for (const [kind, entries] of [['ending', script.endings], ['achievement', script.achievements]] as const)
    for (const entry of entries) if (evaluateCondition(entry.condition, next, script) &&
      !next.awardedGallery.some((value) => value.kind === kind && value.id === entry.id))
      next.awardedGallery.push({ kind, id: entry.id });
  return { state: next, changes: changesBetween(script, before, next, action.appliedEventIds) };
}

export function appendActivity(script: GameScript, state: GameState, action: ActivityAction, changes: VisibleChange[]): GameState {
  const next = structuredClone(state);
  next.activityLog.push({ id: randomUUID(), at: new Date().toISOString(), day: next.day,
    period: script.periods[next.periodIndex] ?? '', locationId: next.locationId,
    kind: action.kind, summary: action.summary, npcId: action.npcId, chatMessageId: action.chatMessageId,
    details: changes.map(({ kind, text, entityId }) => ({ kind, text, entityId })) });
  return next;
}
