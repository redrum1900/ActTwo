import { validCalendarDate, type Condition, type ValueComparison } from '@game/contracts';

export type ConditionPath = readonly (number | 'not')[];
export type ConditionAction =
  | { type: 'replace'; value: Condition }
  | { type: 'insert'; index: number; value: Condition }
  | { type: 'remove'; index: number }
  | { type: 'move'; from: number; to: number };

export interface ConditionSources {
  storyEvents: { id: string; label: string }[];
  items: { id: string; name: string }[];
  npcs: { id: string; name: string; initialItems?: string[]; indicators?: { id: string; name: string; type: string; options?: string[] }[] }[];
  locations: { id: string; name: string; items?: string[] }[];
  playerIndicators: { id: string; name: string; type: string; options?: string[] }[];
  storyIndicators?: { id: string; name: string; type: string; options?: string[]; systemRole?: string }[];
  periods: string[];
  playerFields: { id: string; label: string; type?: string; options?: { value: string; label: string }[] }[];
  rules: { id: string; label: string }[];
  ownerNpcId?: string;
}

export function comparisonOperators(type: string): string[] {
  if (type === 'number' || type === 'date') return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
  if (type === 'text' || type === 'input' || type === 'textarea') return ['eq', 'ne', 'contains', 'notContains'];
  if (type === 'tags' || type === 'checkbox') return ['has', 'lacks', 'length'];
  return ['eq', 'ne'];
}

export function defaultComparison(type: string, options?: readonly string[]): ValueComparison {
  if (type === 'tags' || type === 'checkbox') return { has: options?.[0] ?? '' };
  if (type === 'number') return { eq: 0 };
  if (type === 'boolean') return { eq: false };
  if (type === 'date') return { eq: '' };
  return { eq: type === 'enum' || type === 'select' || type === 'radio' ? options?.[0] ?? '' : '' };
}

export function changeConditionKind(group: Condition, kind: 'all' | 'any'): Condition {
  const children = 'all' in group ? group.all : 'any' in group ? group.any : [group];
  return kind === 'all' ? { all: [...children] } : { any: [...children] };
}

export function patchCondition(root: Condition, path: ConditionPath, action: ConditionAction): Condition {
  const update = (node: Condition, depth: number): Condition => {
    if (depth < path.length) {
      const segment = path[depth];
      if (segment === 'not') {
        if (!('not' in node)) throw new Error('条件路径中的 NOT 不存在');
        return { ...node, not: update(node.not, depth + 1) };
      }
      if (!('all' in node) && !('any' in node)) throw new Error('条件路径中的分组不存在');
      const key = 'all' in node ? 'all' : 'any';
      const children = 'all' in node ? [...node.all] : [...node.any];
      if (segment < 0 || segment >= children.length) throw new Error('条件路径索引越界');
      children[segment] = update(children[segment], depth + 1);
      return { ...node, [key]: children } as Condition;
    }
    if (action.type === 'replace') return action.value;
    if (!('all' in node) && !('any' in node)) throw new Error('只能在条件分组中增删或移动');
    const key = 'all' in node ? 'all' : 'any';
    const children = 'all' in node ? [...node.all] : [...node.any];
    if (action.type === 'insert') children.splice(action.index, 0, action.value);
    if (action.type === 'remove') {
      if (action.index < 0 || action.index >= children.length) throw new Error('条件索引越界');
      children.splice(action.index, 1);
    }
    if (action.type === 'move') {
      if (action.from < 0 || action.from >= children.length || action.to < 0 || action.to >= children.length) throw new Error('条件索引越界');
      const [child] = children.splice(action.from, 1);
      children.splice(action.to, 0, child);
    }
    return { ...node, [key]: children } as Condition;
  };
  return update(root, 0);
}

