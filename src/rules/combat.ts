/**
 * Tactical combat state machine. Pure TypeScript — the Phaser CombatScene
 * only renders this state and forwards commands.
 *
 * Implemented (SRD 5.2): initiative, movement in 5-ft squares, one attack per
 * turn (move into an adjacent enemy), multi-part damage, Pack Tactics,
 * 0 HP rules for characters (Unconscious, Death Saving Throws, Instant Death,
 * Stable), stabilising an ally with the Help action (DC 10 Wisdom (Medicine)).
 * Monsters die at 0 HP. Simple enemy AI. Victory/defeat.
 * Retreat: characters escape by stepping off a map edge; fallen allies can be
 * carried out (see RetreatRule for the three difficulty settings).
 * Spells (rules/spells.ts) use the hooks here: effects with SRD durations
 * ("until the start/end of your next turn", Concentration), Temporary Hit
 * Points, and the one-spell-slot-per-turn rule.
 * Not yet: opportunity attacks, reactions, most conditions.
 */
import type { Direction } from '../engine/commands';
import { DIRECTION_VECTORS } from '../engine/commands';
import { resolveRollMode, rollD20 } from '../engine/dice';
import type { Rng } from '../engine/rng';
import type { Ability } from '../engine/state';
import { resolveAttack } from './attack';

export type Side = 'party' | 'enemy';

/**
 * What happens to fallen characters when the party flees (Preferences → Difficulty).
 * hard:   anyone may flee at any time; whoever is left on the field is lost.
 * normal: the last character standing can't flee while an unconscious ally is
 *         still on the field — carry them out first.
 * casual: when one character flees, the whole party escapes.
 */
export type RetreatRule = 'hard' | 'normal' | 'casual';
export type Trait = 'pack-tactics';

/**
 * Lasting effects on a unit. `owner` is whoever caused it; `ends` says when it
 * stops: at the start or end of the owner's turn (`skip` = turns to let pass
 * first, so "the end of your next turn" is ends 'end', skip 1), or when the
 * owner's Concentration ends.
 */
export type EffectKind = 'bless' | 'shield-of-faith' | 'guided' | 'slowed' | 'poisoned' | 'blinded' | 'no-heal';
export interface Effect {
  kind: EffectKind;
  owner: string;
  ends: 'start' | 'end' | 'concentration';
  skip?: number;
}

/** What a spellcaster brings into a fight (built by rules/spells.ts from the character sheet). */
export interface CasterInfo {
  classId: string;
  ability: Ability;
  mod: number; // spellcasting ability modifier
  attack: number; // spell attack bonus
  dc: number; // spell save DC
  level: number; // character level (cantrip damage)
  cantrips: string[];
  prepared: string[];
  slots: number[]; // slots left per level (index 0 = level 1)
  maxSlots: number[];
}

export interface Unit {
  id: string;
  name: string;
  side: Side;
  sprite: string; // art key (content/assets.json); ignored by the rules
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ac: number;
  speed: number; // squares per turn (5 ft each)
  initBonus: number;
  attackName: string;
  attackBonus: number;
  damage: string[]; // summed; e.g. ["1d4+3", "2d4"]
  traits: Trait[];
  medicine: number; // Wisdom (Medicine) bonus, for stabilising allies
  deathSaves: { successes: number; failures: number };
  stable: boolean;
  dead: boolean;
  xp?: number; // monsters: experience points for defeating it
  fled?: boolean; // left the battle over a map edge
  carrying?: string; // id of the fallen ally this unit carries
  carriedBy?: string; // id of the unit carrying this one (off the grid while carried)
  saves?: Partial<Record<Ability, number>>; // saving throw bonuses (missing = +0)
  tempHp?: number; // Temporary Hit Points, lost before real ones
  effects?: Effect[];
  concentration?: { spell: string; name: string; round: number; rounds: number };
  caster?: CasterInfo;
  unarmoredAc?: number; // AC with Mage Armor (13 + Dex, + shield) — characters wearing no armour only
  mageArmor?: boolean;
  monster?: string; // monsters.json id
  attacks?: number; // Multiattack: attacks per Attack action
  regeneration?: number; // HP regained at the start of its turn…
  regenBlocked?: boolean; // …unless it took acid or fire damage since (SRD 5.2 Troll)
  fumble?: number; // house rule for quest tweaks (a drunk troll): chance each attack simply misses
}

