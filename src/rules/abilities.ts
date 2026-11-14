/** SRD 5.2 ability scores and derived values. Pure functions only — no Phaser. */

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];
export type AbilityScores = Record<Ability, number>;

/** Ability modifier: floor((score - 10) / 2). */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Proficiency bonus by character level (1–20): +2 at 1–4, rising by 1 every 4 levels. */
export function proficiencyBonus(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new RangeError(`Level must be 1–20, got ${level}`);
  }
  return 2 + Math.floor((level - 1) / 4);
}
