import { describe, expect, it } from 'vitest';
import { buildUnits, encounters } from '../src/content/encounters';
import { casterOf, characterData, checkSheet, choicesOf, membersOf, pregens, spells, statsOf } from '../src/content/characters';
import { createRng } from '../src/engine/rng';
import type { CharacterSheet, PartyMemberState } from '../src/engine/state';
import { acOf, type CasterInfo, type CombatState, endTurn, hasEffect, hurt, type Unit } from '../src/rules/combat';
import { freshParty, afterCombat } from '../src/rules/party';
import { rest } from '../src/rules/rest';
import {
  arcaneRecovery,
  areaSquares,
  castOptions,
  castOutside,
  castSpell,
  slotsAt,
  spellChoices,
} from '../src/rules/spells';
import { makeUnit, scripted } from './helpers';

const cleric = pregens.find((p) => p.classId === 'cleric')!;
const wizard = pregens.find((p) => p.classId === 'wizard')!;
const sc = (id: string) => characterData.classes[id].spellcasting!;

function caster(p: Partial<CasterInfo> = {}): CasterInfo {
  return {
    classId: 'wizard',
    ability: 'int',
    mod: 3,
    attack: 5,
    dc: 13,
    level: 1,
    cantrips: ['fire-bolt', 'ray-of-frost', 'acid-splash'],
    prepared: ['magic-missile', 'burning-hands', 'thunderwave', 'false-life', 'ice-knife'],
    slots: [2],
    maxSlots: [2],
    ...p,
  };
}

/** A fight with turn order as given, the first unit to act. */
function fight(units: Unit[]): CombatState {
  return {
    width: 12,
    height: 9,
    units,
    order: units.map((u) => u.id),
    turnIndex: 0,
    round: 1,
    movesLeft: units[0].speed,
    actionUsed: false,
    outcome: 'ongoing',
    retreat: 'normal',
    bonusUsed: false,
    slotUsed: false,
    potions: 0,
    log: [],
  };
}

