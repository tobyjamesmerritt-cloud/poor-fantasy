import { describe, expect, it } from 'vitest';
import { characterData, derive, pregens } from '../src/content/characters';
import { createRng } from '../src/engine/rng';
import { makeSave, parseSave } from '../src/engine/save';
import { newGameState, SAVE_VERSION } from '../src/engine/state';
import { startCombat } from '../src/rules/combat';
import { buy, equip, equipProblem, type Purse, sell, sellPrice, unequip, useItem } from '../src/rules/items';
import { freshParty } from '../src/rules/party';
import { awardXp, nextLevelXp, takeTreasure } from '../src/rules/rewards';
import { makeUnit, scripted } from './helpers';

const purse = (coins = 10000): Purse => ({ coins, inventory: {} });

describe('shop (SRD 5.2 prices; equipment sells for half)', () => {
  it('buys and sells', () => {
    const p = purse(10000);
    expect(buy(p, 'weapon:longsword', characterData)).toBeNull();
    expect(p).toEqual({ coins: 8500, inventory: { 'weapon:longsword': 1 } });
    expect(sellPrice('weapon:longsword', characterData)).toBe(750);
    expect(sell(p, 'weapon:longsword', characterData)).toBeNull();
    expect(p).toEqual({ coins: 9250, inventory: {} });
    expect(buy(purse(100), 'armor:plate', characterData)).toMatch(/afford/);
  });

  it('equipping swaps the old item into the pack and changes the numbers', () => {
    const fighter = structuredClone(pregens[0]); // greatsword, chain mail
    const p = purse(0);
    p.inventory['weapon:longsword'] = 1;
    p.inventory.shield = 1;
    expect(equip(fighter, p, 'weapon:longsword', characterData)).toBeNull();
    expect(equip(fighter, p, 'shield', characterData)).toBeNull();
    expect(p.inventory).toEqual({ 'weapon:greatsword': 1 });
    const d = derive(fighter);
    expect(d.ac).toBe(19); // chain mail 16 + shield 2 + Fighting Style (Defense) 1
    expect(d.damage).toEqual(['1d8+3']);
    expect(unequip(fighter, p, 'shield', characterData)).toBeNull();
    expect(derive(fighter).ac).toBe(17);
  });

  it('training: wizards can’t wear armor; rogues use finesse/light martial weapons; others lose proficiency', () => {
    const wizard = structuredClone(pregens[5]);
    expect(equipProblem(wizard, 'armor:leather', characterData)).toMatch(/light armor/);
    const rogue = structuredClone(pregens[2]);
    const p = purse(0);
    p.inventory['weapon:rapier'] = 1;
    p.inventory['weapon:longsword'] = 1;
    equip(rogue, p, 'weapon:rapier', characterData);
    expect(derive(rogue).attackBonus).toBe(5); // Dex +3, proficient
    equip(rogue, p, 'weapon:longsword', characterData);
    expect(derive(rogue).attackBonus).toBe(-1); // Str −1, not trained
  });
});

describe('rewards', () => {
  it('XP of defeated monsters is split among living characters who fought', () => {
    const party = freshParty([
      { id: 'a', name: 'A', hp: 10, hitDie: 10, conMod: 0 },
      { id: 'b', name: 'B', hp: 10, hitDie: 10, conMod: 0 },
      { id: 'c', name: 'C', hp: 10, hitDie: 10, conMod: 0 },
    ]);
    party[2].dead = true;
    const combat = startCombat(createRng(1), 6, 6, [
      makeUnit({ id: 'a', side: 'party', x: 0, y: 0 }),
      makeUnit({ id: 'b', side: 'party', x: 1, y: 0 }),
      makeUnit({ id: 'c', side: 'party', x: 2, y: 0, dead: true, hp: 0 }),
      makeUnit({ id: 'z', side: 'enemy', x: 5, y: 5, dead: true, hp: 0, xp: 25 }),
      makeUnit({ id: 'y', side: 'enemy', x: 4, y: 5, dead: true, hp: 0, xp: 50 }),
      makeUnit({ id: 'x', side: 'enemy', x: 3, y: 5, xp: 999 }), // still alive: no XP
    ]);
    const sheets = ['a', 'b', 'c'].map((id) => ({ ...structuredClone(pregens[0]), id }));
    expect(awardXp(party, sheets, combat)).toMatchObject({ total: 75, each: 37 });
    expect(sheets.map((s) => s.xp ?? 0)).toEqual([37, 37, 0]);
    expect(nextLevelXp(1)).toBe(300);
  });

  it('treasure goes to the purse and pack', () => {
    const p = purse(100);
    takeTreasure(p, { coins: 2400, items: { 'consumable:potion-of-healing': 1 } });
    expect(p).toEqual({ coins: 2500, inventory: { 'consumable:potion-of-healing': 1 } });
  });
});

