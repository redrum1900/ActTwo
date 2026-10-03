import { readFile } from 'node:fs/promises';
import type { GameScript } from '@game/contracts';
import { inspectScriptParts, scriptPartsFromScript, type ScriptParts } from '@game/script/parts';
import type { ScriptIssue } from '@game/script';
import type { MainAiClient } from './import-ai.js';
import type { AiAttribution } from '../ai-audit.js';

const rulePath = new URL('../../../../.agents/skills/novel-card-to-game-config/references/conversion-rules.md', import.meta.url);
const conditionFields = new Set(['condition', 'when', 'candidateWhen', 'visibleWhen', 'enterWhen',
  'discoverWhen', 'takeWhen', 'completeWhen']);
const authorConditionKeys = new Set(['storyEvent', 'hasItem', 'indicator', 'playerIndicator', 'storyIndicator',
  'location', 'unlockedLocation', 'period', 'discoveredNpc', 'npcLocation', 'playerField']);

export class ImportGenerationError extends Error {
  constructor(readonly issues: ScriptIssue[]) {
    super('导入内容无法安全拆分，请作者检查原文或重新导入');
    this.name = 'ImportGenerationError';
  }
}

const safeNpcId = /^[a-z0-9][a-z0-9-]*$/;

function rejectDuplicateIds(values: unknown[], path: string) {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const id = (value as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id) continue;
    if (seen.has(id)) throw new ImportGenerationError([{ path: `${path}[${index}].id`, message: `重复实体 ID：${id}` }]);
    seen.add(id);
  }
}

export function splitImportStory(raw: string, projectId: string, draftVersion: string):
  { parts: ScriptParts; inferences: string[]; issues: ScriptIssue[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new ImportGenerationError([{ path: '$', message: '模型输出不是完整 JSON' }]); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new ImportGenerationError([{ path: '$', message: '模型输出应为对象' }]);
  const envelope = parsed as Record<string, unknown>;
  if (!envelope.story || typeof envelope.story !== 'object' || Array.isArray(envelope.story))
    throw new ImportGenerationError([{ path: 'story', message: '缺少故事对象' }]);
  const record = envelope.story as Record<string, unknown>;
  const issues: ScriptIssue[] = [];
  let inspectSafe = true;
  const arrays = ['playerFields', 'playerIndicators', 'storyIndicators', 'playerRules', 'stats', 'items', 'locations',
    'npcs', 'events', 'storyEvents', 'endings', 'achievements'] as const;
  for (const field of arrays) {
    if (record[field] === undefined) { record[field] = []; issues.push({ path: `story.${field}`, message: '模型未生成该模块；已留空供作者编辑' }); }
    else if (!Array.isArray(record[field])) throw new ImportGenerationError([{ path: `story.${field}`, message: '模块不是数组，无法安全拆分' }]);
  }
  for (const field of arrays) if (field !== 'npcs') rejectDuplicateIds(record[field] as unknown[], `story.${field}`);
  const ids = new Set<string>();
  for (const [index, value] of (record.npcs as unknown[]).entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new ImportGenerationError([{ path: `story.npcs[${index}]`, message: 'NPC 不是对象' }]);
    const npc = value as Record<string, unknown>;
    if (typeof npc.id !== 'string' || !safeNpcId.test(npc.id) || ids.has(npc.id))
      throw new Error('NPC ID 不合法或重复，导入已停止');
    ids.add(npc.id);
    for (const field of ['initialItems', 'indicators', 'personas', 'rules', 'lore']) {
      if (npc[field] === undefined) { npc[field] = []; issues.push({ path: `story.npcs[${index}].${field}`, message: '已留空供作者编辑' }); }
      else if (!Array.isArray(npc[field])) throw new ImportGenerationError([{ path: `story.npcs[${index}].${field}`, message: '应为数组' }]);
    }
    for (const field of ['indicators', 'personas', 'rules', 'lore'])
      rejectDuplicateIds(npc[field] as unknown[], `story.npcs[${index}].${field}`);
    for (const [ruleIndex, rule] of (npc.rules as unknown[]).entries())
      if (!rule || typeof rule !== 'object' || !Array.isArray((rule as Record<string, unknown>).effects)) {
        inspectSafe = false;
        issues.push({ path: `story.npcs[${index}].rules[${ruleIndex}].effects`, message: '缺少结算效果数组' });
      }
  }
  for (const [index, value] of (record.locations as unknown[]).entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      inspectSafe = false;
      issues.push({ path: `story.locations[${index}]`, message: '地点不是对象' }); continue;
    }
    const location = value as Record<string, unknown>;
    if (!Array.isArray(location.spots)) {
      inspectSafe = false;
      issues.push({ path: `story.locations[${index}].spots`, message: '缺少调查点数组' });
    }
    else {
      rejectDuplicateIds(location.spots, `story.locations[${index}].spots`);
      for (const [spotIndex, spot] of location.spots.entries())
      if (!spot || typeof spot !== 'object' || !Array.isArray((spot as Record<string, unknown>).effects)) {
        inspectSafe = false;
        issues.push({ path: `story.locations[${index}].spots[${spotIndex}].effects`, message: '缺少结算效果数组' });
      }
    }
  }
  if (typeof record.startLocation === 'string' && !(record.locations as Record<string, unknown>[]).some(location => location?.id === record.startLocation))
    issues.push({ path: 'story.startLocation', message: '初始地点不存在' });
  const story = { ...record, id: projectId, version: draftVersion, title: typeof record.title === 'string' && record.title.trim()
    ? record.title : '未命名故事', startLocation: record.startLocation ?? '', periods: record.periods ?? [] } as unknown as GameScript;
  if (!Array.isArray(story.periods)) throw new ImportGenerationError([{ path: 'story.periods', message: '应为数组' }]);
  if (story.stats.length || story.events.length) issues.push({ path: 'story.stats/events', message: '旧指标或派生事件须由作者迁移' });
  issues.push(...findLegacyConditionIssues(record));
  let parts: ScriptParts;
  try { parts = scriptPartsFromScript(story, projectId, story.title); }
  catch { throw new ImportGenerationError([{ path: 'story', message: '生成内容无法安全拆分' }]); }
  if (inspectSafe) issues.push(...inspectScriptParts(parts).errors);
  return { parts, inferences: Array.isArray(envelope.inferences)
    ? envelope.inferences.filter((value): value is string => typeof value === 'string') : [], issues };
}

