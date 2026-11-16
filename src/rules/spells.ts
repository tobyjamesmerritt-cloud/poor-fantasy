/**
 * Spellcasting (SRD 5.2 "Spells"; Cleric and Wizard "Spellcasting"). Pure
 * TypeScript: spell data comes from content/spells.json via the caller.
 *
 * Implemented: cantrips known, prepared spells, spell slots per class level,
 * spell attack bonus (Proficiency Bonus + ability modifier) and save DC
 * (8 + both), cantrip damage at level 5, casting with a higher slot, the
 * one-spell-slot-per-turn rule, Concentration, Wizard spellbook and Arcane
 * Recovery, and the spells in spells.json. Areas of effect on the grid use
 * the shapes below (house approximation of the SRD's cone/cube/sphere/line).
 */
import { parseDice, roll } from '../engine/dice';
import type { Rng } from '../engine/rng';
import type { Ability, CharacterSheet, PartyMemberState, SpellState } from '../engine/state';
import { resolveAttack } from './attack';
import {
  type CasterInfo,
  type CombatState,
  type EffectKind,
  type Unit,
  acOf,
  activeUnit,
  addEffect,
  attackMode,
  blessBonus,
  chebyshev,
  checkOutcome,
  endConcentration,
  hasEffect,
  healUnit,
  hurt,
  isDown,
  isUp,
  onField,
  unitAt,
} from './combat';

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

/** A class's Spellcasting feature (classes.json). Arrays are indexed by class level − 1. */
export interface SpellcastingDef {
  ability: Ability;
  cantrips: number[];
  prepared: number[];
  slots: number[][];
  spellbook?: { start: number; perLevel: number }; // Wizard
  arcaneRecovery?: boolean; // Wizard
  recommended: { cantrips: string[]; prepared: string[]; spellbook?: string[] };
}

export type Rider = 'slowed' | 'guided' | 'poisoned' | 'blinded' | 'no-heal';
export interface Area {
  shape: 'single' | 'sphere' | 'cone' | 'cube' | 'line';
  size?: number; // feet: radius (sphere), length (cone, line), side (cube)
}

export type SpellEffect =
  | {
      kind: 'attack';
      attack: 'melee' | 'ranged';
      damage: string;
      type: string;
      upcast?: string;
      rays?: number;
      rider?: Rider;
      burst?: { save: Ability; damage: string; type: string; upcast?: string; size: number };
    }
  | { kind: 'save'; save: Ability; damage?: string; type?: string; half: boolean; upcast?: string; rider?: Rider; push?: number; area: Area }
  | { kind: 'missiles'; count: number; damage: string; type: string }
  | { kind: 'heal'; dice: string; addMod: boolean; targets: number; upcast?: string; shortRest?: boolean }
  | { kind: 'buff'; buff: 'bless' | 'shield-of-faith'; targets: number; upcastTargets?: number }
  | { kind: 'stabilize' }
  | { kind: 'teleport' }
  | { kind: 'ward'; ward: 'mage-armor'; hours: number }
  | { kind: 'temp-hp'; dice: string; upcastFlat: number };

export interface SpellDef {
  name: string;
  level: number; // 0 = cantrip
  school: string;
  classes: string[];
  time: 'action' | 'bonus' | '10 minutes';
  range: number; // feet; 0 = self, 5 = touch
  where: 'combat' | 'any' | 'rest'; // rest = outside fights only
  concentration?: boolean;
  effect: SpellEffect;
  summary: string;
}

export type Spells = Record<string, SpellDef>;

/** Concentration spells: how long they last, in rounds (1 minute = 10 rounds). */
const CONCENTRATION_ROUNDS: Record<string, number> = { bless: 10, 'shield-of-faith': 100 };

// ---------------------------------------------------------------------------
// The character side: what a caster knows and prepares
// ---------------------------------------------------------------------------

const mod = (score: number) => Math.floor((score - 10) / 2);

export const slotsAt = (sc: SpellcastingDef, level: number): number[] => sc.slots[level - 1] ?? [];
export const maxSpellLevel = (sc: SpellcastingDef, level: number): number => slotsAt(sc, level).length;
export const cantripsKnown = (sc: SpellcastingDef, level: number): number => sc.cantrips[level - 1] ?? 0;
export const preparedCount = (sc: SpellcastingDef, level: number): number => sc.prepared[level - 1] ?? 0;
export const spellbookSize = (sc: SpellcastingDef, level: number): number =>
  sc.spellbook ? sc.spellbook.start + sc.spellbook.perLevel * (level - 1) : 0;

/** Cantrip damage dice multiply at character levels 5, 11 and 17. */
export const cantripScale = (level: number): number => 1 + (level >= 5 ? 1 : 0) + (level >= 11 ? 1 : 0) + (level >= 17 ? 1 : 0);

/** The class's spells the game implements, cantrips or level 1+ up to `maxLevel`; highest level first. */
export function classSpells(spells: Spells, classId: string, kind: 'cantrips' | 'leveled', maxLevel = 9): string[] {
  return Object.entries(spells)
    .filter(([, s]) => s.classes.includes(classId) && (kind === 'cantrips' ? s.level === 0 : s.level >= 1 && s.level <= maxLevel))
    .sort(([, a], [, b]) => b.level - a.level)
    .map(([id]) => id);
}

