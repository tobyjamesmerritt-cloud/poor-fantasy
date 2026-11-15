/**
 * Items, the party pack, buying, selling and equipping (SRD 5.2 Equipment).
 * An item reference is "armor:<id>", "weapon:<id>" (magic: "weapon:<id>+1"),
 * "shield", "consumable:<id>", "scroll:<spell id>" (Spell Scroll) or
 * "misc:<id>" (quest items). Equipment sells for half its cost (SRD 5.2
 * "Selling Equipment"); quest items can't be sold.
 */
import type { Rng } from '../engine/rng';
import type { CharacterSheet } from '../engine/state';
import { type CharacterData, equipped, trainedWithArmor, trainedWithWeapon, weaponDef } from './character';

/** Spell Scroll value (SRD 5.2): twice the scribing cost — cantrip 30 GP, 1st 50, 2nd 200, 3rd 300. */
const SCROLL_VALUE = [3000, 5000, 20000, 30000];

export type ItemRef = string;
export type Inventory = Record<ItemRef, number>;

export type ItemKind = 'armor' | 'weapon' | 'shield' | 'consumable' | 'scroll' | 'misc';

export function itemInfo(ref: ItemRef, data: CharacterData): { name: string; cost: number; kind: ItemKind } | null {
  if (ref === 'shield') return { name: data.shield.name, cost: data.shield.cost, kind: 'shield' };
  const [kind, id] = ref.split(':') as [ItemKind, string];
  if (kind === 'scroll') {
    const s = data.spells[id];
    return s ? { name: `Spell Scroll (${s.name})`, cost: SCROLL_VALUE[Math.min(3, s.level)], kind } : null;
  }
  const def =
    kind === 'armor' ? data.armor[id]
    : kind === 'weapon' ? weaponDef(data, id)
    : kind === 'consumable' ? data.consumables[id]
    : kind === 'misc' ? data.misc[id]
    : undefined;
  return def ? { name: def.name, cost: def.cost, kind } : null;
}

export const sellPrice = (ref: ItemRef, data: CharacterData): number => Math.floor((itemInfo(ref, data)?.cost ?? 0) / 2);

/** Quest items stay with the party. */
export const canSell = (ref: ItemRef): boolean => !ref.startsWith('misc:');

/**
 * Random treasure for quest rewards (through the Rng):
 *   "weapon+1"            a +1 weapon (any SRD weapon in gear.json)
 *   "scroll:<class>:<lv>" a Spell Scroll of a <class> spell of that level the game implements
 */
export function rollLoot(kind: string, rng: Rng, data: CharacterData): ItemRef {
  if (kind === 'weapon+1') {
    const ids = Object.keys(data.weapons);
    return `weapon:${ids[rng.int(0, ids.length - 1)]}+1`;
  }
  const scroll = /^scroll:([a-z-]+):(\d)$/.exec(kind);
  if (scroll) {
    const ids = Object.entries(data.spells)
      .filter(([, s]) => s.classes.includes(scroll[1]) && s.level === Number(scroll[2]))
      .map(([id]) => id);
    if (ids.length) return `scroll:${ids[rng.int(0, ids.length - 1)]}`;
  }
  throw new Error(`Unknown random loot "${kind}"`);
}

/** Can this random-loot kind be rolled (for validating quest data)? */
export function lootKindOk(kind: string, data: CharacterData): boolean {
  try {
    rollLoot(kind, { int: (lo: number) => lo } as unknown as Rng, data);
    return true;
  } catch {
    return false;
  }
}

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
  if (!canSell(ref)) return 'You need that for a quest.';
  p.coins += sellPrice(ref, data);
  add(p.inventory, ref, -1);
  return null;
}

/** Why a character can't equip an item (null = they can). Untrained weapons are allowed (no proficiency bonus). */
export function equipProblem(sheet: CharacterSheet, ref: ItemRef, data: CharacterData): string | null {
  const cls = data.classes[sheet.classId];
  const info = itemInfo(ref, data);
  if (!info) return 'Unknown item.';
  if (info.kind === 'consumable' || info.kind === 'scroll' || info.kind === 'misc') return 'That isn’t equipment.';
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
  trainedWithWeapon(data.classes[sheet.classId], weaponDef(data, id)!);
