/**
 * Loot tables (DND-74): src/content/loot.json, validated at load together with
 * the monsters' and treasure spots' table references.
 */
import type { Rng } from '../engine/rng';
import { itemInfo, lootKindOk, rollLoot } from '../rules/items';
import { type Haul, type LootTables, rollTable, validateLoot } from '../rules/loot';
import { characterData } from './characters';
import { monsters } from './encounters';
import raw from './loot.json';

export const lootTables: LootTables = (raw as unknown as { tables: LootTables }).tables;

const isItem = (ref: string) => (ref.startsWith('random:') ? lootKindOk(ref.slice(7), characterData) : !!itemInfo(ref, characterData));
const errors = validateLoot(lootTables, isItem);
for (const [id, m] of Object.entries(monsters)) {
  const t = (m as { treasure?: string }).treasure;
  if (t && !lootTables[t]) errors.push(`monster "${id}": unknown treasure table "${t}"`);
}
if (errors.length) throw new Error('Invalid loot.json:\n- ' + errors.join('\n- '));

/** Roll a loot table through the Rng. */
export const rollTreasure = (table: string, rng: Rng): Haul => rollTable(table, lootTables, rng, (kind, r) => rollLoot(kind, r, characterData));

/** "12 gp 4 sp, Silver ring, 2 × Potion of Healing" (or "nothing of value"). */
export function describeHaul(h: Haul): string {
  const parts: string[] = [];
  if (h.coins) {
    const gp = Math.floor(h.coins / 100);
    const sp = Math.floor((h.coins % 100) / 10);
    const cp = h.coins % 10;
    parts.push([gp && `${gp} gp`, sp && `${sp} sp`, cp && `${cp} cp`].filter(Boolean).join(' '));
  }
  for (const [ref, n] of Object.entries(h.items)) parts.push(`${n > 1 ? `${n} × ` : ''}${itemInfo(ref, characterData)?.name ?? ref}`);
  return parts.length ? parts.join(', ') : 'nothing of value';
}
