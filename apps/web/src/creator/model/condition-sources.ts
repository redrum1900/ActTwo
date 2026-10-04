import type { ConditionSources } from './condition-tree.js';

export function conditionSourcesFromSections(sections: Record<string, { content: string }>): ConditionSources {
  const read = (path: string): unknown => { try { return JSON.parse(sections[path]?.content ?? 'null'); } catch { return null; } };
  const array = (path: string) => { const value = read(path); return Array.isArray(value) ? value as Record<string, unknown>[] : []; };
  const manifest = (read('manifest.json') ?? {}) as Record<string, unknown>;
  const npcIds = [...new Set(Object.keys(sections).flatMap(path => /^npcs\/([^/]+)\/base\.json$/.exec(path)?.[1] ?? []))];
  const npcs = npcIds.map(id => {
    const base = (read(`npcs/${id}/base.json`) ?? {}) as Record<string, unknown>;
    const indicators = array(`npcs/${id}/indicators.json`).filter(entry => typeof entry.id === 'string').map(entry => ({
      id: String(entry.id), name: String(entry.name ?? entry.id), type: String(entry.type ?? ''),
      options: Array.isArray(entry.options) ? entry.options.map(String) : undefined,
    }));
    return { id, name: String(base.name ?? id), initialItems: Array.isArray(base.initialItems) ? base.initialItems.map(String) : [], indicators };
  });
  const indicators = array('player/indicators.json').filter(entry => typeof entry.id === 'string').map(entry => ({
    id: String(entry.id), name: String(entry.name ?? entry.id), type: String(entry.type ?? ''),
    options: Array.isArray(entry.options) ? entry.options.map(String) : undefined,
  }));
  const storyIndicators = array('story/indicators.json').filter(entry => typeof entry.id === 'string' && !entry.systemRole).map(entry => ({
    id: String(entry.id), name: String(entry.name ?? entry.id), type: String(entry.type ?? ''),
    options: Array.isArray(entry.options) ? entry.options.map(String) : undefined,
    ...(typeof entry.systemRole === 'string' ? { systemRole: entry.systemRole } : {}),
  }));
  const rules = [...array('player/rules.json'), ...npcIds.flatMap(id => array(`npcs/${id}/rules.json`))]
    .filter(entry => typeof entry.id === 'string').map(entry => ({ id: String(entry.id), label: String(entry.intent ?? entry.id) }));
  return {
    storyEvents: (Array.isArray(manifest.storyEvents) ? manifest.storyEvents : []).filter((entry: unknown) => entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string')
      .map((entry: { id: string; label?: string }) => ({ id: entry.id, label: entry.label ?? entry.id })),
    items: array('items.json').filter(entry => typeof entry.id === 'string').map(entry => ({ id: String(entry.id), name: String(entry.name ?? entry.id) })),
    locations: array('locations.json').filter(entry => typeof entry.id === 'string').map(entry => ({ id: String(entry.id), name: String(entry.name ?? entry.id),
      items: Array.isArray(entry.items) ? entry.items.filter((item: unknown) => item && typeof item === 'object' && typeof (item as { item?: unknown }).item === 'string')
        .map((item: { item: string }) => item.item) : [] })),
    npcs, playerIndicators: indicators, storyIndicators,
    periods: Array.isArray(manifest.periods) ? manifest.periods.map(String) : [],
    playerFields: array('player-form.json').filter(entry => typeof entry.id === 'string').map(entry => ({ id: String(entry.id), label: String(entry.label ?? entry.id),
      type: String(entry.type ?? 'input'), options: Array.isArray(entry.options) ? entry.options as { value: string; label: string }[] : undefined })),
    rules,
  };
}
