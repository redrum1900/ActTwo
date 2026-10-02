type Rule = Record<string, unknown>;
type Node = Record<string, unknown>;

function withoutTopLevelStoryEvent(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const node = value as Node;
  if (typeof node.storyEvent === 'string') return undefined;
  if (!Array.isArray(node.all)) return value;
  const remaining = node.all.filter(part => !(part && typeof part === 'object' && !Array.isArray(part) && 'storyEvent' in part));
  if (remaining.length === node.all.length) return value;
  return remaining.length === 1 ? remaining[0] : remaining.length ? { ...node, all: remaining } : undefined;
}

export function currentStoryEventGate(rule: Rule): string | null {
  const condition = (rule.when ?? rule.condition) as Node | undefined;
  if (!condition) return null;
  if (typeof condition.storyEvent === 'string') return condition.storyEvent;
  if (Array.isArray(condition.all)) {
    const direct = condition.all.find(part => part && typeof part === 'object' && !Array.isArray(part) && 'storyEvent' in part) as Node | undefined;
    return typeof direct?.storyEvent === 'string' ? direct.storyEvent : null;
  }
  return null;
}

export function setStoryEventGate<T extends Rule>(rule: T, eventId: string | null): T {
  const existing = withoutTopLevelStoryEvent(rule.when ?? rule.condition);
  const when = eventId ? existing ? { all: [existing, { storyEvent: eventId }] } : { storyEvent: eventId } : existing;
  return { ...rule, condition: undefined, when } as T;
}

export function currentRecordedStoryEvents(rule: Rule): string[] {
  return (Array.isArray(rule.effects) ? rule.effects : [])
    .filter(effect => effect && typeof effect === 'object' && effect.type === 'recordStoryEvent')
    .map(effect => String(effect.eventId));
}

export function setRecordedStoryEvents<T extends Rule>(rule: T, eventIds: string[]): T {
  const others = (Array.isArray(rule.effects) ? rule.effects : []).filter(effect => !(effect && typeof effect === 'object' && effect.type === 'recordStoryEvent'));
  return { ...rule, effects: [...others, ...[...new Set(eventIds)].map(eventId => ({ type: 'recordStoryEvent', eventId }))] } as T;
}
