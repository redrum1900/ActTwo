import { compareConditionValue, validCalendarDate, type Condition, type Effect, type GameScript, type GameState, type Owner } from '@game/contracts';
import { syncInventories } from './inventory-projection.js';

export function createInitialState(script: GameScript, player: GameState['player']): GameState {
  const npcItems: GameState['npcItems'] = {};
  const npcStats: GameState['npcStats'] = {};
  const knownNpcItems: GameState['knownNpcItems'] = {};
  const npcIndicators: NonNullable<GameState['npcIndicators']> = {};
  const playerIndicators: NonNullable<GameState['playerIndicators']> = Object.fromEntries((script.playerIndicators ?? []).map((indicator) => [indicator.id, {
    value: indicator.type === 'tags' ? [...new Set(indicator.initial)] : indicator.initial,
    playerVisible: indicator.playerVisible,
  }]));
  const storyIndicators: NonNullable<GameState['storyIndicators']> = Object.fromEntries((script.storyIndicators ?? []).map((indicator) => [indicator.id, {
    value: indicator.type === 'tags' ? [...new Set(indicator.initial)] : indicator.initial,
    playerVisible: indicator.playerVisible,
  }]));
  const npcLocations: NonNullable<GameState['npcLocations']> = {};
  for (const npc of script.npcs) {
    npcLocations[npc.id] = npc.initialLocationId;
    npcIndicators[npc.id] = Object.fromEntries((npc.indicators ?? []).map((indicator) => [indicator.id, {
      value: indicator.type === 'tags' ? [...new Set(indicator.initial)] : indicator.initial,
      playerVisible: indicator.playerVisible,
    }]));
    npcItems[npc.id] = {};
    for (const item of npc.initialItems) npcItems[npc.id][item] = (npcItems[npc.id][item] ?? 0) + 1;
    npcStats[npc.id] = {};
    knownNpcItems[npc.id] = [];
  }
  const playerStats: GameState['playerStats'] = {};
  const worldStats: GameState['worldStats'] = {};
  for (const stat of script.stats) {
    if (stat.owner === 'npc') for (const npc of script.npcs) npcStats[npc.id][stat.id] = stat.initial;
    if (stat.owner === 'player') playerStats[stat.id] = stat.initial;
    if (stat.owner === 'world') worldStats[stat.id] = stat.initial;
  }
  const initial: GameState = {
    scriptId: script.id, scriptVersion: script.version, scriptHash: script.contentHash, player: { ...player },
    locationId: script.startLocation, day: 1, periodIndex: 0,
    playerItems: {}, npcItems, itemStates: Object.fromEntries(script.items.map((item) => [item.id, {
      owner: null, discovered: false,
    }])), playerStats, worldStats, npcStats, npcIndicators, playerIndicators, storyIndicators, npcLocations,
    flags: [], storyEventFlags: [], tags: [], npcTags: Object.fromEntries(script.npcs.map((npc) => [npc.id, []])),
    knownPlayerItems: Object.fromEntries(script.npcs.map((npc) => [npc.id, []])),
    unlockedLocations: [script.startLocation], discoveredNpcs: [], knownNpcItems,
    completedEvents: [], exploredSpots: [], chats: {}, activityLog: [], memories: {}, memorySegments: {}, ruleDiagnostics: [], awardedGallery: [], turns: 0,
  };
  for (const npc of script.npcs) for (const item of npc.initialItems) {
    if (initial.itemStates[item]?.owner) throw new Error(`道具 ${item} 初始归属重复`);
    initial.itemStates[item].owner = `npc:${npc.id}`;
  }
  for (const location of script.locations) for (const placement of location.items ?? []) {
    if (initial.itemStates[placement.item]?.owner) throw new Error(`道具 ${placement.item} 初始归属重复`);
    initial.itemStates[placement.item].owner = `location:${location.id}`;
  }
  return refreshWorld(script, syncInventories(initial));
}