export interface CombatState {
  width: number;
  height: number;
  units: Unit[];
  order: string[]; // initiative order, unit ids
  turnIndex: number;
  round: number;
  movesLeft: number;
  actionUsed: boolean;
  outcome: 'ongoing' | 'victory' | 'defeat' | 'fled';
  retreat: RetreatRule;
  bonusUsed: boolean; // this turn's Bonus Action (potions, some spells)
  slotUsed: boolean; // SRD 5.2: only one spell slot may be expended per turn
  potions: number; // Potions of Healing in the party pack
  scrolls?: Record<string, number>; // Spell Scrolls in the party pack, by spell id
  log: string[];
}

/** Conscious and able to act. */
export const isUp = (u: Unit): boolean => u.hp > 0 && !u.dead;
/** A character at 0 HP who is not dead (Unconscious, possibly Stable). */
export const isDown = (u: Unit): boolean => u.side === 'party' && u.hp <= 0 && !u.dead;
/** Standing on the grid: not fled and not being carried. */
export const onField = (u: Unit): boolean => !u.fled && !u.carriedBy;

/**
 * Movement cost per square. Carrying a fallen ally costs 1 extra square per
 * square (SRD 5.2 Grappled condition: moving a creature you hold costs
 * 1 extra foot per foot unless it is Tiny or two sizes smaller).
 */
export const stepCost = (u: Unit): number => (u.carrying ? 2 : 1);

export function startCombat(
  rng: Rng,
  width: number,
  height: number,
  units: Unit[],
  retreat: RetreatRule = 'normal',
  potions = 0,
  scrolls: Record<string, number> = {},
): CombatState {
  const rolled = units.map((u) => ({ id: u.id, init: rollD20(rng).kept + u.initBonus, tie: u.initBonus }));
  rolled.sort((a, b) => b.init - a.init || b.tie - a.tie);
  const state: CombatState = {
    width,
    height,
    units: units.map((u) => structuredClone(u)),
    order: rolled.map((r) => r.id),
    turnIndex: 0,
    round: 1,
    movesLeft: 0,
    actionUsed: false,
    outcome: 'ongoing',
    retreat,
    bonusUsed: false,
    slotUsed: false,
    potions,
    scrolls: { ...scrolls },
    log: ['Roll for initiative! ' + rolled.map((r) => `${nameOf(units, r.id)} ${r.init}`).join(', ')],
  };
  beginTurn(state);
  runEnemyTurn(state, rng); // enemies that win initiative act immediately
  return state;
}

export function activeUnit(state: CombatState): Unit {
  return unitById(state, state.order[state.turnIndex]);
}

export function unitById(state: CombatState, id: string): Unit {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`No unit ${id}`);
  return u;
}

/** The unit occupying a square. Unconscious characters still occupy theirs; corpses do not. */
export function unitAt(state: CombatState, x: number, y: number): Unit | undefined {
  return state.units.find((u) => (isUp(u) || isDown(u)) && onField(u) && u.x === x && u.y === y);
}

/**
 * Move the active unit one square. Moving into an enemy attacks it; moving
 * into an unconscious ally tries to stabilise them (Help action), or picks
 * them up if they are already stable. Stepping off a map edge flees.
 * Returns false when the step is not allowed.
 */
export function step(state: CombatState, rng: Rng, dir: Direction): boolean {
  if (state.outcome !== 'ongoing') return false;
  const u = activeUnit(state);
  const [dx, dy] = DIRECTION_VECTORS[dir];
  const nx = u.x + dx;
  const ny = u.y + dy;
  if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) {
    if (u.side !== 'party') return false;
    const check = canFlee(state);
    if (!check.ok) {
      state.log.push(check.reason);
      return true; // the explanation is a change worth showing
    }
    flee(state, rng);
    return true;
  }

  const occupant = unitAt(state, nx, ny);
  if (occupant) {
    if (state.actionUsed) return false;
    if (occupant.side !== u.side) {
      attack(state, rng, u, occupant);
      return true;
    }
    if (isDown(occupant) && !occupant.stable) {
      helpStabilise(state, rng, u, occupant);
      return true;
    }
    if (isDown(occupant) && !u.carrying) {
      pickUp(state, u, occupant);
      return true;
    }
    return false;
  }
  if (state.movesLeft < stepCost(u)) return false;
  u.x = nx;
  u.y = ny;
  state.movesLeft -= stepCost(u);
  if (u.carrying) Object.assign(unitById(state, u.carrying), { x: nx, y: ny });
  return true;
}

