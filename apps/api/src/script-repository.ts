import type { GameScript } from '@game/contracts';
import { listScripts, loadScript } from '@game/script';
import type { ProjectStore } from './creator/project-store.js';

export interface ScriptRepository {
  get(id: string): GameScript;
  list(): GameScript[];
}

export function createScriptRepository(projects?: ProjectStore): ScriptRepository {
  return {
    get(id) {
      const published = projects?.getPublished(id);
      if (published) return published;
      return loadScript(id);
    },
    list() { return [...listScripts(), ...(projects?.listPublished() ?? [])]; },
  };
}
