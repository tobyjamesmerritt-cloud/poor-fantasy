import { describe, expect, it } from 'vitest';
import { riverPiece } from '../src/rules/pathTiles';
import { isWater, tryStep, type LocationMap } from '../src/rules/location';

const map = (water: string[], bridge: string[]): LocationMap => {
  const h = water.length;
  const w = water[0].length;
  return {
    id: 't', width: w, height: h, solid: Array(w * h).fill(false), material: Array(w * h).fill(''),
    water: water.join('').split('').map((c) => c === '~'), bridge: bridge.join('').split('').map((c) => c === '='),
    entrance: { x: 0, y: 0, facing: 'e' }, exits: [], spots: [],
  };
};

describe('river and bridge (3D view)', () => {
  it('water blocks movement, a bridge square does not', () => {
    const m = map(['.~.', '.~.', '.~.'], ['...', '.=.', '...']);
    expect(isWater(m, 1, 0)).toBe(true);
    expect(isWater(m, 1, 1)).toBe(false);
    expect(tryStep(m, { x: 0, y: 0, facing: 'e' }, 'forward')).toBeNull();
    expect(tryStep(m, { x: 0, y: 1, facing: 'e' }, 'forward')).not.toBeNull();
  });
  it('picks the river art and its turn', () => {
    expect(riverPiece(true, false, true, false, false)).toEqual({ piece: 'straight', turns: 0 });
    expect(riverPiece(false, true, false, true, false)).toEqual({ piece: 'straight', turns: 1 });
    // a north-south river under an east-west road: the deck (north-south in the art) is turned a quarter
    expect(riverPiece(true, false, true, false, true)).toEqual({ piece: 'bridge', turns: 1 });
    expect(riverPiece(false, true, false, true, true)).toEqual({ piece: 'bridge', turns: 0 });
    // bend joining west and south is the art's own orientation
    expect(riverPiece(false, false, true, true, false)).toEqual({ piece: 'corner', turns: 0 });
  });
});
