import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildUnits,
  encounters,
  encounterXp,
  type EncounterDef,
  resolveEncounter,
  locationContent,
  monsters,
  validateMonsters,
} from '../src/content/encounters';
import { loadLocationMap } from '../src/content/locationMap';
import { loadTravelMap, type TiledMap } from '../src/content/world';

const cave = encounters['cave-rats'];

describe('encounters', () => {
  it('scales to the party: an XP budget for one character fewer, fixed monsters kept, filler clamped', () => {
    // 6 at level 1, Moderate: 5 × 75 = 375; spider 50 + bat 50 fixed → 11 rats by budget, max 8,
    // and never more monsters than characters: 6 − 2 fixed = 4 rats
    const six = resolveEncounter(cave, { partySize: 6, level: 1 });
    expect(six.enemies.filter((e) => e.monster === 'giant-rat')).toHaveLength(4);
    expect(six.enemies).toHaveLength(6);
    // 3 at level 1: 2 × 75 = 150 → 2 by budget, capped at 3 − 2 = 1
    const three = resolveEncounter(cave, { partySize: 3, level: 1 });
    expect(three.enemies.map((e) => e.monster).sort()).toEqual(['giant-bat', 'giant-rat', 'giant-wolf-spider']);
    // the quest designer can make one fight harder (within the cap)
    const spiders: EncounterDef = { ...cave, scaling: { difficulty: 'low', filler: { monsters: ['giant-wolf-spider'], min: 1, max: 8 } } };
    expect(resolveEncounter(spiders, { partySize: 6, level: 1 }).enemies).toHaveLength(5); // 250 / 50
    expect(resolveEncounter(spiders, { partySize: 6, level: 1, difficulty: 'high' }).enemies).toHaveLength(6); // 500 / 50 = 10, capped at 6
    // a lone character still gets a fight (budget for 1, capped at 1)
    expect(resolveEncounter(encounters['ambush-dark'], { partySize: 1, level: 1 }).enemies).toHaveLength(1);
    expect(encounterXp(resolveEncounter(encounters['troll-bridge'], { partySize: 6, level: 3 }))).toBe(1800 + 4 * 25);
  });

  it('names duplicate monsters with letters and copies SRD stats', () => {
    const units = buildUnits(resolveEncounter(cave, { partySize: 6, level: 1 }));
    const rats = units.filter((u) => u.name.startsWith('Giant Rat'));
    expect(rats.map((r) => r.name)).toEqual(['Giant Rat A', 'Giant Rat B', 'Giant Rat C', 'Giant Rat D']);
    expect(units.find((u) => u.name === 'Giant Bat')).toBeDefined(); // single monsters get no letter
    expect(rats[0]).toMatchObject({ ac: 13, hp: 7, attackBonus: 5, damage: ['1d4+3'], traits: ['pack-tactics'] });
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
    const troll = buildUnits(resolveEncounter(encounters['troll-bridge']), undefined, undefined, 0, { troll: { fumble: 0.75 } }).find((u) => u.monster === 'troll')!;
    expect(troll).toMatchObject({ hp: 94, ac: 15, attacks: 3, regeneration: 15, fumble: 0.75 });
  });

  it('rejects overlapping or off-map units, unknown monsters and wrong board sizes', () => {
    const bad = (patch: Partial<EncounterDef>) => () => buildUnits({ ...resolveEncounter(cave), ...patch });
    expect(bad({ enemies: [{ monster: 'giant-rat', x: 1, y: 2 }] })).toThrow(/overlaps/);
    expect(bad({ enemies: [{ monster: 'giant-rat', x: 99, y: 0 }] })).toThrow(/off the map/);
    expect(bad({ enemies: [{ monster: 'dragon', x: 9, y: 0 }] })).toThrow(/unknown monster/);
    expect(bad({ width: 10 })).toThrow(/board must be/);
    expect(bad({ partyStart: cave.partyStart.slice(0, 2) })).toThrow(/start squares/);
  });

  it('validates monster definitions', () => {
    const rat = monsters['giant-rat'];
    expect(() => validateMonsters({ x: { ...rat, actions: [{ ...rat.actions[0], damage: ['d'] }] } })).toThrow(/bad dice/);
    expect(() => validateMonsters({ x: { ...rat, actions: [{ ...rat.actions[0], types: ['pointy'] }] } })).toThrow(/unknown damage type/);
    expect(() => validateMonsters({ x: { ...rat, abilities: [{ kind: 'breath', name: 'Fire' } as never] } })).toThrow(/planned: true/);
    expect(() => validateMonsters({ x: { ...rat, abilities: [{ kind: 'breath', name: 'Fire', planned: true }] } })).not.toThrow();
    expect(() => validateMonsters({ x: { ...rat, tags: [] } })).toThrow(/needs tags/);
    expect(() => validateMonsters({ x: { ...rat, traits: ['flying'] } })).toThrow(/unknown trait/);
    expect(() => validateMonsters({ x: { ...rat, sprite: 'nope' } })).toThrow(/unknown sprite/);
  });

  it('location content refers to real world-map locations, and every location map loads', () => {
    const world = loadTravelMap(JSON.parse(readFileSync('public/assets/maps/world.json', 'utf8')) as TiledMap);
    const ids = world.locations.map((l) => l.id);
    const fights: string[] = [];
    for (const [id, c] of Object.entries(locationContent)) {
      if (c.parent) expect(ids, `locations.json "${id}" parent`).toContain(c.parent.location);
      else expect(ids, `locations.json "${id}"`).toContain(id);
      if (!c.map) continue;
      const tiled = JSON.parse(readFileSync(`public/assets/maps/${c.map}.json`, 'utf8')) as TiledMap;
      const m = loadLocationMap(c.map, tiled, Object.keys(encounters)); // throws on any mistake
      fights.push(...m.spots.filter((s) => s.kind === 'fight').map((s) => s.encounter!));
    }
    expect(fights.sort()).toEqual(['cave-rats', 'ruins-crawlers', 'shrine-crypt', 'shrine-nave']);
  });

  it('rejects a location map with a fight for an unknown encounter', () => {
    const tiled = JSON.parse(readFileSync('public/assets/maps/hollow-cave.json', 'utf8')) as TiledMap;
    expect(() => loadLocationMap('hollow-cave', tiled, ['ruins-crawlers'])).toThrow(/unknown encounter "cave-rats"/);
  });
});
