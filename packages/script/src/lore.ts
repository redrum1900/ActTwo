export interface LoreTypeInput { type?: string; keywords?: readonly string[] }

export function loreType(entry: LoreTypeInput): 'always' | 'triggered' {
  if (entry.type === 'always' || entry.type === 'triggered') return entry.type;
  return entry.keywords?.length ? 'triggered' : 'always';
}