export function conditionIssues(root: Condition, sources: ConditionSources): string[] {
  const issues: string[] = [];
  const compareIssue = (value: ValueComparison, type: string, label: string) => {
    const allowed = comparisonOperators(type);
    const entries = Object.entries(value).filter(([key]) => !['id', 'npcId'].includes(key));
    if (!entries.length) issues.push(`${label}缺少比较方式`);
    for (const [key, operand] of entries) {
      if (!allowed.includes(key)) { issues.push(`${label}${type === 'boolean' ? '是布尔指标，' : ''}比较 ${key} 不适用于${type}`); continue; }
      if (key === 'length') {
        if (!operand || typeof operand !== 'object' || Array.isArray(operand) || !Object.keys(operand).length ||
          Object.entries(operand).some(([operator, count]) => !['eq', 'gt', 'gte', 'lt', 'lte'].includes(operator) || !Number.isInteger(count) || (count as number) < 0)) issues.push(`${label}数组长度无效`);
      } else if (type === 'number' && (typeof operand !== 'number' || !Number.isFinite(operand))) issues.push(`${label}数字比较值无效`);
      else if (type === 'boolean' && typeof operand !== 'boolean') issues.push(`${label}是布尔指标，比较值只能是/否`);
      else if (type === 'date' && !validCalendarDate(operand)) issues.push(`${label}日期比较值无效`);
      else if (!['number', 'boolean', 'date'].includes(type) && (typeof operand !== 'string' || !operand.trim())) issues.push(`${label}文字比较值无效`);
    }
  };
  const walk = (node: Condition): void => {
    if ('all' in node || 'any' in node) {
      const children = 'all' in node ? node.all : node.any;
      if (!children.length) issues.push('条件分组不能为空');
      children.forEach(walk); return;
    }
    if ('not' in node) { walk(node.not); return; }
    if ('storyEvent' in node && !sources.storyEvents.some(entry => entry.id === node.storyEvent)) issues.push(`未知剧情事件 ${node.storyEvent}`);
    if ('hasItem' in node) {
      if (!sources.items.some(entry => entry.id === node.hasItem.item)) issues.push(`未知道具 ${node.hasItem.item}`);
      const owner = node.hasItem.owner;
      if (owner.startsWith('npc:') && !sources.npcs.some(entry => entry.id === owner.slice(4))) issues.push(`未知持有者 ${owner}`);
      if (owner.startsWith('location:') && !sources.locations.some(entry => entry.id === owner.slice(9))) issues.push(`未知持有者 ${owner}`);
    }
    if ('playerIndicator' in node) {
      const definition = sources.playerIndicators.find(entry => entry.id === node.playerIndicator.id);
      if (!definition) issues.push(`未知玩家指标 ${node.playerIndicator.id}`);
      else compareIssue(node.playerIndicator, definition.type, `玩家指标 ${definition.name}`);
    }
    if ('storyIndicator' in node) {
      const definition = sources.storyIndicators?.find(entry => entry.id === node.storyIndicator.id);
      if (!definition) issues.push(`未知剧本指标 ${node.storyIndicator.id}`);
      else compareIssue(node.storyIndicator, definition.type, `剧本指标 ${definition.name}`);
    }
    if ('indicator' in node) {
      const definition = sources.npcs.find(npc => npc.id === (node.indicator.npcId ?? sources.ownerNpcId))?.indicators?.find(entry => entry.id === node.indicator.id);
      if (!definition) issues.push(`未知 NPC 指标 ${node.indicator.npcId ?? ''}:${node.indicator.id}`);
      else compareIssue(node.indicator, definition.type, `NPC 指标 ${definition.name}`);
    }
    if ('location' in node && !sources.locations.some(entry => entry.id === node.location)) issues.push(`未知地点 ${node.location}`);
    if ('unlockedLocation' in node && !sources.locations.some(entry => entry.id === node.unlockedLocation)) issues.push(`未知地点 ${node.unlockedLocation}`);
    if ('npcLocation' in node && (!sources.npcs.some(entry => entry.id === node.npcLocation.npcId) || !sources.locations.some(entry => entry.id === node.npcLocation.locationId))) issues.push('未知 NPC 地点');
    if ('period' in node && !sources.periods.includes(node.period)) issues.push(`未知时段 ${node.period}`);
    if ('playerField' in node) {
      const definition = sources.playerFields.find(entry => entry.id === node.playerField.id);
      if (!definition) issues.push(`未知玩家资料 ${node.playerField.id}`);
      else compareIssue(node.playerField, definition.type ?? 'input', `开局资料 ${definition.label}`);
    }
  };
  walk(root);
  return issues;
}
