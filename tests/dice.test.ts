import { describe, expect, it } from 'vitest';
import { parseDice, resolveRollMode, roll, rollD20 } from '../src/engine/dice';
import { createRng } from '../src/engine/rng';

describe('parseDice', () => {
  it('parses standard expressions', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 });
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('1d8 - 1')).toEqual({ count: 1, sides: 8, modifier: -1 });
    expect(parseDice('5')).toEqual({ count: 0, sides: 0, modifier: 5 });
  });
  it('rejects garbage', () => {
    expect(() => parseDice('2x6')).toThrow();
    expect(() => parseDice('1d0')).toThrow();
  });
});

describe('roll', () => {
  it('stays within bounds over many rolls', () => {
    const rng = createRng(42);
    for (let i = 0; i < 2000; i++) {
      const r = roll(rng, '3d6+2');
      expect(r.total).toBeGreaterThanOrEqual(5);
      expect(r.total).toBeLessThanOrEqual(20);
    }
  });
  it('is reproducible from a seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect(Array.from({ length: 10 }, () => roll(a, '1d20').total)).toEqual(
      Array.from({ length: 10 }, () => roll(b, '1d20').total),
    );
  });
});

describe('advantage', () => {
  it('advantage keeps the higher die, disadvantage the lower', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const adv = rollD20(rng, 'advantage');
      expect(adv.kept).toBe(Math.max(...adv.dice));
      const dis = rollD20(rng, 'disadvantage');
      expect(dis.kept).toBe(Math.min(...dis.dice));
    }
  });
  it('sources cancel regardless of count', () => {
    expect(resolveRollMode(3, 1)).toBe('normal');
    expect(resolveRollMode(2, 0)).toBe('advantage');
    expect(resolveRollMode(0, 1)).toBe('disadvantage');
    expect(resolveRollMode(0, 0)).toBe('normal');
  });
});
