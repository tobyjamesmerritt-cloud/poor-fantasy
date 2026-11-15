import { describe, expect, it } from 'vitest';
import { characterData, derive, pregens, startingCoins } from '../src/content/characters';
import { createRng } from '../src/engine/rng';
import type { CharacterSheet } from '../src/engine/state';
import {
  abilityMod,
  checkIncreases,
  finalScores,
  pointBuyCost,
  roll4d6DropLowest,
  STANDARD_ARRAY,
  validateSheet,
} from '../src/rules/character';
import { scripted } from './helpers';

const base: CharacterSheet = {
  id: 'x',
  name: 'Test',
  sprite: 'fighter',
  classId: 'fighter',
  speciesId: 'human',
  backgroundId: 'soldier',
  scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  increases: { str: 2, con: 1 },
  level: 1,
};

describe('ability scores (SRD 5.2)', () => {
  it('modifiers', () => {
    expect([1, 8, 9, 10, 11, 12, 15, 17, 20].map(abilityMod)).toEqual([-5, -1, -1, 0, 0, 1, 2, 3, 5]);
  });

  it('4d6 drop the lowest, six times', () => {
    const rng = scripted([6, 1, 5, 4, ...Array(20).fill(3)]);
    const r = roll4d6DropLowest(rng);
    expect(r[0]).toBe(15); // 6 + 5 + 4, the 1 dropped
    expect(r).toHaveLength(6);
    for (const v of roll4d6DropLowest(createRng(9))) expect(v).toBeGreaterThanOrEqual(3);
  });

  it('standard array and point buy (27 points, 8–15)', () => {
    expect(STANDARD_ARRAY).toEqual([15, 14, 13, 12, 10, 8]);
    expect(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 })).toBe(27);
    expect(pointBuyCost({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBe(0);
    expect(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBeNull();
  });

  it('background increases: +2/+1 or +1/+1/+1 among its three abilities, max 20', () => {
    const soldier = characterData.backgrounds.soldier;
    expect(checkIncreases(soldier, { str: 2, con: 1 })).toBeNull();
    expect(checkIncreases(soldier, { str: 1, dex: 1, con: 1 })).toBeNull();
    expect(checkIncreases(soldier, { wis: 2, con: 1 })).toMatch(/can't raise Wisdom/);
    expect(checkIncreases(soldier, { str: 3 })).toMatch(/\+2 and \+1/);
    expect(finalScores({ scores: { ...base.scores, str: 19 }, increases: { str: 2, con: 1 } }).str).toBe(20);
  });
});

describe('derived stats (level 1)', () => {
  it('fighter: chain mail, greatsword, Hit Die max + Con', () => {
    const d = derive(base); // Str 17, Dex 13, Con 15
    expect(d).toMatchObject({ hp: 12, ac: 16, speed: 6, attackBonus: 5, damage: ['2d6+3'], initBonus: 1 });
  });

  it('finesse weapons use Dexterity when better; Alert adds the proficiency bonus to initiative', () => {
    const rogue = derive({ ...base, classId: 'rogue', backgroundId: 'criminal', scores: { ...base.scores, str: 8, dex: 15 }, increases: { dex: 2, con: 1 } });
    expect(rogue).toMatchObject({ ac: 14, attackBonus: 5, damage: ['1d6+3'], initBonus: 3 + 2 });
  });

  it('heavy armour without the Strength costs 10 ft; Dwarven Toughness adds 1 HP; Goliaths are faster', () => {
    const weak = derive({ ...base, scores: { ...base.scores, str: 10 }, increases: { con: 2, dex: 1 } });
    expect(weak.speed).toBe(4);
    expect(weak.notes[0]).toMatch(/Strength 13/);
    expect(derive({ ...base, speciesId: 'dwarf' }).hp).toBe(13);
    expect(derive({ ...base, speciesId: 'goliath' }).speed).toBe(7);
  });

  it('validates choices; only playable classes for now', () => {
    expect(validateSheet(base, characterData)).toEqual([]);
    expect(validateSheet({ ...base, classId: 'bard' }, characterData)).toContain("Bard isn't playable yet.");
    expect(validateSheet({ ...base, name: ' ' }, characterData)[0]).toMatch(/name/);
  });

  it('the quick-start party is valid and brings class + background coins', () => {
    expect(pregens).toHaveLength(6);
    expect(startingCoins(pregens)).toBe((4 + 9 + 8 + 7 + 7 + 5 + 14 + 8 + 16 + 8 + 14 + 8) * 100);
  });
});
