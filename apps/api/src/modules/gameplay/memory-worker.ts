import type { GameScript } from '@game/contracts';
import type { SaveRecord } from './save-types.js';
import type { MysqlSaveStore } from '../../infrastructure/mysql/mysql-save-store.js';
import { deriveChatContext, type ChatAdapter } from './chat-service.js';
import { compressMemory } from './memory-policy.js';
import type { AiAttribution } from '../../infrastructure/ai/ai-audit.js';

export function createMemoryWorker(store: MysqlSaveStore, adapter: ChatAdapter) {
  const jobs = new Map<string, Promise<void>>();
  return (owner: string, script: GameScript, save: SaveRecord, npcId: string, audit?: AiAttribution): Promise<void> => {
    const key = JSON.stringify([owner, script.id, npcId]);
    if (jobs.has(key)) return jobs.get(key)!;
    const npc = script.npcs.find(entry => entry.id === npcId);
    if (!adapter.summarize || !npc) return Promise.resolve();
    const task = Promise.resolve().then(async () => {
      const turnId = [...(save.state.chats[npcId] ?? [])].reverse().find(m => m.turnId)?.turnId;
      const context = deriveChatContext(script, save.state, npc, '', turnId, audit ? { ...audit, operationId: turnId ?? audit.operationId } : undefined);
      const derived = await compressMemory(context, adapter.summarize!);
      if (derived !== save.state) await store.updateDerivedMemory(owner, script.id, save, derived);
    }).catch(() => { console.warn('后台记忆任务未完成，原始聊天记录保留'); }).finally(() => { jobs.delete(key); });
    jobs.set(key, task);
    return task;
  };
}
