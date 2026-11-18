/**
 * Loot tables (DND-74). Pure TypeScript: tables come from content/loot.json via
 * the caller; all randomness goes through the Rng (seeded, replayable).
 *
 * A table: coins (copper, [min, max]), a number of rolls ([min, max] or a fixed
 * number), and weighted entries. An entry's `item` is an item ref
 * ("consumable:potion-of-healing", "valuable:small-garnet"…), another table
 * ("table:<id>"), or a random kind rolls/items.ts knows ("random:weapon+1",
 * "random:scroll:<class>:<level>"); `count` gives several.
 */
import type { Rng } from '../engine/rng';

export type Range = number | [number, number];

export interface LootEntry {
  item: string;
  weight: number;
  count?: Range;
}

export interface LootTable {
  coins?: [number, number]; // copper
  rolls?: Range; // default 1
  entries: LootEntry[];
}

export type LootTables = Record<string, LootTable>;

export interface Haul {
  coins: number;
  items: Record<string, number>;
}

const rollRange = (rng: Rng, r: Range | undefined, fallback: number): number =>
  r === undefined ? fallback : typeof r === 'number' ? r : rng.int(Math.min(r[0], r[1]), Math.max(r[0], r[1]));

/**
 * Roll a table. `random` turns "random:<kind>" into a concrete item ref
 * (rules/items.ts rollLoot). Nested tables add their coins and items.
 */
export function rollTable(id: string, tables: LootTables, rng: Rng, random: (kind: string, rng: Rng) => string, depth = 0): Haul {
  const t = tables[id];
  if (!t) throw new Error(`Unknown loot table "${id}"`);
  if (depth > 8) throw new Error(`Loot table "${id}" nests too deep`);
  const haul: Haul = { coins: t.coins ? rollRange(rng, t.coins, 0) : 0, items: {} };
  const total = t.entries.reduce((s, e) => s + e.weight, 0);
  const rolls = rollRange(rng, t.rolls, 1);
  for (let i = 0; i < rolls && total > 0; i++) {
    let pick = rng.int(1, total);
    const e = t.entries.find((x) => (pick -= x.weight) <= 0)!;
    const n = rollRange(rng, e.count, 1);
    for (let k = 0; k < n; k++) {
      if (e.item.startsWith('table:')) {
        const sub = rollTable(e.item.slice(6), tables, rng, random, depth + 1);
        haul.coins += sub.coins;
        for (const [ref, c] of Object.entries(sub.items)) haul.items[ref] = (haul.items[ref] ?? 0) + c;
      } else {
        const ref = e.item.startsWith('random:') ? random(e.item.slice(7), rng) : e.item;
        haul.items[ref] = (haul.items[ref] ?? 0) + 1;
      }
    }
  }
  return haul;
}

/** Problems with the tables (empty = fine). `isItem` checks item refs and "random:" kinds. */
export function validateLoot(tables: LootTables, isItem: (ref: string) => boolean): string[] {
  const errors: string[] = [];
  const okRange = (r: Range | undefined) => r === undefined || (typeof r === 'number' ? r >= 0 : r.length === 2 && r[0] >= 0 && r[1] >= r[0]);
  for (const [id, t] of Object.entries(tables)) {
    const where = `loot table "${id}"`;
    if (!Array.isArray(t.entries) || !t.entries.length) errors.push(`${where}: needs entries`);
    if (t.coins && !okRange(t.coins)) errors.push(`${where}: coins must be [min, max] copper`);
    if (!okRange(t.rolls)) errors.push(`${where}: rolls must be a number or [min, max]`);
    for (const e of t.entries ?? []) {
      if (!(e.weight > 0)) errors.push(`${where}: "${e.item}" needs a weight above 0`);
      if (!okRange(e.count)) errors.push(`${where}: "${e.item}" count must be a number or [min, max]`);
      if (e.item.startsWith('table:')) {
        if (!tables[e.item.slice(6)]) errors.push(`${where}: unknown table "${e.item.slice(6)}"`);
      } else if (!isItem(e.item)) errors.push(`${where}: unknown item "${e.item}"`);
    }
  }
  // no table may (indirectly) contain itself
  const visit = (id: string, path: string[]): void => {
    if (path.includes(id)) {
      errors.push(`loot tables loop: ${[...path, id].join(' → ')}`);
      return;
    }
    for (const e of tables[id]?.entries ?? []) if (e.item.startsWith('table:')) visit(e.item.slice(6), [...path, id]);
  };
  for (const id of Object.keys(tables)) visit(id, []);
  return [...new Set(errors)];
}