/** Lift a fallen, stable ally onto your shoulders (takes your action). */
function pickUp(state: CombatState, u: Unit, target: Unit): void {
  state.actionUsed = true;
  u.carrying = target.id;
  target.carriedBy = u.id;
  Object.assign(target, { x: u.x, y: u.y });
  state.log.push(`${u.name} lifts ${target.name} onto their shoulders (moving costs double).`);
}

/** Put a carried ally down on the nearest free square (the carrier fell, or the ally woke up). */
function drop(state: CombatState, carrier: Unit): void {
  if (!carrier.carrying) return;
  const carried = unitById(state, carrier.carrying);
  carrier.carrying = undefined;
  carried.carriedBy = undefined;
  for (let r = 0; r <= Math.max(state.width, state.height); r++) {
    for (let y = carrier.y - r; y <= carrier.y + r; y++) {
      for (let x = carrier.x - r; x <= carrier.x + r; x++) {
        if (x < 0 || y < 0 || x >= state.width || y >= state.height || unitAt(state, x, y)) continue;
        Object.assign(carried, { x, y });
        state.log.push(`${carried.name} is put down.`);
        return;
      }
    }
  }
}

/** Whether the active character may flee this turn, and why not. */
export function canFlee(state: CombatState): { ok: true } | { ok: false; reason: string } {
  if (state.outcome !== 'ongoing') return { ok: false, reason: 'The battle is over.' };
  const u = activeUnit(state);
  if (u.side !== 'party' || !isUp(u)) return { ok: false, reason: 'Only a conscious character can flee.' };
  const onEdge = u.x === 0 || u.y === 0 || u.x === state.width - 1 || u.y === state.height - 1;
  if (!onEdge) return { ok: false, reason: `${u.name} must reach the edge of the map to flee.` };
  if (state.movesLeft < stepCost(u)) return { ok: false, reason: `${u.name} has no movement left to flee.` };
  if (state.retreat === 'normal') {
    const othersStanding = state.units.some((o) => o !== u && o.side === 'party' && isUp(o) && onField(o));
    const leftBehind = state.units.filter((o) => o.side === 'party' && isDown(o) && onField(o));
    if (!othersStanding && leftBehind.length) {
      return {
        ok: false,
        reason: `${u.name} won't abandon ${leftBehind.map((o) => o.name).join(', ')} — carry them out first.`,
      };
    }
  }
  return { ok: true };
}

/** The active character leaves the battle over the map edge (with anyone they carry). */
export function flee(state: CombatState, rng: Rng): void {
  const check = canFlee(state);
  if (!check.ok) {
    state.log.push(check.reason);
    return;
  }
  const u = activeUnit(state);
  u.fled = true;
  if (u.carrying) {
    const carried = unitById(state, u.carrying);
    carried.fled = true;
    state.log.push(`${u.name} flees the battle, carrying ${carried.name} to safety!`);
  } else {
    state.log.push(`${u.name} flees the battle!`);
  }
  if (state.retreat === 'casual') {
    for (const o of state.units) if (o.side === 'party' && !o.dead) o.fled = true;
    state.log.push('The whole party falls back with them.');
  }
  checkOutcome(state);
  if (state.outcome !== 'ongoing') return;
  advance(state, rng);
  runEnemyTurn(state, rng);
}

export function endTurn(state: CombatState, rng: Rng): void {
  if (state.outcome !== 'ongoing') return;
  advance(state, rng);
  runEnemyTurn(state, rng);
}

/**
 * Move to the next creature that can take a turn. Characters at 0 HP make
 * their Death Saving Throw at the start of their turn (SRD 5.2 "Death Saving
 * Throws"); unless that restores them, their turn passes.
 */
