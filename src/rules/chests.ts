/**
 * Chests (shrine and dungeon maps): a `chest` spot opens once and pays out a loot
 * table chosen by the party's level, so the same chest is worth more to a stronger
 * party (house rule). Tables live in content/loot.json as chest-1 / chest-3 / chest-5.
 */
import type { CharacterSheet } from '../engine/state';

/** The party's level for scaling: the average of the roster's levels, rounded (at least 1). */
export function partyLevel(roster: readonly Pick<CharacterSheet, 'level'>[]): number {
  if (!roster.length) return 1;
  return Math.max(1, Math.round(roster.reduce((n, r) => n + (r.level ?? 1), 0) / roster.length));
}

/** Loot table for a chest at this party level: levels 1–2, 3–4, 5. */
export const chestTable = (level: number): string => (level >= 5 ? 'chest-5' : level >= 3 ? 'chest-3' : 'chest-1');
