/**
 * Items, the party pack, buying, selling and equipping (SRD 5.2 Equipment).
 * An item reference is "armor:<id>", "weapon:<id>", "shield" or "consumable:<id>".
 * Equipment sells for half its cost (SRD 5.2 "Selling Equipment").
 */
import type { CharacterSheet } from '../engine/state';
import { type CharacterData, equipped, trainedWithArmor, trainedWithWeapon } from './character';

export type ItemRef = string;
export type Inventory = Record<ItemRef, number>;

export function itemInfo(ref: ItemRef, data: CharacterData): { name: string; cost: number; kind: 'armor' | 'weapon' | 'shield' | 'consumable' } | null {
  if (ref === 'shield') return { name: data.shield.name, cost: data.shield.cost, kind: 'shield' };
  const [kind, id] = ref.split(':') as ['armor' | 'weapon' | 'consumable', string];
  const def = kind === 'armor' ? data.armor[id] : kind === 'weapon' ? data.weapons[id] : kind === 'consumable' ? data.consumables[id] : undefined;
  return def ? { name: def.name, cost: def.cost, kind } : null;
}

export const sellPrice = (ref: ItemRef, data: CharacterData): number => Math.floor((itemInfo(ref, data)?.cost ?? 0) / 2);

export interface Purse {
  coins: number;
  inventory: Inventory;
}

const add = (inv: Inventory, ref: ItemRef, n: number) => {
  const v = (inv[ref] ?? 0) + n;
  if (v > 0) inv[ref] = v;
  else delete inv[ref];
};

export function buy(p: Purse, ref: ItemRef, data: CharacterData): string | null {
  const info = itemInfo(ref, data);
  if (!info) return 'The shop doesn’t have that.';
  if (p.coins < info.cost) return 'You can’t afford that.';
  p.coins -= info.cost;
  add(p.inventory, ref, 1);
  return null;
}

export function sell(p: Purse, ref: ItemRef, data: CharacterData): string | null {
  if (!p.inventory[ref]) return 'You don’t have that.';
  p.coins += sellPrice(ref, data);
  add(p.inventory, ref, -1);
  return null;
}

/** Why a character can't equip an item (null = they can). Untrained weapons are allowed (no proficiency bonus). */
export function equipProblem(sheet: CharacterSheet, ref: ItemRef, data: CharacterData): string | null {
  const cls = data.classes[sheet.classId];
  const info = itemInfo(ref, data);
  if (!info) return 'Unknown item.';
  if (info.kind === 'consumable') return 'That isn’t equipment.';
  if (info.kind === 'shield' && !trainedWithArmor(cls, 'shield')) return `${cls.name}s aren’t trained with shields.`;
  if (info.kind === 'armor') {
    const a = data.armor[ref.split(':')[1]];
    if (!trainedWithArmor(cls, a)) return `${cls.name}s aren’t trained with ${a.category} armor.`;
  }
  return null;
}

/** Equip from the pack; whatever it replaces goes back into the pack. */
export function equip(sheet: CharacterSheet, p: Purse, ref: ItemRef, data: CharacterData): string | null {
  if (!p.inventory[ref]) return 'That isn’t in the pack.';
  const why = equipProblem(sheet, ref, data);
  if (why) return why;
  const gear = { ...equipped(sheet, data) };
  const [kind, id] = ref.split(':');
  if (ref === 'shield') {
    if (gear.shield) return 'Already carrying a shield.';
    gear.shield = true;
  } else if (kind === 'armor') {
    if (gear.armor) add(p.inventory, `armor:${gear.armor}`, 1);
    gear.armor = id;
  } else {
    add(p.inventory, `weapon:${gear.weapon}`, 1);
    gear.weapon = id;
  }
  add(p.inventory, ref, -1);
  sheet.gear = gear;
  return null;
}

/** Take off armor or a shield (into the pack). Weapons are swapped, not removed. */
export function unequip(sheet: CharacterSheet, p: Purse, slot: 'armor' | 'shield', data: CharacterData): string | null {
  const gear = { ...equipped(sheet, data) };
  if (slot === 'shield') {
    if (!gear.shield) return 'No shield to remove.';
    gear.shield = false;
    add(p.inventory, 'shield', 1);
  } else {
    if (!gear.armor) return 'No armor to remove.';
    add(p.inventory, `armor:${gear.armor}`, 1);
    gear.armor = null;
  }
  sheet.gear = gear;
  return null;
}

/** The weapon ids a character could carry (for the trained check in the shop). */
export const weaponTrained = (sheet: CharacterSheet, id: string, data: CharacterData): boolean =>
  trainedWithWeapon(data.classes[sheet.classId], data.weapons[id]);