export function discoverPresentNpcs(script: GameScript, state: GameState): GameState {
  const next = structuredClone(state);
  for (const npc of script.npcs) {
    if (npcPresent(npc, next) && (!npc.periods || npc.periods.includes(script.periods[next.periodIndex])) &&
      evaluateCondition(npc.visibleWhen, next, script, npc.id) && !next.discoveredNpcs.includes(npc.id)) next.discoveredNpcs.push(npc.id);
  }
  return next;
}

export function deriveNpcSnapshot(script: GameScript, state: GameState, npcId: string) {
  const npc = script.npcs.find((entry) => entry.id === npcId);
  if (!npc) throw new Error(`未知 NPC ${npcId}`);
  const common = npc.personas?.find((entry) => entry.id === 'common');
  const matches = npc.personas?.filter((entry) => entry.id !== 'common' && evaluateCondition(entry.when, state, script, npcId)) ?? [];
  const personaParts = [...(common ? [common] : []), ...matches];
  return {
    npcId, persona: personaParts.map((entry) => `${entry.name}：${entry.content}`).join('\n\n'),
    indicators: structuredClone(state.npcIndicators?.[npcId] ?? {}),
    locationId: state.npcLocations?.[npcId] ?? null,
  };
}

function npcPresent(npc: GameScript['npcs'][number], state: GameState): boolean {
  return state.npcLocations?.[npc.id] === state.locationId;
}

function inventory(state: GameState, owner: Owner): Record<string, number> {
  return Object.fromEntries(Object.entries(state.itemStates).filter(([, runtime]) => runtime.owner === owner).map(([id]) => [id, 1]));
}

export function evaluateCondition(condition: Condition | null | undefined, state: GameState, script?: GameScript, ownerNpcId?: string): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every((part) => evaluateCondition(part, state, script, ownerNpcId));
  if ('any' in condition) return condition.any.some((part) => evaluateCondition(part, state, script, ownerNpcId));
  if ('not' in condition) return !evaluateCondition(condition.not, state, script, ownerNpcId);
  if ('storyIndicator' in condition) return compareConditionValue(state.storyIndicators?.[condition.storyIndicator.id]?.value, condition.storyIndicator,
    script?.storyIndicators?.find((entry) => entry.id === condition.storyIndicator.id)?.type);
  if ('indicator' in condition) {
    const { npcId, id } = condition.indicator;
    const target = npcId ?? ownerNpcId;
    return compareConditionValue(target ? state.npcIndicators?.[target]?.[id]?.value : undefined, condition.indicator,
      script?.npcs.find((entry) => entry.id === target)?.indicators?.find((entry) => entry.id === id)?.type);
  }
  if ('playerIndicator' in condition) {
    return compareConditionValue(state.playerIndicators?.[condition.playerIndicator.id]?.value, condition.playerIndicator,
      script?.playerIndicators?.find((entry) => entry.id === condition.playerIndicator.id)?.type);
  }
  if ('playerField' in condition) {
    const value = state.player[condition.playerField.id];
    return compareConditionValue(value, condition.playerField, script?.playerFields.find((entry) => entry.id === condition.playerField.id)?.type);
  }
  if ('npcLocation' in condition) return state.npcLocations?.[condition.npcLocation.npcId] === condition.npcLocation.locationId;
  if ('storyEvent' in condition) return state.storyEventFlags?.some((entry) => entry.id === condition.storyEvent) ?? false;
  if ('hasItem' in condition) {
    const runtime = state.itemStates[condition.hasItem.item];
    return runtime?.owner === condition.hasItem.owner;
  }
  if ('flag' in condition) return state.flags.includes(condition.flag);
  if ('tag' in condition) return state.tags?.includes(condition.tag) ?? false;
  if ('npcTag' in condition) return state.npcTags[condition.npcTag.npc]?.includes(condition.npcTag.tag) ?? false;
  if ('unlockedLocation' in condition) return state.unlockedLocations.includes(condition.unlockedLocation);
  if ('completedEvent' in condition) return state.completedEvents.includes(condition.completedEvent);
  if ('location' in condition) return state.locationId === condition.location;
  if ('period' in condition) return !!script && script.periods[state.periodIndex] === condition.period;
  if ('discoveredNpc' in condition) return state.discoveredNpcs.includes(condition.discoveredNpc);
  if ('stat' in condition) {
    const { npc, scope, id, gte, lte, eq } = condition.stat;
    const value = npc ? state.npcStats[npc]?.[id] : scope === 'player' ? state.playerStats[id] : state.worldStats[id];
    if (value === undefined) return false;
    return (gte === undefined || value >= gte) && (lte === undefined || value <= lte) && (eq === undefined || value === eq);
  }
  return false;
}

