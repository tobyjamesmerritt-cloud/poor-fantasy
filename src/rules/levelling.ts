/**
 * Levelling up (SRD 5.2 "Level Advancement"): with enough XP a character
 * gains a level — one more Hit Point Die, Hit Points (roll the Hit Die or take
 * the fixed value, + Con modifier, minimum 1), a higher Proficiency Bonus at
 * level 5, an Ability Score Improvement at level 4, and the class's features
 * for that level (listed; most are not in effect yet).
 */
import type { Rng } from '../engine/rng';
import type { Ability, AbilityScores, CharacterSheet } from '../engine/state';
import { ABILITIES, averageHitDie, type CharacterData, deriveStats, finalScores, MAX_LEVEL } from './character';
import { XP_FOR_LEVEL } from './rewards';

export interface LevelUpChoice {
  hp: 'roll' | 'average';
  asi?: Partial<AbilityScores>; // level 4: +2 to one ability, or +1 to two (none above 20)
}

export const xpForNext = (sheet: CharacterSheet): number | null =>
  sheet.level >= MAX_LEVEL ? null : (XP_FOR_LEVEL[sheet.level + 1] ?? null);

export function canLevelUp(sheet: CharacterSheet): boolean {
  const need = xpForNext(sheet);
  return need !== null && (sheet.xp ?? 0) >= need;
}

export const needsAsi = (sheet: CharacterSheet): boolean => sheet.level + 1 === 4;

/** Why an ASI choice is invalid (null = fine). */
export function checkAsi(sheet: CharacterSheet, asi: Partial<AbilityScores> | undefined): string | null {
  if (!needsAsi(sheet)) return asi && Object.keys(asi).length ? 'No Ability Score Improvement at this level.' : null;
  const picks = Object.entries(asi ?? {}).filter(([, v]) => v) as [Ability, number][];
  const total = picks.reduce((s, [, v]) => s + v, 0);
  const shape = (picks.length === 1 && picks[0][1] === 2) || (picks.length === 2 && picks.every(([, v]) => v === 1));
  if (total !== 2 || !shape) return 'Choose +2 to one ability, or +1 to two.';
  const now = finalScores(sheet);
  if (picks.some(([a, v]) => now[a] + v > 20)) return 'No ability can go above 20.';
  return null;
}

export interface LevelUpResult {
  level: number;
  hpGain: number; // added to maximum (and current) HP
  roll: number; // the Hit Die result used
  features: string[];
}

export function levelUp(sheet: CharacterSheet, choice: LevelUpChoice, rng: Rng, data: CharacterData): LevelUpResult | string {
  if (!canLevelUp(sheet)) return 'Not enough experience yet.';
  const why = checkAsi(sheet, choice.asi);
  if (why) return why;
  const cls = data.classes[sheet.classId];
  const before = deriveStats(sheet, data).hp;
  const roll = choice.hp === 'roll' ? rng.int(1, cls.hitDie) : averageHitDie(cls.hitDie);
  if (needsAsi(sheet) && choice.asi) {
    const asi = { ...(sheet.asi ?? {}) };
    for (const a of ABILITIES) if (choice.asi[a]) asi[a] = (asi[a] ?? 0) + choice.asi[a]!;
    sheet.asi = asi;
  }
  sheet.level += 1;
  sheet.hpGains = [...(sheet.hpGains ?? []), roll];
  return {
    level: sheet.level,
    roll,
    // the whole maximum is recomputed: a Constitution increase raises HP for every level (SRD 5.2)
    hpGain: deriveStats(sheet, data).hp - before,
    features: cls.featuresByLevel?.[String(sheet.level)] ?? [],
  };
}
