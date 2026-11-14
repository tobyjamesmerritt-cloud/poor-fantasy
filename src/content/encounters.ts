/**
 * Encounter content: the party, monster stat blocks, encounters and which
 * world-map location starts which encounter. Everything is validated at load.
 * Monsters come from monsters.json (SRD 5.2 stat blocks) by id; duplicates get
 * letter suffixes ("Giant Rat A", "Giant Rat B").
 */
import { parseDice } from '../engine/dice';
import type { Trait, Unit } from '../rules/combat';
import { assets } from './assets';
import caveRats from './encounters/cave-rats.json';
import ruinsCrawlers from './encounters/ruins-crawlers.json';
import locationsRaw from './locations.json';
import monstersRaw from './monsters.json';
import partyRaw from './party.json';

export interface MonsterDef {
  name: string;
  sprite: string;
  cr: string;
  xp: number;
  ac: number;
  hp: number;
  hpDice: string;
  speed: number;
  initBonus: number;
  attack: { name: string; bonus: number; damage: string[] };
  traits: string[];
}

export interface PartyMemberDef {
  id: string;
  name: string;
  sprite: string;
  hp: number;
  ac: number;
  speed: number;
  initBonus: number;
  attackName: string;
  attackBonus: number;
  damage: string[];
  medicine: number;
}

export interface EncounterDef {
  id: string;
  width: number;
  height: number;
  floor: string;
  partyLevel: number;
  partyStart: { x: number; y: number }[]; // one square per party member, in party order
  enemies: { monster: string; x: number; y: number }[];
}

export interface LocationContent {
  encounter?: string;
  autoFight?: boolean;
  intro?: string;
}

/** Every combat board has this size (the Phaser canvas is sized from it). */
export const BOARD = { width: 12, height: 9 };

const KNOWN_TRAITS: readonly string[] = ['pack-tactics'];

const strip = <T>(raw: unknown): T => {
  const { _note: _ignored, ...rest } = raw as Record<string, unknown>;
  return rest as T;
};

export const monsters: Record<string, MonsterDef> = validateMonsters(strip(monstersRaw));
export const party: PartyMemberDef[] = (partyRaw as unknown as { members: PartyMemberDef[] }).members;

export function validateMonsters(defs: Record<string, MonsterDef>): Record<string, MonsterDef> {
  const errors: string[] = [];
  for (const [id, m] of Object.entries(defs)) {
    const where = `monster "${id}"`;
    if (!assets.sprites[m.sprite]) errors.push(`${where}: unknown sprite "${m.sprite}"`);
    for (const k of ['xp', 'ac', 'hp', 'speed'] as const) {
      if (!Number.isFinite(m[k]) || m[k] <= 0) errors.push(`${where}: ${k} must be positive`);
    }
    for (const d of [m.hpDice, ...m.attack.damage]) {
      try {
        parseDice(d);
      } catch {
        errors.push(`${where}: bad dice "${d}"`);
      }
    }
    for (const t of m.traits) if (!KNOWN_TRAITS.includes(t)) errors.push(`${where}: unknown trait "${t}"`);
  }
  if (errors.length) throw new Error('Invalid monsters.json:\n- ' + errors.join('\n- '));
  return defs;
}

/** SRD 5.2 "Combat Encounters": XP budget per character, levels 1–3 (extend as the party levels). */
const XP_BUDGET: Record<number, { low: number; moderate: number; high: number }> = {
  1: { low: 50, moderate: 75, high: 100 },
  2: { low: 100, moderate: 150, high: 200 },
  3: { low: 150, moderate: 225, high: 400 },
};

export function encounterXp(e: EncounterDef): number {
  return e.enemies.reduce((sum, en) => sum + monsters[en.monster].xp, 0);
}

export function encounterBudget(e: EncounterDef, partySize = party.length): { low: number; moderate: number; high: number } {
  const per = XP_BUDGET[e.partyLevel];
  if (!per) throw new Error(`No XP budget for party level ${e.partyLevel}`);
  return { low: per.low * partySize, moderate: per.moderate * partySize, high: per.high * partySize };
}

export function buildUnits(e: EncounterDef, members: readonly PartyMemberDef[] = party): Unit[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const occupy = (x: number, y: number, who: string) => {
    if (x < 0 || y < 0 || x >= e.width || y >= e.height) errors.push(`${who} is off the map at (${x},${y})`);
    if (seen.has(`${x},${y}`)) errors.push(`${who} overlaps another unit at (${x},${y})`);
    seen.add(`${x},${y}`);
  };
  if (members.length > e.partyStart.length) {
    errors.push(`${members.length} party members but only ${e.partyStart.length} start squares`);
  }
  if (e.width !== BOARD.width || e.height !== BOARD.height) {
    errors.push(`board must be ${BOARD.width}x${BOARD.height}, got ${e.width}x${e.height}`);
  }
  if (!assets.floors[e.floor]) errors.push(`unknown floor "${e.floor}"`);

  const partyUnits: Unit[] = members.map((p, i) => {
    const start = e.partyStart[i] ?? { x: -1, y: -1 };
    occupy(start.x, start.y, p.name);
    if (!assets.sprites[p.sprite]) errors.push(`${p.name}: unknown sprite "${p.sprite}"`);
    return {
      ...p,
      ...start,
      side: 'party',
      maxHp: p.hp,
      traits: [],
      deathSaves: { successes: 0, failures: 0 },
      stable: false,
      dead: false,
    };
  });

  const counts = new Map<string, number>();
  e.enemies.forEach((en) => counts.set(en.monster, (counts.get(en.monster) ?? 0) + 1));
  const seq = new Map<string, number>();
  const enemies: Unit[] = [];
  e.enemies.forEach((en, i) => {
    const m = monsters[en.monster];
    if (!m) {
      errors.push(`enemy ${i}: unknown monster "${en.monster}"`);
      return;
    }
    const n = seq.get(en.monster) ?? 0;
    seq.set(en.monster, n + 1);
    const name = counts.get(en.monster)! > 1 ? `${m.name} ${String.fromCharCode(65 + n)}` : m.name;
    occupy(en.x, en.y, name);
    enemies.push({
      id: `e${i + 1}`,
      name,
      side: 'enemy',
      sprite: m.sprite,
      x: en.x,
      y: en.y,
      hp: m.hp,
      maxHp: m.hp,
      ac: m.ac,
      speed: m.speed,
      initBonus: m.initBonus,
      attackName: m.attack.name,
      attackBonus: m.attack.bonus,
      damage: m.attack.damage,
      traits: m.traits as Trait[],
      medicine: 0,
      deathSaves: { successes: 0, failures: 0 },
      stable: false,
      dead: false,
    });
  });

  if (errors.length) throw new Error(`Invalid encounter "${e.id}":\n- ` + errors.join('\n- '));
  return [...partyUnits, ...enemies];
}

/** All encounters by id; each is built once at load so mistakes fail at startup. */
export const encounters: Record<string, EncounterDef> = Object.fromEntries(
  [caveRats, ruinsCrawlers].map((raw) => {
    const e = strip<EncounterDef>(raw);
    buildUnits(e);
    return [e.id, e];
  }),
);
export const DEFAULT_ENCOUNTER = 'cave-rats';

/** Per-location content keyed by the map's locationId. */
export const locationContent: Record<string, LocationContent> = (() => {
  const all = strip<Record<string, LocationContent>>(locationsRaw);
  for (const [id, c] of Object.entries(all)) {
    if (c.encounter && !encounters[c.encounter]) throw new Error(`locations.json: "${id}" uses unknown encounter "${c.encounter}"`);
  }
  return all;
})();