function advance(state: CombatState, rng: Rng): void {
  if (state.order.length) expireEffects(state, activeUnit(state).id, 'end');
  for (let guard = 0; guard < state.order.length * 3; guard++) {
    state.turnIndex += 1;
    if (state.turnIndex >= state.order.length) {
      state.turnIndex = 0;
      state.round += 1;
      state.log.push(`— Round ${state.round} —`);
    }
    const u = activeUnit(state);
    if (u.dead || u.fled || (u.side === 'enemy' && u.hp <= 0)) continue;
    if (isDown(u)) {
      if (!u.stable) deathSave(state, rng, u);
      if (state.outcome !== 'ongoing') return;
      if (!isUp(u)) continue;
      if (u.carriedBy) drop(state, unitById(state, u.carriedBy)); // woke up: back on their feet
    }
    beginTurn(state);
    return;
  }
}

function beginTurn(state: CombatState): void {
  const u = activeUnit(state);
  expireEffects(state, u.id, 'start');
  if (u.concentration && state.round - u.concentration.round >= u.concentration.rounds) {
    endConcentration(state, u, 'runs out');
  }
  // Regeneration (SRD 5.2 Troll): back up at the start of its turn, unless burned or dissolved since.
  if (u.regeneration && !u.dead && u.hp > 0) {
    if (u.regenBlocked) state.log.push(`${u.name}'s burned flesh does not knit.`);
    else if (u.hp < u.maxHp) {
      const before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + u.regeneration);
      state.log.push(`${u.name} regenerates ${u.hp - before} HP (${u.hp}/${u.maxHp}).`);
    }
    u.regenBlocked = false;
  }
  // Ray of Frost: Speed −10 ft (2 squares)
  state.movesLeft = hasEffect(u, 'slowed') ? Math.max(0, u.speed - 2) : u.speed;
  state.actionUsed = false;
  state.bonusUsed = false;
  state.slotUsed = false;
  if (u.side === 'party') state.log.push(`▶ ${u.name}'s turn.`);
}

// ---------------------------------------------------------------------------
// Effects, Concentration, damage and healing
// ---------------------------------------------------------------------------

export const hasEffect = (u: Unit, kind: EffectKind): boolean => !!u.effects?.some((e) => e.kind === kind);

/** Armor Class right now (Shield of Faith: +2). */
export const acOf = (u: Unit): number => u.ac + (hasEffect(u, 'shield-of-faith') ? 2 : 0);

/** Put an effect on a unit, replacing the same effect from the same source. */
export function addEffect(target: Unit, effect: Effect): void {
  target.effects = [...(target.effects ?? []).filter((e) => !(e.kind === effect.kind && e.owner === effect.owner)), effect];
}

/** Effects tied to `ownerId`'s turn start or end run out (or count down). */
function expireEffects(state: CombatState, ownerId: string, at: 'start' | 'end'): void {
  for (const u of state.units) {
    if (!u.effects?.length) continue;
    u.effects = u.effects.filter((e) => {
      if (e.owner !== ownerId || e.ends !== at) return true;
      if (e.skip) {
        e.skip -= 1;
        return true;
      }
      return false;
    });
  }
}

/** The caster stops concentrating: every effect they keep up ends. */
export function endConcentration(state: CombatState, caster: Unit, why: string): void {
  if (!caster.concentration) return;
  for (const u of state.units) u.effects = u.effects?.filter((e) => !(e.owner === caster.id && e.ends === 'concentration'));
  state.log.push(`${caster.name}'s ${caster.concentration.name} ${why === 'runs out' ? 'runs out' : `ends (${why})`}.`);
  caster.concentration = undefined;
}

/** Bless: +1d4 to attack rolls and saving throws. Returns the d4 (0 without Bless). */
export function blessBonus(rng: Rng, u: Unit): number {
  return hasEffect(u, 'bless') ? rng.int(1, 4) : 0;
}

/** Is an enemy of `u` within 5 ft who can see it (not Blinded) and isn't Incapacitated? */
export function hostileAdjacent(state: CombatState, u: Unit): boolean {
  return state.units.some((o) => o.side !== u.side && isUp(o) && onField(o) && chebyshev(o, u) === 1 && !hasEffect(o, 'blinded'));
}

