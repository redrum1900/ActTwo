import type { ScriptParts } from '@game/script/parts';
import { ProjectError } from './project-store.js';

const fixed = new Set(['manifest.json', 'player-form.json', 'player/indicators.json', 'story/indicators.json',
  'player/rules.json', 'stats.json', 'items.json', 'locations.json', 'endings.json', 'achievements.json']);
const npcPath = /^npcs\/([a-z0-9][a-z0-9-]*)\/(base|indicators|personas|rules|lore)\.json$/;

export function validateSafeImportParts(parts: ScriptParts, projectId: string): { title: string | null } {
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) throw new ProjectError('导入配置不是有效分段');
  let title: string | null = null;
  const npcIds = new Set<string>();
  for (const [path, content] of Object.entries(parts)) {
    const match = npcPath.exec(path);
    if (!fixed.has(path) && !match) throw new ProjectError(`导入配置路径不安全：${path}`);
    if (typeof content !== 'string') throw new ProjectError(`导入配置不是 JSON：${path}`);
    let value: unknown;
    try { value = JSON.parse(content); }
    catch { throw new ProjectError(`导入配置不是 JSON：${path}`); }
    if (match) {
      npcIds.add(match[1]);
      if (match[2] === 'base') {
        if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).id !== match[1])
          throw new ProjectError(`NPC ID 与配置路径不一致：${path}`);
      } else if (!Array.isArray(value)) throw new ProjectError(`配置应为数组：${path}`);
    } else if (path === 'manifest.json') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).id !== projectId)
        throw new ProjectError('故事 ID 与当前项目不一致');
      const name = (value as Record<string, unknown>).title;
      title = typeof name === 'string' && name.trim() ? name.slice(0, 100) : null;
    } else if (!Array.isArray(value)) throw new ProjectError(`配置应为数组：${path}`);
  }
  if (!('manifest.json' in parts)) throw new ProjectError('导入配置缺少 manifest.json');
  for (const id of npcIds) if (!(`npcs/${id}/base.json` in parts)) throw new ProjectError(`NPC ${id} 缺少基本信息`);
  return { title };
}