/** Recommended picks first, then the rest of the pool, up to n. */
function fill(base: readonly string[], pool: readonly string[], n: number): string[] {
  const out: string[] = [];
  for (const id of [...base, ...pool]) if (pool.includes(id) && !out.includes(id) && out.length < n) out.push(id);
  return out;
}

export interface SpellChoices {
  cantrips: string[];
  spellbook: string[]; // Wizard only (empty otherwise)
  prepared: string[];
}

/** The pool a caster prepares from: the class list (Cleric) or the spellbook (Wizard). */
export function preparePool(sheet: CharacterSheet, sc: SpellcastingDef, spells: Spells, choices?: Pick<SpellChoices, 'spellbook'>): string[] {
  const maxLevel = maxSpellLevel(sc, sheet.level);
  if (sc.spellbook) return (choices?.spellbook ?? spellChoices(sheet, sc, spells).spellbook).filter((id) => spells[id] && spells[id].level <= maxLevel);
  return classSpells(spells, sheet.classId, 'leveled', maxLevel);
}

/**
 * The caster's spells: the sheet's own picks, or — where it has none — the
 * class's recommended picks topped up from the class list to what the class
 * table allows. `topUp` also fills the sheet's own lists to the limit (used to
 * suggest picks after a level up). Picks no longer allowed are left out
 * (checkSpellChoices reports them).
 */
export function spellChoices(sheet: CharacterSheet, sc: SpellcastingDef, spells: Spells, topUp = false): SpellChoices {
  const maxLevel = maxSpellLevel(sc, sheet.level);
  const pick = (own: string[] | undefined, rec: readonly string[], pool: string[], n: number) =>
    own && !topUp ? own.filter((id) => pool.includes(id)) : fill(own ?? rec, pool, n);
  const cantrips = pick(sheet.cantrips, sc.recommended.cantrips, classSpells(spells, sheet.classId, 'cantrips'), cantripsKnown(sc, sheet.level));
  const spellbook = sc.spellbook
    ? pick(sheet.spellbook, sc.recommended.spellbook ?? [], classSpells(spells, sheet.classId, 'leveled', maxLevel), spellbookSize(sc, sheet.level))
    : [];
  const pool = sc.spellbook ? spellbook.filter((id) => spells[id]?.level <= maxLevel) : classSpells(spells, sheet.classId, 'leveled', maxLevel);
  const prepared = pick(sheet.prepared, sc.recommended.prepared, pool, preparedCount(sc, sheet.level));
  return { cantrips, spellbook, prepared };
}

/** Problems with the picks recorded on the sheet (empty = fine). */
export function checkSpellChoices(sheet: CharacterSheet, sc: SpellcastingDef, spells: Spells): string[] {
  const errors: string[] = [];
  const filled = spellChoices(sheet, sc, spells);
  const c = { cantrips: sheet.cantrips ?? [], spellbook: sheet.spellbook ?? filled.spellbook, prepared: sheet.prepared ?? [] };
  const maxLevel = maxSpellLevel(sc, sheet.level);
  const onList = (id: string) => spells[id]?.classes.includes(sheet.classId);
  const dup = (xs: string[]) => new Set(xs).size !== xs.length;
  if (c.cantrips.length > cantripsKnown(sc, sheet.level)) errors.push(`Too many cantrips (at most ${cantripsKnown(sc, sheet.level)}).`);
  if (c.cantrips.some((id) => !onList(id) || spells[id].level !== 0) || dup(c.cantrips)) errors.push('A cantrip choice is not valid.');
  if (sc.spellbook) {
    if (c.spellbook.length > spellbookSize(sc, sheet.level)) errors.push(`Too many spells in the spellbook (at most ${spellbookSize(sc, sheet.level)}).`);
    if (c.spellbook.some((id) => !onList(id) || spells[id].level < 1 || spells[id].level > maxLevel) || dup(c.spellbook)) {
      errors.push('A spellbook choice is not valid.');
    }
  }
  if (c.prepared.length > preparedCount(sc, sheet.level)) errors.push(`Too many prepared spells (at most ${preparedCount(sc, sheet.level)}).`);
  const pool = preparePool(sheet, sc, spells, c);
  if (c.prepared.some((id) => !pool.includes(id)) || dup(c.prepared)) {
    errors.push(sc.spellbook ? 'Prepared spells must come from the spellbook.' : 'A prepared spell is not valid.');
  }
  return errors;
}

/** Spell attack bonus and save DC (SRD 5.2: PB + modifier; 8 + PB + modifier). */
export function spellNumbers(score: number, pb: number): { mod: number; attack: number; dc: number } {
  const m = mod(score);
  return { mod: m, attack: pb + m, dc: 8 + pb + m };
}

export const slotsLeft = (maxSlots: readonly number[], st?: SpellState): number[] => maxSlots.map((n, i) => Math.max(0, n - (st?.used[i] ?? 0)));

// ---------------------------------------------------------------------------
// Resting: slots come back
// ---------------------------------------------------------------------------

/** Long Rest: every slot back, Arcane Recovery and Prayer of Healing usable again. Mage Armor keeps running. */
export function longRestSpells(p: PartyMemberState): void {
  if (p.spells) p.spells = { used: [], ...(p.spells.mageArmorUntil !== undefined ? { mageArmorUntil: p.spells.mageArmorUntil } : {}) };
}

