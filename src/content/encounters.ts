/**
 * Encounter content: the party, monster stat blocks, encounters and which
 * world-map location starts which encounter. Everything is validated at load.
 * Monsters come from monsters.json (SRD 5.2 stat blocks) by id; duplicates get
 * letter suffixes ("Giant Rat A", "Giant Rat B").
 */
import { parseDice } from '../engine/dice';
import { slotsLeft } from '../rules/spells';
import type { Difficulty, FightTweaks } from '../rules/quests';
import { fightBudget, fillerCount, fillerSquares, XP_BUDGET } from '../rules/scaling';
import type { PartyMemberState } from '../engine/state';
import type { Trait, Unit } from '../rules/combat';
import type { MemberStats } from '../rules/party';
import { membersOf, type PartyMemberDef, pregens, statsOf } from './characters';

export type { PartyMemberDef };
import { assets } from './assets';
import ambushDark from './encounters/ambush-dark.json';
import ambushWilds from './encounters/ambush-wilds.json';
import caveRats from './encounters/cave-rats.json';
import ruinsCrawlers from './encounters/ruins-crawlers.json';
import shrineNave from './encounters/shrine-nave.json';
import shrineCrypt from './encounters/shrine-crypt.json';
import oldShack from './encounters/old-shack.json';
import trollBridge from './encounters/troll-bridge.json';
import trollRats from './encounters/troll-rats.json';
import wildRats from './encounters/wild-rats.json';
import wildBats from './encounters/wild-bats.json';
import wildSpiders from './encounters/wild-spiders.json';
import locationsRaw from './locations.json';
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
  saves: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>; // saving throw bonuses
  attack: { name: string; bonus: number; damage: string[] };
  multiattack?: number; // attacks per Attack action (default 1)
  regeneration?: number; // HP regained at the start of each turn (stopped for a turn by acid or fire)
  traits: string[];
}


export interface EncounterDef {
  id: string;
  width: number;
  height: number;
  floor: string;
  partyLevel: number;
  partyStart: { x: number; y: number }[]; // one square per party member, in party order
  enemies: { monster: string; x: number; y: number }[]; // fixed layout (empty when `scaling` places them)
  scaling?: ScalingDef;
}

/**
 * A fight that scales to the party (rules/scaling.ts): `fixed` monsters always
 * appear where placed; `filler` monsters (cycling through the list) are added
 * to fill the XP budget for the difficulty, at least `min` and at most `max`.
 */
export interface ScalingDef {
  difficulty: Difficulty;
  fixed?: { monster: string; x: number; y: number }[];
  filler: { monsters: string[]; min: number; max: number };
}

/** Who is fighting: party size (able to fight) and their average level; quests may override the difficulty. */
export interface FightContext {
  partySize: number;
  level: number;
  difficulty?: Difficulty;
  share?: number; // most monsters as a share of the party size (random encounters near towns: fewer)
}

/** The concrete monsters for this party. Fixed encounters come back unchanged. */
export function resolveEncounter(e: EncounterDef, ctx: FightContext = { partySize: 6, level: 1 }): EncounterDef {
  const s = e.scaling;
  if (!s) return e;
  const fixed = s.fixed ?? [];
  const xpOf = (id: string) => monsters[id]?.xp ?? 0;
  const fixedXp = fixed.reduce((sum, f) => sum + xpOf(f.monster), 0);
  const avg = s.filler.monsters.reduce((sum, id) => sum + xpOf(id), 0) / Math.max(1, s.filler.monsters.length);
  const budget = fightBudget(ctx.partySize, ctx.level, ctx.difficulty ?? s.difficulty);
  // House rule: never more monsters than the party has characters (action economy hurts most at low levels).
  const cap = Math.max(1, Math.round(ctx.partySize * Math.min(1, ctx.share ?? 1)));
  const n = Math.min(fillerCount(budget, fixedXp, avg, s.filler.min, s.filler.max), Math.max(0, cap - fixed.length));
  const spots = fillerSquares(e.width, e.height, [...fixed, ...e.partyStart], n);
  return { ...e, enemies: [...fixed, ...spots.map((p, i) => ({ monster: s.filler.monsters[i % s.filler.monsters.length], ...p }))] };
}

export interface LocationContent {
  map?: string; // public/assets/maps/<map>.json; fights live in the map's spots layer
  intro?: string;
  // places inside another location (not on the world map):
  name?: string;
  style?: 'town' | 'cave' | 'ruins';
  parent?: { location: string; x: number; y: number; facing: 'n' | 'e' | 's' | 'w' }; // where you come out
}