describe('spellcasting tables and picks (SRD 5.2)', () => {
  it('follows the Cleric / Wizard tables', () => {
    expect(slotsAt(sc('cleric'), 1)).toEqual([2]);
    expect(slotsAt(sc('cleric'), 3)).toEqual([4, 2]);
    expect(slotsAt(sc('wizard'), 5)).toEqual([4, 3, 2]);
    expect(sc('wizard').prepared[4]).toBe(9);
  });

  it('gives the pregens the recommended picks, and their numbers', () => {
    expect(choicesOf(cleric)!.prepared).toEqual(['bless', 'cure-wounds', 'guiding-bolt', 'shield-of-faith']);
    const w = choicesOf(wizard)!;
    expect(w.cantrips).toHaveLength(3);
    expect(w.spellbook).toHaveLength(6);
    expect(w.prepared.every((id) => w.spellbook.includes(id))).toBe(true);
    // Wisdom 15 + 2 = 17 (+3), Proficiency +2: attack +5, DC 13
    expect(casterOf(cleric)).toMatchObject({ attack: 5, dc: 13, maxSlots: [2] });
    expect(casterOf(pregens[0])).toBeUndefined(); // Fighter
  });

  it('rejects bad picks', () => {
    const tooMany: CharacterSheet = { ...wizard, cantrips: ['fire-bolt', 'ray-of-frost', 'acid-splash', 'poison-spray'] };
    expect(checkSheet(tooMany).join()).toMatch(/Too many cantrips/);
    const wrongList: CharacterSheet = { ...cleric, prepared: ['fireball'] };
    expect(checkSheet(wrongList).length).toBeGreaterThan(0);
    const notInBook: CharacterSheet = { ...wizard, spellbook: ['magic-missile'], prepared: ['thunderwave'] };
    expect(checkSheet(notInBook).join()).toMatch(/spellbook/);
    const fighterMagic: CharacterSheet = { ...pregens[0], cantrips: ['fire-bolt'] };
    expect(checkSheet(fighterMagic).join()).toMatch(/can't cast/);
  });

  it('only prepares spells of a level the caster has slots for', () => {
    const lvl3: CharacterSheet = { ...cleric, level: 3, hpGains: [5, 5], prepared: undefined };
    const c = spellChoices(lvl3, sc('cleric'), spells);
    expect(c.prepared).toHaveLength(6);
    expect(c.prepared.every((id) => spells[id].level <= 2)).toBe(true);
  });
});

describe('casting in combat', () => {
  it('Fire Bolt: spell attack vs AC, 1d10 (2d10 from level 5)', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 0, y: 0, caster: caster() });
    const rat = makeUnit({ id: 'r', side: 'enemy', x: 5, y: 0, ac: 12, hp: 20 });
    const s = fight([w, rat]);
    expect(castSpell(s, scripted([10, 7]), spells, 'fire-bolt', 0, [{ x: 5, y: 0 }])).toBe(true); // 10+5 = 15 hits
    expect(rat.hp).toBe(13);
    expect(s.actionUsed).toBe(true);

    const w5 = makeUnit({ id: 'w', side: 'party', x: 0, y: 0, caster: caster({ level: 5 }) });
    const rat2 = makeUnit({ id: 'r', side: 'enemy', x: 5, y: 0, ac: 12, hp: 20 });
    castSpell(fight([w5, rat2]), scripted([10, 3, 4]), spells, 'fire-bolt', 0, [{ x: 5, y: 0 }]);
    expect(rat2.hp).toBe(13);
  });

  it('a ranged spell attack with an enemy adjacent has Disadvantage', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 0, y: 0, caster: caster() });
    const near = makeUnit({ id: 'n', side: 'enemy', x: 1, y: 0 });
    const far = makeUnit({ id: 'f', side: 'enemy', x: 6, y: 0, ac: 12, hp: 20 });
    const s = fight([w, near, far]);
    castSpell(s, scripted([18, 3]), spells, 'fire-bolt', 0, [{ x: 6, y: 0 }]); // keeps the 3: 8 misses
    expect(far.hp).toBe(20);
    expect(s.log.join()).toMatch(/enemy in reach/);
  });

  it('Magic Missile never misses; a level 2 slot adds a dart', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 0, y: 0, caster: caster({ slots: [3, 2], maxSlots: [3, 2], prepared: ['magic-missile'] }) });
    const a = makeUnit({ id: 'a', side: 'enemy', x: 5, y: 0, hp: 30 });
    const s = fight([w, a]);
    const at = { x: 5, y: 0 };
    expect(castSpell(s, scripted([1, 1, 1, 1]), spells, 'magic-missile', 2, [at, at, at, at])).toBe(true);
    expect(a.hp).toBe(30 - 4 * 2);
    expect(w.caster!.slots).toEqual([3, 1]);
  });

  it('one spell slot per turn — but a cantrip is still fine', () => {
    const c = makeUnit({
      id: 'c',
      side: 'party',
      x: 0,
      y: 0,
      hp: 5,
      maxHp: 10,
      caster: caster({ classId: 'cleric', cantrips: ['sacred-flame'], prepared: ['healing-word', 'guiding-bolt'] }),
    });
    const foe = makeUnit({ id: 'f', side: 'enemy', x: 4, y: 0, hp: 30 });
    const s = fight([c, foe]);
    expect(castSpell(s, scripted([1, 1]), spells, 'healing-word', 1, [{ x: 0, y: 0 }])).toBe(true);
    expect(c.hp).toBe(10); // 5 + (1 + 1 + 3)
    const opts = Object.fromEntries(castOptions(s, spells).map((o) => [o.id, o.reason]));
    expect(opts['guiding-bolt']).toMatch(/one spell slot/);
    expect(opts['sacred-flame']).toBeUndefined();
  });

  it('Burning Hands: one damage roll, Dexterity saves for half, allies too, not the caster', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 3, y: 4, caster: caster() });
    const ally = makeUnit({ id: 'a', side: 'party', x: 4, y: 4, hp: 30 });
    const foe = makeUnit({ id: 'f', side: 'enemy', x: 6, y: 5, hp: 30, saves: { dex: 0 } });
    const s = fight([w, ally, foe]);
    const area = areaSquares(s, w, spells['burning-hands'], { x: 8, y: 4 });
    expect(area).toHaveLength(7); // 1 + 3 + 3
    expect(area.some((p) => p.x === 3 && p.y === 4)).toBe(false);
    // damage 3d6 = 2+3+4 = 9; ally saves (d20 20 + 0), foe fails (d20 2)
    expect(castSpell(s, scripted([2, 3, 4, 20, 2]), spells, 'burning-hands', 1, [{ x: 8, y: 4 }])).toBe(true);
    expect(ally.hp).toBe(30 - 4);
    expect(foe.hp).toBe(30 - 9);
  });

  it('Thunderwave pushes a creature that fails 10 ft away', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 3, y: 4, caster: caster() });
    const foe = makeUnit({ id: 'f', side: 'enemy', x: 4, y: 4, hp: 30 });
    const s = fight([w, foe]);
    castSpell(s, scripted([1, 1, 2]), spells, 'thunderwave', 1, [{ x: 5, y: 4 }]);
    expect(foe).toMatchObject({ x: 6, y: 4, hp: 28 });
  });

  it('Bless adds 1d4 and ends when the cleric fails a Concentration save', () => {
    const c = makeUnit({ id: 'c', side: 'party', x: 0, y: 0, saves: { con: 0 }, caster: caster({ classId: 'cleric', prepared: ['bless'] }) });
    const f = makeUnit({ id: 'f', side: 'party', x: 1, y: 0 });
    const s = fight([c, f, makeUnit({ id: 'r', side: 'enemy', x: 9, y: 0 })]);
    expect(castSpell(s, scripted([]), spells, 'bless', 1, [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(true);
    expect(hasEffect(f, 'bless')).toBe(true);
    expect(c.concentration?.spell).toBe('bless');
    // 6 damage → DC 10; the cleric rolls bless d4 1 + d20 3 = 4: Concentration lost, Bless gone from everyone
    hurt(s, scripted([1, 3]), c, 6, 'Ouch');
    expect(c.concentration).toBeUndefined();
    expect(hasEffect(f, 'bless')).toBe(false);
    expect(s.log.join(' ')).toMatch(/Bless ends/);
  });

  it('Guiding Bolt grants Advantage to the next attack, then it is gone', () => {
    const c = makeUnit({ id: 'c', side: 'party', x: 0, y: 0, caster: caster({ classId: 'cleric', prepared: ['guiding-bolt'] }) });
    const foe = makeUnit({ id: 'f', side: 'enemy', x: 6, y: 0, hp: 50 });
    const s = fight([c, foe]);
    castSpell(s, scripted([15, 1, 1, 1, 1]), spells, 'guiding-bolt', 1, [{ x: 6, y: 0 }]);
    expect(foe.hp).toBe(46);
    expect(hasEffect(foe, 'guided')).toBe(true);
  });

  it('Ray of Frost slows the target on its turn; it wears off at the caster’s next turn', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 0, y: 0, caster: caster() });
    const foe = makeUnit({ id: 'f', side: 'enemy', x: 9, y: 0, hp: 50, speed: 6 });
    const s = fight([w, foe]);
    castSpell(s, scripted([15, 1]), spells, 'ray-of-frost', 0, [{ x: 9, y: 0 }]);
    expect(hasEffect(foe, 'slowed')).toBe(true);
    endTurn(s, createRng(1)); // the rat walks only 4 squares, then it is the wizard's turn again
    expect(foe.x).toBe(5);
    expect(hasEffect(foe, 'slowed')).toBe(false);
  });

  it('temporary hit points soak damage first', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 0, y: 0, hp: 10, caster: caster() });
    const s = fight([w, makeUnit({ id: 'f', side: 'enemy', x: 9, y: 0 })]);
    castSpell(s, scripted([1, 1]), spells, 'false-life', 1, [{ x: 0, y: 0 }]);
    expect(w.tempHp).toBe(6);
  });

  it('Mage Armor sets the base AC to 13 + Dex; Shield of Faith adds 2', () => {
    const w = makeUnit({ id: 'w', side: 'party', x: 0, y: 0, ac: 12, unarmoredAc: 15, caster: caster({ prepared: ['mage-armor'] }) });
    const s = fight([w, makeUnit({ id: 'f', side: 'enemy', x: 9, y: 0 })]);
    expect(castSpell(s, scripted([]), spells, 'mage-armor', 1, [{ x: 0, y: 0 }])).toBe(true);
    expect(acOf(w)).toBe(15);
  });
});

