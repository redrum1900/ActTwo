import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Condition, Effect, GameScript } from '@game/contracts';

const contentRoot = fileURLToPath(new URL('../../../content', import.meta.url));
const safeId = /^[a-z0-9][a-z0-9-]*$/;

function readPart(gameId: string, file: string, root = contentRoot): unknown {
  return JSON.parse(readFileSync(path.join(root, gameId, file), 'utf8'));
}

function readOptionalArrayPart(gameId: string, file: string, root = contentRoot): unknown[] {
  return existsSync(path.join(root, gameId, file)) ? readPart(gameId, file, root) as unknown[] : [];
}

export function listScripts(): GameScript[] {
  return readdirSync(contentRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && safeId.test(entry.name))
    .map((entry) => loadScript(entry.name));
}

export function loadScript(gameId: string, root = contentRoot): GameScript {
  if (!safeId.test(gameId)) throw new Error('剧本 ID 不合法');
  const npcRoot = path.join(root, gameId, 'npcs');
  const npcs = existsSync(npcRoot) ? readdirSync(npcRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && safeId.test(entry.name)).map((entry) => {
      const relative = (file: string) => `npcs/${entry.name}/${file}`;
      const base = readPart(gameId, relative('base.json'), root) as GameScript['npcs'][number];
      if (base.id !== entry.name) throw new Error(`NPC 目录 ${entry.name} 与 base.json 的 ID 不一致`);
      const optional = (file: string) => existsSync(path.join(npcRoot, entry.name, file)) ? readPart(gameId, relative(file), root) : undefined;
      const indicators = optional('indicators.json') as typeof base.indicators;
      const personas = optional('personas.json') as typeof base.personas;
      const rules = optional('rules.json') as typeof base.rules;
      const profile = base.profile ?? optional('profile.json') as typeof base.profile;
      return { ...base, ...(profile ? { profile } : {}),
        ...(indicators ? { indicators } : {}),
        ...(personas ? { personas } : {}),
        ...(rules ? { rules } : {}),
        lore: optional('lore.json') as typeof base.lore };
    }) : [];
  const script = {
    ...(readPart(gameId, 'manifest.json', root) as object),
    playerFields: readPart(gameId, 'player-form.json', root),
    playerIndicators: readOptionalArrayPart(gameId, 'player/indicators.json', root),
    playerRules: readOptionalArrayPart(gameId, 'player/rules.json', root),
    stats: readOptionalArrayPart(gameId, 'stats.json', root),
    items: readPart(gameId, 'items.json', root),
    locations: readPart(gameId, 'locations.json', root),
    npcs,
    events: npcs.flatMap((npc) => (npc.rules ?? []).map((rule) => ({ ...rule, npc: npc.id }))),
    endings: readPart(gameId, 'endings.json', root),
    achievements: readPart(gameId, 'achievements.json', root),
  } as unknown as GameScript;
  normalizeScriptReferences(script);
  const errors = validateScript(script);
  if (errors.length) throw new Error(`剧本 ${gameId} 配置错误：${errors.join('；')}`);
  script.contentHash = contentHashOf(script);
  return script;
}

