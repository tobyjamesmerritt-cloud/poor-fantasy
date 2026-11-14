/**
 * The seven game modes and the transitions allowed between them.
 * Each mode is a Phaser scene; this table is the single source of truth for
 * which scene may hand off to which.
 */
export type Mode =
  | 'party' // party roster / character creation
  | 'explore' // first-person dungeon + overhead wilderness
  | 'encounter' // pre-combat: fight / parley / flee / wait / advance
  | 'combat' // tactical grid combat
  | 'postCombat' // XP, treasure, loot
  | 'camp' // short/long rest, spells, save, party order
  | 'town'; // shop, temple, training, inn

export const TRANSITIONS: Readonly<Record<Mode, readonly Mode[]>> = {
  party: ['explore', 'town'],
  explore: ['encounter', 'combat', 'camp', 'town', 'party'],
  encounter: ['combat', 'explore'],
  combat: ['postCombat'],
  postCombat: ['explore', 'town', 'party'],
  camp: ['explore', 'encounter'],
  town: ['explore', 'party', 'camp'],
};

export function canTransition(from: Mode, to: Mode): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: Mode, to: Mode): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal mode transition: ${from} → ${to}`);
  }
}
