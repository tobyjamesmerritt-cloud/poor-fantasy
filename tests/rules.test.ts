import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '../src/engine/rng';
import { abilityModifier, proficiencyBonus } from '../src/rules/abilities';
import { resolveAttack } from '../src/rules/attack';

/** Rng stub that returns a scripted sequence of integers. */
function scripted(values: number[]): Rng {
  let i = 0;
  return {
    next: () => 0,
    int: () => {
      if (i >= values.length) throw new Error('script exhausted');
      return values[i++];
    },
    get state() {
      return i;
    },
  };
}

describe('abilities', () => {
  it('computes modifiers', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
    expect(abilityModifier(20)).toBe(5);
  });
  it('computes proficiency bonus by level', () => {
    expect([1, 4, 5, 8, 9, 13, 17, 20].map(proficiencyBonus)).toEqual([2, 2, 3, 3, 4, 5, 6, 6]);
    expect(() => proficiencyBonus(0)).toThrow();
  });
});

describe('resolveAttack', () => {
  it('natural 1 always misses', () => {
    const r = resolveAttack(scripted([1]), { attackBonus: 50, targetAc: 10, damage: '1d8' });
    expect(r.hit).toBe(false);
  });
  it('natural 20 always hits and doubles damage dice, not the modifier', () => {
    const r = resolveAttack(scripted([20, 4, 5]), { attackBonus: -10, targetAc: 30, damage: '1d8+3' });
    expect(r).toMatchObject({ hit: true, critical: true, damage: 4 + 5 + 3 });
  });
  it('meets-it-beats-it against AC', () => {
    expect(resolveAttack(scripted([10, 1]), { attackBonus: 5, targetAc: 15, damage: '1d4' }).hit).toBe(true);
    expect(resolveAttack(scripted([9]), { attackBonus: 5, targetAc: 15, damage: '1d4' }).hit).toBe(false);
  });
  it('is deterministic for a seed', () => {
    const run = () => {
      const rng = createRng(99);
      return Array.from({ length: 20 }, () => resolveAttack(rng, { attackBonus: 5, targetAc: 14, damage: '1d8+3' }));
    };
    expect(run()).toEqual(run());
  });
});