/**
 * Advantage / Disadvantage on an attack roll (SRD 5.2): Pack Tactics, a
 * Guiding Bolt mark (used up by this attack), Blinded or Poisoned attackers,
 * Blinded targets, ranged attacks with an enemy within 5 ft.
 */
export function attackMode(state: CombatState, attacker: Unit, target: Unit, ranged: boolean) {
  let adv = 0;
  let dis = 0;
  const notes: string[] = [];
  if (
    attacker.traits.includes('pack-tactics') &&
    state.units.some((o) => o !== attacker && o.side === attacker.side && isUp(o) && onField(o) && chebyshev(o, target) === 1)
  ) {
    adv++;
    notes.push('pack tactics');
  }
  if (hasEffect(target, 'guided')) {
    adv++;
    notes.push('guided');
    target.effects = target.effects!.filter((e) => e.kind !== 'guided');
  }
  if (hasEffect(target, 'blinded')) {
    adv++;
    notes.push('target blinded');
  }
  if (hasEffect(attacker, 'poisoned')) {
    dis++;
    notes.push('poisoned');
  }
  if (hasEffect(attacker, 'blinded')) {
    dis++;
    notes.push('blinded');
  }
  if (ranged && hostileAdjacent(state, attacker)) {
    dis++;
    notes.push('enemy in reach');
  }
  return { mode: resolveRollMode(adv, dis), notes };
}

/**
 * Deal damage and log it: Temporary Hit Points soak first, then the 0 HP
 * rules (applyDamage). A concentrating target makes a Constitution save
 * (DC 10 or half the damage, max 30) or loses Concentration; dropping to
 * 0 HP ends it. Someone carrying an ally drops them.
 */
export function hurt(state: CombatState, rng: Rng, target: Unit, amount: number, line: string, type?: string): void {
  if (target.regeneration && amount > 0 && (type === 'fire' || type === 'acid')) target.regenBlocked = true;
  let soaked = 0;
  if (target.tempHp && amount > 0) {
    soaked = Math.min(target.tempHp, amount);
    target.tempHp -= soaked;
    amount -= soaked;
  }
  const temp = soaked ? ` [${soaked} absorbed by temporary HP]` : '';
  state.log.push(line + temp + (amount > 0 ? applyDamage(target, amount) : '.'));
  if (!isUp(target) && target.carrying) drop(state, target);
  if (target.concentration) {
    if (!isUp(target)) endConcentration(state, target, target.dead ? 'dead' : 'unconscious');
    else if (amount > 0) {
      const dc = Math.min(30, Math.max(10, Math.floor(amount / 2)));
      const bless = blessBonus(rng, target);
      const total = rng.int(1, 20) + (target.saves?.con ?? 0) + bless;
      if (total < dc) endConcentration(state, target, `Constitution save ${total} vs DC ${dc}`);
      else state.log.push(`${target.name} keeps concentrating (${total} vs DC ${dc}).`);
    }
  }
}

/** Regain hit points (not while Chill Touch stops it). Waking up resets death saves. Returns HP gained. */
export function healUnit(target: Unit, amount: number): number {
  if (target.dead || hasEffect(target, 'no-heal')) return 0;
  const before = Math.max(0, target.hp);
  const wasDown = target.hp <= 0;
  target.hp = Math.min(target.maxHp, before + amount);
  if (wasDown && target.hp > 0) {
    target.deathSaves = { successes: 0, failures: 0 };
    target.stable = false;
  }
  return target.hp - before;
}

/** d20: 10+ success, 1 = two failures, 20 = regain 1 HP. Three successes: Stable; three failures: dead. */
export function deathSave(state: CombatState, rng: Rng, u: Unit): void {
  const roll = rng.int(1, 20);
  const ds = u.deathSaves;
  if (roll === 20) {
    u.hp = 1;
    u.deathSaves = { successes: 0, failures: 0 };
    state.log.push(`${u.name} rolls a 20 on a death save and regains consciousness!`);
    return;
  }
  if (roll >= 10) ds.successes += 1;
  else ds.failures += roll === 1 ? 2 : 1;
  if (ds.failures >= 3) {
    u.dead = true;
    state.log.push(`${u.name} fails a death save (${roll}) — ${u.name} dies.`);
    checkOutcome(state);
  } else if (ds.successes >= 3) {
    u.stable = true;
    state.log.push(`${u.name} succeeds a death save (${roll}) and is stable.`);
  } else {
    state.log.push(
      `${u.name} ${roll >= 10 ? 'succeeds' : 'fails'} a death save (${roll}) — ✔${ds.successes} ✖${ds.failures}.`,
    );
  }
}

