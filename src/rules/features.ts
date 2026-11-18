/**
 * Class features that work in combat (SRD 5.2, levels 1–5 of the playable
 * classes). Pure TypeScript. Which features a character has comes from the
 * class table (classes.json `features` at level 1, `featuresByLevel` after);
 * this module turns names into numbers, tracks uses per rest, and the combat
 * rules in combat.ts apply them.
 *
 * Implemented:
 * - Fighter: Fighting Style (Defense), Second Wind, Action Surge, Extra Attack,
 *   Champion's Improved Critical.
 * - Rogue: Sneak Attack, Cunning Action (Dash/Disengage as a Bonus Action),
 *   Uncanny Dodge.
 * - Paladin: Lay On Hands, Fighting Style (Defense), Extra Attack.
 * - Ranger: Fighting Style (Defense), Extra Attack, Hunter's Prey (Colossus Slayer).
 * - Cleric: Life Domain's Disciple of Life.
 *
 * House choices (the SRD lets the player pick): Fighting Style is always
 * Defense; the Hunter's prey is always Colossus Slayer.
 */
import type { PartyMemberState } from '../engine/state';

/** Features with uses that come back on a rest. */
export type FeatureId = 'second-wind' | 'action-surge' | 'lay-on-hands';

export interface CombatFeatures {
  attacks?: number; // Extra Attack: attacks per Attack action
  sneakAttack?: string; // Sneak Attack dice (needs a Finesse or Ranged weapon)
  cunningAction?: boolean; // Dash / Disengage as a Bonus Action
  uncannyDodge?: boolean; // Reaction: halve an attack's damage
  critOn?: number; // Improved Critical: 19
  colossusSlayer?: boolean; // +1d8 once a turn against a creature below its HP maximum
  secondWindBonus?: number; // Second Wind heals 1d10 + this (Fighter level)
  /** Uses per rest (Lay On Hands: the pool of hit points). */
  uses?: Partial<Record<FeatureId, number>>;
}

/** Feature names this character has at their level (class table). */
export function featureNames(classDef: { features?: string[]; featuresByLevel?: Record<string, string[]> }, level: number): string[] {
  const out = [...(classDef.features ?? [])];
  for (let l = 2; l <= level; l++) out.push(...(classDef.featuresByLevel?.[String(l)] ?? []));
  return out;
}

/** The combat numbers for a character's features. `finesse`: the weapon in hand has Finesse (Sneak Attack). */
export function combatFeatures(classId: string, level: number, names: readonly string[], finesse: boolean): CombatFeatures {
  const has = (n: string) => names.includes(n);
  const f: CombatFeatures = {};
  const uses: Partial<Record<FeatureId, number>> = {};
  if (has('Extra Attack')) f.attacks = 2;
  if (has('Second Wind')) {
    uses['second-wind'] = level >= 4 ? 3 : 2; // SRD 5.2 Fighter table
    f.secondWindBonus = level;
  }
  if (has('Action Surge')) uses['action-surge'] = 1;
  if (has('Lay On Hands')) uses['lay-on-hands'] = 5 * level;
  if (has('Sneak Attack') && finesse) f.sneakAttack = `${Math.ceil(level / 2)}d6`;
  if (has('Cunning Action')) f.cunningAction = true;
  if (has('Uncanny Dodge')) f.uncannyDodge = true;
  if (has('Fighter Subclass (Champion)')) f.critOn = 19;
  if (has('Ranger Subclass (Hunter)')) f.colossusSlayer = true;
  if (Object.keys(uses).length) f.uses = uses;
  void classId;
  return f;
}

/** Fighting Style (Defense): +1 AC while wearing armour. */
export const defenseStyle = (names: readonly string[], wearingArmor: boolean): number => (names.includes('Fighting Style') && wearingArmor ? 1 : 0);

/** Uses left: the per-rest maximum minus what has been spent. */
export function usesLeft(max: CombatFeatures['uses'], p?: PartyMemberState): Partial<Record<FeatureId, number>> {
  const out: Partial<Record<FeatureId, number>> = {};
  for (const [id, n] of Object.entries(max ?? {}) as [FeatureId, number][]) out[id] = Math.max(0, n - (p?.featureUses?.[id] ?? 0));
  return out;
}

/** Fight → party: what was spent. */
export function usesSpent(max: CombatFeatures['uses'], left: Partial<Record<FeatureId, number>> | undefined): Record<string, number> | undefined {
  const spent: Record<string, number> = {};
  for (const [id, n] of Object.entries(max ?? {}) as [FeatureId, number][]) {
    const s = n - (left?.[id] ?? n);
    if (s > 0) spent[id] = s;
  }
  return Object.keys(spent).length ? spent : undefined;
}

/**
 * Rests (SRD 5.2): a Short Rest gives back one Second Wind and Action Surge;
 * a Long Rest gives back everything (Lay On Hands only comes back then).
 */
export function restFeatures(p: PartyMemberState, kind: 'short' | 'long'): void {
  if (!p.featureUses) return;
  if (kind === 'long') {
    delete p.featureUses;
    return;
  }
  if (p.featureUses['second-wind']) p.featureUses['second-wind'] -= 1;
  delete p.featureUses['action-surge'];
  for (const k of Object.keys(p.featureUses)) if (!p.featureUses[k]) delete p.featureUses[k];
  if (!Object.keys(p.featureUses).length) delete p.featureUses;
}