export function advanceTime(script: GameScript, state: GameState): GameState {
  const next = structuredClone(state);
  next.periodIndex += 1;
  if (next.periodIndex >= script.periods.length) { next.periodIndex = 0; next.day += 1; }
  return refreshWorld(script, next);
}

export function refreshWorld(script: GameScript, state: GameState): GameState {
  const next = structuredClone(state);
  for (const location of script.locations) {
    if (evaluateCondition(location.visibleWhen, next, script) && !next.unlockedLocations.includes(location.id)) next.unlockedLocations.push(location.id);
  }
  return discoverPresentNpcs(script, next);
}

export function canEnterLocation(script: GameScript, state: GameState, locationId: string): boolean {
  if (!script.locations.some((entry) => entry.id === locationId) || !state.unlockedLocations.includes(locationId)) return false;
  const location = script.locations.find((entry) => entry.id === locationId);
  return evaluateCondition(location?.enterWhen, state, script);
}

function applyEffects(script: GameScript, state: GameState, effects: readonly Effect[], ownerNpcId?: string, ownerPlayer = false): { state: GameState; changed: boolean } | null {
  let next = structuredClone(state);
  const newFormat = !!script.storyIndicators?.some((entry) => entry.systemRole === 'onceRules');
  const validOwner = (owner: Owner) => owner === 'player' || owner.startsWith('npc:') && script.npcs.some((entry) => entry.id === owner.slice(4)) ||
    owner.startsWith('location:') && script.locations.some((entry) => entry.id === owner.slice(9));
  for (const effect of effects) {
    if (effect.type === 'giveItem') {
      const runtime = next.itemStates[effect.item];
      if (!runtime || runtime.owner || !validOwner(effect.to)) return null;
      runtime.owner = effect.to;
      runtime.discovered = true;
    } else if (effect.type === 'removeItem' || effect.type === 'transferItem') {
      const runtime = next.itemStates[effect.item];
      if (!runtime || runtime.owner !== effect.from || !validOwner(effect.from) || effect.type === 'transferItem' && !validOwner(effect.to)) return null;
      runtime.owner = effect.type === 'transferItem' ? effect.to : null;
      runtime.discovered = true;
    } else if (effect.type === 'changeIndicator' || effect.type === 'setIndicator' || effect.type === 'setIndicatorVisibility' ||
      effect.type === 'addIndicatorTag' || effect.type === 'removeIndicatorTag') {
      const target = effect.target ?? (effect.npcId ? `npc:${effect.npcId}` : ownerNpcId ? `npc:${ownerNpcId}` : ownerPlayer ? 'player' : null);
      if (!target) return null;
      const npcId = target.startsWith('npc:') ? target.slice(4) : null;
      if (npcId && !script.npcs.some((entry) => entry.id === npcId)) { if (newFormat) return null; else continue; }
      const definition = npcId ? script.npcs.find((entry) => entry.id === npcId)?.indicators?.find((entry) => entry.id === effect.id) :
        target === 'player' ? script.playerIndicators?.find((entry) => entry.id === effect.id) :
        target === 'story' ? script.storyIndicators?.find((entry) => entry.id === effect.id) : undefined;
      const runtime = npcId ? next.npcIndicators?.[npcId]?.[effect.id] : target === 'player' ? next.playerIndicators?.[effect.id] :
        target === 'story' ? next.storyIndicators?.[effect.id] : undefined;
      if (!definition || !runtime || definition.systemRole) return null;
      if (effect.type === 'setIndicatorVisibility') runtime.playerVisible = effect.visible;
      else if (effect.type === 'changeIndicator') {
        if (definition.type !== 'number' || typeof runtime.value !== 'number' || !Number.isFinite(effect.by)) return null;
        runtime.value = Math.min(definition.max, Math.max(definition.min, runtime.value + effect.by));
      } else if (effect.type === 'setIndicator') {
        const value = effect.value;
        if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value < definition.min || value > definition.max)) return null;
        if (definition.type === 'enum' && (typeof value !== 'string' || !definition.options.includes(value))) return null;
        if (definition.type === 'boolean' && (typeof value !== 'boolean' || (definition.writeOnceTrue && runtime.value === true && value === false))) return null;
        if (definition.type === 'text' && typeof value !== 'string') return null;
        if (definition.type === 'date' && !validCalendarDate(value)) return null;
        if (definition.type === 'tags' && (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string'))) return null;
        runtime.value = definition.type === 'tags' ? [...new Set(value as string[])] : value;
      } else {
        if (definition.type !== 'tags' || !Array.isArray(runtime.value)) return null;
        runtime.value = effect.type === 'addIndicatorTag' ? [...new Set([...runtime.value, effect.tag])] : runtime.value.filter((tag) => tag !== effect.tag);
      }
    } else if (effect.type === 'moveNpc') {
      const target = effect.target ?? (ownerNpcId ? `npc:${ownerNpcId}` : null);
      if (!target) return null;
      const npcId = target.slice(4);
      if (!script.npcs.some((entry) => entry.id === npcId)) continue;
      if (!script.locations.some((entry) => entry.id === effect.locationId)) return null;
      (next.npcLocations ??= {})[npcId] = effect.locationId;
    } else if (effect.type === 'changeStat') {
      const values = effect.scope === 'npc' ? next.npcStats[effect.npc ?? ''] : effect.scope === 'player' ? next.playerStats : next.worldStats;
      if (!values || values[effect.id] === undefined) return null;
      const definition = script.stats.find((stat) => stat.id === effect.id && stat.owner === effect.scope);
      if (!definition) return null;
      values[effect.id] = Math.min(definition.max, Math.max(definition.min, values[effect.id] + effect.by));
    } else if (effect.type === 'addTag') {
      const tags = next.tags ?? (next.tags = []);
      if (!tags.includes(effect.tag)) tags.push(effect.tag);
    } else if (effect.type === 'removeTag') {
      next.tags = (next.tags ?? []).filter((tag) => tag !== effect.tag);
    } else if (effect.type === 'addNpcTag' || effect.type === 'removeNpcTag') {
      const tags = next.npcTags[effect.npc] ?? (next.npcTags[effect.npc] = []);
      next.npcTags[effect.npc] = effect.type === 'addNpcTag' ? [...new Set([...tags, effect.tag])] : tags.filter((tag) => tag !== effect.tag);
    } else if (effect.type === 'discoverItem') {
      if (!next.itemStates[effect.item]) return null;
      next.itemStates[effect.item].discovered = true;
    } else if (effect.type === 'revealPlayerItem') {
      const known = next.knownPlayerItems[effect.npc] ?? (next.knownPlayerItems[effect.npc] = []);
      if (!known.includes(effect.item)) known.push(effect.item);
    } else if (effect.type === 'unlockLocation') {
      if (!next.unlockedLocations.includes(effect.location)) next.unlockedLocations.push(effect.location);
    } else if (effect.type === 'recordGallery') {
      if (!next.awardedGallery.some((entry) => entry.kind === effect.kind && entry.id === effect.id)) next.awardedGallery.push({ kind: effect.kind, id: effect.id });
    } else if (effect.type === 'setFlag') {
      if (!next.flags.includes(effect.flag)) next.flags.push(effect.flag);
    } else if (effect.type === 'recordStoryEvent') {
      const definition = script.storyEvents?.find((entry) => entry.id === effect.eventId);
      if (!definition) return null;
      if (!next.storyEventFlags.some((entry) => entry.id === definition.id)) next.storyEventFlags.push(structuredClone(definition));
    } else if (effect.type === 'removeStoryEvent') {
      if (!script.storyEvents?.some((entry) => entry.id === effect.eventId)) return null;
      next.storyEventFlags = next.storyEventFlags.filter((entry) => entry.id !== effect.eventId);
    } else if (effect.type === 'discoverNpc') {
      if (!next.discoveredNpcs.includes(effect.npc)) next.discoveredNpcs.push(effect.npc);
    } else if (effect.type === 'revealNpcItem') {
      const known = next.knownNpcItems[effect.npc] ?? (next.knownNpcItems[effect.npc] = []);
      if (!known.includes(effect.item)) known.push(effect.item);
    } else if (effect.type === 'advanceTime') next = advanceTime(script, next);
  }
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  return { state: refreshWorld(script, syncInventories(next)), changed };
}

