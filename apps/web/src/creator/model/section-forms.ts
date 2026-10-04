const format = (value: unknown) => JSON.stringify(value, null, 2);

export function patchManifest(content: string, patch: Record<string, unknown>): string {
  const current = JSON.parse(content) as Record<string, unknown>;
  return format({ ...current, ...patch });
}

export function newStoryEvent() {
  return { id: crypto.randomUUID(), label: '', detail: '' };
}

export function patchStoryEvent(content: string, id: string, patch: { label?: string; detail?: string }): string {
  const current = JSON.parse(content) as Record<string, unknown>;
  const events = Array.isArray(current.storyEvents) ? current.storyEvents as { id: string; label: string; detail: string }[] : [];
  return format({ ...current, storyEvents: events.map(event => event.id === id ? { ...event, ...patch, id } : event) });
}

export function removeStoryEvent(content: string, id: string): string {
  const current = JSON.parse(content) as Record<string, unknown>;
  const events = Array.isArray(current.storyEvents) ? current.storyEvents as { id: string }[] : [];
  return format({ ...current, storyEvents: events.filter(event => event.id !== id) });
}

export function newEntryId(): string { return crypto.randomUUID(); }

export function splitLoreKeywords(text: string, existing: string[]): string[] {
  return [...new Set([...existing, ...text.split(/[,，]/).map(part => part.trim()).filter(Boolean)])];
}

interface PersonaDraft { id: string; name?: string; content?: string; when?: unknown; [key: string]: unknown }

export function addPersona(content: string, common = false): string {
  const entries = JSON.parse(content) as PersonaDraft[];
  if (common && entries.some(entry => entry.id === 'common')) throw new Error('通用性格已存在');
  const entry = common ? { id: 'common', name: '通用', content: '' } : { id: newEntryId(), name: '新性格', content: '' };
  return format([...entries, entry]);
}

export function patchPersona(content: string, id: string, patch: Record<string, unknown>): string {
  if (id === 'common' && patch.when != null) throw new Error('通用性格不能配置条件');
  const entries = JSON.parse(content) as PersonaDraft[];
  return format(entries.map(entry => {
    if (entry.id !== id) return entry;
    const next: PersonaDraft = { ...entry, ...patch, id };
    for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
    return next;
  }));
}

export function removePersona(content: string, id: string): string {
  if (id === 'common') throw new Error('通用性格不能删除');
  return format((JSON.parse(content) as PersonaDraft[]).filter(entry => entry.id !== id));
}

export function patchNpcBase(content: string, patch: Record<string, unknown>): string {
  return format({ ...(JSON.parse(content) as Record<string, unknown>), ...patch });
}

export function addNpcInitialItems(content: string, itemIds: string[]): string {
  const base = JSON.parse(content) as { initialItems?: string[]; itemVisibility?: Record<string, unknown> };
  const current = base.initialItems ?? [];
  const added = [...new Set(itemIds)].filter(id => id && !current.includes(id));
  return format({ ...base, initialItems: [...current, ...added], itemVisibility: {
    ...base.itemVisibility, ...Object.fromEntries(added.map(id => [id, null])),
  } });
}

export function removeNpcInitialItem(content: string, itemId: string): string {
  const base = JSON.parse(content) as { initialItems?: string[]; itemVisibility?: Record<string, unknown> };
  const itemVisibility = { ...base.itemVisibility };
  delete itemVisibility[itemId];
  return format({ ...base, initialItems: (base.initialItems ?? []).filter(id => id !== itemId), itemVisibility });
}

export function setNpcItemVisibility(content: string, itemId: string, condition: unknown): string {
  const base = JSON.parse(content) as { initialItems?: string[]; itemVisibility?: Record<string, unknown> };
  if (!base.initialItems?.includes(itemId)) throw new Error('NPC 未持有该道具');
  const itemVisibility = { ...base.itemVisibility };
  if (condition === undefined) delete itemVisibility[itemId];
  else itemVisibility[itemId] = condition;
  return format({ ...base, itemVisibility });
}

export function patchEntryById(content: string, id: string, patch: Record<string, unknown>): string {
  const entries = JSON.parse(content) as Record<string, unknown>[];
  return format(entries.map(entry => entry.id === id ? { ...entry, ...patch, id } : entry));
}

export function addEntry(content: string, entry: Record<string, unknown>): string {
  return format([...(JSON.parse(content) as unknown[]), entry]);
}

export function removeEntry(content: string, id: string): string {
  return format((JSON.parse(content) as { id: string }[]).filter(entry => entry.id !== id));
}

export function patchLocation(content: string, id: string, patch: Record<string, unknown>): string {
  const locations = JSON.parse(content) as Record<string, unknown>[];
  return format(locations.map(location => location.id === id ? { ...location, ...patch } : location));
}

interface LocationPlacement { item: string; [key: string]: unknown }
interface LocationWithItems { id: string; items?: LocationPlacement[]; [key: string]: unknown }

export function addLocationPlacement(content: string, locationId: string, itemId: string): string {
  const locations = JSON.parse(content) as LocationWithItems[];
  const location = locations.find(entry => entry.id === locationId);
  if (!location) throw new Error('地点不存在');
  if (locations.some(entry => entry.items?.some(placement => placement.item === itemId))) throw new Error('道具已放置在其他地点');
  return patchLocation(content, locationId, { items: [...(location.items ?? []), { item: itemId }] });
}

export function patchLocationPlacement(content: string, locationId: string, itemId: string, fields: Record<string, unknown>): string {
  const locations = JSON.parse(content) as LocationWithItems[];
  const location = locations.find(entry => entry.id === locationId);
  if (!location?.items?.some(placement => placement.item === itemId)) throw new Error('地点道具不存在');
  return patchLocation(content, locationId, { items: location.items.map(placement => {
    if (placement.item !== itemId) return placement;
    const next = { ...placement, ...fields };
    for (const [key, value] of Object.entries(fields)) if (value === undefined) delete next[key];
    return next;
  }) });
}

export function removeLocationPlacement(content: string, locationId: string, itemId: string): string {
  const locations = JSON.parse(content) as LocationWithItems[];
  const location = locations.find(entry => entry.id === locationId);
  if (!location) throw new Error('地点不存在');
  return patchLocation(content, locationId, { items: (location.items ?? []).filter(placement => placement.item !== itemId) });
}

export function availableLocationPlacementItems(content: string, items: { id: string; name: string }[], npcItems: string[]) {
  const locations = JSON.parse(content) as LocationWithItems[];
  const occupied = new Set([...npcItems, ...locations.flatMap(location => (location.items ?? []).map(placement => placement.item))]);
  return items.filter(item => !occupied.has(item.id));
}

export function newLocationId(): string { return `location-${crypto.randomUUID()}`; }

export function changePeriod(periods: string[], index: number, name: string): string[] {
  return periods.map((period, position) => position === index ? name.trim() : period);
}

export function movePeriod(periods: string[], index: number, direction: -1 | 1): string[] {
  const target = index + direction;
  if (target < 0 || target >= periods.length) return periods;
  const updated = [...periods];
  [updated[index], updated[target]] = [updated[target], updated[index]];
  return updated;
}

export function removePeriod(periods: string[], index: number): string[] {
  return periods.length <= 1 ? periods : periods.filter((_, position) => position !== index);
}