/** Every combat board has this size (the Phaser canvas is sized from it). */
export const BOARD = { width: 12, height: 9 };

const KNOWN_TRAITS: readonly string[] = ['pack-tactics'];

const strip = <T>(raw: unknown): T => {
  const { _note: _ignored, ...rest } = raw as Record<string, unknown>;
  return rest as T;
};

export const monsters: Record<string, MonsterDef> = validateMonsters(strip(monstersRaw));
/** The quick-start party: default for encounter validation, tests and the balance simulator. */
export const party: PartyMemberDef[] = membersOf(pregens);
export const partyStats: MemberStats[] = statsOf(pregens);

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
    if (!m.saves || ['str', 'dex', 'con', 'int', 'wis', 'cha'].some((a) => !Number.isInteger(m.saves[a as 'str']))) errors.push(`${where}: saves needs all six abilities`);
  }
  if (errors.length) throw new Error('Invalid monsters.json:\n- ' + errors.join('\n- '));
  return defs;
}

export function encounterXp(e: EncounterDef): number {
  return e.enemies.reduce((sum, en) => sum + monsters[en.monster].xp, 0);
}

export function encounterBudget(e: EncounterDef, partySize = party.length): { low: number; moderate: number; high: number } {
  const per = XP_BUDGET[e.partyLevel];
  if (!per) throw new Error(`No XP budget for party level ${e.partyLevel}`);
  return { low: per.low * partySize, moderate: per.moderate * partySize, high: per.high * partySize };
}

/**
 * Combat units for an encounter. `status` (the persistent party) sets current
 * HP, spell slots left, temporary HP and Mage Armor (still running at `now`):
 * the dead stay home; unconscious characters lie stable at their start square.
 */
export function buildUnits(
  e: EncounterDef,
  members: readonly PartyMemberDef[] = party,
  status?: readonly PartyMemberState[],
  time = 0,
  tweaks: FightTweaks = {},
): Unit[] {
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

  const partyUnits: Unit[] = [];
  members.forEach((p, i) => {
    const now = status?.find((s) => s.id === p.id);
    if (now?.dead) return;
    const start = e.partyStart[i] ?? { x: -1, y: -1 };
    occupy(start.x, start.y, p.name);
    if (!assets.sprites[p.sprite]) errors.push(`${p.name}: unknown sprite "${p.sprite}"`);
    const { hitDie: _hd, conMod: _con, caster, ...combatStats } = p;
    const hp = now ? Math.max(0, now.hp) : p.hp;
    const warded = p.unarmoredAc !== undefined && (now?.spells?.mageArmorUntil ?? -1) > time;
    partyUnits.push({
      ...combatStats,
      ...start,
      hp,
      ...(caster ? { caster: { ...caster, slots: slotsLeft(caster.maxSlots, now?.spells), cantrips: [...caster.cantrips], prepared: [...caster.prepared] } } : {}),
      ...(now?.tempHp ? { tempHp: now.tempHp } : {}),
      ...(warded ? { ac: p.unarmoredAc!, mageArmor: true } : {}),
      side: 'party',
      maxHp: p.hp,
      traits: [],
      deathSaves: { successes: 0, failures: 0 },
      stable: hp <= 0, // already tended after the last fight
      dead: false,
    });
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
      saves: m.saves,
      attackName: m.attack.name,
      attackBonus: m.attack.bonus,
      damage: m.attack.damage,
      traits: m.traits as Trait[],
      monster: en.monster,
      ...(m.multiattack ? { attacks: m.multiattack } : {}),
      ...(m.regeneration ? { regeneration: m.regeneration } : {}),
      ...(tweaks[en.monster]?.fumble ? { fumble: tweaks[en.monster].fumble } : {}),
      xp: m.xp,
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
  [caveRats, ruinsCrawlers, ambushWilds, ambushDark, shrineNave, shrineCrypt, oldShack, trollBridge, trollRats, wildRats, wildBats, wildSpiders].map((raw) => {
    const e = strip<EncounterDef>(raw);
    buildUnits(resolveEncounter(e)); // the default party…
    if (e.scaling) buildUnits(resolveEncounter(e, { partySize: 6, level: 7, difficulty: 'high' })); // …and the most monsters it can get
    return [e.id, e];
  }),
);
export const DEFAULT_ENCOUNTER = 'cave-rats';

/** Per-location content keyed by the world map's locationId. */
export const locationContent: Record<string, LocationContent> = strip(locationsRaw);
