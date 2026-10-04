export function referencedStoryEventIds(sections: Record<string, { content: string }>): string[] {
  const ids = new Set<string>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const node = value as Record<string, unknown>;
    if (typeof node.storyEvent === 'string') ids.add(node.storyEvent);
    if (node.type === 'recordStoryEvent' && typeof node.eventId === 'string') ids.add(node.eventId);
    Object.values(node).forEach(walk);
  };
  for (const [path, section] of Object.entries(sections)) {
    if (path === 'manifest.json') continue;
    try { walk(JSON.parse(section.content)); } catch { /* The JSON editor reports malformed sections separately. */ }
  }
  return [...ids];
}
