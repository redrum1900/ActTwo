import type { GameScript } from '@game/contracts';
import { listScripts, loadScript } from '@game/script';
import type { MysqlProjectStore } from './infrastructure/mysql/mysql-project-store.js';

export interface ScriptRepository {
  get(id: string): GameScript;
  getExact?(id: string, version: string, hash: string): GameScript | null;
  list(): GameScript[];
}
export interface AsyncScriptRepository {
  get(id: string): Promise<GameScript>;
  getExact?(id: string, version: string, hash: string): Promise<GameScript | null>;
  list(): Promise<GameScript[]>;
}

export class ScriptNotFoundError extends Error {
  constructor() { super('剧本不存在'); this.name = 'ScriptNotFoundError'; }
}

export function createScriptRepository(): ScriptRepository {
  return {
    get: loadScript,
    getExact(id, version, hash) {
      const game = loadScript(id);
      return game.version === version && game.contentHash === hash ? game : null;
    },
    list: listScripts,
  };
}

export function createMysqlScriptRepository(projects: MysqlProjectStore): AsyncScriptRepository {
  return {
    async get(id) {
      const script = await projects.getPublished(id);
      if (!script) throw new ScriptNotFoundError();
      return script;
    },
    getExact: (id, version, hash) => projects.getPublishedExact(id, version, hash),
    list: () => projects.listPublished(),
  };
}
