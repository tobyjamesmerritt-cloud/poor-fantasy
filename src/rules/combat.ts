/**
 * Tactical combat state machine (walking skeleton). Pure TypeScript — the
 * Phaser CombatScene only renders this state and forwards commands.
 *
 * Implemented: initiative order, 30 ft (6 squares) movement per turn,
 * one attack action per turn by moving into an adjacent enemy, death at 0 HP,
 * simple enemy AI (approach nearest, attack when adjacent), victory/defeat.
 * Not yet: opportunity attacks, bonus actions, reactions, spells, conditions.
 */
import type { Direction } from '../engine/commands';
import { DIRECTION_VECTORS } from '../engine/commands';
import { rollD20 } from '../engine/dice';
import type { Rng } from '../engine/rng';
import { resolveAttack } from './attack';

export type Side = 'party' | 'enemy';

export interface Unit {
  id: string;
  name: string;
  side: Side;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  ac: number;
  speed: number; // squares per turn
  initBonus: number;
  attackBonus: number;
  damage: string;
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

export function startCombat(rng: Rng, width: number, height: number, units: Unit[]): CombatState {
  const rolled = units.map((u) => ({ id: u.id, init: rollD20(rng).kept + u.initBonus, tie: u.initBonus }));
  rolled.sort((a, b) => b.init - a.init || b.tie - a.tie);
  const state: CombatState = {
    width,
    height,
    units: units.map((u) => ({ ...u })),
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

export function unitAt(state: CombatState, x: number, y: number): Unit | undefined {
  return state.units.find((u) => u.hp > 0 && u.x === x && u.y === y);
}

/**
 * Move the active unit one square, or attack if an enemy occupies it.
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
    if (occupant.side === u.side || state.actionUsed) return false;
    attack(state, rng, u, occupant);
    return true;
  }
  if (state.movesLeft <= 0) return false;
  u.x = nx;
  u.y = ny;
  state.movesLeft -= 1;
  return true;
}

export function endTurn(state: CombatState, rng: Rng): void {
  if (state.outcome !== 'ongoing') return;
  advance(state);
  runEnemyTurn(state, rng);
}

function advance(state: CombatState): void {
  do {
    state.turnIndex += 1;
    if (state.turnIndex >= state.order.length) {
      state.turnIndex = 0;
      state.round += 1;
      state.log.push(`— Round ${state.round} —`);
    }
  } while (activeUnit(state).hp <= 0);
  beginTurn(state);
}

function beginTurn(state: CombatState): void {
  const u = activeUnit(state);
  state.movesLeft = u.speed;
  state.actionUsed = false;
  if (u.side === 'party') state.log.push(`▶ ${u.name}'s turn.`);
}

function attack(state: CombatState, rng: Rng, attacker: Unit, target: Unit): void {
  const r = resolveAttack(rng, { attackBonus: attacker.attackBonus, targetAc: target.ac, damage: attacker.damage });
  state.actionUsed = true;
  state.movesLeft = 0; // skeleton simplification: attacking ends movement
  if (!r.hit) {
    state.log.push(`${attacker.name} misses ${target.name} (${r.attackTotal} vs AC ${target.ac}).`);
    return;
  }
  target.hp = Math.max(0, target.hp - r.damage);
  state.log.push(
    `${attacker.name} ${r.critical ? 'CRITS' : 'hits'} ${target.name} for ${r.damage}` +
      (target.hp === 0 ? ` — ${target.name} falls!` : ` (${target.hp}/${target.maxHp}).`),
  );
  checkOutcome(state);
}

function checkOutcome(state: CombatState): void {
  const alive = (side: Side) => state.units.some((u) => u.side === side && u.hp > 0);
  if (!alive('enemy')) {
    state.outcome = 'victory';
    state.log.push('Victory!');
  } else if (!alive('party')) {
    state.outcome = 'defeat';
    state.log.push('The party has fallen…');
  }
}

/** Enemy AI: step toward the nearest living party member, attack when adjacent. */
export function runEnemyTurn(state: CombatState, rng: Rng): void {
  while (state.outcome === 'ongoing' && activeUnit(state).side === 'enemy') {
    const u = activeUnit(state);
    for (let guard = 0; guard < 20 && state.outcome === 'ongoing'; guard++) {
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
    advance(state);
  }
}

function nearest(state: CombatState, from: Unit, side: Side): Unit | undefined {
  return state.units
    .filter((u) => u.side === side && u.hp > 0)
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
 * movement (8-way, 1 square per step, living units block). Excludes its own square.
 */
export function reachableSquares(state: CombatState): { x: number; y: number; cost: number }[] {
  return [...searchMoves(state).values()].filter((n) => n.cost > 0).map(({ x, y, cost }) => ({ x, y, cost }));
}

/**
 * Steps for "go here" from a click/tap. Empty square: shortest path within
 * remaining movement. Enemy: walk to the nearest square next to it, then step
 * into it (= attack), if the action is still available. Null if impossible.
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
  if (target.side === u.side || state.actionUsed) return null;
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
 * True when the active unit has nothing meaningful left this turn, so the UI
 * can end the turn automatically. Grows with DND-10 (bonus actions etc.).
 */
export function turnExhausted(state: CombatState): boolean {
  return state.outcome === 'ongoing' && state.actionUsed && state.movesLeft <= 0;
}
