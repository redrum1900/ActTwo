import type { GameScript } from '../../../packages/contracts/src/index.js';
import type { SaveRecord, SaveStore } from './save-store.js';
import { deriveChatContext, type ChatAdapter } from './chat-service.js';
import { compressMemory } from './memory-policy.js';

export function createMemoryWorker(store: SaveStore, adapter: ChatAdapter) {
  const jobs = new Map<string, Promise<void>>();
  return (owner: string, script: GameScript, save: SaveRecord, npcId: string): Promise<void> => {
    const key = JSON.stringify([owner, script.id, npcId]);
    if (jobs.has(key)) return jobs.get(key)!;
    const npc = script.npcs.find(entry => entry.id === npcId);
    if (!adapter.summarize || !npc) return Promise.resolve();
    const task = Promise.resolve().then(async () => {
      const turnId = [...(save.state.chats[npcId] ?? [])].reverse().find(m => m.turnId)?.turnId;
      const context = deriveChatContext(script, save.state, npc, '', turnId);
      const derived = await compressMemory(context, adapter.summarize!);
      if (derived !== save.state) store.updateDerivedMemory(owner, script.id, save, derived);
    }).catch(() => { console.warn('后台记忆任务未完成，原始聊天记录保留'); }).finally(() => { jobs.delete(key); });
    jobs.set(key, task);
    return task;
  };
}