export function contentHashOf(script: GameScript): string {
  const { contentHash: _ignored, ...content } = script;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

export function normalizeScriptReferences(script: GameScript): void {
  const resolve = (entries: readonly { id: string; name: string }[], reference: string): string => {
    if (entries.some((entry) => entry.id === reference)) return reference;
    const matches = entries.filter((entry) => entry.name === reference);
    if (matches.length > 1) throw new Error(`名称“${reference}”有歧义，请改用 ID`);
    return matches[0]?.id ?? reference;
  };
  const item = (value: string) => resolve(script.items, value);
  const location = (value: string) => resolve(script.locations, value);
  const npc = (value: string) => resolve(script.npcs, value);
  const owner = (value: string) => value.startsWith('npc:') ? `npc:${npc(value.slice(4))}` : value.startsWith('location:') ? `location:${location(value.slice(9))}` : value;
  const condition = (value: Condition | null | undefined): void => {
    if (!value) return;
    if ('all' in value) return value.all.forEach(condition);
    if ('any' in value) return value.any.forEach(condition);
    if ('not' in value) return condition(value.not);
    if ('hasItem' in value) { value.hasItem.item = item(value.hasItem.item); value.hasItem.owner = owner(value.hasItem.owner) as typeof value.hasItem.owner; }
    if ('location' in value) value.location = location(value.location);
    if ('npcTag' in value) value.npcTag.npc = npc(value.npcTag.npc);
    if ('unlockedLocation' in value) value.unlockedLocation = location(value.unlockedLocation);
    if ('discoveredNpc' in value) value.discoveredNpc = npc(value.discoveredNpc);
    if ('stat' in value && value.stat.npc) value.stat.npc = npc(value.stat.npc);
    if ('indicator' in value && value.indicator.npcId) value.indicator.npcId = npc(value.indicator.npcId);
    if ('npcLocation' in value) { value.npcLocation.npcId = npc(value.npcLocation.npcId); value.npcLocation.locationId = location(value.npcLocation.locationId); }
  };
  const effect = (value: Effect): void => {
    if ('item' in value) value.item = item(value.item);
    if ('to' in value) value.to = owner(value.to) as typeof value.to;
    if ('from' in value) value.from = owner(value.from) as typeof value.from;
    if ('npc' in value && value.npc) value.npc = npc(value.npc);
    if ('npcId' in value && value.npcId) value.npcId = npc(value.npcId);
    if ('target' in value && value.target?.startsWith('npc:')) value.target = `npc:${npc(value.target.slice(4))}`;
    if (value.type === 'moveNpc') value.locationId = location(value.locationId);
    if (value.type === 'unlockLocation') value.location = location(value.location);
  };
  (script as { startLocation: string }).startLocation = location(script.startLocation);
  for (const place of script.locations) {
    condition(place.visibleWhen);
    condition(place.enterWhen);
    for (const placement of place.items ?? []) { placement.item = item(placement.item); condition(placement.discoverWhen); condition(placement.takeWhen); }
    for (const spot of place.spots) { condition(spot.visibleWhen); condition(spot.condition); spot.effects.forEach(effect); }
  }
  for (const character of script.npcs) {
    character.initialLocationId = location(character.initialLocationId);
    (character as unknown as { initialItems: string[] }).initialItems = character.initialItems.map(item);
    if (character.itemVisibility) {
      const visibility = character.itemVisibility;
      (character as { itemVisibility: Record<string, Condition | null> }).itemVisibility = Object.fromEntries(
        Object.entries(visibility).map(([key, rule]) => { condition(rule); return [item(key), rule]; }),
      );
    }
    for (const persona of character.personas ?? []) condition(persona.when);
    for (const lore of character.lore ?? []) condition(lore.when);
    condition(character.visibleWhen);
    for (const field of character.profile ?? []) condition(field.visibleWhen);
  }
  for (const event of script.events) { event.npc = npc(event.npc); condition(event.candidateWhen); condition(event.when); condition(event.condition); event.effects.forEach(effect); }
  for (const rule of script.playerRules ?? []) { condition(rule.candidateWhen); condition(rule.when); condition(rule.condition); rule.effects.forEach(effect); }
  for (const definition of script.items) for (const variant of definition.variants ?? []) condition(variant.when);
  for (const entry of [...script.endings, ...script.achievements]) condition(entry.condition);
  for (const step of script.guide?.steps ?? []) { condition(step.completeWhen); step.target.locationId = location(step.target.locationId); if (step.target.npcId) step.target.npcId = npc(step.target.npcId); }
}

export function validateScript(script: GameScript): string[] {
  const errors: string[] = [];
  const storyEvents = Array.isArray(script.storyEvents) ? script.storyEvents : [];
  if (!Array.isArray(script.storyEvents)) errors.push('剧情事件应为数组');
  if (!script.id || !safeId.test(script.id)) errors.push('剧本 ID 不合法');
  if (!script.version) errors.push('缺少版本号');
  if (!script.periods?.length) errors.push('至少需要一个时段');
  const itemIds = new Set(script.items?.map((item) => item.id) ?? []);
  const npcIds = new Set(script.npcs?.map((npc) => npc.id) ?? []);
  const locationIds = new Set(script.locations?.map((location) => location.id) ?? []);
  const statIds = new Set(script.stats?.map((stat) => `${stat.owner}:${stat.id}`) ?? []);
  const unique = (label: string, ids: string[]) => {
    if (new Set(ids).size !== ids.length) errors.push(`${label}存在重复 ID`);
  };
  unique('道具', script.items.map((item) => item.id));
  unique('道具名称', script.items.map((item) => item.name));
  unique('NPC', script.npcs.map((npc) => npc.id));
  unique('地点', script.locations.map((location) => location.id));
  unique('事件', script.events.map((event) => event.id));
  unique('剧情事件', storyEvents.map((event) => event?.id));
  const storyEventIds = new Set(storyEvents.map((event) => event?.id));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const [index, event] of storyEvents.entries()) {
    if (!event || typeof event !== 'object') { errors.push(`剧情事件 ${index + 1} 应为对象`); continue; }
    if (!uuid.test(event.id)) errors.push(`剧情事件 ${index + 1} ID 不是 UUID`);
    if (typeof event.label !== 'string' || !event.label.trim()) errors.push(`剧情事件 ${event.id} 名称不能为空`);
    if (typeof event.detail !== 'string') errors.push(`剧情事件 ${event.id} 详情应为文本`);
  }
  const initialOwners = new Map<string, string>();
  for (const npc of script.npcs) for (const item of npc.initialItems) {
    if (initialOwners.has(item)) errors.push(`道具 ${item} 初始归属重复：${initialOwners.get(item)} 与 NPC ${npc.id}`);
    initialOwners.set(item, `NPC ${npc.id}`);
  }
  for (const location of script.locations) for (const placement of location.items ?? []) {
    if (initialOwners.has(placement.item)) errors.push(`道具 ${placement.item} 初始归属重复：${initialOwners.get(placement.item)} 与地点 ${location.id}`);
    initialOwners.set(placement.item, `地点 ${location.id}`);
  }
  if (!locationIds.has(script.startLocation)) errors.push(`起始地点 ${script.startLocation} 不存在`);
  const checkCondition = (condition: Condition | null | undefined, label: string, ownerNpcId?: string): void => {
    if (!condition) return;
    if ('all' in condition) { if (!condition.all.length) errors.push(`${label} all 条件不能为空`); return condition.all.forEach((part) => checkCondition(part, label, ownerNpcId)); }
    if ('any' in condition) { if (!condition.any.length) errors.push(`${label} any 条件不能为空`); return condition.any.forEach((part) => checkCondition(part, label, ownerNpcId)); }
    if ('not' in condition) return checkCondition(condition.not, label, ownerNpcId);
    if ('indicator' in condition) {
      const target = condition.indicator.npcId ?? ownerNpcId;
      const definition = script.npcs.find((entry) => entry.id === target)?.indicators?.find((entry) => entry.id === condition.indicator.id);
      if (!target || !npcIds.has(target)) errors.push(`${label}引用未知 NPC ${target ?? '未指定'}`);
      else if (!definition) errors.push(`${label}引用未知指标 ${target}:${condition.indicator.id}`);
      else if ((condition.indicator.gte !== undefined || condition.indicator.lte !== undefined) && definition.type !== 'number') errors.push(`${label}指标 ${definition.id} 不是数字`);
      else if ((condition.indicator.has !== undefined || condition.indicator.lacks !== undefined) && definition.type !== 'tags') errors.push(`${label}指标 ${definition.id} 不是标签集合`);
      else if (definition.type !== 'tags' && [condition.indicator.eq, condition.indicator.ne].some((value) => value !== undefined && typeof value !== (definition.type === 'number' ? 'number' : definition.type === 'boolean' ? 'boolean' : 'string'))) errors.push(`${label}指标 ${definition.id} 比较值类型不匹配`);
    }
    if ('playerIndicator' in condition) {
      const definition = script.playerIndicators?.find((entry) => entry.id === condition.playerIndicator.id);
      const { gte, lte, eq, ne, has, lacks } = condition.playerIndicator;
      if (!definition) errors.push(`${label}引用未知玩家指标 ${condition.playerIndicator.id}`);
      else if ((gte !== undefined || lte !== undefined) && definition.type !== 'number') errors.push(`${label}玩家指标 ${definition.id} 不是数字`);
      else if ((has !== undefined || lacks !== undefined) && definition.type !== 'tags') errors.push(`${label}玩家指标 ${definition.id} 不是标签集合`);
      else if (definition.type !== 'tags' && [eq, ne].some((value) => value !== undefined && typeof value !== (definition.type === 'number' ? 'number' : definition.type === 'boolean' ? 'boolean' : 'string')))
        errors.push(`${label}玩家指标 ${definition.id} 比较值类型不匹配`);
    }
    if ('playerField' in condition && !script.playerFields.some((entry) => entry.id === condition.playerField.id))
      errors.push(`${label}引用未知玩家资料 ${condition.playerField.id}`);
    if ('npcLocation' in condition && (!npcIds.has(condition.npcLocation.npcId) || !locationIds.has(condition.npcLocation.locationId)))
      errors.push(`${label}引用未知 NPC 地点 ${condition.npcLocation.npcId}:${condition.npcLocation.locationId}`);
    if ('hasItem' in condition && !itemIds.has(condition.hasItem.item)) errors.push(`${label}引用未知道具 ${condition.hasItem.item}`);
    if ('hasItem' in condition) {
      const owner = condition.hasItem.owner;
      if (owner.startsWith('npc:') && !npcIds.has(owner.slice(4))) errors.push(`${label}引用未知道具持有者 ${owner}`);
      if (owner.startsWith('location:') && !locationIds.has(owner.slice(9))) errors.push(`${label}引用未知道具持有地点 ${owner}`);
    }
    if ('npcTag' in condition && !npcIds.has(condition.npcTag.npc)) errors.push(`${label}引用未知 NPC ${condition.npcTag.npc}`);
    if ('unlockedLocation' in condition && !locationIds.has(condition.unlockedLocation)) errors.push(`${label}引用未知地点 ${condition.unlockedLocation}`);
    if ('completedEvent' in condition && !script.events.some((entry) => entry.id === condition.completedEvent)) errors.push(`${label}引用未知事件 ${condition.completedEvent}`);
    if ('storyEvent' in condition && !storyEventIds.has(condition.storyEvent)) errors.push(`${label}引用未知剧情事件 ${condition.storyEvent}`);
    if ('location' in condition && !locationIds.has(condition.location)) errors.push(`${label}引用未知地点 ${condition.location}`);
    if ('discoveredNpc' in condition && !npcIds.has(condition.discoveredNpc)) errors.push(`${label}引用未知 NPC ${condition.discoveredNpc}`);
    if ('stat' in condition && !statIds.has(`${condition.stat.npc ? 'npc' : condition.stat.scope ?? 'world'}:${condition.stat.id}`)) errors.push(`${label}引用未知数值 ${condition.stat.id}`);
    if ('stat' in condition && condition.stat.npc && !npcIds.has(condition.stat.npc)) errors.push(`${label}引用未知 NPC ${condition.stat.npc}`);
    if ('stat' in condition && condition.stat.gte !== undefined && condition.stat.lte !== undefined && condition.stat.gte > condition.stat.lte) errors.push(`${label}数值范围无效`);
    if ('period' in condition && !script.periods.includes(condition.period)) errors.push(`${label}引用未知时段 ${condition.period}`);
  };
  const checkEffect = (effect: Effect, label: string, ownerNpcId?: string, ownerPlayer = false): void => {
    if (['changeIndicator', 'setIndicator', 'setIndicatorVisibility', 'addIndicatorTag', 'removeIndicatorTag'].includes(effect.type)) {
      const explicit = 'target' in effect ? effect.target : undefined;
      const target = explicit ?? ('npcId' in effect && effect.npcId ? `npc:${effect.npcId}` : ownerNpcId ? `npc:${ownerNpcId}` : ownerPlayer ? 'player' : undefined);
      if (!target) errors.push(`${label}缺少指标修改目标`);
      else if (target !== 'player' && !npcIds.has(target.slice(4))) {
        // Unknown explicit NPC targets are author warnings; runtime skips only that effect.
      } else if ('id' in effect) {
        const definition = target === 'player' ? script.playerIndicators?.find((entry) => entry.id === effect.id) :
          script.npcs.find((entry) => entry.id === target.slice(4))?.indicators?.find((entry) => entry.id === effect.id);
        if (!definition) errors.push(`${label}引用未知指标 ${target}:${effect.id}`);
        else {
        const wrong = (effect.type === 'changeIndicator' && definition?.type !== 'number') ||
          ((effect.type === 'addIndicatorTag' || effect.type === 'removeIndicatorTag') && definition?.type !== 'tags') ||
          (effect.type === 'setIndicator' && definition && (definition.type === 'tags' ? !Array.isArray(effect.value) :
            typeof effect.value !== (definition.type === 'number' ? 'number' : definition.type === 'boolean' ? 'boolean' : 'string')));
        if (wrong) errors.push(`${label}效果 ${effect.id} 类型不匹配`);
        }
      }
    }
    if (effect.type === 'moveNpc') {
      const target = effect.target ?? (ownerNpcId ? `npc:${ownerNpcId}` : undefined);
      if (!target) errors.push(`${label}移动 NPC 缺少目标`);
      if (!locationIds.has(effect.locationId)) errors.push(`${label}移动 NPC 引用未知地点 ${effect.locationId}`);
    }
    if ('item' in effect && !itemIds.has(effect.item)) errors.push(`${label}引用未知道具 ${effect.item}`);
    if (effect.type === 'discoverNpc' && !npcIds.has(effect.npc)) errors.push(`${label}引用未知 NPC ${effect.npc}`);
    if (effect.type === 'revealNpcItem' && !npcIds.has(effect.npc)) errors.push(`${label}引用未知 NPC ${effect.npc}`);
    if (effect.type === 'changeStat' && !statIds.has(`${effect.scope}:${effect.id}`)) errors.push(`${label}引用未知数值 ${effect.id}`);
    if (effect.type === 'changeStat' && effect.scope === 'npc' && !npcIds.has(effect.npc ?? '')) errors.push(`${label}引用未知 NPC ${effect.npc}`);
    if ('to' in effect && typeof effect.to === 'string' && effect.to.startsWith('npc:') && !npcIds.has(effect.to.slice(4))) errors.push(`${label}引用未知持有者 ${effect.to}`);
    if ('from' in effect && typeof effect.from === 'string' && effect.from.startsWith('npc:') && !npcIds.has(effect.from.slice(4))) errors.push(`${label}引用未知持有者 ${effect.from}`);
    if (effect.type === 'unlockLocation' && !locationIds.has(effect.location)) errors.push(`${label}引用未知地点 ${effect.location}`);
    if (effect.type === 'recordGallery' && !(effect.kind === 'ending' ? script.endings : script.achievements).some((entry) => entry.id === effect.id)) errors.push(`${label}引用未知图鉴 ${effect.id}`);
    if (effect.type === 'recordStoryEvent' && !storyEventIds.has(effect.eventId)) errors.push(`${label}引用未知剧情事件 ${effect.eventId}`);
  };
  for (const npc of script.npcs) {
    if (!locationIds.has(npc.initialLocationId)) errors.push(`NPC ${npc.id} 初始地点不存在 ${npc.initialLocationId}`);
    unique(`NPC ${npc.id} 指标`, (npc.indicators ?? []).map((entry) => entry.id));
    for (const indicator of npc.indicators ?? []) {
      if (indicator.type === 'number' && (!Number.isFinite(indicator.initial) || indicator.min > indicator.max || indicator.initial < indicator.min || indicator.initial > indicator.max)) errors.push(`NPC ${npc.id} 指标 ${indicator.id} 数值范围无效`);
      if (indicator.type === 'enum' && (!indicator.options.length || !indicator.options.includes(indicator.initial))) errors.push(`NPC ${npc.id} 指标 ${indicator.id} 选项无效`);
    }
    unique(`NPC ${npc.id} 人格`, (npc.personas ?? []).map((entry) => entry.id));
    for (const persona of npc.personas ?? []) {
      if (persona.id === 'common' && persona.when != null) errors.push(`NPC ${npc.id} 通用人格不能配置条件`);
      checkCondition(persona.when, `NPC ${npc.id} 人格 ${persona.id}`, npc.id);
    }
    for (const id of npc.initialItems) if (!itemIds.has(id)) errors.push(`NPC ${npc.id} 引用未知道具 ${id}`);
    for (const lore of npc.lore ?? []) checkCondition(lore.when, `NPC ${npc.id} 背景资料`, npc.id);
    checkCondition(npc.visibleWhen, `NPC ${npc.id}`, npc.id);
    for (const [item, condition] of Object.entries(npc.itemVisibility ?? {})) {
      if (!itemIds.has(item)) errors.push(`NPC ${npc.id} 引用未知道具 ${item}`);
      checkCondition(condition, `NPC ${npc.id} 道具`, npc.id);
    }
    for (const profile of npc.profile ?? []) checkCondition(profile.visibleWhen, `NPC ${npc.id} 资料`, npc.id);
  }
  for (const location of script.locations) {
    checkCondition(location.visibleWhen, `地点 ${location.id}`);
    checkCondition(location.enterWhen, `地点 ${location.id} 进入条件`);
    unique(`地点 ${location.id} 调查点`, location.spots.map((spot) => spot.id));
    for (const placement of location.items ?? []) {
      if (!itemIds.has(placement.item)) errors.push(`地点 ${location.id} 引用未知道具 ${placement.item}`);
      checkCondition(placement.discoverWhen, `地点 ${location.id} 道具发现条件`);
      checkCondition(placement.takeWhen, `地点 ${location.id} 道具获取条件`);
    }
    unique(`地点 ${location.id} 道具`, (location.items ?? []).map((entry) => entry.item));
    for (const spot of location.spots) {
      checkCondition(spot.visibleWhen, `调查点 ${spot.id}`);
      checkCondition(spot.condition, `调查点 ${spot.id}`);
      spot.effects.forEach((effect) => checkEffect(effect, `调查点 ${spot.id}`));
    }
  }
  unique('玩家指标', (script.playerIndicators ?? []).map((entry) => entry.id));
  for (const indicator of script.playerIndicators ?? []) {
    if (indicator.type === 'number' && (!Number.isFinite(indicator.initial) || indicator.min > indicator.max || indicator.initial < indicator.min || indicator.initial > indicator.max))
      errors.push(`玩家指标 ${indicator.id} 数值范围无效`);
    if (indicator.type === 'enum' && (!indicator.options.length || !indicator.options.includes(indicator.initial)))
      errors.push(`玩家指标 ${indicator.id} 选项无效`);
  }
  unique('玩家规则', (script.playerRules ?? []).map((entry) => entry.id));
  for (const rule of script.playerRules ?? []) {
    checkCondition(rule.when ?? rule.condition, `玩家规则 ${rule.id}`);
    if (!['automatic', 'action'].includes(rule.trigger)) errors.push(`玩家规则 ${rule.id} 触发方式无效`);
    for (const effect of rule.effects) checkEffect(effect, `玩家规则 ${rule.id}`, undefined, true);
  }
  for (const event of script.events) {
    if (!npcIds.has(event.npc)) errors.push(`事件 ${event.id} 引用未知 NPC ${event.npc}`);
    checkCondition(event.when ?? event.condition, `事件 ${event.id}`, event.npc);
    checkCondition(event.candidateWhen, `事件 ${event.id} 候选条件`, event.npc);
    if (event.priority !== undefined && !Number.isFinite(event.priority)) errors.push(`事件 ${event.id} 优先级无效`);
    if (!['semantic', 'automatic', 'action'].includes(event.trigger)) errors.push(`事件 ${event.id} 触发方式无效`);
    event.effects.forEach((effect) => checkEffect(effect, `事件 ${event.id}`, event.npc));
  }
  for (const entry of [...script.endings, ...script.achievements]) {
    if (!entry.condition) errors.push(`图鉴 ${entry.id} 缺少触发条件`);
    else checkCondition(entry.condition, `图鉴 ${entry.id}`);
  }
  for (const item of script.items) for (const variant of item.variants ?? []) checkCondition(variant.when, `道具 ${item.id} 变体`);
  if (script.guide) {
    unique('引导步骤', script.guide.steps.map((step) => step.id));
    for (const step of script.guide.steps) {
      checkCondition(step.completeWhen, `引导 ${step.id}`);
      if (!locationIds.has(step.target.locationId)) errors.push(`引导 ${step.id} 引用未知地点 ${step.target.locationId}`);
      if (step.target.npcId && !npcIds.has(step.target.npcId)) errors.push(`引导 ${step.id} 引用未知 NPC ${step.target.npcId}`);
      for (const period of step.target.periods ?? []) if (!script.periods.includes(period)) errors.push(`引导 ${step.id} 引用未知时段 ${period}`);
    }
  }
  return errors;
}

