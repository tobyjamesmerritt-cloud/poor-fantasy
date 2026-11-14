import { describe, expect, it } from 'vitest';
import { buildUnits, encounterBudget, encounterXp, type EncounterDef, monsters, validateMonsters } from '../src/content/encounters';
import skirmishJson from '../src/content/skirmish.json';

const skirmish = skirmishJson as EncounterDef;

describe('encounters', () => {
  it('the test skirmish stays at or below Low difficulty (SRD 5.2 XP budget) until class features exist', () => {
    const xp = encounterXp(skirmish);
    expect(xp).toBe(200);
    expect(xp).toBeLessThanOrEqual(encounterBudget(skirmish).low);
  });

  it('names duplicate monsters with letters and copies SRD stats', () => {
    const units = buildUnits(skirmish);
    const rats = units.filter((u) => u.name.startsWith('Giant Rat'));
    expect(rats.map((r) => r.name)).toEqual(['Giant Rat A', 'Giant Rat B', 'Giant Rat C', 'Giant Rat D']);
    expect(units.find((u) => u.name === 'Giant Bat')).toBeDefined(); // single monsters get no letter
    expect(rats[0]).toMatchObject({ ac: 13, hp: 7, attackBonus: 5, damage: ['1d4+3'], traits: ['pack-tactics'] });
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length);
  });

  it('rejects overlapping or off-map units and unknown monsters', () => {
    const bad = (patch: Partial<EncounterDef>) => () => buildUnits({ ...skirmish, ...patch });
    expect(bad({ enemies: [{ monster: 'giant-rat', x: 1, y: 2 }] })).toThrow(/overlaps/);
    expect(bad({ enemies: [{ monster: 'giant-rat', x: 99, y: 0 }] })).toThrow(/off the map/);
    expect(bad({ enemies: [{ monster: 'dragon', x: 9, y: 0 }] })).toThrow(/unknown monster/);
  });

  it('validates monster definitions', () => {
    const rat = monsters['giant-rat'];
    expect(() => validateMonsters({ x: { ...rat, attack: { ...rat.attack, damage: ['d'] } } })).toThrow(/bad dice/);
    expect(() => validateMonsters({ x: { ...rat, traits: ['flying'] } })).toThrow(/unknown trait/);
    expect(() => validateMonsters({ x: { ...rat, sprite: 'nope' } })).toThrow(/unknown sprite/);
  });
});