function onceLedgerId(script: GameScript): string | undefined {
  return script.storyIndicators?.find((entry) => entry.systemRole === 'onceRules')?.id;
}

function ruleAlreadyApplied(script: GameScript, state: GameState, id: string): boolean {
  const ledger = onceLedgerId(script);
  return ledger ? Array.isArray(state.storyIndicators?.[ledger]?.value) && state.storyIndicators[ledger].value.includes(id) : state.completedEvents.includes(id);
}

function recordAppliedRule(script: GameScript, state: GameState, id: string): void {
  const ledger = onceLedgerId(script);
  if (ledger) {
    const runtime = state.storyIndicators?.[ledger];
    if (runtime && Array.isArray(runtime.value) && !runtime.value.includes(id)) runtime.value.push(id);
  } else if (!state.completedEvents.includes(id)) state.completedEvents.push(id);
}

export function applyEvent(script: GameScript, state: GameState, eventId: string): { applied: boolean; state: GameState } {
  const event = script.events.find((entry) => entry.id === eventId);
  if (!event || (event.once && ruleAlreadyApplied(script, state, event.id)) ||
    !evaluateCondition(event.when ?? event.condition, state, script, event.npc)) return { applied: false, state };
  const next = applyEffects(script, state, event.effects, event.npc);
  if (!next?.changed) return { applied: false, state };
  recordAppliedRule(script, next.state, event.id);
  return { applied: true, state: next.state };
}