/**
 * Wizard Arcane Recovery (SRD 5.2): after a Short Rest, once per Long Rest,
 * recover expended slots with a combined level up to half the Wizard level
 * (round up). Highest slots first. Returns the slot levels recovered.
 */
export function arcaneRecovery(p: PartyMemberState, level: number): number[] {
  const st = p.spells;
  if (!st || st.recovered || !st.used.some((n) => n > 0)) return [];
  let budget = Math.ceil(level / 2);
  const got: number[] = [];
  for (let lv = st.used.length; lv >= 1; lv--) {
    while (st.used[lv - 1] > 0 && lv <= budget && lv <= 5) {
      st.used[lv - 1] -= 1;
      budget -= lv;
      got.push(lv);
    }
  }
  if (got.length) st.recovered = true;
  return got;
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

/** Base dice (× cantrip scale) plus upcast dice per slot level above the spell's. */
function damageDice(base: string, upcast: string | undefined, extra: number, scale = 1): string[] {
  const b = parseDice(base);
  const parts = [`${b.count * scale}d${b.sides}${b.modifier ? (b.modifier > 0 ? `+${b.modifier}` : b.modifier) : ''}`];
  if (upcast && extra > 0) {
    const u = parseDice(upcast);
    parts.push(`${u.count * extra}d${u.sides}`);
  }
  return parts;
}

const rollAll = (rng: Rng, parts: string[]): number => parts.reduce((sum, p) => sum + Math.max(0, roll(rng, p).total), 0);

// ---------------------------------------------------------------------------
// Casting in combat
// ---------------------------------------------------------------------------

export type Targeting =
  | { kind: 'creatures'; side: 'enemy' | 'ally'; count: number; repeat: boolean; range: number; down: 'only' | 'also' | 'no' }
  | { kind: 'point'; range: number; radius: number }
  | { kind: 'direction'; shape: 'cone' | 'cube' | 'line'; size: number }
  | { kind: 'square'; range: number }
  | { kind: 'self' };

const squares = (feet: number) => Math.max(1, Math.round(feet / 5));

/** Spell ids may name a Spell Scroll: "scroll:<spell id>". */
export const baseSpellId = (id: string): string => (id.startsWith('scroll:') ? id.slice(7) : id);
export const spellOf = (spells: Spells, id: string): SpellDef | undefined => spells[baseSpellId(id)];

/** Spell Scroll (SRD 5.2): the scroll's own save DC and attack bonus by spell level. */
export const scrollNumbers = (level: number): { dc: number; attack: number } => (level >= 3 ? { dc: 15, attack: 7 } : { dc: 13, attack: 5 });

/** How a spell picks its targets, cast with a slot of level `slot` (cantrips: 0) by a caster of `level`. */
export function targetingOf(spell: SpellDef, slot: number, level: number): Targeting {
  const e = spell.effect;
  const extra = Math.max(0, slot - spell.level);
  const range = squares(spell.range);
  switch (e.kind) {
    case 'attack':
      return { kind: 'creatures', side: 'enemy', count: e.rays ? e.rays + extra : 1, repeat: true, range: e.attack === 'melee' ? 1 : range, down: 'no' };
    case 'missiles':
      return { kind: 'creatures', side: 'enemy', count: e.count + extra, repeat: true, range, down: 'no' };
    case 'save':
      if (e.area.shape === 'single') return { kind: 'creatures', side: 'enemy', count: 1, repeat: false, range, down: 'no' };
      if (e.area.shape === 'sphere') return { kind: 'point', range, radius: squares(e.area.size ?? 5) };
      return { kind: 'direction', shape: e.area.shape, size: squares(e.area.size ?? 15) };
    case 'heal':
      return { kind: 'creatures', side: 'ally', count: e.targets, repeat: false, range, down: 'also' };
    case 'buff':
      return { kind: 'creatures', side: 'ally', count: e.targets + extra * (e.upcastTargets ?? 0), repeat: false, range, down: 'no' };
    case 'stabilize':
      return { kind: 'creatures', side: 'ally', count: 1, repeat: false, range: range * (level >= 5 ? 2 : 1), down: 'only' };
    case 'teleport':
      return { kind: 'square', range };
    case 'ward':
      return { kind: 'creatures', side: 'ally', count: 1, repeat: false, range, down: 'no' };
    case 'temp-hp':
      return { kind: 'self' };
  }
}

/** Units a creature-targeting spell may pick. */
function creatureTargets(state: CombatState, caster: Unit, spell: SpellDef, t: Extract<Targeting, { kind: 'creatures' }>): Unit[] {
  return state.units.filter((u) => {
    if (!onField(u) || u.dead || chebyshev(caster, u) > t.range) return false;
    const ally = u.side === caster.side;
    if (t.side === 'enemy') return !ally && isUp(u);
    if (!ally) return false;
    if (t.down === 'only') return isDown(u) && !u.stable;
    if (t.down === 'no' && !isUp(u)) return false;
    if (spell.effect.kind === 'ward') return u.unarmoredAc !== undefined && !u.mageArmor;
    if (spell.effect.kind === 'heal') return u.hp < u.maxHp;
    return true;
  });
}

/** Squares the player can click to aim the spell. */
export function validTargets(state: CombatState, spells: Spells, spellId: string, slot: number): { x: number; y: number }[] {
  const u = activeUnit(state);
  const spell = spellOf(spells, spellId);
  if (!spell || !u.caster) return [];
  const t = targetingOf(spell, slot, u.caster.level);
  const all: { x: number; y: number }[] = [];
  for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) all.push({ x, y });
  switch (t.kind) {
    case 'creatures':
      return creatureTargets(state, u, spell, t).map(({ x, y }) => ({ x, y }));
    case 'point':
      return all.filter((p) => chebyshev(u, p) <= t.range);
    case 'direction':
      return all.filter((p) => p.x !== u.x || p.y !== u.y);
    case 'square':
      return all.filter((p) => chebyshev(u, p) <= t.range && chebyshev(u, p) > 0 && !unitAt(state, p.x, p.y));
    case 'self':
      return [{ x: u.x, y: u.y }];
  }
}

