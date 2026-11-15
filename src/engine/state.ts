/**
 * The single game-state store. Everything needed to resume a game lives here
 * and must be plain JSON-serializable data: saving is JSON.stringify.
 */
import type { Mode } from './modes';
import { assertTransition } from './modes';

const START_TIME = 8 * 60; // day 1, 08:00

export const SAVE_VERSION = 4; // v2: party position · v3: world + location positions, facing, clock · v4: persistent party, coins, rests

export interface GameState {
  version: number;
  seed: number; // RNG state, so reloads continue the same sequence
  mode: Mode;
  flags: Record<string, boolean | number | string>; // story flags set by event scripts
  partyIds: string[];
  world: { x: number; y: number } | null; // party square on the world map; null = use the map's start
  location: { id: string; x: number; y: number; facing: 'n' | 'e' | 's' | 'w' } | null; // inside a location, else null
  time: number; // game clock in minutes since midnight of day 1 (see rules/time.ts)
  party: PartyMemberState[]; // current condition of each member, in party.json order
  coins: number; // party purse in copper pieces (100 cp = 1 gp)
  lastLongRest: number | null; // game time a Long Rest finished (16-hour wait before the next)
}

/** What changes about a character between fights. Fixed stats live in content/party.json. */
export interface PartyMemberState {
  id: string;
  hp: number;
  hitDice: number; // unspent Hit Point Dice (level 1: max 1)
  dead: boolean;
  wakesAt: number | null; // unconscious + stable: game time they regain 1 HP (SRD: after 1d4 hours)
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
    party: [], // filled from content/party.json at startup (main.ts)
    coins: 60 * 100, // 60 gp to start (placeholder until character creation, M2)
    lastLongRest: null,
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
