import { describe, expect, it } from 'vitest';
import { pathFrame } from '../src/rules/pathTiles';

describe('pathFrame', () => {
  it('picks straights, corners, T-junctions, crossing and dead ends', () => {
    expect(pathFrame(true, false, true, false)).toBe(1); // N-S
    expect(pathFrame(false, true, false, true)).toBe(2); // E-W
    expect(pathFrame(true, true, false, false)).toBe(3); // N+E corner
    expect(pathFrame(true, true, true, true)).toBe(11);
    expect(pathFrame(true, false, false, false)).toBe(12); // dead end
    expect(pathFrame(false, false, false, false)).toBe(2); // lone square
  });
  it('gives every connection set its own frame', () => {
    const seen = new Set<number>();
    for (let m = 1; m < 16; m++) seen.add(pathFrame(!!(m & 1), !!(m & 2), !!(m & 4), !!(m & 8)));
    expect(seen.size).toBe(15);
  });
});
