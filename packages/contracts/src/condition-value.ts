import type { Condition, IndicatorValue, ValueComparison } from './index.js';

const authorConditionKeys = ['storyEvent', 'hasItem', 'indicator', 'playerIndicator', 'storyIndicator', 'location',
  'unlockedLocation', 'period', 'discoveredNpc', 'npcLocation', 'playerField'] as const;

/** Remove unsupported old author predicates. An empty root remains explicitly unsatisfiable. */
export function pruneLegacyCondition(condition: Condition): Condition {
  const prune = (node: Condition): Condition | null => {
    if ('all' in node || 'any' in node) {
      const children = ('all' in node ? node.all : node.any).map(prune).filter((child): child is Condition => child !== null);
      return children.length ? 'all' in node ? { all: children } : { any: children } : null;
    }
    if ('not' in node) {
      const child = prune(node.not);
      return child ? { not: child } : null;
    }
    return authorConditionKeys.some(key => key in node) ? node : null;
  };
  return prune(condition) ?? { any: [] };
}

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function compareConditionValue(value: IndicatorValue | undefined, check: ValueComparison, kind?: string): boolean {
  if (value === undefined) return false;
  const entries = Object.entries(check).filter(([key, operand]) => key !== 'id' && key !== 'npcId' && operand !== undefined);
  if (!entries.length) return false;
  for (const [key, operand] of entries) {
    if (key === 'eq' || key === 'ne') {
      if (typeof value !== typeof operand || Array.isArray(value) || Array.isArray(operand)) return false;
      if ((kind === 'date' || kind === undefined && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) &&
        (!validCalendarDate(value) || !validCalendarDate(operand))) return false;
    }
    if (key === 'eq' && value !== operand) return false;
    if (key === 'ne' && value === operand) return false;
    if (['gt', 'gte', 'lt', 'lte'].includes(key)) {
      if (typeof value !== typeof operand || !['number', 'string'].includes(typeof value)) return false;
      if (typeof value === 'string' && (kind !== 'date' && kind !== undefined || !validCalendarDate(value) || !validCalendarDate(operand))) return false;
      const left = value as number | string;
      const right = operand as number | string;
      if (key === 'gt' && !(left > right)) return false;
      if (key === 'gte' && !(left >= right)) return false;
      if (key === 'lt' && !(left < right)) return false;
      if (key === 'lte' && !(left <= right)) return false;
    }
    if (key === 'has' && (!Array.isArray(value) || typeof operand !== 'string' || !value.includes(operand))) return false;
    if (key === 'lacks' && (!Array.isArray(value) || typeof operand !== 'string' || value.includes(operand))) return false;
    if (key === 'contains' && (typeof value !== 'string' || typeof operand !== 'string' || !value.includes(operand))) return false;
    if (key === 'notContains' && (typeof value !== 'string' || typeof operand !== 'string' || value.includes(operand))) return false;
    if (key === 'length') {
      if (!Array.isArray(value) || !operand || typeof operand !== 'object') return false;
      const lengths = Object.entries(operand);
      if (!lengths.length) return false;
      for (const [operator, count] of lengths) {
        if (!Number.isInteger(count) || (count as number) < 0) return false;
        if (operator === 'eq' && value.length !== count) return false;
        if (operator === 'gt' && !(value.length > (count as number))) return false;
        if (operator === 'gte' && !(value.length >= (count as number))) return false;
        if (operator === 'lt' && !(value.length < (count as number))) return false;
        if (operator === 'lte' && !(value.length <= (count as number))) return false;
        if (!['eq', 'gt', 'gte', 'lt', 'lte'].includes(operator)) return false;
      }
    }
    if (!['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'has', 'lacks', 'contains', 'notContains', 'length'].includes(key)) return false;
  }
  return true;
}