function applyPrecheckedEvent(script: GameScript, state: GameState, event: GameScript['events'][number]) {
  if (event.once && ruleAlreadyApplied(script, state, event.id)) return { applied: false, state };
  const next = applyEffects(script, state, event.effects, event.npc);
  if (!next?.changed) return { applied: false, state };
  recordAppliedRule(script, next.state, event.id);
  return { applied: true, state: next.state };
}

export function settlePlayerEvents(script: GameScript, state: GameState, npcId: string, proposedIds: readonly string[]) {
  const eligible = new Set(script.events.filter((event) => event.npc === npcId &&
    event.trigger === 'semantic' &&
    (!event.once || !ruleAlreadyApplied(script, state, event.id)) && evaluateCondition(event.when ?? event.condition, state, script, npcId)).map((event) => event.id));
  const ordered = script.events.filter((event) => event.npc === npcId &&
    proposedIds.includes(event.id) && eligible.has(event.id))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
  let next = state;
  const applied: typeof ordered = [];
  const groups = new Set<string>();
  for (const event of ordered) {
    if (event.exclusiveGroup && groups.has(event.exclusiveGroup)) continue;
    const result = applyPrecheckedEvent(script, next, event);
    if (result.applied) { next = result.state; applied.push(event); if (event.exclusiveGroup) groups.add(event.exclusiveGroup); }
  }
  return { state: next, applied };
}

