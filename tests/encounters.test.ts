import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildUnits,
  encounterBudget,
  encounters,
  encounterXp,
  type EncounterDef,
  locationContent,
  monsters,
  validateMonsters,
} from '../src/content/encounters';
import { loadLocationMap } from '../src/content/locationMap';
import { loadTravelMap, type TiledMap } from '../src/content/world';

const cave = encounters['cave-rats'];

describe('encounters', () => {
  it('every encounter stays at or below Low difficulty (SRD 5.2 XP budget) until class features exist', () => {
    for (const e of Object.values(encounters)) {
      expect(encounterXp(e), e.id).toBeLessThanOrEqual(encounterBudget(e).low);
    }
    expect(encounterXp(cave)).toBe(200);
    expect(encounterXp(encounters['ruins-crawlers'])).toBe(250);
  });

  it('names duplicate monsters with letters and copies SRD stats', () => {
    const units = buildUnits(cave);
    const rats = units.filter((u) => u.name.startsWith('Giant Rat'));
    expect(rats.map((r) => r.name)).toEqual(['Giant Rat A', 'Giant Rat B', 'Giant Rat C', 'Giant Rat D']);
    expect(units.find((u) => u.name === 'Giant Bat')).toBeDefined(); // single monsters get no letter
    expect(rats[0]).toMatchObject({ ac: 13, hp: 7, attackBonus: 5, damage: ['1d4+3'], traits: ['pack-tactics'] });
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
  });

  it('rejects overlapping or off-map units, unknown monsters and wrong board sizes', () => {
    const bad = (patch: Partial<EncounterDef>) => () => buildUnits({ ...cave, ...patch });
    expect(bad({ enemies: [{ monster: 'giant-rat', x: 1, y: 2 }] })).toThrow(/overlaps/);
    expect(bad({ enemies: [{ monster: 'giant-rat', x: 99, y: 0 }] })).toThrow(/off the map/);
    expect(bad({ enemies: [{ monster: 'dragon', x: 9, y: 0 }] })).toThrow(/unknown monster/);
    expect(bad({ width: 10 })).toThrow(/board must be/);
    expect(bad({ partyStart: cave.partyStart.slice(0, 2) })).toThrow(/start squares/);
  });

  it('validates monster definitions', () => {
    const rat = monsters['giant-rat'];
    expect(() => validateMonsters({ x: { ...rat, attack: { ...rat.attack, damage: ['d'] } } })).toThrow(/bad dice/);
    expect(() => validateMonsters({ x: { ...rat, traits: ['flying'] } })).toThrow(/unknown trait/);
    expect(() => validateMonsters({ x: { ...rat, sprite: 'nope' } })).toThrow(/unknown sprite/);
  });

  it('location content refers to real world-map locations, and every location map loads', () => {
    const world = loadTravelMap(JSON.parse(readFileSync('public/assets/maps/world.json', 'utf8')) as TiledMap);
    const ids = world.locations.map((l) => l.id);
    const fights: string[] = [];
    for (const [id, c] of Object.entries(locationContent)) {
      expect(ids, `locations.json "${id}"`).toContain(id);
      if (!c.map) continue;
      const tiled = JSON.parse(readFileSync(`public/assets/maps/${c.map}.json`, 'utf8')) as TiledMap;
      const m = loadLocationMap(c.map, tiled, Object.keys(encounters)); // throws on any mistake
      fights.push(...m.spots.filter((s) => s.kind === 'fight').map((s) => s.encounter!));
    }
    expect(fights.sort()).toEqual(['cave-rats', 'ruins-crawlers']);
  });

  it('rejects a location map with a fight for an unknown encounter', () => {
    const tiled = JSON.parse(readFileSync('public/assets/maps/hollow-cave.json', 'utf8')) as TiledMap;
    expect(() => loadLocationMap('hollow-cave', tiled, ['ruins-crawlers'])).toThrow(/unknown encounter "cave-rats"/);
  });
});
