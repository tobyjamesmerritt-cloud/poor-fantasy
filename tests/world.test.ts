import { DIRECTION_VECTORS } from '../src/engine/commands';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTravelMap, type TiledMap } from '../src/content/world';
import { canStep, findPath, isBlocked, locationAt, type TravelMap } from '../src/rules/world';

const world = loadTravelMap(JSON.parse(readFileSync('public/assets/maps/world.json', 'utf8')) as TiledMap);

/** Tiny hand-made map: '#' blocked, '.' open. */
function grid(rows: string[]): TravelMap {
  return {
    width: rows[0].length,
    height: rows.length,
    blocked: rows.join('').split('').map((c) => c === '#'),
    locations: [],
    start: { x: 0, y: 0 },
  };
}

describe('travel rules', () => {
  it('finds a shortest path around obstacles', () => {
    const m = grid(['....', '.##.', '....']);
    expect(findPath(m, { x: 0, y: 1 }, { x: 3, y: 1 })).toHaveLength(5); // no corner-cutting past the wall
    expect(findPath(m, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull(); // target blocked
  });

  it('walks a straight-looking line on open ground instead of bowing out', () => {
    const m = grid(Array(9).fill('.'.repeat(20)));
    const from = { x: 0, y: 0 };
    for (const to of [{ x: 12, y: 0 }, { x: 15, y: 5 }, { x: 4, y: 8 }, { x: 18, y: 8 }]) {
      const path = findPath(m, from, to)!;
      expect(path).toHaveLength(Math.max(to.x, to.y)); // still a shortest path
      let x = 0, y = 0, worst = 0;
      for (const d of path) {
        const [dx, dy] = DIRECTION_VECTORS[d];
        x += dx; y += dy;
        worst = Math.max(worst, Math.abs(to.x * y - to.y * x) / Math.hypot(to.x, to.y));
      }
      expect(worst, `to (${to.x},${to.y})`).toBeLessThanOrEqual(1); // never more than a square off the line
    }
  });

  it('never cuts a corner diagonally past a blocked square', () => {
    const m = grid(['.#', '..']);
    expect(canStep(m, { x: 0, y: 0 }, 'se')).toBe(false);
    expect(findPath(m, { x: 0, y: 0 }, { x: 1, y: 1 })).toHaveLength(2);
  });

  it('treats off-map squares as blocked', () => {
    expect(isBlocked(grid(['..']), -1, 0)).toBe(true);
  });
});

describe('world map', () => {
  it('has two towns, a cave and ruins, all reachable from the start', () => {
    expect(world.locations.map((l) => l.kind).sort()).toEqual(['cave', 'ruins', 'town', 'town']);
    for (const l of world.locations) {
      expect(isBlocked(world, l.x, l.y), l.name).toBe(false);
      expect(findPath(world, world.start, l), `path to ${l.name}`).not.toBeNull();
      expect(locationAt(world, l.x, l.y)?.id).toBe(l.id);
    }
  });

  it('has a river that blocks the map (crossable only by the bridge)', () => {
    const blockedCount = world.blocked.filter(Boolean).length;
    expect(blockedCount).toBeGreaterThan(80);
    expect(isBlocked(world, world.start.x, world.start.y)).toBe(false);
  });

  it('rejects maps without a start or with unknown location types', () => {
    const raw = JSON.parse(readFileSync('public/assets/maps/world.json', 'utf8')) as TiledMap;
    const noStart = structuredClone(raw);
    const objs = noStart.layers.find((l) => l.name === 'locations')!.objects!;
    objs.splice(objs.findIndex((o) => o.type === 'start'), 1);
    expect(() => loadTravelMap(noStart)).toThrow(/start/);
    const badType = structuredClone(raw);
    badType.layers.find((l) => l.name === 'locations')!.objects![0].type = 'castle';
    expect(() => loadTravelMap(badType)).toThrow(/unknown type/);
  });
});
