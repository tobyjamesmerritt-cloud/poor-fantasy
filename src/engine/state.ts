/**
 * The single game-state store. Everything needed to resume a game lives here
 * and must be plain JSON-serializable data: saving is JSON.stringify.
 */
import type { Mode } from './modes';
import { assertTransition } from './modes';

const START_TIME = 8 * 60; // day 1, 08:00

export const SAVE_VERSION = 3; // v2: party position on a map · v3: world + location positions, facing, game clock

export interface GameState {
  version: number;
  seed: number; // RNG state, so reloads continue the same sequence
  mode: Mode;
  flags: Record<string, boolean | number | string>; // story flags set by event scripts
  partyIds: string[];
  world: { x: number; y: number } | null; // party square on the world map; null = use the map's start
  location: { id: string; x: number; y: number; facing: 'n' | 'e' | 's' | 'w' } | null; // inside a location, else null
  time: number; // game clock in minutes since midnight of day 1 (see rules/time.ts)
}

export function newGameState(seed: number): GameState {
  return {
    version: SAVE_VERSION,
    seed,
    mode: 'party',
    flags: {},
    partyIds: [],
    world: null,
    location: null,
    time: START_TIME,
  };
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