/** Nearest of the 8 compass directions from `from` toward `to`. */
export function octant(from: { x: number; y: number }, to: { x: number; y: number }): [number, number] {
  const a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / (Math.PI / 4));
  const dirs: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  return dirs[((a % 8) + 8) % 8];
}

/**
 * The squares an area spell covers when aimed at `at`.
 * Sphere: squares whose centres lie within the radius of the chosen square's centre.
 * Cone: from the caster toward the nearest compass direction, as wide at each
 *   distance as half that distance either side. Cube: a 3×3 block in front of the
 *   caster (diagonal: the corner block). Line: 1 square wide toward the aim point.
 * The caster's own square is only included by a sphere.
 */
export function areaSquares(state: CombatState, caster: { x: number; y: number }, spell: SpellDef, at: { x: number; y: number }): { x: number; y: number }[] {
  const e = spell.effect;
  const area = e.kind === 'save' ? e.area : null;
  if (!area || area.shape === 'single') return [at];
  const inBoard = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < state.width && p.y < state.height;
  const n = squares(area.size ?? 5);
  const out: { x: number; y: number }[] = [];
  if (area.shape === 'sphere') {
    for (let y = at.y - n; y <= at.y + n; y++) {
      for (let x = at.x - n; x <= at.x + n; x++) if (Math.hypot(x - at.x, y - at.y) <= n + 0.01 && inBoard({ x, y })) out.push({ x, y });
    }
    return out;
  }
  if (area.shape === 'line') {
    const dx = at.x - caster.x;
    const dy = at.y - caster.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (!steps) return [];
    for (let i = 1; i <= n; i++) {
      const p = { x: caster.x + Math.round((dx * i) / steps), y: caster.y + Math.round((dy * i) / steps) };
      if (!inBoard(p)) break;
      out.push(p);
    }
    return out;
  }
  const [ux, uy] = octant(caster, at);
  if (area.shape === 'cube') {
    // orthogonal: n deep, centred; diagonal: the n×n block off the corner
    for (let a = 1; a <= n; a++) {
      for (let b = -Math.floor(n / 2); b <= Math.floor(n / 2); b++) {
        const p = ux && uy ? null : { x: caster.x + ux * a + (ux ? 0 : b), y: caster.y + uy * a + (uy ? 0 : b) };
        if (p && inBoard(p)) out.push(p);
      }
    }
    if (ux && uy) for (let a = 1; a <= n; a++) for (let b = 1; b <= n; b++) {
      const p = { x: caster.x + ux * a, y: caster.y + uy * b };
      if (inBoard(p)) out.push(p);
    }
    return out;
  }
  // cone
  const len = Math.hypot(ux, uy);
  for (let y = caster.y - n; y <= caster.y + n; y++) {
    for (let x = caster.x - n; x <= caster.x + n; x++) {
      const dx = x - caster.x;
      const dy = y - caster.y;
      const along = (dx * ux + dy * uy) / len;
      const across = Math.abs(dx * uy - dy * ux) / len;
      if (along >= 0.5 && along <= n + 0.01 && across <= along / 2 + 0.01 && inBoard({ x, y })) out.push({ x, y });
    }
  }
  return out;
}

export interface CastOption {
  id: string; // spell id, or "scroll:<spell id>" to read a Spell Scroll from the pack
  scroll?: boolean;
  spell: SpellDef;
  levels: number[]; // slot levels it can be cast with now (cantrips: [0])
  reason?: string; // why it can't be cast right now
}

/** The active unit's spells and whether each can be cast right now. */
export function castOptions(state: CombatState, spells: Spells): CastOption[] {
  const u = activeUnit(state);
  const c = u.caster;
  if (!c || state.outcome !== 'ongoing' || !isUp(u) || !onField(u)) return [];
  return [...c.cantrips, ...c.prepared]
    .filter((id) => spells[id] && spells[id].where !== 'rest')
    .map((id): CastOption => {
      const spell = spells[id];
      const levels = spell.level === 0 ? [0] : c.slots.map((n, i) => (n > 0 && i + 1 >= spell.level ? i + 1 : 0)).filter(Boolean);
      let reason: string | undefined;
      if (spell.time === 'action' && state.actionUsed) reason = 'Action already used';
      else if (spell.time === 'bonus' && state.bonusUsed) reason = 'Bonus Action already used';
      else if (spell.level > 0 && state.slotUsed) reason = 'Only one spell slot per turn';
      else if (!levels.length) reason = 'No spell slots left';
      else if (spell.effect.kind === 'teleport' && u.carrying) reason = 'Put your load down first';
      else if (!validTargets(state, spells, id, levels[0]).length) reason = 'No target in range';
      return { id, spell, levels, reason };
    })
    .concat(scrollOptions(state, spells));
}

