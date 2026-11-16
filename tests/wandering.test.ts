import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wandering } from '../src/content/quests';
import { loadTravelMap, type TiledMap } from '../src/content/world';
import { newGameState } from '../src/engine/state';
import { distanceToSettlement, wanderingCheck, zoneAt } from '../src/rules/wandering';
import { scripted } from './helpers';

const world = loadTravelMap(JSON.parse(readFileSync('public/assets/maps/world.json', 'utf8')) as TiledMap);

describe('random encounters on the world map', () => {
  it('gentle near settlements and sites (hidden ones too), harsher in the wilds', () => {
    expect(distanceToSettlement(world, 7, 16)).toBe(0); // Millbrook
    expect(zoneAt(world, 9, 16, wandering).difficulty).toBe('low');
    expect(zoneAt(world, 8, 6, wandering).difficulty).toBe('low'); // near the (hidden) brewery
    const far = { x: 0, y: 0, d: 0 };
    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        const d = distanceToSettlement(world, x, y);
        if (d > far.d && !world.blocked[y * world.width + x]) Object.assign(far, { x, y, d });
      }
    }
    expect(far.d).toBeGreaterThan(9);
    expect(zoneAt(world, far.x, far.y, wandering).difficulty).toBe('high');
  });

  it('a quiet spell after each encounter, then a chance per step', () => {
    const g = newGameState(1);
    const off = { x: 5, y: 13 }; // grass, a few squares from Millbrook
    // grace: the first steps of a game can't trigger (the counter starts full, so step 1 can)
    g.flags['wander:steps'] = 0;
    for (let i = 0; i < wandering.grace; i++) expect(wanderingCheck(g, world, off.x, off.y, wandering, scripted([1]))).toBeNull();
    const met = wanderingCheck(g, world, off.x, off.y, wandering, scripted([1, 0]));
    expect(met).toMatchObject({ difficulty: 'low' });
    expect(g.flags['wander:steps']).toBe(0);
    // a high roll: nothing
    g.flags['wander:steps'] = 99;
    expect(wanderingCheck(g, world, off.x, off.y, wandering, scripted([1000]))).toBeNull();
    // never on a town square
    g.flags['wander:steps'] = 99;
    expect(wanderingCheck(g, world, 7, 16, wandering, scripted([1, 0]))).toBeNull();
  });

  it('roads are safe; near a settlement encounters are rarer than in the wilds', () => {
    expect(wandering.roadChance).toBe(0);
    const near = wandering.zones.find((z) => z.difficulty === 'low')!;
    expect(near.chance!).toBeLessThan(wandering.chance);
    // a road square: never, whatever the roll
    let road: { x: number; y: number } | undefined;
    for (let i = 0; i < world.width * world.height && !road; i++) if (world.terrain?.[i] === 'road') road = { x: i % world.width, y: Math.floor(i / world.width) };
    const onTown = [...world.locations, ...world.sites].some((p) => p.x === road!.x && p.y === road!.y);
    if (road && !onTown) {
      const g = newGameState(1);
      g.flags['wander:steps'] = 99;
      expect(wanderingCheck(g, world, road.x, road.y, wandering, scripted([1, 0]))).toBeNull();
    }
  });
});
