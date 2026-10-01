import type { GameScript } from '@game/contracts';
import { contentHashOf, inspectScript, normalizeScriptReferences, type ScriptIssue } from './index.js';

export type ScriptParts = Record<string, string>;
const requiredArrays = ['player-form.json', 'items.json', 'locations.json', 'endings.json', 'achievements.json'] as const;
const npcIdPattern = /^[a-z0-9][a-z0-9-]*$/;
const format = (value: unknown) => JSON.stringify(value, null, 2);

export function blankScriptParts(id: string, title: string): ScriptParts {
  return {
    'manifest.json': format({ id, version: '1.0.0', title, subtitle: '', description: '', world: '',
      startLocation: 'start', periods: ['白天', '夜晚'] }),
    'player-form.json': format([{ id: 'name', label: '你的名字', type: 'input', default: '玩家', required: true, editable: true, public: true }]),
    'items.json': '[]',
    'locations.json': format([{ id: 'start', name: '起点', description: '', interactionMode: 'in-person', spots: [] }]),
    'endings.json': '[]',
    'achievements.json': '[]',
    'player/indicators.json': '[]',
    'player/rules.json': '[]',
    'npcs/character/base.json': format({ id: 'character', name: '角色', description: '', initialLocationId: 'start', initialItems: [] }),
    'npcs/character/indicators.json': '[]',
    'npcs/character/personas.json': format([{ id: 'common', name: '通用', content: '愿意与玩家交谈。' }]),
    'npcs/character/rules.json': '[]',
    'npcs/character/lore.json': '[]',
  };
}

export function scriptPartsFromScript(source: GameScript, id: string, title: string): ScriptParts {
  const { contentHash: _hash, playerFields, playerIndicators, playerRules, stats, items, locations, npcs, events: _events,
    endings, achievements, ...manifest } = source;
  const parts: ScriptParts = {
    'manifest.json': format({ ...manifest, id, title }),
    'player-form.json': format(playerFields),
    'player/indicators.json': format(playerIndicators ?? []),
    'player/rules.json': format(playerRules ?? []),
    'stats.json': format(stats ?? []),
    'items.json': format(items),
    'locations.json': format(locations),
    'endings.json': format(endings),
    'achievements.json': format(achievements),
  };
  for (const npc of npcs) {
    const { indicators, personas, rules, lore, ...base } = npc;
    const path = `npcs/${npc.id}/`;
    parts[`${path}base.json`] = format(base);
    parts[`${path}indicators.json`] = format(indicators ?? []);
    parts[`${path}personas.json`] = format(personas ?? []);
    parts[`${path}rules.json`] = format(rules ?? []);
    parts[`${path}lore.json`] = format(lore ?? []);
  }
  return parts;
}

export function inspectScriptParts(parts: ScriptParts): { script: GameScript | null; errors: ScriptIssue[]; warnings: ScriptIssue[] } {
  const errors: ScriptIssue[] = [];
  const warnings: ScriptIssue[] = [];
  const read = (path: string, required = true): unknown => {
    const text = parts[path];
    if (text === undefined) {
      if (required) errors.push({ path, message: '缺少配置项' });
      return undefined;
    }
    try { return JSON.parse(text); }
    catch { errors.push({ path, message: 'JSON 格式错误' }); return undefined; }
  };
  const manifest = read('manifest.json');
  if (manifest !== undefined && (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)))
    errors.push({ path: 'manifest.json', message: '应为对象' });
  if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
    const value = manifest as Record<string, unknown>;
    for (const field of ['id', 'version', 'title', 'startLocation'])
      if (typeof value[field] !== 'string' || !value[field]) errors.push({ path: `manifest.json.${field}`, message: '应为非空文本' });
    if (!Array.isArray(value.periods)) errors.push({ path: 'manifest.json.periods', message: '应为数组' });
  }
  const arrays = Object.fromEntries(requiredArrays.map((path) => [path, read(path)]));
  for (const path of requiredArrays) if (arrays[path] !== undefined && !Array.isArray(arrays[path])) errors.push({ path, message: '应为数组' });
  const optionalArrays = ['player/indicators.json', 'player/rules.json', 'stats.json'] as const;
  for (const path of optionalArrays) {
    arrays[path] = read(path, false) ?? [];
    if (!Array.isArray(arrays[path])) errors.push({ path, message: '应为数组' });
  }
  const npcIds = [...new Set(Object.keys(parts).flatMap(path => /^npcs\/([^/]+)\//.exec(path)?.[1] ?? []))];
  const npcs: GameScript['npcs'][number][] = [];
  for (const id of npcIds) {
    if (!npcIdPattern.test(id)) { errors.push({ path: `npcs/${id}`, message: 'NPC ID 不合法' }); continue; }
    const base = read(`npcs/${id}/base.json`);
    const indicators = read(`npcs/${id}/indicators.json`, false) ?? [];
    const personas = read(`npcs/${id}/personas.json`);
    const rules = read(`npcs/${id}/rules.json`, false) ?? [];
    const lore = read(`npcs/${id}/lore.json`, false) ?? [];
    for (const [name, value] of Object.entries({ indicators, personas, rules, lore }))
      if (value !== undefined && !Array.isArray(value)) errors.push({ path: `npcs/${id}/${name}.json`, message: '应为数组' });
    if (base && typeof base === 'object' && !Array.isArray(base)) {
      if ((base as { id?: string }).id !== id) errors.push({ path: `npcs/${id}/base.json`, message: 'NPC ID 与目录不一致' });
      npcs.push({ ...(base as GameScript['npcs'][number]), indicators, personas, rules, lore } as GameScript['npcs'][number]);
    } else if (base !== undefined) errors.push({ path: `npcs/${id}/base.json`, message: '应为对象' });
  }
  if (errors.length) return { script: null, errors, warnings };
  if (!npcs.length) return { script: null, errors: [{ path: 'npcs', message: '至少需要一个 NPC' }], warnings };
  try {
    const script = {
      ...(manifest as object),
      playerFields: arrays['player-form.json'], playerIndicators: arrays['player/indicators.json'],
      playerRules: arrays['player/rules.json'], stats: arrays['stats.json'], items: arrays['items.json'],
      locations: arrays['locations.json'], endings: arrays['endings.json'], achievements: arrays['achievements.json'],
      npcs, events: npcs.flatMap(npc => (npc.rules ?? []).map(rule => ({ ...rule, npc: npc.id }))),
    } as unknown as GameScript;
    normalizeScriptReferences(script);
    const result = inspectScript(script);
    errors.push(...result.errors); warnings.push(...result.warnings);
    if (errors.length) return { script: null, errors, warnings };
    script.contentHash = contentHashOf(script);
    return { script, errors, warnings };
  } catch (error) {
    errors.push({ path: '$', message: error instanceof Error ? error.message : '剧本结构错误' });
    return { script: null, errors, warnings };
  }
}

export function assembleScriptParts(parts: ScriptParts): GameScript {
  const result = inspectScriptParts(parts);
  if (!result.script) throw new Error(`剧本校验失败：${result.errors.map(issue => `${issue.path} ${issue.message}`).join('；')}`);
  return result.script;
}
