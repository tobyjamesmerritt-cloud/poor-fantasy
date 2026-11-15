/**
 * Rewards after a fight: experience points and treasure.
 * XP: the XP of every defeated monster, divided evenly among the characters
 * who are still alive at the end (SRD 5.2 "Experience Points"). Fleeing still
 * earns XP for the monsters already slain.
 * Treasure: wild beasts carry none (house rule); lairs and guarded rooms hold
 * the treasure listed in content/treasure.json, taken when the fight is won.
 */
import type { CharacterSheet, PartyMemberState } from '../engine/state';
import type { CombatState } from './combat';
import type { Inventory } from './items';

/** SRD 5.2 Character Advancement: XP needed for each level. */
export const XP_FOR_LEVEL: Record<number, number> = { 2: 300, 3: 900, 4: 2700, 5: 6500 };

export interface Treasure {
  coins: number; // copper
  items: Inventory;
}

export function awardXp(
  party: readonly PartyMemberState[],
  roster: CharacterSheet[],
  combat: CombatState,
): { each: number; total: number; who: string[] } {
  const total = combat.units.filter((u) => u.side === 'enemy' && u.dead).reduce((sum, u) => sum + (u.xp ?? 0), 0);
  const fighters = party.filter((p) => !p.dead && combat.units.some((u) => u.id === p.id));
  if (!total || !fighters.length) return { each: 0, total, who: [] };
  const each = Math.floor(total / fighters.length);
  for (const p of fighters) {
    const sheet = roster.find((s) => s.id === p.id);
    if (sheet) sheet.xp = (sheet.xp ?? 0) + each;
  }
  return { each, total, who: fighters.map((p) => p.id) };
}

export function takeTreasure(purse: { coins: number; inventory: Inventory }, t: Treasure): void {
  purse.coins += t.coins;
  for (const [ref, n] of Object.entries(t.items)) purse.inventory[ref] = (purse.inventory[ref] ?? 0) + n;
}

/** Next level's XP, or null at the top of the table. */
export const nextLevelXp = (level: number): number | null => XP_FOR_LEVEL[level + 1] ?? null;
