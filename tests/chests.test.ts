import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { encounters } from '../src/content/encounters';
import { loadLocationMap } from '../src/content/locationMap';
import { lootTables, rollTreasure } from '../src/content/loot';
import type { TiledMap } from '../src/content/world';
import { createRng } from '../src/engine/rng';
import { chestTable, partyLevel } from '../src/rules/chests';
import { doorTileAt, propAt, spotAt, viewFaces } from '../src/rules/location';

const shrine = () =>
  loadLocationMap('shrine-of-the-dawn', JSON.parse(readFileSync('public/assets/maps/shrine-of-the-dawn.json', 'utf8')) as TiledMap, Object.keys(encounters));

describe('chests scale to the party', () => {
  it('picks a table by level and the tables exist', () => {
    expect([1, 2, 3, 4, 5].map(chestTable)).toEqual(['chest-1', 'chest-1', 'chest-3', 'chest-3', 'chest-5']);
    for (const t of ['chest-1', 'chest-3', 'chest-5']) expect(lootTables[t]).toBeDefined();
  });

  it('party level is the rounded average of the roster', () => {
    expect(partyLevel([])).toBe(1);
    expect(partyLevel([{ level: 1 }, { level: 2 }, { level: 3 }])).toBe(2);
    expect(partyLevel([{ level: 5 }, { level: 5 }, { level: 4 }])).toBe(5);
  });

  it('higher tables pay more coin on average (seeded)', () => {
    const avg = (table: string) => {
      const rng = createRng(11);
      let n = 0;
      for (let i = 0; i < 200; i++) n += rollTreasure(table, rng).coins;
      return n / 200;
    };
    expect(avg('chest-3')).toBeGreaterThan(avg('chest-1'));
    expect(avg('chest-5')).toBeGreaterThan(avg('chest-3'));
  });
});

describe('the shrine map', () => {
  it('has three chests, two more fights, props and dungeon doors', () => {
    const m = shrine();
    expect(m.spots.filter((s) => s.kind === 'chest')).toHaveLength(3);
    expect(m.spots.filter((s) => s.kind === 'fight').map((s) => s.encounter).sort()).toEqual(['shrine-bats', 'shrine-crypt', 'shrine-nave', 'shrine-spiders']);
    expect(propAt(m, 7, 1)).toBe('chest');
    expect(propAt(m, 7, 6)).toBe('cross');
    expect(doorTileAt(m, 3, 9)).toBe(true);
    expect(doorTileAt(m, 8, 11)).toBe(true);
    expect(spotAt(m, 7, 1)?.kind).toBe('chest');
  });

  it('a dungeon door is seen as a door face from outside but can be walked onto', () => {
    const m = shrine();
    // stand at (8,13) facing north: the door at (8,11) is two squares ahead
    const faces = viewFaces(m, { x: 8, y: 13, facing: 'n' }, 4);
    expect(faces.some((f) => f.feature === 'door' && f.depth === 2)).toBe(true);
  });
});