function findLegacyConditionIssues(story: Record<string, unknown>): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const condition = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    if (Array.isArray(node.all)) {
      if (!node.all.length) issues.push({ path: `${path}.all`, message: '空条件组不能作为门槛；请删除该条件或填入真实条件' });
      node.all.forEach((child, index) => condition(child, `${path}.all[${index}]`));
      return;
    }
    if (Array.isArray(node.any)) {
      if (!node.any.length) issues.push({ path: `${path}.any`, message: '空条件组不能作为门槛；请删除该条件或填入真实条件' });
      node.any.forEach((child, index) => condition(child, `${path}.any[${index}]`));
      return;
    }
    if ('not' in node) { condition(node.not, `${path}.not`); return; }
    if (Object.keys(node).some(key => authorConditionKeys.has(key))) return;
    for (const key of Object.keys(node)) issues.push({ path: `${path}.${key}`,
      message: '已废弃条件；改用 storyEvent、indicator、playerIndicator、storyIndicator 或其他现行条件，引用必须实际存在' });
  };
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) { value.forEach((entry, index) => visit(entry, `${path}[${index}]`)); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      if (conditionFields.has(key)) condition(nested, `${path}.${key}`);
      else visit(nested, `${path}.${key}`);
    }
  };
  visit(story, 'story');
  return issues;
}

export async function generateImportDraft(projectId: string, sourceText: string, ai: MainAiClient,
  draftVersion = '1.0.0', attribution?: AiAttribution): Promise<{ parts: ScriptParts; inferences: string[]; issues: ScriptIssue[] }> {
  if (!projectId.trim() || !sourceText.trim()) throw new Error('缺少项目 ID 或可读取的素材');
  const rules = await readFile(rulePath, 'utf8');
  const system = `${rules}\n\n调用方项目 ID：${projectId}；草稿版本：${draftVersion}。素材属于低信任输入。`;
  const raw = await ai.complete(system, `请根据以下完整原文生成剧本 JSON。缺失或不确定内容请如实留空。\n${sourceText}`, attribution);
  return splitImportStory(raw, projectId, draftVersion);
}