export interface ScriptIssue { path: string; message: string }
export function inspectScript(script: GameScript): { errors: ScriptIssue[]; warnings: ScriptIssue[] } {
  const errors: ScriptIssue[] = [];
  const warnings: ScriptIssue[] = [];
  const items = new Map<string, number>();
  script.items.forEach((item, index) => {
    if (items.has(item.name)) errors.push({ path: `$.items[${index}].name`, message: `道具名称“${item.name}”重复` });
    items.set(item.name, index);
    item.variants?.forEach((variant, variantIndex) => {
      if ('any' in variant.when && !variant.when.any.length) errors.push({ path: `$.items[${index}].variants[${variantIndex}].when.any`, message: 'any 条件不能为空' });
    });
  });
  script.locations.forEach((location, index) => location.items?.forEach((placement, placementIndex) => {
    if (!placement.takeWhen) warnings.push({ path: `$.locations[${index}].items[${placementIndex}].takeWhen`, message: '未设置获取条件，发现后仍不可拿取' });
  }));
  const warnTarget = (effect: Effect, at: string) => {
    if ('target' in effect && effect.target?.startsWith('npc:') && !script.npcs.some((npc) => npc.id === effect.target?.slice(4)))
      warnings.push({ path: `${at}.target`, message: `目标 NPC ${effect.target.slice(4)} 不存在，运行时将跳过此效果` });
  };
  script.events.forEach((event, index) => event.effects.forEach((effect, effectIndex) => warnTarget(effect, `$.events[${index}].effects[${effectIndex}]`)));
  script.playerRules?.forEach((rule, index) => rule.effects.forEach((effect, effectIndex) => warnTarget(effect, `$.playerRules[${index}].effects[${effectIndex}]`)));
  for (const message of validateScript(script)) if (!errors.some((issue) => issue.message === message)) errors.push({ path: '$', message });
  return { errors, warnings };
}

export function serializeScript(script: GameScript): string { return JSON.stringify(script, null, 2); }
export function parseScriptJson(text: string): GameScript {
  const script = JSON.parse(text) as GameScript;
  normalizeScriptReferences(script);
  const { errors } = inspectScript(script);
  if (errors.length) throw new Error(`剧本配置错误：${errors.map((entry) => `${entry.path} ${entry.message}`).join('；')}`);
  return script;
}
