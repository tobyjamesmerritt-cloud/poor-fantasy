/** SRD 5.2 attack resolution. Pure functions only — no Phaser. */
import { type DiceExpr, type RollMode, parseDice, roll, rollD20 } from '../engine/dice';
import type { Rng } from '../engine/rng';

export interface AttackInput {
  attackBonus: number; // ability modifier + proficiency + other bonuses
  targetAc: number;
  damage: string | DiceExpr; // e.g. "1d8+3"
  mode?: RollMode;
}

export interface AttackResult {
  d20: number;
  d20Dice: number[];
  attackTotal: number;
  hit: boolean;
  critical: boolean;
  damage: number;
}

/**
 * Natural 20 always hits and is a critical hit; natural 1 always misses.
 * Critical hits roll the damage dice twice; the modifier is added once.
 */
export function resolveAttack(rng: Rng, input: AttackInput): AttackResult {
  const { kept, dice } = rollD20(rng, input.mode ?? 'normal');
  const attackTotal = kept + input.attackBonus;
  const critical = kept === 20;
  const hit = critical || (kept !== 1 && attackTotal >= input.targetAc);

  let damage = 0;
  if (hit) {
    const expr = typeof input.damage === 'string' ? parseDice(input.damage) : input.damage;
    const diceExpr: DiceExpr = { ...expr, count: critical ? expr.count * 2 : expr.count };
    damage = Math.max(0, roll(rng, diceExpr).total);
  }
  return { d20: kept, d20Dice: dice, attackTotal, hit, critical, damage };
}
