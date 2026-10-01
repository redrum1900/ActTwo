export interface PendingTurn {
  id: string;
  npcId: string;
  playerText: string;
  npcText: string;
  status: 'sending' | 'failed';
  statusText?: string;
}

export function beginPendingTurn(id: string, npcId: string, playerText: string): PendingTurn {
  return { id, npcId, playerText, npcText: '', status: 'sending' };
}

export function appendPendingDraft(turn: PendingTurn, delta: string): PendingTurn {
  return { ...turn, npcText: turn.npcText + delta };
}

export function failPendingTurn(turn: PendingTurn): PendingTurn {
  return { ...turn, npcText: '', status: 'failed', statusText: undefined };
}

export function npcLeftCurrentLocation(before: { locationId: string; npcs: readonly { id: string }[] },
  after: { locationId: string; npcs: readonly { id: string }[] }, npcId: string): boolean {
  return before.locationId === after.locationId && before.npcs.some((npc) => npc.id === npcId) &&
    !after.npcs.some((npc) => npc.id === npcId);
}
