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

export function patchLocation(content: string, id: string, patch: Record<string, unknown>): string {
  const locations = JSON.parse(content) as Record<string, unknown>[];
  return format(locations.map(location => location.id === id ? { ...location, ...patch } : location));
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
