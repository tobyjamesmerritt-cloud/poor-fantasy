/** Treasure per location fight spot (treasure.json), validated at load. */
import { itemInfo } from '../rules/items';
import type { Treasure } from '../rules/rewards';
import { characterData } from './characters';
import { lootTables } from './loot';
import raw from './treasure.json';

export const treasure: Record<string, Treasure> = (() => {
  const { _note: _n, ...all } = raw as unknown as Record<string, Treasure> & { _note?: string };
  for (const [key, t] of Object.entries(all)) {
    for (const ref of Object.keys(t.items)) {
      if (!itemInfo(ref, characterData)) throw new Error(`treasure.json "${key}": unknown item "${ref}"`);
    }
    if (t.table && !lootTables[t.table]) throw new Error(`treasure.json "${key}": unknown loot table "${t.table}"`);
  }
  return all;
})();

export function describeTreasure(t: Treasure): string {
  const parts = [t.coins ? `${t.coins / 100} gp` : ''];
  for (const [ref, n] of Object.entries(t.items)) parts.push(`${n > 1 ? `${n}× ` : ''}${itemInfo(ref, characterData)!.name}`);
  return parts.filter(Boolean).join(', ');
}
