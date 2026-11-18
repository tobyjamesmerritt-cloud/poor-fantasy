import { describe, expect, it } from 'vitest';
import { characterData } from '../src/content/characters';
import { describeHaul, lootTables, rollTreasure } from '../src/content/loot';
import { monsters } from '../src/content/encounters';
import { createRng } from '../src/engine/rng';
import { itemInfo, sell, sellPrice } from '../src/rules/items';
import { rollTable, validateLoot } from '../src/rules/loot';
import { slainTreasure } from '../src/rules/rewards';
import type { CombatState } from '../src/rules/combat';
import { makeUnit, scripted } from './helpers';

describe('loot tables (DND-74)', () => {
  it('every table rolls to real items, over many seeds', () => {
    for (const id of Object.keys(lootTables)) {
      for (let seed = 0; seed < 40; seed++) {
        const h = rollTreasure(id, createRng(seed));
        expect(h.coins).toBeGreaterThanOrEqual(0);
        for (const ref of Object.keys(h.items)) expect(itemInfo(ref, characterData), `${id}: ${ref}`).not.toBeNull();
      }
    }
  });

  it('weighted picks, counts, nested tables and coins follow the dice', () => {
    const tables = {
      a: { coins: [10, 20] as [number, number], rolls: 2, entries: [{ item: 'x', weight: 1 }, { item: 'table:b', weight: 3 }] },
      b: { coins: [5, 5] as [number, number], entries: [{ item: 'y', weight: 1, count: 2 }] },
    };
    // coins 15; roll 1 → pick 1 (x); roll 2 → pick 4 (table b: coins 5, y ×2)
    const h = rollTable('a', tables, scripted([15, 1, 4, 5, 1]), (k) => k);
    expect(h).toEqual({ coins: 20, items: { x: 1, y: 2 } });
  });

  it('validation catches unknown items and tables, bad weights and loops', () => {
    const errs = validateLoot(
      {
        a: { entries: [{ item: 'nope', weight: 1 }, { item: 'table:b', weight: 0 }] },
        b: { entries: [{ item: 'table:a', weight: 1 }] },
        c: { entries: [{ item: 'table:zzz', weight: 1 }] },
      },
      (r) => r !== 'nope',
    );
    expect(errs.join('\n')).toMatch(/unknown item "nope"/);
    expect(errs.join('\n')).toMatch(/weight above 0/);
    expect(errs.join('\n')).toMatch(/loop/);
    expect(errs.join('\n')).toMatch(/unknown table "zzz"/);
  });

  it('slain monsters with a treasure table drop it; routed ones and beasts don’t; only on a win', () => {
    expect(monsters.bandit.treasure).toBe('bandit-pouch');
    expect(monsters.wolf.treasure).toBeUndefined();
    const s = {
      outcome: 'victory',
      units: [
        makeUnit({ id: 'b1', side: 'enemy', x: 0, y: 0, dead: true, treasure: 'bandit-pouch' }),
        makeUnit({ id: 'b2', side: 'enemy', x: 0, y: 1, fled: true, treasure: 'bandit-pouch' }),
        makeUnit({ id: 'w', side: 'enemy', x: 0, y: 2, dead: true }),
      ],
    } as unknown as CombatState;
    expect(slainTreasure(s)).toEqual(['bandit-pouch']);
    expect(slainTreasure({ ...s, outcome: 'fled' })).toEqual([]);
  });

  it('valuables sell for their full value; gear for half (SRD 5.2)', () => {
    expect(sellPrice('valuable:silver-ring', characterData)).toBe(1000);
    expect(sellPrice('weapon:longsword', characterData)).toBe(750);
    const p = { coins: 0, inventory: { 'valuable:gold-locket': 1 } as Record<string, number> };
    expect(sell(p, 'valuable:gold-locket', characterData)).toBeNull();
    expect(p.coins).toBe(2500);
    expect(describeHaul({ coins: 1234, items: { 'valuable:silver-ring': 2 } })).toBe('12 gp 3 sp 4 cp, 2 × Silver ring');
  });
});
