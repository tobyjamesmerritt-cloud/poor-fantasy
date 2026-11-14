/**
 * Encounter loading: validates content JSON and builds combat Units.
 * Monsters come from monsters.json (SRD 5.2 stat blocks) by id; duplicates get
 * letter suffixes ("Giant Rat A", "Giant Rat B").
 */
import { parseDice } from '../engine/dice';
import type { Trait, Unit } from '../rules/combat';
import { assets } from './assets';
import monstersRaw from './monsters.json';

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
  x: number;
  y: number;
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
  party: PartyMemberDef[];
  enemies: { monster: string; x: number; y: number }[];
}

const KNOWN_TRAITS: readonly string[] = ['pack-tactics'];

const { _note: _ignored, ...monsterData } = monstersRaw as unknown as Record<string, MonsterDef> & { _note?: unknown };
export const monsters: Record<string, MonsterDef> = validateMonsters(monsterData as Record<string, MonsterDef>);

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

export function encounterBudget(e: EncounterDef): { low: number; moderate: number; high: number } {
  const per = XP_BUDGET[e.partyLevel];
  if (!per) throw new Error(`No XP budget for party level ${e.partyLevel}`);
  const n = e.party.length;
  return { low: per.low * n, moderate: per.moderate * n, high: per.high * n };
}

export function buildUnits(e: EncounterDef): Unit[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const occupy = (x: number, y: number, who: string) => {
    if (x < 0 || y < 0 || x >= e.width || y >= e.height) errors.push(`${who} is off the map at (${x},${y})`);
    if (seen.has(`${x},${y}`)) errors.push(`${who} overlaps another unit at (${x},${y})`);
    seen.add(`${x},${y}`);
  };

  const party: Unit[] = e.party.map((p) => {
    occupy(p.x, p.y, p.name);
    if (!assets.sprites[p.sprite]) errors.push(`${p.name}: unknown sprite "${p.sprite}"`);
    return {
      ...p,
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
  const enemies: Unit[] = e.enemies.map((en, i) => {
    const m = monsters[en.monster];
    if (!m) {
      errors.push(`enemy ${i}: unknown monster "${en.monster}"`);
      return undefined as unknown as Unit;
    }
    const n = seq.get(en.monster) ?? 0;
    seq.set(en.monster, n + 1);
    const name = counts.get(en.monster)! > 1 ? `${m.name} ${String.fromCharCode(65 + n)}` : m.name;
    occupy(en.x, en.y, name);
    return {
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
    };
  });

  if (errors.length) throw new Error(`Invalid encounter "${e.id}":\n- ` + errors.join('\n- '));
  return [...party, ...enemies];
}