/**
 * Spell Scrolls in the pack the active caster can read: the spell must be on
 * their class's list (SRD 5.2). Reading one uses no spell slot.
 */
function scrollOptions(state: CombatState, spells: Spells): CastOption[] {
  const u = activeUnit(state);
  const c = u.caster!;
  return Object.entries(state.scrolls ?? {})
    .filter(([id, n]) => n > 0 && spells[id]?.classes.includes(c.classId) && spells[id].where !== 'rest')
    .map(([id]) => {
      const spell = spells[id];
      const ref = `scroll:${id}`;
      let reason: string | undefined;
      if (spell.time === 'action' && state.actionUsed) reason = 'Action already used';
      else if (spell.time === 'bonus' && state.bonusUsed) reason = 'Bonus Action already used';
      else if (spell.effect.kind === 'teleport' && u.carrying) reason = 'Put your load down first';
      else if (!validTargets(state, spells, ref, spell.level).length) reason = 'No target in range';
      return { id: ref, scroll: true, spell, levels: [spell.level], reason };
    });
}

/**
 * Cast a spell. `targets` are grid squares: one per pick for creature spells
 * (repeat a square for several darts or rays at one target), the aim point
 * for areas, the destination for Misty Step. Returns false if not allowed.
 */
export function castSpell(
  state: CombatState,
  rng: Rng,
  spells: Spells,
  spellId: string,
  slot: number,
  targets: { x: number; y: number }[],
): boolean {
  const u = activeUnit(state);
  const c = u.caster;
  const spell = spellOf(spells, spellId);
  const option = castOptions(state, spells).find((o) => o.id === spellId);
  if (!c || !spell || !option || option.reason || !option.levels.includes(slot)) return false;
  const t = targetingOf(spell, slot, c.level);
  const valid = validTargets(state, spells, spellId, slot);
  const ok = (p: { x: number; y: number }) => valid.some((v) => v.x === p.x && v.y === p.y);
  if (!targets.length || !targets.every(ok)) return false;
  if (t.kind === 'creatures') {
    if (targets.length > t.count) return false;
    if (!t.repeat && new Set(targets.map((p) => `${p.x},${p.y}`)).size !== targets.length) return false;
  } else if (targets.length !== 1) return false;

  // Pay for it: a spell slot, or the scroll (which crumbles to dust)
  const scroll = option.scroll ? baseSpellId(spellId) : null;
  if (scroll) state.scrolls![scroll] -= 1;
  else if (spell.level > 0) {
    c.slots[slot - 1] -= 1;
    state.slotUsed = true;
  }
  if (spell.time === 'bonus') state.bonusUsed = true;
  else {
    state.actionUsed = true; // movement can still be used before or after (SRD 5.2)
  }
  const upcast = slot > spell.level && spell.level > 0 ? ` (level ${slot} slot)` : '';
  state.log.push(`✦ ${u.name} ${scroll ? 'reads a scroll of' : 'casts'} ${spell.name}${upcast}.`);
  if (scroll && spell.level > c.maxSlots.length) {
    // SRD 5.2 Spell Scroll: a spell above what you can cast needs a spellcasting ability check, DC 10 + its level.
    const d20 = rng.int(1, 20);
    if (d20 + c.mod < 10 + spell.level) {
      state.log.push(`The words twist away from ${u.name} (${d20 + c.mod} vs DC ${10 + spell.level}) — the scroll is wasted.`);
      return true;
    }
  }
  const own = { attack: c.attack, dc: c.dc };
  if (scroll) Object.assign(c, scrollNumbers(spell.level)); // the scroll's own DC and attack bonus
  try {
    resolveSpell(state, rng, spellId, spell, slot, targets);
  } finally {
    Object.assign(c, own);
  }
  checkOutcome(state);
  return true;
}