export function runAutomaticRules(script: GameScript, state: GameState, actionKind: 'chat' | 'move' | 'wait' | 'search' | 'take' | 'explore') {
  const candidates = [
    ...(script.playerRules ?? []).filter((rule) => rule.trigger === 'automatic' ||
      (rule.trigger === 'action' && (!rule.actions?.length || rule.actions.includes(actionKind))))
      .map((rule) => ({ owner: 'player', rule, npcId: undefined as string | undefined })),
    ...script.events.filter((rule) => rule.trigger === 'automatic')
      .map((rule) => ({ owner: `npc:${rule.npc}`, rule, npcId: rule.npc as string | undefined })),
  ].filter(({ rule, npcId }) => (!rule.once || !ruleAlreadyApplied(script, state, rule.id)) &&
    evaluateCondition(rule.when ?? rule.condition, state, script, npcId))
    .sort((a, b) => (b.rule.priority ?? 0) - (a.rule.priority ?? 0) || a.owner.localeCompare(b.owner) || a.rule.id.localeCompare(b.rule.id));
  let next = state;
  const groups = new Set<string>();
  const appliedIds: string[] = [];
  for (const { owner, rule, npcId } of candidates) {
    const group = rule.exclusiveGroup ? `${owner}:${rule.exclusiveGroup}` : null;
    if (group && groups.has(group)) continue;
    const result = applyEffects(script, next, rule.effects, npcId, owner === 'player');
    if (!result?.changed) continue;
    next = result.state;
    recordAppliedRule(script, next, rule.id);
    appliedIds.push(rule.id);
    if (group) groups.add(group);
  }
  return { state: next, appliedIds };
}

export function searchLocation(script: GameScript, state: GameState) {
  const location = script.locations.find((entry) => entry.id === state.locationId);
  const next = structuredClone(state);
  const discovered: string[] = [];
  for (const placement of location?.items ?? []) {
    const runtime = next.itemStates[placement.item];
    if (runtime?.owner !== `location:${state.locationId}` || runtime.discovered) continue;
    if (evaluateCondition(placement.discoverWhen, next, script)) {
      runtime.discovered = true;
      discovered.push(placement.item);
    }
  }
  return { state: next, discovered };
}

export function takeLocationItem(script: GameScript, state: GameState, itemId: string) {
  const placement = script.locations.find((entry) => entry.id === state.locationId)?.items?.find((entry) => entry.item === itemId);
  const runtime = state.itemStates[itemId];
  if (!placement || runtime?.owner !== `location:${state.locationId}` || !runtime.discovered) return { applied: false, state, text: '这里没有可获取的道具。' };
  if (!evaluateCondition(placement.takeWhen, state, script)) return { applied: false, state, text: placement.blockedHint ?? '暂时无法取得。' };
  const next = structuredClone(state);
  next.itemStates[itemId].owner = 'player';
  return { applied: true, state: syncInventories(next), text: `获得了[${script.items.find((item) => item.id === itemId)?.name ?? itemId}]。` };
}

export function exploreSpot(script: GameScript, state: GameState, spotId: string): { applied: boolean; state: GameState; text?: string } {
  const location = script.locations.find((entry) => entry.id === state.locationId);
  const spot = location?.spots.find((entry) => entry.id === spotId);
  if (!spot || !evaluateCondition(spot.visibleWhen, state, script)) return { applied: false, state };
  if (spot.once && state.exploredSpots.includes(spot.id)) return { applied: false, state, text: '这里已经调查过了。' };
  if (!evaluateCondition(spot.condition, state, script)) return { applied: false, state, text: spot.failureText ?? '现在还没有新的发现。' };
  const result = applyEffects(script, state, spot.effects);
  if (!result) return { applied: false, state, text: spot.failureText ?? '现在还没有新的发现。' };
  if (spot.once) result.state.exploredSpots.push(spot.id);
  return { applied: true, state: result.state, text: spot.successText ?? spot.description };
}