describe('spells between fights', () => {
  const roster = [cleric, wizard];
  const stats = statsOf(roster);

  it('combat starts with the slots left; the fight writes back what was spent', () => {
    const party = freshParty(stats);
    party[1].spells = { used: [1] };
    const units = buildUnits(encounters['cave-rats'], membersOf(roster), party);
    expect(units.find((u) => u.id === wizard.id)!.caster!.slots).toEqual([1]);
    const s = fight(units);
    s.outcome = 'victory';
    units.find((u) => u.id === cleric.id)!.caster!.slots = [0];
    afterCombat(party, stats, s, 0, createRng(1));
    expect(party[0].spells!.used).toEqual([2]);
  });

  it('Cure Wounds at camp spends a slot; a Long Rest gives them back', () => {
    const party = freshParty(stats);
    party[1].hp = 1;
    const spend = () => {};
    const r = castOutside(spells, 'cure-wounds', 1, stats[0], party, stats, [wizard.id], 0, scripted([4, 4]), spend);
    expect(r.ok).toBe(true);
    expect(party[1].hp).toBe(Math.min(stats[1].hp, 1 + 8 + 3));
    expect(party[0].spells!.used).toEqual([1]);
    rest('long', { party, stats, now: 0, lastLongRest: null, coins: 0, site: { kind: 'inn', name: 'Inn', risk: 0 } }, createRng(1));
    expect(party[0].spells!.used).toEqual([]);
  });

  it('Prayer of Healing: once per Long Rest for each target', () => {
    const lvl3 = { ...cleric, level: 3, hpGains: [5, 5], prepared: ['cure-wounds', 'prayer-of-healing'] };
    const st = statsOf([lvl3, wizard]);
    const party = freshParty(st);
    party[1].hp = 1;
    const ok = castOutside(spells, 'prayer-of-healing', 2, st[0], party, st, [wizard.id], 0, createRng(3), () => {});
    expect(ok).toMatchObject({ ok: true, minutes: 10 });
    party[1].hp = 1;
    const again = castOutside(spells, 'prayer-of-healing', 2, st[0], party, st, [wizard.id], 0, createRng(3), () => {});
    expect(again.ok).toBe(false);
  });

  it('Arcane Recovery: half the Wizard level (round up) in slot levels, once per Long Rest', () => {
    const p: PartyMemberState = { id: 'w', hp: 10, hitDice: 3, dead: false, wakesAt: null, spells: { used: [2, 1] } };
    expect(arcaneRecovery(p, 3)).toEqual([2]);
    expect(p.spells!.used).toEqual([2, 0]);
    expect(arcaneRecovery(p, 3)).toEqual([]);
  });
});
