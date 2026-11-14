/**
 * The single game-state store. Everything needed to resume a game lives here
 * and must be plain JSON-serializable data: saving is JSON.stringify.
 */
import type { Mode } from './modes';
import { assertTransition } from './modes';

export const SAVE_VERSION = 1;

export interface GameState {
  version: number;
  seed: number; // RNG state, so reloads continue the same sequence
  mode: Mode;
  flags: Record<string, boolean | number | string>; // story flags set by event scripts
  partyIds: string[];
}

export function newGameState(seed: number): GameState {
  return { version: SAVE_VERSION, seed, mode: 'party', flags: {}, partyIds: [] };
}

export function changeMode(state: GameState, to: Mode): GameState {
  assertTransition(state.mode, to);
  return { ...state, mode: to };
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const data = JSON.parse(json) as Partial<GameState>;
  if (data.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${String(data.version)} (expected ${SAVE_VERSION})`);
  }
  return data as GameState;
}
