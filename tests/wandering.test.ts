import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wandering } from '../src/content/quests';
import { loadTravelMap, type TiledMap } from '../src/content/world';
import { newGameState } from '../src/engine/state';
import { checkZones, distanceToSettlement, locationWanderCheck, wanderingCheck, zoneAt } from '../src/rules/wandering';
import { locationContent } from '../src/content/encounters';
import { findPath, squaresAround, worldSight } from '../src/rules/world';
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

  it('roads west of the bridge are safe; near a settlement encounters are rarer than in the wilds', () => {
    expect(wandering.roadChance).toBe(0);
    const near = wandering.zones.find((z) => z.difficulty === 'low')!;
    expect(near.chance!).toBeLessThan(wandering.chance);
    // a road square: never, whatever the roll
    let road: { x: number; y: number } | undefined;
    for (let i = 0; i < world.width * world.height && !road; i++) if (world.terrain?.[i] === 'road' && i % world.width < 20) road = { x: i % world.width, y: Math.floor(i / world.width) };
    const onTown = [...world.locations, ...world.sites].some((p) => p.x === road!.x && p.y === road!.y);
    if (road && !onTown) {
      const g = newGameState(1);
      g.flags['wander:steps'] = 99;
      expect(wanderingCheck(g, world, road.x, road.y, wandering, scripted([1, 0]))).toBeNull();
    }
  });
});

describe('lair zones and the east road', () => {
  it('every "near" names a real place', () => {
    expect(checkZones(world, wandering)).toEqual([]);
    expect(checkZones(world, { ...wandering, zones: [{ name: 'x', near: 'nowhere', within: 2, difficulty: 'low', dialogs: [] }] })).toHaveLength(1);
  });

  it('ogres around Hollow Cave, the dead around the Old Keep', () => {
    expect(zoneAt(world, 30, 7, wandering).dialogs).toEqual(['wander-ogre']); // grass below the cave
    expect(zoneAt(world, 30, 25, wandering).dialogs).toEqual(['wander-dead']); // beside the keep
  });

  it('bandits only on roads east of the bridge, and rarely', () => {
    const east = { x: 26, y: 15 }; // the road south from the bridge
    expect(world.terrain?.[east.y * world.width + east.x]).toBe('road');
    const z = zoneAt(world, east.x, east.y, wandering);
    expect(z.dialogs).toEqual(['wander-bandits']);
    expect(z.roadChance!).toBeLessThan(0.05);
    const g = newGameState(1);
    g.flags['wander:steps'] = 99;
    expect(wanderingCheck(g, world, east.x, east.y, wandering, scripted([20, 0]))).toMatchObject({ dialog: 'wander-bandits' });
    g.flags['wander:steps'] = 99;
    expect(wanderingCheck(g, world, east.x, east.y, wandering, scripted([21]))).toBeNull(); // 2% = rolls 1–20
    expect(zoneAt(world, 27, 15, wandering).dialogs).not.toContain('wander-bandits'); // off the road
    expect(zoneAt(world, 15, 17, wandering).dialogs).not.toContain('wander-bandits'); // west road
  });

  it('the dead also walk inside the Old Keep, but not on spots or exits', () => {
    const w = locationContent['old-keep'].wander!;
    expect(w.dialogs).toEqual(['wander-dead-inside']);
    const g = newGameState(1);
    g.flags['wander:steps'] = 99;
    expect(locationWanderCheck(g, 'Old Keep', w, wandering.grace, true, scripted([1, 0]))).toBeNull();
    g.flags['wander:steps'] = 99;
    expect(locationWanderCheck(g, 'Old Keep', w, wandering.grace, false, scripted([1, 0]))).toMatchObject({ dialog: 'wander-dead-inside', zone: 'Old Keep' });
    expect(g.flags['wander:steps']).toBe(0);
    expect(locationWanderCheck(g, 'Old Keep', w, wandering.grace, false, scripted([1, 0]))).toBeNull(); // grace
  });
});

describe('world map fog of war', () => {
  it('sees 3 squares by day, 2 at dusk, 1 at night', () => {
    expect(worldSight(0)).toBe(3);
    expect(worldSight(0.5)).toBe(2);
    expect(worldSight(1)).toBe(1);
    expect(squaresAround(world, 10, 10, 1)).toHaveLength(9);
    expect(squaresAround(world, 10, 10, 3).length).toBeGreaterThan(squaresAround(world, 10, 10, 2).length);
  });

  it('click-walking avoids land still under the fog', () => {
    const fogged = (x: number) => x > 7;
    expect(findPath(world, { x: 7, y: 16 }, { x: 9, y: 16 }, (x) => fogged(x))).toBeNull();
    expect(findPath(world, { x: 7, y: 16 }, { x: 9, y: 16 })).not.toBeNull();
  });
});