/** Apply damage with the SRD 5.2 rules for dropping to and taking damage at 0 HP. */
export function applyDamage(target: Unit, amount: number): string {
  if (target.side === 'party' && isDown(target)) {
    // "Damage at 0 Hit Points": one failure, or death if it equals/exceeds HP max.
    if (amount >= target.maxHp) {
      target.dead = true;
      return ` — ${target.name} is slain!`;
    }
    target.stable = false;
    target.deathSaves.failures += 1;
    if (target.deathSaves.failures >= 3) {
      target.dead = true;
      return ` — ${target.name} dies.`;
    }
    return ` — ${target.name} suffers a death save failure (✖${target.deathSaves.failures}).`;
  }
  const remainder = amount - target.hp;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp > 0) return ` (${target.hp}/${target.maxHp}).`;
  if (target.side === 'enemy') {
    target.dead = true;
    return ` — ${target.name} falls!`;
  }
  // Instant Death: the remainder after reaching 0 HP equals or exceeds HP maximum.
  if (remainder >= target.maxHp) {
    target.dead = true;
    return ` — ${target.name} is killed outright!`;
  }
  target.deathSaves = { successes: 0, failures: 0 };
  target.stable = false;
  return ` — ${target.name} falls unconscious!`;
}

function attack(state: CombatState, rng: Rng, attacker: Unit, target: Unit): void {
  if (attacker.fumble && rng.int(1, 100) <= Math.round(attacker.fumble * 100)) {
    state.actionUsed = true;
    state.movesLeft = 0;
    state.log.push(`${attacker.name} lurches, swings wide and misses ${target.name}.`);
    return;
  }
  const { mode, notes } = attackMode(state, attacker, target, false);
  const bless = blessBonus(rng, attacker);
  if (bless) notes.push(`bless +${bless}`);
  const ac = acOf(target);
  const r = resolveAttack(rng, { attackBonus: attacker.attackBonus + bless, targetAc: ac, damage: attacker.damage, mode });
  state.actionUsed = true;
  state.movesLeft = 0; // simplification until DND-10: attacking ends movement
  const adv = notes.length ? ` [${notes.join(', ')}]` : '';
  if (!r.hit) {
    state.log.push(`${attacker.name} misses ${target.name} (${r.attackTotal} vs AC ${ac})${adv}.`);
    return;
  }
  const verb = r.critical ? 'CRITS' : 'hits';
  hurt(state, rng, target, r.damage, `${attacker.name} ${verb} ${target.name} for ${r.damage}${adv}`);
  checkOutcome(state);
}

/** Help action to stabilise: DC 10 Wisdom (Medicine) check. */
function helpStabilise(state: CombatState, rng: Rng, helper: Unit, target: Unit): void {
  const roll = rng.int(1, 20);
  const total = roll + helper.medicine;
  state.actionUsed = true;
  state.movesLeft = 0; // simplification until DND-10
  if (total >= 10) {
    target.stable = true;
    state.log.push(`${helper.name} tends to ${target.name} (Medicine ${total} vs DC 10) — ${target.name} is stable.`);
  } else {
    state.log.push(`${helper.name} tries to stabilise ${target.name} (Medicine ${total} vs DC 10) but fails.`);
  }
}

export function checkOutcome(state: CombatState): void {
  if (state.outcome !== 'ongoing') return;
  if (!state.units.some((u) => u.side === 'enemy' && isUp(u))) {
    state.outcome = 'victory';
    state.log.push('Victory!');
  } else if (!state.units.some((u) => u.side === 'party' && isUp(u) && onField(u))) {
    if (state.units.some((u) => u.side === 'party' && u.fled)) {
      state.outcome = 'fled';
      state.log.push('The party retreats!');
    } else {
      state.outcome = 'defeat';
      state.log.push('The party has fallen…');
    }
  }
}