function resolveSpell(
  state: CombatState,
  rng: Rng,
  spellId: string,
  spell: SpellDef,
  slot: number,
  targets: { x: number; y: number }[],
): void {
  const u = activeUnit(state);
  const c = u.caster!;
  spellId = baseSpellId(spellId);
  if (spell.concentration) {
    if (u.concentration) endConcentration(state, u, `${u.name} begins ${spell.name}`);
    u.concentration = { spell: spellId, name: spell.name, round: state.round, rounds: CONCENTRATION_ROUNDS[spellId] ?? 10 };
  }

  const extra = spell.level > 0 ? slot - spell.level : 0;
  const scale = spell.level === 0 ? cantripScale(c.level) : 1;
  const unitsAt = (ps: { x: number; y: number }[]) => ps.map((p) => unitAt(state, p.x, p.y)).filter((x): x is Unit => !!x);
  const e = spell.effect;

  switch (e.kind) {
    case 'attack': {
      for (const target of unitsAt(targets)) {
        if (!isUp(target)) {
          state.log.push(`The ${e.rays ? 'ray' : 'spell'} meets only ${target.name}'s body.`);
          continue;
        }
        spellAttack(state, rng, u, target, e.attack === 'ranged', damageDice(e.damage, e.upcast, extra, scale), e.type, e.rider);
      }
      if (e.burst) {
        const centre = targets[0];
        const caught = state.units.filter((x) => onField(x) && !x.dead && (isUp(x) || isDown(x)) && chebyshev(x, centre) <= squares(e.burst!.size));
        const dmg = rollAll(rng, damageDice(e.burst.damage, e.burst.upcast, extra));
        state.log.push(`The shard bursts into freezing shards (${dmg} ${e.burst.type}).`);
        for (const v of caught) savingThrow(state, rng, u, v, e.burst.save, dmg, false, e.burst.type);
      }
      break;
    }
    case 'missiles': {
      for (const target of unitsAt(targets)) {
        if (!isUp(target)) continue;
        const dmg = rollAll(rng, [e.damage]);
        hurt(state, rng, target, dmg, `A dart strikes ${target.name} for ${dmg} ${e.type}`, e.type);
      }
      break;
    }
    case 'save': {
      const caught =
        e.area.shape === 'single'
          ? unitsAt(targets)
          : state.units.filter(
              (x) => onField(x) && !x.dead && (isUp(x) || isDown(x)) && areaSquares(state, u, spell, targets[0]).some((p) => p.x === x.x && p.y === x.y),
            );
      if (!caught.length) state.log.push('…but nobody is caught in it.');
      const dmg = e.damage ? rollAll(rng, damageDice(e.damage, e.upcast, extra, scale)) : 0;
      const failed: Unit[] = [];
      for (const v of caught) if (!savingThrow(state, rng, u, v, e.save, dmg, e.half, e.type)) failed.push(v);
      for (const v of failed) {
        if (e.rider && isUp(v)) applyRider(state, u, v, e.rider);
        if (e.push && isUp(v)) push(state, u, v, squares(e.push));
      }
      break;
    }
    case 'heal': {
      for (const target of unitsAt(targets)) {
        const amount = rollAll(rng, damageDice(e.dice, e.upcast, extra)) + (e.addMod ? c.mod : 0);
        const wasDown = target.hp <= 0;
        const gained = healUnit(target, Math.max(0, amount));
        state.log.push(
          gained
            ? `${target.name} regains ${gained} HP (${target.hp}/${target.maxHp})${wasDown ? ` — ${target.name} is back on their feet!` : '.'}`
            : `${target.name} can't regain hit points right now.`,
        );
      }
      break;
    }
    case 'buff': {
      for (const target of unitsAt(targets)) addEffect(target, { kind: e.buff as EffectKind, owner: u.id, ends: 'concentration' });
      const who = unitsAt(targets).map((x) => x.name).join(', ');
      state.log.push(e.buff === 'bless' ? `${who} ${targets.length > 1 ? 'are' : 'is'} blessed (+1d4 to attacks and saves).` : `A shimmering field surrounds ${who} (+2 AC).`);
      break;
    }
    case 'stabilize': {
      for (const target of unitsAt(targets)) {
        target.stable = true;
        state.log.push(`${target.name} is stable.`);
      }
      break;
    }
    case 'teleport': {
      const ft = chebyshev(u, targets[0]) * 5;
      Object.assign(u, targets[0]);
      state.log.push(`${u.name} vanishes in silver mist and reappears ${ft} ft away.`);
      break;
    }
    case 'ward': {
      for (const target of unitsAt(targets)) {
        target.ac = target.unarmoredAc!;
        target.mageArmor = true;
        state.log.push(`${target.name} is warded by Mage Armor (AC ${acOf(target)}).`);
      }
      break;
    }
    case 'temp-hp': {
      const amount = rollAll(rng, [e.dice]) + e.upcastFlat * extra;
      if (amount > (u.tempHp ?? 0)) u.tempHp = amount; // Temporary HP don't stack: keep the higher
      state.log.push(`${u.name} has ${u.tempHp} temporary hit points (rolled ${amount}).`);
      break;
    }
  }
}

/** Spell attack roll: crits double the dice; riders on a hit. */
function spellAttack(
  state: CombatState,
  rng: Rng,
  caster: Unit,
  target: Unit,
  ranged: boolean,
  dice: string[],
  type: string,
  rider?: Rider,
): void {
  const { mode, notes } = attackMode(state, caster, target, ranged);
  const bless = blessBonus(rng, caster);
  if (bless) notes.push(`bless +${bless}`);
  const ac = acOf(target);
  const r = resolveAttack(rng, { attackBonus: caster.caster!.attack + bless, targetAc: ac, damage: dice, mode });
  const tag = notes.length ? ` [${notes.join(', ')}]` : '';
  if (!r.hit) {
    state.log.push(`It misses ${target.name} (${r.attackTotal} vs AC ${ac})${tag}.`);
    return;
  }
  hurt(state, rng, target, r.damage, `${r.critical ? 'CRITICAL! It' : 'It'} hits ${target.name} for ${r.damage} ${type}${tag}`, type);
  if (rider && isUp(target)) applyRider(state, caster, target, rider);
}

