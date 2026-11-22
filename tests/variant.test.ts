import { describe, expect, it } from 'vitest';
import { squareVariant } from '../src/rules/location';

describe('squareVariant (3D wall texture variety)', () => {
  it('is stable for a square and mixes both variants across a map', () => {
    expect(squareVariant(3, 4)).toBe(squareVariant(3, 4));
    const seen = new Set<number>();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) seen.add(squareVariant(x, y) % 2);
    expect(seen.size).toBe(2);
  });
});
