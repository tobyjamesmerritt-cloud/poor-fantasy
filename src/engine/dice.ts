import type { Rng } from './rng';

/** Parsed dice expression, e.g. "2d6+3" → { count: 2, sides: 6, modifier: 3 }. */
export interface DiceExpr {
  count: number;
  sides: number;
  modifier: number;
}

export interface RollResult {
  expr: DiceExpr;
  rolls: number[];
  total: number;
}

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

const DICE_RE = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

export function parseDice(text: string): DiceExpr {
  const m = DICE_RE.exec(text);
  if (!m) {
    const flat = Number(text);
    if (Number.isInteger(flat)) return { count: 0, sides: 0, modifier: flat };
    throw new SyntaxError(`Bad dice expression: "${text}"`);
  }
  const count = m[1] === '' ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const modifier = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
  if (count < 0 || sides < 1) throw new RangeError(`Bad dice expression: "${text}"`);
  return { count, sides, modifier };
}

export function roll(rng: Rng, dice: string | DiceExpr): RollResult {
  const expr = typeof dice === 'string' ? parseDice(dice) : dice;
  const rolls: number[] = [];
  for (let i = 0; i < expr.count; i++) rolls.push(rng.int(1, expr.sides));
  const total = rolls.reduce((a, b) => a + b, 0) + expr.modifier;
  return { expr, rolls, total };
}

/** A d20 roll honouring advantage/disadvantage. Returns the kept die and both dice. */
export function rollD20(rng: Rng, mode: RollMode = 'normal'): { kept: number; dice: number[] } {
  const a = rng.int(1, 20);
  if (mode === 'normal') return { kept: a, dice: [a] };
  const b = rng.int(1, 20);
  return { kept: mode === 'advantage' ? Math.max(a, b) : Math.min(a, b), dice: [a, b] };
}

/**
 * SRD 5.2: any number of advantage and disadvantage sources cancel to normal
 * if at least one of each is present.
 */
export function resolveRollMode(advantageSources: number, disadvantageSources: number): RollMode {
  if (advantageSources > 0 && disadvantageSources > 0) return 'normal';
  if (advantageSources > 0) return 'advantage';
  if (disadvantageSources > 0) return 'disadvantage';
  return 'normal';
}
