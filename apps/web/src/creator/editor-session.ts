export function hasUnsavedChanges(draft: string, saved: string): boolean { return draft !== saved; }

export async function resolveDirtyChoice(choice: 'save' | 'discard' | 'cancel', save: () => Promise<boolean>): Promise<boolean> {
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return save();
}
