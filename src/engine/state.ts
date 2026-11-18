/**
 * The single game-state store. Everything needed to resume a game lives here
 * and must be plain JSON-serializable data: saving is JSON.stringify.
 */
import type { Mode } from './modes';
import { assertTransition } from './modes';

const START_TIME = 8 * 60; // day 1, 08:00

export const SAVE_VERSION = 11; // v11 explored squares (fog of war) · v2 position · v3 locations, facing, clock · v4 persistent party, coins, rests · v5 character sheets · v6 character pool (bench) · v7 inventory, XP · v8 XP and levels on the character sheet · v9 spells (sheet choices, slots used, temp HP) · v10 party name

export interface GameState {
  version: number;
  seed: number; // RNG state, so reloads continue the same sequence
  mode: Mode;
  flags: Record<string, boolean | number | string>; // story flags set by event scripts
  partyName?: string; // what the player calls the party (absent = "The party")
  partyIds: string[];
  world: { x: number; y: number } | null; // party square on the world map; null = use the map's start
  location: { id: string; x: number; y: number; facing: 'n' | 'e' | 's' | 'w' } | null; // inside a location, else null
  explored?: Record<string, string>; // location id → squares the party has seen (hex bitmask, rules/location.ts markSeen)
  time: number; // game clock in minutes since midnight of day 1 (see rules/time.ts)
  roster: CharacterSheet[]; // who is in the party, in marching order (derived stats: rules/character.ts)
  party: PartyMemberState[]; // current condition of each member (same ids as the roster)
  bench: BenchEntry[]; // created characters not in the party (any number)
  coins: number; // party purse in copper pieces (100 cp = 1 gp)
  inventory: Record<string, number>; // the party pack: item ref → count (see rules/items.ts)
  lastLongRest: number | null; // game time a Long Rest finished (16-hour wait before the next)
}

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type AbilityScores = Record<Ability, number>;

/**
 * The choices a player made for a character (SRD 5.2 "Creating a Character").
 * Everything else (HP, AC, attack, speed) is derived from these + content data.
 */
export interface CharacterSheet {
  id: string;
  name: string;
  sprite: string; // portrait / map sprite key (content/assets.json)
  classId: string; // content/classes.json
  speciesId: string; // content/species.json
  backgroundId: string; // content/backgrounds.json
  scores: AbilityScores; // before background increases
  increases: Partial<AbilityScores>; // background: +2/+1 or +1/+1/+1 among its three abilities
  level: number;
  gear?: Gear; // equipped items; absent = the class's starting kit
  xp?: number; // experience points (kept with the character across games)
  hpGains?: number[]; // Hit Die result for each level after the first (level 2 = index 0), before Con
  asi?: Partial<AbilityScores>; // Ability Score Improvement(s) taken at level 4
  // Spellcasters (rules/spells.ts). Absent = the class's recommended picks.
  cantrips?: string[]; // spell ids (content/spells.json)
  spellbook?: string[]; // Wizard: level 1+ spells in the spellbook
  prepared?: string[]; // level 1+ spells prepared (changed after a Long Rest)
}

/** Equipped items (ids in content/gear.json). */
export interface Gear {
  armor: string | null;
  shield: boolean;
  weapon: string;
}

/** A character waiting outside the party; `state` null = never adventured (fresh when they join). */
export interface BenchEntry {
  sheet: CharacterSheet;
  state: PartyMemberState | null;
}

/** What changes about a character between fights. Fixed stats live in content/party.json. */
export interface PartyMemberState {
  id: string;
  hp: number;
  hitDice: number; // unspent Hit Point Dice (level 1: max 1)
  dead: boolean;
  wakesAt: number | null; // unconscious + stable: game time they regain 1 HP (SRD: after 1d4 hours)
  tempHp?: number; // Temporary Hit Points (last until used up or a Long Rest)
  spells?: SpellState; // casters only
  featureUses?: Record<string, number>; // class feature uses spent since they last came back (rules/features.ts)
}

/** A caster's magic between fights (rules/spells.ts). */
export interface SpellState {
  used: number[]; // spell slots expended per slot level (index 0 = level 1); a Long Rest clears them
  recovered?: boolean; // Wizard Arcane Recovery used since the last Long Rest
  prayed?: boolean; // had Prayer of Healing since the last Long Rest
  mageArmorUntil?: number; // game time Mage Armor ends
  free?: Record<string, number>; // free casts spent since the last Long Rest (Paladin's Smite, Favored Enemy), by spell id
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
    roster: [], // filled at startup (quick start) or on the party screen
    party: [],
    bench: [],
    inventory: {},
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
