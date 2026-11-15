/**
 * Tactical combat state machine. Pure TypeScript — the Phaser CombatScene
 * only renders this state and forwards commands.
 *
 * Implemented (SRD 5.2): initiative, movement in 5-ft squares, one attack per
 * turn (move into an adjacent enemy), multi-part damage, Pack Tactics,
 * 0 HP rules for characters (Unconscious, Death Saving Throws, Instant Death,
 * Stable), stabilising an ally with the Help action (DC 10 Wisdom (Medicine)).
 * Monsters die at 0 HP. Simple enemy AI. Victory/defeat.
 * Not yet: opportunity attacks, bonus actions, reactions, spells, conditions.
 */
import type { Direction } from '../engine/commands';
import { DIRECTION_VECTORS } from '../engine/commands';
import { resolveRollMode, rollD20 } from '../engine/dice';
import type { Rng } from '../engine/rng';
import { resolveAttack } from './attack';

export type Side = 'party' | 'enemy';
export type Trait = 'pack-tactics';

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
  outcome: 'ongoing' | 'victory' | 'defeat';
  log: string[];
}

/** Conscious and able to act. */
export const isUp = (u: Unit): boolean => u.hp > 0 && !u.dead;
/** A character at 0 HP who is not dead (Unconscious, possibly Stable). */
export const isDown = (u: Unit): boolean => u.side === 'party' && u.hp <= 0 && !u.dead;

export function startCombat(rng: Rng, width: number, height: number, units: Unit[]): CombatState {
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
  return state.units.find((u) => (isUp(u) || isDown(u)) && u.x === x && u.y === y);
}

/**
 * Move the active unit one square. Moving into an enemy attacks it; moving
 * into an unconscious ally tries to stabilise them (Help action).
 * Returns false when the step is not allowed.
 */
export function step(state: CombatState, rng: Rng, dir: Direction): boolean {
  if (state.outcome !== 'ongoing') return false;
  const u = activeUnit(state);
  const [dx, dy] = DIRECTION_VECTORS[dir];
  const nx = u.x + dx;
  const ny = u.y + dy;
  if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) return false;

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
    return false;
  }
  if (state.movesLeft <= 0) return false;
  u.x = nx;
  u.y = ny;
  state.movesLeft -= 1;
  return true;
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
  for (let guard = 0; guard < state.order.length * 3; guard++) {
    state.turnIndex += 1;
    if (state.turnIndex >= state.order.length) {
      state.turnIndex = 0;
      state.round += 1;
      state.log.push(`— Round ${state.round} —`);
    }
    const u = activeUnit(state);
    if (u.dead || (u.side === 'enemy' && u.hp <= 0)) continue;
    if (isDown(u)) {
      if (!u.stable) deathSave(state, rng, u);
      if (state.outcome !== 'ongoing') return;
      if (!isUp(u)) continue;
    }
    beginTurn(state);
    return;
  }
}

function beginTurn(state: CombatState): void {
  const u = activeUnit(state);
  state.movesLeft = u.speed;
  state.actionUsed = false;
  if (u.side === 'party') state.log.push(`▶ ${u.name}'s turn.`);
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
  // Pack Tactics: Advantage if an ally of the attacker within 5 ft of the target isn't Incapacitated.
  const packAdvantage =
    attacker.traits.includes('pack-tactics') &&
    state.units.some((o) => o !== attacker && o.side === attacker.side && isUp(o) && chebyshev(o, target) === 1);
  const mode = resolveRollMode(packAdvantage ? 1 : 0, 0);
  const r = resolveAttack(rng, { attackBonus: attacker.attackBonus, targetAc: target.ac, damage: attacker.damage, mode });
  state.actionUsed = true;
  state.movesLeft = 0; // simplification until DND-10: attacking ends movement
  const adv = mode === 'advantage' ? ' [pack tactics]' : '';
  if (!r.hit) {
    state.log.push(`${attacker.name} misses ${target.name} (${r.attackTotal} vs AC ${target.ac})${adv}.`);
    return;
  }
  const verb = r.critical ? 'CRITS' : 'hits';
  state.log.push(`${attacker.name} ${verb} ${target.name} for ${r.damage}${adv}` + applyDamage(target, r.damage));
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

function checkOutcome(state: CombatState): void {
  if (state.outcome !== 'ongoing') return;
  if (!state.units.some((u) => u.side === 'enemy' && isUp(u))) {
    state.outcome = 'victory';
    state.log.push('Victory!');
  } else if (!state.units.some((u) => u.side === 'party' && isUp(u))) {
    state.outcome = 'defeat';
    state.log.push('The party has fallen…');
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
        if (!state.actionUsed) attack(state, rng, u, target);
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
    .filter((u) => u.side === side && isUp(u))
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
  for (let cost = 1; cost <= state.movesLeft && frontier.length; cost++) {
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
  const canTarget = target.side !== u.side || (isDown(target) && !target.stable);
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
  if (state.actionUsed) return true;
  return state.movesLeft <= 0 && !hasTargetInReach(state);
}

/** Something the active unit could use its action on right now: an adjacent enemy, or a dying ally to stabilise. */
function hasTargetInReach(state: CombatState): boolean {
  const u = activeUnit(state);
  return state.units.some(
    (t) =>
      t !== u &&
      chebyshev(t, u) === 1 &&
      ((t.side !== u.side && isUp(t)) || (t.side === u.side && isDown(t) && !t.stable && !t.dead)),
  );
}
