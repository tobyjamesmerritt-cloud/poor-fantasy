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

import { floorPiece, turnedUV } from '../src/rules/pathTiles';

describe('floorPiece (3D path floor)', () => {
  it('matches the art base orientations with no turn', () => {
    expect(floorPiece(true, false, true, false).piece).toBe('straight');
    expect(floorPiece(true, true, false, false)).toEqual({ piece: 'corner', turns: 0 });
    expect(floorPiece(true, true, true, false)).toEqual({ piece: 't', turns: 0 });
    expect(floorPiece(true, false, false, false)).toEqual({ piece: 'end', turns: 0 });
    expect(floorPiece(true, true, true, true).piece).toBe('cross');
  });
  it('turns pieces clockwise to fit the neighbours', () => {
    expect(floorPiece(false, true, false, false)).toEqual({ piece: 'end', turns: 1 }); // end open to the east
    expect(floorPiece(false, true, true, false)).toEqual({ piece: 'corner', turns: 1 }); // E+S
    expect(floorPiece(false, true, false, true)).toEqual({ piece: 'straight', turns: 1 }); // E-W
    expect(floorPiece(true, false, true, true)).toEqual({ piece: 't', turns: 2 }); // N+S+W (east closed)
  });
  it('turnedUV rotates a point a quarter turn clockwise', () => {
    expect(turnedUV(0.5, 0, 0)).toEqual([0.5, 0]);
    expect(turnedUV(0.5, 0, 1)).toEqual([0, 0.5]); // top-middle ends up left-middle for the source→dest lookup
  });
});
