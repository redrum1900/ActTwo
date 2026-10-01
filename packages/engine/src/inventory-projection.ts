import type { GameState } from '@game/contracts';

/** Refreshes the public inventory counts from the canonical itemStates owner map. */
export function syncInventories(state: GameState): GameState {
  state.playerItems = {};
  state.npcItems = Object.fromEntries(Object.keys(state.npcLocations ?? {}).map((id) => [id, {}]));
  for (const [item, runtime] of Object.entries(state.itemStates)) {
    if (runtime.owner === 'player') state.playerItems[item] = 1;
    else if (runtime.owner?.startsWith('npc:')) {
      const npc = runtime.owner.slice(4);
      (state.npcItems[npc] ??= {})[item] = 1;
    }
  }
  return state;
}
