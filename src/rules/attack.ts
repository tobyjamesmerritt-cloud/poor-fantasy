/** SRD 5.2 attack resolution. Pure functions only — no Phaser. */
import { type DiceExpr, type RollMode, parseDice, roll, rollD20 } from '../engine/dice';
import type { Rng } from '../engine/rng';

export interface AttackInput {
  attackBonus: number; // ability modifier + proficiency + other bonuses
  targetAc: number;
  damage: string | DiceExpr | (string | DiceExpr)[]; // e.g. "1d8+3" or ["1d4+3", "2d4"] (bite + poison)
  mode?: RollMode;
  critOn?: number; // lowest natural roll that is a critical hit (Improved Critical: 19)
  autoCrit?: boolean; // any hit is a critical hit (attacking a Paralyzed creature from within 5 ft)
}

export interface AttackResult {
  d20: number;
  d20Dice: number[];
  attackTotal: number;
  hit: boolean;
  critical: boolean;
  damage: number;
  parts: number[]; // damage of each part, in order (for damage types)
}

/**
 * Natural 20 always hits and is a critical hit; natural 1 always misses.
 * Critical hits roll the damage dice twice; the modifier is added once.
 */
export function resolveAttack(rng: Rng, input: AttackInput): AttackResult {
  const { kept, dice } = rollD20(rng, input.mode ?? 'normal');
  const attackTotal = kept + input.attackBonus;
  const natCrit = kept >= (input.critOn ?? 20);
  const hit = natCrit || (kept !== 1 && attackTotal >= input.targetAc);
  const critical = natCrit || (hit && !!input.autoCrit);

  let damage = 0;
  const rolled: number[] = [];
  if (hit) {
    const parts = Array.isArray(input.damage) ? input.damage : [input.damage];
    for (const part of parts) {
      const expr = typeof part === 'string' ? parseDice(part) : part;
      const diceExpr: DiceExpr = { ...expr, count: critical ? expr.count * 2 : expr.count };
      const n = Math.max(0, roll(rng, diceExpr).total);
      rolled.push(n);
      damage += n;
    }
  }
  return { d20: kept, d20Dice: dice, attackTotal, hit, critical, damage, parts: rolled };
}