/** Saving throw against the caster's DC; damage on a failure (half on a success if `half`). Returns true on a success. */
function savingThrow(state: CombatState, rng: Rng, caster: Unit, target: Unit, ability: Ability, dmg: number, half: boolean, type?: string): boolean {
  const bless = blessBonus(rng, target);
  // Dodge (SRD 5.2): Advantage on Dexterity saving throws
  const d20 = ability === 'dex' && hasEffect(target, 'dodging') ? Math.max(rng.int(1, 20), rng.int(1, 20)) : rng.int(1, 20);
  const total = d20 + (target.saves?.[ability] ?? 0) + bless;
  const dc = caster.caster!.dc;
  const success = total >= dc;
  const what = `${target.name} ${success ? 'saves' : 'fails'} (${ability.toUpperCase()} ${total} vs DC ${dc}${bless ? `, bless +${bless}` : ''})`;
  const taken = success ? (half ? Math.floor(dmg / 2) : 0) : dmg;
  if (taken > 0) hurt(state, rng, target, taken, `${what}: ${taken} ${type ?? ''}`.trimEnd(), type);
  else state.log.push(`${what}.`);
  return success;
}

function applyRider(state: CombatState, caster: Unit, target: Unit, rider: Rider): void {
  const lasting: Record<Rider, { ends: 'start' | 'end'; skip: number; text: string }> = {
    slowed: { ends: 'start', skip: 0, text: 'is slowed (−10 ft Speed)' },
    guided: { ends: 'end', skip: 1, text: 'glimmers — the next attack against it has Advantage' },
    poisoned: { ends: 'end', skip: 1, text: 'is Poisoned (Disadvantage on attacks)' },
    blinded: { ends: 'end', skip: 1, text: 'is Blinded' },
    'no-heal': { ends: 'end', skip: 1, text: "can't regain hit points for now" },
  };
  const l = lasting[rider];
  addEffect(target, { kind: rider, owner: caster.id, ends: l.ends, skip: l.skip });
  state.log.push(`${target.name} ${l.text}.`);
}

/** Thunderwave: shove a creature straight away from the caster, stopping at the edge or another creature. */
function push(state: CombatState, from: Unit, target: Unit, n: number): void {
  const dx = Math.sign(target.x - from.x);
  const dy = Math.sign(target.y - from.y);
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const x = target.x + dx;
    const y = target.y + dy;
    if (x < 0 || y < 0 || x >= state.width || y >= state.height || unitAt(state, x, y)) break;
    target.x = x;
    target.y = y;
    moved++;
  }
  if (moved) state.log.push(`${target.name} is hurled back ${moved * 5} ft.`);
}

// ---------------------------------------------------------------------------
// Casting outside combat (camp, party screen)
// ---------------------------------------------------------------------------

/** What out-of-combat casting needs to know about a party member. */
export interface CasterStats {
  id: string;
  name: string;
  hp: number; // maximum
  level?: number; // default 1
  hitDie: number;
  conMod: number;
  caster?: { classId: string; mod: number; maxSlots: number[]; arcaneRecovery: boolean; prepared: string[] };
  noArmor?: boolean; // wearing no armour (Mage Armor can help)
}

export interface OutsideResult {
  ok: boolean;
  reason?: string;
  minutes: number;
  log: string[];
}

/** Spells a character can cast right now outside a fight (healing, wards) — prepared ones, and scrolls in the pack. */
export function outsideOptions(
  spells: Spells,
  who: CasterStats,
  p: PartyMemberState,
  inventory: Record<string, number> = {},
): { id: string; spell: SpellDef; levels: number[]; scroll?: boolean }[] {
  const c = who.caster;
  if (!c || p.dead || p.hp <= 0) return [];
  const left = slotsLeft(c.maxSlots, p.spells);
  const outside = (id: string) => spells[id] && spells[id].where !== 'combat' && spells[id].level > 0;
  const prepared = c.prepared
    .filter(outside)
    .map((id) => ({ id, spell: spells[id], levels: left.map((n, i) => (n > 0 && i + 1 >= spells[id].level ? i + 1 : 0)).filter(Boolean) }));
  const scrolls = Object.keys(inventory)
    .filter((ref) => ref.startsWith('scroll:') && inventory[ref] > 0)
    .map(baseSpellId)
    .filter((id) => outside(id) && spells[id].classes.includes(c.classId))
    .map((id) => ({ id: `scroll:${id}`, spell: spells[id], levels: [spells[id].level], scroll: true }));
  return [...prepared, ...scrolls];
}

/** Who a spell can target outside a fight. */
export function outsideTargets(spell: SpellDef, casterId: string, party: readonly PartyMemberState[], stats: readonly CasterStats[], now: number): string[] {
  const e = spell.effect;
  return party
    .filter((p) => {
      if (p.dead) return false;
      const s = stats.find((x) => x.id === p.id);
      if (!s) return false;
      if (e.kind === 'heal') return p.hp < s.hp && !(e.shortRest && p.spells?.prayed);
      if (e.kind === 'ward') return !!s.noArmor && !((p.spells?.mageArmorUntil ?? -1) > now);
      if (e.kind === 'temp-hp') return p.id === casterId;
      return false;
    })
    .map((p) => p.id);
}

/**
 * Cast a healing or warding spell between fights. Prayer of Healing takes
 * 10 minutes and gives its targets a Short Rest's benefits (Hit Dice, Arcane
 * Recovery) — once per Long Rest each.
 */
