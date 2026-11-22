import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkStairs, loadLocationMap } from '../src/content/locationMap';
import { encounters, locationContent } from '../src/content/encounters';
import type { TiledMap } from '../src/content/world';
import { stairsArrival, viewFaces, type LocationMap, type Spot } from '../src/rules/location';

function room(rows: string[], spots: Spot[] = [], exits: { x: number; y: number }[] = []): LocationMap {
  const cells = rows.join('').split('');
  return {
    id: 'test',
    width: rows[0].length,
    height: rows.length,
    solid: cells.map((c) => c === '#'),
    material: cells.map((c) => (c === '#' ? 'stone' : '')),
    entrance: { x: 1, y: 1, facing: 'n' },
    exits,
    spots,
  };
}
const stairs = (id: string, x: number, y: number, to: string, link: string, dir: 'up' | 'down', facing: Spot['facing'] = 'n'): Spot => ({
  id,
  kind: 'stairs',
  name: id,
  x,
  y,
  description: '',
  to,
  link,
  dir,
  facing,
});

describe('stairs (DND-96)', () => {
  it('you arrive on the square in front of the stairs, facing away from them', () => {
    // stairs at (2,1) that you climb by facing north: arrive at (2,2) facing south
    expect(stairsArrival(stairs('up', 2, 1, 'b', 'down', 'up', 'n'))).toEqual({ x: 2, y: 2, facing: 's' });
    expect(stairsArrival(stairs('up', 3, 3, 'b', 'down', 'up', 'e'))).toEqual({ x: 2, y: 3, facing: 'w' });
  });

  it('a staircase is drawn as a feature in the wall; gates only when asked', () => {
    const m = room(['#####', '#...#', '#...#', '#####'], [stairs('up', 2, 0, 'b', 'down', 'up')]);
    m.solid[2] = false; // the stairs square is open floor (walkable)
    const faces = viewFaces(m, { x: 2, y: 2, facing: 'n' }, 4);
    expect(faces.some((f) => f.feature === 'stairs-up' && f.kind === 'front' && f.lateral === 0)).toBe(true);

    const gate = room(['#####', '#...#', '#...#', '#####'], [], [{ x: 2, y: 0 }]);
    gate.solid[2] = false;
    expect(viewFaces(gate, { x: 2, y: 2, facing: 'n' }, 4).some((f) => f.feature)).toBe(false);
    expect(viewFaces(gate, { x: 2, y: 2, facing: 'n' }, 4, () => false, true).some((f) => f.feature === 'gate')).toBe(true);
  });

  it('checkStairs: the other floor must exist, link back, and go the other way', () => {
    const a = { ...room(['...']), id: 'a', spots: [stairs('up', 1, 0, 'b', 'down', 'up')] };
    const good = { ...room(['...']), id: 'b', spots: [stairs('down', 1, 0, 'a', 'up', 'down')] };
    expect(checkStairs({ a, b: good })).toEqual([]);
    expect(checkStairs({ a }).join()).toMatch(/unknown location "b"/);
    expect(checkStairs({ a, b: { ...good, spots: [] } }).join()).toMatch(/no such stairs/);
    expect(checkStairs({ a, b: { ...good, spots: [stairs('down', 1, 0, 'c', 'up', 'down')] } }).join()).toMatch(/not back here/);
    expect(checkStairs({ a, b: { ...good, spots: [stairs('down', 1, 0, 'a', 'up', 'up')] } }).join()).toMatch(/one must go up/);
  });

  it('every real map loads, and every stairs spot in the game has its partner', () => {
    const maps: Record<string, LocationMap> = {};
    for (const [id, c] of Object.entries(locationContent)) {
      if (!c.map) continue;
      const tiled = JSON.parse(readFileSync(`public/assets/maps/${c.map}.json`, 'utf8')) as TiledMap;
      maps[id] = loadLocationMap(c.map, tiled, Object.keys(encounters));
    }
    expect(checkStairs(maps)).toEqual([]);
  });
});