/** Enemy AI: step toward the nearest conscious party member, attack when adjacent. */
export function runEnemyTurn(state: CombatState, rng: Rng): void {
  while (state.outcome === 'ongoing' && activeUnit(state).side === 'enemy') {
    const u = activeUnit(state);
    for (let guard = 0; guard < 30 && state.outcome === 'ongoing'; guard++) {
      const target = nearest(state, u, 'party');
      if (!target) break;
      if (chebyshev(u, target) === 1) {
        if (!state.actionUsed) {
          attack(state, rng, u, target);
          // Multiattack: the rest of the attacks, at whoever is still standing next to it
          for (let k = 1; k < (u.attacks ?? 1) && state.outcome === 'ongoing'; k++) {
            const next = state.units.find((o) => o.side === 'party' && isUp(o) && onField(o) && chebyshev(o, u) === 1);
            if (!next) break;
            attack(state, rng, u, next);
          }
        }
        break;
      }
      if (state.movesLeft <= 0) break;
      const dir = bestStepToward(state, u, target);
      if (!dir || !step(state, rng, dir)) break;
    }
    if (state.outcome !== 'ongoing') return;
    advance(state, rng);
  }
}

function nearest(state: CombatState, from: Unit, side: Side): Unit | undefined {
  return state.units
    .filter((u) => u.side === side && isUp(u) && onField(u))
    .sort((a, b) => chebyshev(from, a) - chebyshev(from, b))[0];
}

function bestStepToward(state: CombatState, u: Unit, target: Unit): Direction | undefined {
  let best: Direction | undefined;
  let bestDist = chebyshev(u, target);
  for (const [dir, [dx, dy]] of Object.entries(DIRECTION_VECTORS) as [Direction, readonly [number, number]][]) {
    const nx = u.x + dx;
    const ny = u.y + dy;
    if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height || unitAt(state, nx, ny)) continue;
    const d = Math.max(Math.abs(target.x - nx), Math.abs(target.y - ny));
    if (d < bestDist) {
      bestDist = d;
      best = dir;
    }
  }
  return best;
}

/** Grid distance with diagonals costing 1 (SRD default 5 ft per diagonal). */
export function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function nameOf(units: Unit[], id: string): string {
  return units.find((u) => u.id === id)?.name ?? id;
}

interface PathNode {
  x: number;
  y: number;
  cost: number;
  prev: number | null; // key of previous square, null for the start
  dir: Direction | null; // step taken to arrive here
}

/** Breadth-first search over empty squares within the active unit's remaining movement. */
function searchMoves(state: CombatState): Map<number, PathNode> {
  const nodes = new Map<number, PathNode>();
  if (state.outcome !== 'ongoing') return nodes;
  const start = activeUnit(state);
  const key = (x: number, y: number) => y * state.width + x;
  nodes.set(key(start.x, start.y), { x: start.x, y: start.y, cost: 0, prev: null, dir: null });
  let frontier = [key(start.x, start.y)];
  const per = stepCost(start);
  for (let cost = per; cost <= state.movesLeft && frontier.length; cost += per) {
    const next: number[] = [];
    for (const k of frontier) {
      const p = nodes.get(k)!;
      for (const [dir, [dx, dy]] of Object.entries(DIRECTION_VECTORS) as [Direction, readonly [number, number]][]) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        const nk = key(nx, ny);
        if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
        if (nodes.has(nk) || unitAt(state, nx, ny)) continue;
        nodes.set(nk, { x: nx, y: ny, cost, prev: k, dir });
        next.push(nk);
      }
    }
    frontier = next;
  }
  return nodes;
}

function pathFrom(nodes: Map<number, PathNode>, endKey: number): Direction[] {
  const dirs: Direction[] = [];
  for (let n = nodes.get(endKey); n && n.dir; n = n.prev === null ? undefined : nodes.get(n.prev)) dirs.unshift(n.dir);
  return dirs;
}

/**
 * Squares the active unit can still reach this turn with its remaining
 * movement (8-way, 1 square per step, occupied squares block). Excludes its own square.
 */