export function castOutside(
  spells: Spells,
  spellId: string,
  slot: number,
  caster: CasterStats,
  party: PartyMemberState[],
  stats: readonly CasterStats[],
  targetIds: readonly string[],
  now: number,
  rng: Rng,
  spendHitDice: (p: PartyMemberState, s: CasterStats, log: string[]) => void,
  inventory: Record<string, number> = {},
): OutsideResult {
  const fail = (reason: string): OutsideResult => ({ ok: false, reason, minutes: 0, log: [] });
  const spell = spellOf(spells, spellId);
  const me = party.find((p) => p.id === caster.id);
  if (!spell || !me) return fail('Unknown spell.');
  const option = outsideOptions(spells, caster, me, inventory).find((o) => o.id === spellId);
  if (!option) return fail(`${caster.name} can't cast that now.`);
  if (!option.levels.includes(slot)) return fail('No spell slot of that level left.');
  const allowed = outsideTargets(spell, caster.id, party, stats, now);
  const e = spell.effect;
  const max = e.kind === 'heal' ? e.targets : 1;
  if (!targetIds.length || targetIds.length > max || !targetIds.every((id) => allowed.includes(id)) || new Set(targetIds).size !== targetIds.length) {
    return fail('Choose who the spell is for.');
  }

  if (option.scroll) {
    // the scroll crumbles to dust (SRD 5.2); a spell above the caster's slots needs a check, DC 10 + level
    const left = (inventory[spellId] ?? 0) - 1;
    if (left > 0) inventory[spellId] = left;
    else delete inventory[spellId];
    if (spell.level > caster.caster!.maxSlots.length) {
      const total = rng.int(1, 20) + caster.caster!.mod;
      if (total < 10 + spell.level) return { ok: true, minutes: 1, log: [`${caster.name} stumbles over the scroll's words (${total} vs DC ${10 + spell.level}) — it is wasted.`] };
    }
  } else {
    me.spells = me.spells ?? { used: [] };
    me.spells.used[slot - 1] = (me.spells.used[slot - 1] ?? 0) + 1;
    for (let i = 0; i < me.spells.used.length; i++) me.spells.used[i] ??= 0;
  }
  const extra = slot - spell.level;
  const log = [`${caster.name} ${option.scroll ? 'reads a scroll of' : 'casts'} ${spell.name}${extra > 0 ? ` (level ${slot} slot)` : ''}.`];
  const minutes = spell.time === '10 minutes' ? 10 : 1;

  for (const id of targetIds) {
    const p = party.find((x) => x.id === id)!;
    const s = stats.find((x) => x.id === id)!;
    if (e.kind === 'heal') {
      const amount = rollAll(rng, damageDice(e.dice, e.upcast, extra)) + (e.addMod ? caster.caster!.mod : 0);
      const before = Math.max(0, p.hp);
      p.hp = Math.min(s.hp, before + Math.max(0, amount));
      if (before <= 0 && p.hp > 0) p.wakesAt = null;
      log.push(`${s.name} regains ${p.hp - before} HP (${p.hp}/${s.hp}).`);
      if (e.shortRest) {
        p.spells = p.spells ?? { used: [] };
        p.spells.prayed = true;
        spendHitDice(p, s, log);
        if (s.caster?.arcaneRecovery) {
          const got = arcaneRecovery(p, s.level ?? 1);
          if (got.length) log.push(`${s.name} recovers spell slot${got.length > 1 ? 's' : ''} of level ${got.join(', ')} (Arcane Recovery).`);
        }
      }
    } else if (e.kind === 'ward') {
      p.spells = p.spells ?? { used: [] };
      p.spells.mageArmorUntil = now + minutes + e.hours * 60;
      log.push(`${s.name} is warded by Mage Armor for ${e.hours} hours.`);
    } else if (e.kind === 'temp-hp') {
      const amount = rollAll(rng, [e.dice]) + e.upcastFlat * extra;
      p.tempHp = Math.max(p.tempHp ?? 0, amount);
      log.push(`${s.name} gains ${amount} temporary hit points.`);
    }
  }
  return { ok: true, minutes, log };
}

/** Fight → party: slots spent, temporary HP left, Mage Armor cast during the fight. */
export function spellsAfterCombat(p: PartyMemberState, u: Unit, now: number): void {
  p.tempHp = u.tempHp || undefined;
  if (!p.tempHp) delete p.tempHp;
  if (u.caster) {
    const used = u.caster.maxSlots.map((n, i) => n - u.caster!.slots[i]);
    p.spells = { ...(p.spells ?? {}), used };
  }
  if (u.mageArmor && !((p.spells?.mageArmorUntil ?? -1) > now)) {
    p.spells = p.spells ?? { used: [] };
    p.spells.mageArmorUntil = now + 8 * 60;
  }
}

/** Sheet + current condition → the caster block a combat unit carries. */
export function casterInfo(
  sheet: CharacterSheet,
  sc: SpellcastingDef,
  spells: Spells,
  score: number,
  pb: number,
  st?: SpellState,
): CasterInfo {
  const choices = spellChoices(sheet, sc, spells);
  const n = spellNumbers(score, pb);
  const maxSlots = slotsAt(sc, sheet.level);
  return {
    classId: sheet.classId,
    ability: sc.ability,
    mod: n.mod,
    attack: n.attack,
    dc: n.dc,
    level: sheet.level,
    cantrips: choices.cantrips,
    prepared: choices.prepared,
    maxSlots: [...maxSlots],
    slots: slotsLeft(maxSlots, st),
  };
}
