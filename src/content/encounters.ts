/**
 * Encounter content: the party, monster stat blocks, encounters and which
 * world-map location starts which encounter. Everything is validated at load.
 * Monsters come from monsters.json (SRD 5.2 stat blocks) by id; duplicates get
 * letter suffixes ("Giant Rat A", "Giant Rat B").
 */
import { parseDice } from '../engine/dice';
import { freeLeft, slotsLeft } from '../rules/spells';
import { usesLeft } from '../rules/features';
import type { Difficulty, FightTweaks } from '../rules/quests';
import { fightBudget, fillerCount, fillerSquares, XP_BUDGET } from '../rules/scaling';
import type { PartyMemberState } from '../engine/state';
import { ABILITY_KINDS, type MonsterAbility, type MonsterAction, type Trait, type Unit } from '../rules/combat';
import type { MemberStats } from '../rules/party';
import { membersOf, type PartyMemberDef, pregens, statsOf } from './characters';

export type { PartyMemberDef };
import { assets } from './assets';
import locationsRaw from './locations.json';
import monstersRaw from './monsters.json';

const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
const CONDITIONS = ['paralyzed', 'prone', 'grappled', 'poisoned', 'guided', 'restrained', 'blinded', 'charmed', 'frightened', 'exhaustion'];
const SIZE_NAMES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const ABILITIES6 = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

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
  actions: MonsterAction[]; // melee attacks (multi = Multiattack count, onHit = rider) — DND-75
  abilities?: MonsterAbility[]; // recharge-area, aura, parry, undead-fortitude; other kinds { planned: true } don't fire yet
  resist?: string[];
  immune?: string[];
  vulnerable?: string[];
  conditionImmune?: string[];
  tags: string[]; // where it turns up (wilds, dark, urban, undead…) — picking monsters by tag + CR (DND-73)
  regeneration?: number; // HP regained at the start of each turn (stopped for a turn by acid or fire)
  traits: string[];
  type?: string; // SRD creature type: beast, giant, undead, fiend… (Divine Smite)
  morale?: number; // house rule: HP fraction at which it may break and flee (missing = fights to the death)
  size?: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
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
  /** Who fills the budget: named `monsters`, or every monster with all of `tags` and a CR within `cr` [min, max]. */
  filler: { monsters?: string[]; tags?: string[]; cr?: [number, number]; min: number; max: number };
}

/** A CR as a number ("1/4" → 0.25). */
export const crValue = (cr: string): number => (cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr));

/**
 * The filler monsters for an encounter (DND-73): the named list, or the bestiary
 * picked by tags + CR range — strongest first, so mixed groups lead with the big one.
 */
export function fillerPool(f: ScalingDef['filler'], where = 'encounter'): string[] {
  if (f.monsters?.length) {
    for (const id of f.monsters) if (!monsters[id]) throw new Error(`${where}: unknown monster "${id}"`);
    return f.monsters;
  }
  const [lo, hi] = f.cr ?? [0, 30];
  const pool = Object.entries(monsters)
    .filter(([, m]) => (f.tags ?? []).every((t) => m.tags.includes(t)) && crValue(m.cr) >= lo && crValue(m.cr) <= hi)
    .sort(([a, x], [b, y]) => y.xp - x.xp || a.localeCompare(b))
    .map(([id]) => id);
  if (!pool.length) throw new Error(`${where}: no monster has tags [${(f.tags ?? []).join(', ')}] and CR ${lo}–${hi}`);
  return pool;
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
  const pool = fillerPool(s.filler, e.id);
  const avg = pool.reduce((sum, id) => sum + xpOf(id), 0) / Math.max(1, pool.length);
  const budget = fightBudget(ctx.partySize, ctx.level, ctx.difficulty ?? s.difficulty);
  // House rule: never more monsters than the party has characters (action economy hurts most at low levels).
  const cap = Math.max(1, Math.round(ctx.partySize * Math.min(1, ctx.share ?? 1)));
  const n = Math.min(fillerCount(budget, fixedXp, avg, s.filler.min, s.filler.max), Math.max(0, cap - fixed.length));
  const spots = fillerSquares(e.width, e.height, [...fixed, ...e.partyStart], n);
  return { ...e, enemies: [...fixed, ...spots.map((p, i) => ({ monster: pool[i % pool.length], ...p }))] };
}