export function makeView(script: GameScript, state: GameState) {
  const location = script.locations.find((entry) => entry.id === state.locationId);
  const itemView = (id: string) => {
    const definition = script.items.find((item) => item.id === id);
    const runtime = state.itemStates[id];
    const variant = definition?.variants?.find((entry) => evaluateCondition(entry.when, state, script));
    return { id, count: 1, name: definition?.name ?? id, image: definition?.image, description: variant?.description ?? definition?.description ?? '',
      detail: variant?.detail ?? definition?.detail ?? '' };
  };
  const locations = script.locations.filter((entry) => state.unlockedLocations.includes(entry.id))
    .map(({ id, name, description }) => ({ id, name, description, enterable: canEnterLocation(script, state, id) }));
  const npcToView = (npc: GameScript['npcs'][number]) => ({
    id: npc.id, name: npc.name, description: npc.description, portrait: npc.portrait, accent: npc.accent,
    profile: (npc.profile ?? []).filter((field) => evaluateCondition(field.visibleWhen, state, script, npc.id))
      .map(({ label, value }) => ({ label, value })),
    stats: npc.indicators ? npc.indicators.filter((indicator) => state.npcIndicators?.[npc.id]?.[indicator.id]?.playerVisible)
      .map((indicator) => ({ id: indicator.id, name: indicator.name, value: state.npcIndicators?.[npc.id]?.[indicator.id]?.value ?? indicator.initial })) :
      script.stats.filter((stat) => stat.owner === 'npc' && stat.visible).map((stat) => ({
      id: stat.id, name: stat.name ?? stat.id, value: state.npcStats[npc.id]?.[stat.id] ?? stat.initial,
    })),
    channel: script.locations.find((entry) => entry.id === state.npcLocations?.[npc.id])?.interactionMode,
    items: Object.entries(state.npcItems[npc.id] ?? {}).filter(([item]) =>
      state.knownNpcItems[npc.id]?.includes(item) ||
      (Object.hasOwn(npc.itemVisibility ?? {}, item) && evaluateCondition(npc.itemVisibility?.[item], state, script, npc.id)),
    ).map(([id]) => itemView(id)),
  });
  const npcs = script.npcs.filter((npc) =>
    npcPresent(npc, state) &&
    (!npc.periods || npc.periods.includes(script.periods[state.periodIndex])) &&
    (state.discoveredNpcs.includes(npc.id) || evaluateCondition(npc.visibleWhen, state, script, npc.id)),
  ).map(npcToView);
  const guideSteps = script.guide?.steps.map((step) => ({
    id: step.id, title: step.title, text: step.text, target: step.target,
    completed: evaluateCondition(step.completeWhen, state, script),
  })) ?? [];
  const currentObjective = guideSteps.findIndex((step) => !step.completed);
  return {
    script: { id: script.id, version: script.version, title: script.title, subtitle: script.subtitle, theme: script.theme,
      guide: script.guide ? { intro: script.guide.intro, steps: guideSteps } : undefined },
    objective: currentObjective < 0 ? null : { ...guideSteps[currentObjective], index: currentObjective + 1, total: guideSteps.length },
    player: state.player,
    playerIndicators: (script.playerIndicators ?? []).filter((indicator) => state.playerIndicators?.[indicator.id]?.playerVisible)
      .map((indicator) => ({ id: indicator.id, name: indicator.name, value: state.playerIndicators?.[indicator.id]?.value ?? indicator.initial })),
    day: state.day, period: script.periods[state.periodIndex], locationId: state.locationId,
    location: location ? { id: location.id, name: location.name, description: location.description,
      items: (location.items ?? []).filter((placement) => state.itemStates[placement.item]?.owner === `location:${location.id}` && state.itemStates[placement.item]?.discovered)
        .map((placement) => ({ ...itemView(placement.item), canTake: evaluateCondition(placement.takeWhen, state, script), blockedHint: placement.blockedHint })),
      spots: location.spots.filter((spot) => evaluateCondition(spot.visibleWhen, state, script)).map((spot) => ({
        id: spot.id, name: spot.name, description: spot.description, done: state.exploredSpots.includes(spot.id),
      })) } : null,
    locations, npcs,
    knownNpcs: script.npcs.filter((npc) => state.discoveredNpcs.includes(npc.id)).map(npcToView),
    items: Object.keys(state.playerItems).map(itemView), chats: state.chats, activityLog: state.activityLog,
    offers: [] as { npcId: string; from: string; to: string; offerId: string; cue: string }[],
  };
}
