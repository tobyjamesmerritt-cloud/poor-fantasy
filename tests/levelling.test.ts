import { describe, expect, it } from 'vitest';
import { characterData, derive, pregens } from '../src/content/characters';
import type { CharacterSheet } from '../src/engine/state';
import { proficiencyBonus, validateSheet } from '../src/rules/character';
import { canLevelUp, checkAsi, levelUp, xpForNext } from '../src/rules/levelling';
import { scripted } from './helpers';

const fighter = (): CharacterSheet => structuredClone(pregens[0]); // Aldric: Str 17, Con 15, d10

describe('levelling up (SRD 5.2)', () => {
  it('needs the XP for the next level', () => {
    const s = fighter();
    expect(xpForNext(s)).toBe(300);
    expect(canLevelUp(s)).toBe(false);
    s.xp = 300;
    expect(canLevelUp(s)).toBe(true);
  });

  it('level 2: one more Hit Die worth of HP — rolled or the fixed value — plus Con', () => {
    const a = { ...fighter(), xp: 300 };
    const r = levelUp(a, { hp: 'average' }, scripted([]), characterData);
    expect(r).toMatchObject({ level: 2, roll: 6, hpGain: 8, features: ['Action Surge', 'Tactical Mind'] }); // 6 + Con 2
    expect(derive(a).hp).toBe(20);
    const b = { ...fighter(), xp: 300 };
    expect(levelUp(b, { hp: 'roll' }, scripted([1]), characterData)).toMatchObject({ roll: 1, hpGain: 3 });
    expect(validateSheet(a, characterData)).toEqual([]);
  });

  it('level 4 Ability Score Improvement; a Con increase raises HP for every level', () => {
    const s = { ...fighter(), xp: 9999 };
    levelUp(s, { hp: 'average' }, scripted([]), characterData); // 2
    levelUp(s, { hp: 'average' }, scripted([]), characterData); // 3
    expect(levelUp(s, { hp: 'average' }, scripted([]), characterData)).toMatch(/\+2 to one ability/); // needs an ASI
    expect(checkAsi(s, { str: 1, dex: 1, con: 1 })).toMatch(/\+2 to one/);
    const before = derive(s).hp; // Con 15 (+2)
    const r = levelUp(s, { hp: 'average', asi: { con: 1, str: 1 } }, scripted([]), characterData);
    expect(r).toMatchObject({ level: 4 });
    expect(derive(s).scores).toMatchObject({ str: 18, con: 16 }); // Con +3 now
    expect(typeof r === 'object' && r.hpGain).toBe(6 + 3 + 3); // the new level + 1 HP for each of the 3 earlier levels
    expect(derive(s).hp).toBe(before + 12);
  });

  it('proficiency bonus +3 at level 5; nothing above level 5 yet', () => {
    expect([1, 4, 5].map(proficiencyBonus)).toEqual([2, 2, 3]);
    const s = { ...fighter(), xp: 99999 };
    for (let i = 0; i < 4; i++) levelUp(s, { hp: 'average', asi: s.level === 3 ? { str: 2 } : undefined }, scripted([]), characterData);
    expect(s.level).toBe(5);
    expect(derive(s).attackBonus).toBe(4 + 3); // Str 19 (+4) + PB 3
    expect(canLevelUp(s)).toBe(false);
  });
});