export interface LocationContent {
  map?: string; // public/assets/maps/<map>.json; fights live in the map's spots layer
  intro?: string;
  sight?: number; // squares seen on the overhead map (fog of war); default towns 5, dungeons 1
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
    const dice = [m.hpDice, ...(m.actions ?? []).flatMap((a) => [...a.damage, ...(a.bonusIfAdvantage ? [a.bonusIfAdvantage] : [])])];
    for (const a of m.abilities ?? []) if (a.kind === 'recharge-area') dice.push((a as { damage: string }).damage);
    for (const d of dice) {
      try {
        parseDice(d);
      } catch {
        errors.push(`${where}: bad dice "${d}"`);
      }
    }
    errors.push(...checkMonsterAbilities(where, m));
    for (const t of m.traits) if (!KNOWN_TRAITS.includes(t)) errors.push(`${where}: unknown trait "${t}"`);
    if (!m.saves || ['str', 'dex', 'con', 'int', 'wis', 'cha'].some((a) => !Number.isInteger(m.saves[a as 'str']))) errors.push(`${where}: saves needs all six abilities`);
  }
  if (errors.length) throw new Error('Invalid monsters.json:\n- ' + errors.join('\n- '));
  return defs;
}


/** Actions and abilities (DND-75): known kinds must be complete; anything else must say `planned: true`. */
function checkMonsterAbilities(where: string, m: MonsterDef): string[] {
  const e: string[] = [];
  if (!Array.isArray(m.actions) || !m.actions.length) e.push(`${where}: needs at least one action`);
  for (const a of m.actions ?? []) {
    const w = `${where} action "${a.name}"`;
    if (!Number.isInteger(a.bonus)) e.push(`${w}: bonus must be a whole number`);
    if (!Array.isArray(a.types) || a.types.length !== a.damage.length) e.push(`${w}: one damage type per damage part`);
    for (const t of a.types ?? []) if (!DAMAGE_TYPES.includes(t)) e.push(`${w}: unknown damage type "${t}"`);
    if (a.multi !== undefined && !(Number.isInteger(a.multi) && a.multi >= 1)) e.push(`${w}: multi must be 1 or more`);
    const h = a.onHit;
    if (h) {
      if (!['paralyzed', 'prone', 'grappled', 'poisoned', 'guided'].includes(h.condition)) e.push(`${w}: unknown onHit condition "${h.condition}"`);
      if ((h.save && !h.dc) || (h.dc && !h.save)) e.push(`${w}: onHit save needs both save and dc`);
      if (h.save && !ABILITIES6.includes(h.save)) e.push(`${w}: unknown save "${h.save}"`);
      if (h.maxSize && !SIZE_NAMES.includes(h.maxSize)) e.push(`${w}: unknown size "${h.maxSize}"`);
    }
  }
  for (const a of m.abilities ?? []) {
    const w = `${where} ability "${a.name ?? a.kind}"`;
    if (!a.name) e.push(`${w}: needs a name`);
    if (!(ABILITY_KINDS as readonly string[]).includes(a.kind)) {
      if (!(a as { planned?: boolean }).planned) e.push(`${w}: unknown kind "${a.kind}" (add planned: true to keep it as data until it is built)`);
      continue;
    }
    const x = a as Record<string, unknown>;
    if (a.kind === 'recharge-area') {
      if (!(Number(x.recharge) >= 2 && Number(x.recharge) <= 6)) e.push(`${w}: recharge 2–6`);
      if (!ABILITIES6.includes(String(x.save)) || !Number(x.dc) || !DAMAGE_TYPES.includes(String(x.type))) e.push(`${w}: needs save, dc and a damage type`);
      const area = x.area as { shape?: string; size?: number } | undefined;
      if (!area || !['line', 'cone', 'sphere'].includes(area.shape ?? '') || !(Number(area.size) > 0)) e.push(`${w}: area { shape: line|cone|sphere, size }`);
    }
    if (a.kind === 'aura' && (!ABILITIES6.includes(String(x.save)) || !Number(x.dc) || !['poisoned', 'prone'].includes(String(x.condition)) || !Number(x.range))) {
      e.push(`${w}: aura needs range, save, dc and condition (poisoned|prone)`);
    }
    if (a.kind === 'parry' && !Number(x.ac)) e.push(`${w}: parry needs ac`);
  }
  for (const k of ['resist', 'immune', 'vulnerable'] as const) for (const t of m[k] ?? []) if (!DAMAGE_TYPES.includes(t)) e.push(`${where}: ${k} has unknown type "${t}"`);
  for (const c of m.conditionImmune ?? []) if (!CONDITIONS.includes(c)) e.push(`${where}: unknown condition "${c}"`);
  if (m.size && !SIZE_NAMES.includes(m.size)) e.push(`${where}: unknown size "${m.size}"`);
  if (!Array.isArray(m.tags) || !m.tags.length) e.push(`${where}: needs tags (where it turns up)`);
  return e;
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
      ...(caster
        ? {
            caster: {
              ...caster,
              slots: slotsLeft(caster.maxSlots, now?.spells),
              cantrips: [...caster.cantrips],
              prepared: [...caster.prepared],
              ...(caster.freeMax ? { free: freeLeft(caster.freeMax, now?.spells) } : {}),
            },
          }
        : {}),
      ...(now?.tempHp ? { tempHp: now.tempHp } : {}),
      ...(p.features?.attacks ? { attacks: p.features.attacks } : {}),
      ...(p.features?.uses ? { uses: usesLeft(p.features.uses, now) } : {}),
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
      ...(m.type ? { creatureType: m.type } : {}),
      ...(m.size ? { size: m.size } : {}),
      ...(m.morale ? { morale: m.morale } : {}),
      attackName: m.actions[0].name,
      attackBonus: m.actions[0].bonus,
      damage: m.actions[0].damage,
      damageType: m.actions[0].types[0],
      actions: structuredClone(m.actions),
      ...(m.abilities?.length ? { abilities: structuredClone(m.abilities) } : {}),
      ...(m.resist?.length ? { resist: m.resist } : {}),
      ...(m.immune?.length ? { immune: m.immune } : {}),
      ...(m.vulnerable?.length ? { vulnerable: m.vulnerable } : {}),
      ...(m.conditionImmune?.length ? { conditionImmune: m.conditionImmune } : {}),
      traits: m.traits as Trait[],
      monster: en.monster,
      ...(m.actions[0].multi ? { attacks: m.actions[0].multi } : {}),
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
/** Every JSON in content/encounters/ (no registration needed); the file name must be its id. */
const encounterFiles = import.meta.glob('./encounters/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const encounters: Record<string, EncounterDef> = Object.fromEntries(
  Object.entries(encounterFiles).map(([path, raw]) => {
    const e = strip<EncounterDef>(raw as EncounterDef);
    const file = path.replace(/^.*\//, '').replace(/\.json$/, '');
    if (e.id !== file) throw new Error(`encounters/${file}.json: id "${e.id}" must match the file name`);
    if (e.scaling) fillerPool(e.scaling.filler, e.id); // throws if no monster fits
    buildUnits(resolveEncounter(e)); // the default party…
    if (e.scaling) buildUnits(resolveEncounter(e, { partySize: 6, level: 7, difficulty: 'high' })); // …and the most monsters it can get
    return [e.id, e];
  }),
);
export const DEFAULT_ENCOUNTER = 'cave-rats';

/** Per-location content keyed by the world map's locationId. */
export const locationContent: Record<string, LocationContent> = strip(locationsRaw);