describe('save migration', () => {
  it('a v6 save loads as the current version with an empty pack and 0 XP', () => {
    const v7 = newGameState(1);
    v7.party = freshParty([{ id: 'a', name: 'A', hp: 10, hitDie: 10, conMod: 0 }]);
    const old = makeSave(v7, 1, '', '') as unknown as { state: Record<string, unknown> };
    old.state.version = 6;
    delete old.state.inventory;
    old.state.party = [{ id: 'a', hp: 4, hitDice: 1, dead: false, wakesAt: null }];
    const env = parseSave(JSON.stringify(old));
    expect(env.state.inventory).toEqual({});
    expect(env.state.party[0]).toMatchObject({ hp: 4 });
    expect(env.state.version).toBe(SAVE_VERSION);
  });
});

describe('Potion of Healing in combat (Bonus Action)', () => {
  it('drink, or give to an adjacent ally — even an unconscious one; once per turn', async () => {
    const { usePotion, potionTargets } = await import('../src/rules/combat');
    const { scripted } = await import('./helpers');
    const s = startCombat(
      createRng(2),
      6,
      6,
      [
        makeUnit({ id: 'a', side: 'party', x: 0, y: 0, hp: 3, maxHp: 10, initBonus: 99 }),
        makeUnit({ id: 'b', side: 'party', x: 1, y: 0, hp: 0, maxHp: 10, deathSaves: { successes: 1, failures: 2 } }),
        makeUnit({ id: 'c', side: 'party', x: 4, y: 4, hp: 2, maxHp: 10 }), // too far
        makeUnit({ id: 'z', side: 'enemy', x: 5, y: 5, initBonus: -99 }),
      ],
      'normal',
      2,
    );
    expect(potionTargets(s).map((u) => u.id)).toEqual(['a', 'b']);
    expect(usePotion(s, scripted([3, 4]), 'b')).toBe(true); // 3 + 4 + 2 = 9
    const b = s.units.find((u) => u.id === 'b')!;
    expect(b.hp).toBe(9);
    expect(b.deathSaves).toEqual({ successes: 0, failures: 0 });
    expect(s.potions).toBe(1);
    expect(potionTargets(s)).toEqual([]); // Bonus Action used
    expect(s.actionUsed).toBe(false); // can still attack
  });
});

describe('temple (house prices)', () => {
  it('heals the wounded for a fee per character; raises the dead with 1 HP', async () => {
    const { templeHeal, templeRaise, healCost } = await import('../src/rules/services');
    const stats = [
      { id: 'a', name: 'A', hp: 10, hitDie: 10, conMod: 0 },
      { id: 'b', name: 'B', hp: 8, hitDie: 8, conMod: 0 },
      { id: 'c', name: 'C', hp: 8, hitDie: 8, conMod: 0 },
    ];
    const party = freshParty(stats);
    party[0].hp = 0;
    party[0].wakesAt = 999;
    party[2].dead = true;
    const prices = { healPerCharacter: 1000, raiseDead: 25000 };
    expect(healCost(party, stats, prices)).toBe(1000); // only A (C is dead, B is fine)
    const purse = { coins: 30000 };
    expect(templeHeal(purse, party, stats, prices)).toBeNull();
    expect(party[0]).toMatchObject({ hp: 10, wakesAt: null });
    expect(templeRaise(purse, party[2], prices)).toBeNull();
    expect(party[2]).toMatchObject({ dead: false, hp: 1 });
    expect(purse.coins).toBe(4000);
    expect(templeRaise({ coins: 10 }, { ...party[2], dead: true }, prices)).toMatch(/afford/);
  });
});

describe('using items outside a fight', () => {
  it('a Potion of Healing heals 2d4 + 2 and wakes the unconscious; it is used up', () => {
    const inv: Record<string, number> = { 'consumable:potion-of-healing': 1, 'consumable:ale': 1 };
    const p = { id: 'a', hp: 0, hitDice: 1, dead: false, wakesAt: 120 };
    const r = useItem(inv, 'consumable:potion-of-healing', p, { name: 'Aldric', hp: 12 }, scripted([2, 3]), characterData);
    expect(r).toEqual({ log: ['Aldric drinks Potion of Healing and regains 7 HP (7/12) — back on their feet!'] });
    expect(p).toMatchObject({ hp: 7, wakesAt: null });
    expect(inv['consumable:potion-of-healing']).toBeUndefined();
    expect(useItem(inv, 'consumable:potion-of-healing', p, { name: 'Aldric', hp: 12 }, scripted([]), characterData)).toMatch(/isn’t in the pack/);
  });

  it('refuses the dead and the unhurt; ale is just drunk', () => {
    const inv: Record<string, number> = { 'consumable:potion-of-healing': 2, 'consumable:ale': 1 };
    const full = { id: 'a', hp: 12, hitDice: 1, dead: false, wakesAt: null };
    expect(useItem(inv, 'consumable:potion-of-healing', full, { name: 'A', hp: 12 }, scripted([]), characterData)).toMatch(/isn’t hurt/);
    expect(useItem(inv, 'consumable:potion-of-healing', { ...full, dead: true, hp: 0 }, { name: 'A', hp: 12 }, scripted([]), characterData)).toMatch(/beyond/);
    expect(inv['consumable:potion-of-healing']).toBe(2);
    expect(useItem(inv, 'consumable:ale', undefined, undefined, scripted([]), characterData)).toMatchObject({ log: [expect.stringMatching(/The party drinks/)] });
    expect(inv['consumable:ale']).toBeUndefined();
  });
});
