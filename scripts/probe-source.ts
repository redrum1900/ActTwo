import type { GameScript, GameState } from '@game/contracts';
import { createMysqlPool } from '../apps/api/src/infrastructure/mysql/mysql.js';
import { createMysqlProjectStore } from '../apps/api/src/infrastructure/mysql/mysql-project-store.js';
import { createMysqlSaveStore } from '../apps/api/src/infrastructure/mysql/mysql-save-store.js';

export function probeArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

export async function loadProbeSource(requireSave: boolean): Promise<{ script: GameScript; state: GameState | null }> {
  const gameId = probeArgument('--game');
  const ownerId = probeArgument('--owner');
  if (!gameId) throw new Error('请提供 --game <故事 ID>');
  if (requireSave && !ownerId) throw new Error('请提供 --owner <账号 ID>');
  const pool = createMysqlPool(process.env);
  try {
    const save = ownerId ? await createMysqlSaveStore(pool).getAuto(ownerId, gameId) : null;
    if (requireSave && !save) throw new Error('指定账号没有自动存档');
    const projects = createMysqlProjectStore(pool);
    const script = save
      ? await projects.getPublishedExact(gameId, save.state.scriptVersion, save.state.scriptHash)
      : await projects.getPublished(gameId);
    if (!script) throw new Error('找不到存档对应的发布快照或故事尚未发布');
    return { script, state: save?.state ?? null };
  } finally { await pool.end(); }
}