export function reachableSquares(state: CombatState): { x: number; y: number; cost: number }[] {
  return [...searchMoves(state).values()].filter((n) => n.cost > 0).map(({ x, y, cost }) => ({ x, y, cost }));
}

/**
 * Steps for "go here" from a click/tap. Empty square: shortest path within
 * remaining movement. Enemy: walk next to it, then step into it (= attack).
 * Unconscious ally: walk next to them, then step in (= try to stabilise).
 * Needs the action for the last two. Null if impossible.
 */
export function planMoveTo(state: CombatState, x: number, y: number): Direction[] | null {
  if (state.outcome !== 'ongoing') return null;
  const u = activeUnit(state);
  const nodes = searchMoves(state);
  const target = unitAt(state, x, y);
  if (!target) {
    const n = nodes.get(y * state.width + x);
    return n && n.cost > 0 ? pathFrom(nodes, y * state.width + x) : null;
  }
  // enemies: attack · dying ally: stabilise · stable ally: pick up (one at a time)
  const canTarget = target.side !== u.side || (isDown(target) && (!target.stable || !u.carrying));
  if (!canTarget || state.actionUsed) return null;
  let best: PathNode | undefined;
  for (const n of nodes.values()) {
    if (chebyshev(n, target) === 1 && (!best || n.cost < best.cost)) best = n;
  }
  if (!best) return null;
  const finalDir = (Object.entries(DIRECTION_VECTORS) as [Direction, readonly [number, number]][]).find(
    ([, [dx, dy]]) => best!.x + dx === target.x && best!.y + dy === target.y,
  )![0];
  return [...pathFrom(nodes, best.y * state.width + best.x), finalDir];
}

/**
 * True when the active unit's turn should hand over automatically (the
 * "End turn automatically" preference): it has used its action — Gold Box
 * style, acting ends the turn and any movement left is given up — or it has
 * no movement left and nothing in reach to act on. Grows with DND-10
 * (bonus actions etc.).
 */
export function turnExhausted(state: CombatState): boolean {
  if (state.outcome !== 'ongoing') return false;
  const u = activeUnit(state);
  const canWalk = state.movesLeft >= stepCost(u);
  if (state.actionUsed) return !(u.carrying && canWalk); // a carrier gets to walk their load away
  return !canWalk && !hasTargetInReach(state) && !u.caster; // a caster can still cast from where they stand
}

/** Something the active unit could use its action on right now: an adjacent enemy, or a dying ally to stabilise. */
function hasTargetInReach(state: CombatState): boolean {
  const u = activeUnit(state);
  return state.units.some(
    (t) =>
      t !== u &&
      chebyshev(t, u) === 1 &&
      onField(t) &&
      ((t.side !== u.side && isUp(t)) || (t.side === u.side && isDown(t) && (!t.stable || !u.carrying))),
  );
}

/**
 * Potion of Healing (SRD 5.2): as a Bonus Action, drink it or administer it
 * to a creature within 5 feet; it regains 2d4 + 2 HP. A character at 0 HP who
 * regains any HP wakes up (death saves reset).
 */
export function potionTargets(state: CombatState): Unit[] {
  if (state.outcome !== 'ongoing' || state.bonusUsed || state.potions <= 0) return [];
  const u = activeUnit(state);
  if (u.side !== 'party' || !isUp(u)) return [];
  return state.units.filter(
    (t) => t.side === 'party' && !t.dead && onField(t) && t.hp < t.maxHp && (t === u || chebyshev(t, u) === 1),
  );
}

export function usePotion(state: CombatState, rng: Rng, targetId: string): boolean {
  const target = potionTargets(state).find((t) => t.id === targetId);
  if (!target) return false;
  const u = activeUnit(state);
  const wasDown = target.hp <= 0;
  const heal = healUnit(target, rng.int(1, 4) + rng.int(1, 4) + 2);
  state.potions -= 1;
  state.bonusUsed = true;
  const who = target === u ? `${u.name} drinks a Potion of Healing` : `${u.name} gives ${target.name} a Potion of Healing`;
  state.log.push(`${who}: +${heal} HP (${target.hp}/${target.maxHp})${wasDown ? ` — ${target.name} is back on their feet!` : '.'}`);
  return true;
}
