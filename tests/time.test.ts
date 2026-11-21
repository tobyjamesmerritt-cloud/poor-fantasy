import { describe, expect, it } from 'vitest';
import { darkness, isNight } from '../src/rules/time';

const at = (h: number, m = 0, day = 0) => day * 1440 + h * 60 + m;

describe('darkness (night shading)', () => {
  it('is day at noon and night at midnight, on any day', () => {
    expect(darkness(at(12))).toBe(0);
    expect(darkness(at(0))).toBe(1);
    expect(darkness(at(23, 30, 4))).toBe(1);
  });
  it('fades in at dusk and out at dawn', () => {
    expect(darkness(at(18))).toBe(0);
    expect(darkness(at(19, 30))).toBeCloseTo(0.5);
    expect(darkness(at(21))).toBe(1);
    expect(darkness(at(6))).toBeCloseTo(0.5);
    expect(darkness(at(7))).toBe(0);
  });
});

describe('isNight (dawn is day, dusk is night)', () => {
  it('flips at 05:00 and 18:00', () => {
    expect(isNight(at(4.9))).toBe(true);
    expect(isNight(at(5))).toBe(false); // dawn
    expect(isNight(at(12))).toBe(false);
    expect(isNight(at(17.9))).toBe(false);
    expect(isNight(at(18))).toBe(true); // dusk
    expect(isNight(at(23))).toBe(true);
  });
});
