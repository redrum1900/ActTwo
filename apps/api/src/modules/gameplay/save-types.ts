import type { GameState } from '@game/contracts';

export interface SaveRecord {
  slot: number;
  label: string;
  state: GameState;
  revision: number;
  updatedAt: string;
}
