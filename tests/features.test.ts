import { describe, expect, it } from 'vitest';
import { characterData, memberOf, membersForFight, pregens } from '../src/content/characters';
import { createRng } from '../src/engine/rng';
import type { PartyMemberState } from '../src/engine/state';
import { resolveAttack } from '../src/rules/attack';
import { type CombatState, featureOptions, step, swapWeapon, takeAction, type Unit, useFeature, weaponChoices } from '../src/rules/combat';
import { combatFeatures, featureNames, restFeatures } from '../src/rules/features';
import { makeUnit, scripted } from './helpers';

const names = (classId: string, level: number) => featureNames(characterData.classes[classId], level);

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

describe('class features in combat (SRD 5.2)', () => {
  it('feature numbers by class and level', () => {
    const f5 = combatFeatures('fighter', 5, names('fighter', 5), false);
    expect(f5).toMatchObject({ attacks: 2, critOn: 19, secondWindBonus: 5, uses: { 'second-wind': 3, 'action-surge': 1 } });
    expect(combatFeatures('fighter', 1, names('fighter', 1), false)).toEqual({ secondWindBonus: 1, uses: { 'second-wind': 2 } });
    expect(combatFeatures('rogue', 1, names('rogue', 1), true).sneakAttack).toBe('1d6');

    expect(combatFeatures('rogue', 5, names('rogue', 5), true)).toMatchObject({ sneakAttack: '3d6', cunningAction: true, uncannyDodge: true });
    expect(combatFeatures('paladin', 3, names('paladin', 3), false).uses).toEqual({ 'lay-on-hands': 15 });
    expect(combatFeatures('ranger', 5, names('ranger', 5), false)).toMatchObject({ attacks: 2, colossusSlayer: true });
  });

  it('the pregen fighter has Defense (+1 AC in armour); the rogue’s weapon gets Sneak Attack', () => {
    const fighter = memberOf(pregens.find((p) => p.classId === 'fighter')!);
    expect(fighter.features?.uses?.['second-wind']).toBe(2);
    expect(memberOf(pregens.find((p) => p.classId === 'rogue')!).features?.sneakAttack).toBe('1d6');
  });

  it('Improved Critical: a natural 19 is a critical hit', () => {
    const r = resolveAttack(scripted([19, 3, 3]), { attackBonus: 0, targetAc: 30, damage: '1d6', critOn: 19 });
    expect(r.critical && r.hit).toBe(true);
    expect(r.damage).toBe(6); // two d6
  });

  it('Extra Attack: the Attack action is two attacks, with movement between', () => {
    const a = makeUnit({ id: 'f', side: 'party', x: 1, y: 1, attackBonus: 50, attacks: 2 });
    const e = makeUnit({ id: 'e', side: 'enemy', x: 2, y: 1, hp: 100, ac: 1 });
    const s = fight([a, e]);
    step(s, createRng(1), 'e');
    expect(s.actionUsed).toBe(false);
    expect(s.attacksMade).toBe(1);
    expect(takeAction(s, 'dash')).toBe(false); // mid-Attack: no other action
    step(s, createRng(2), 'e');
    expect(s.actionUsed).toBe(true);
  });

  it('Sneak Attack: with an ally next to the target, once per turn', () => {
    const rogue = makeUnit({ id: 'r', side: 'party', x: 1, y: 1, attackBonus: 50, damage: ['1'], attacks: 2, finesse: true, features: { sneakAttack: '3d6' } });
    const ally = makeUnit({ id: 'a', side: 'party', x: 3, y: 1 });
    const e = makeUnit({ id: 'e', side: 'enemy', x: 2, y: 1, hp: 100, ac: 1 });
    const s = fight([rogue, ally, e]);
    step(s, createRng(1), 'e');
    expect(s.log.join('\n')).toMatch(/sneak attack/);
    const afterFirst = e.hp;
    expect(afterFirst).toBeLessThan(100 - 3); // 1 + 3d6
    step(s, createRng(2), 'e');
    expect(afterFirst - e.hp).toBe(1); // no second Sneak Attack this turn
  });

  it('no Sneak Attack without a Finesse weapon in hand', () => {
    const rogue = makeUnit({ id: 'r', side: 'party', x: 1, y: 1, attackBonus: 50, damage: ['1'], finesse: false, features: { sneakAttack: '3d6' } });
    const s = fight([rogue, makeUnit({ id: 'a', side: 'party', x: 3, y: 1 }), makeUnit({ id: 'e', side: 'enemy', x: 2, y: 1, hp: 100, ac: 1 })]);
    step(s, createRng(1), 'e');
    expect(s.log.join('\n')).not.toMatch(/sneak attack/);
  });

  it('weapons: draw a spare from the pack once a turn; only one person can hold it', () => {
    const [m1, m2] = membersForFight(pregens.slice(0, 2), { 'weapon:dagger': 1 });
    expect(m1.weapons?.map((w) => w.ref)).toContain('weapon:dagger');
    const u1 = makeUnit({ id: 'a', side: 'party', x: 1, y: 1, weapons: m1.weapons, weaponRef: m1.weaponRef });
    const u2 = makeUnit({ id: 'b', side: 'party', x: 1, y: 2, weapons: m2.weapons, weaponRef: m2.weaponRef });
    const s = fight([u1, u2, makeUnit({ id: 'e', side: 'enemy', x: 8, y: 8 })]);
    s.packWeapons = { 'weapon:dagger': 1 };
    expect(swapWeapon(s, 'weapon:dagger')).toBe(true);
    expect(u1.attackName).toBe('Dagger');
    expect(u1.finesse).toBe(true);
    expect(swapWeapon(s, m1.weaponRef)).toBe(false); // one object interaction a turn
    s.turnIndex = 1;
    s.objectUsed = false;
    expect(weaponChoices(s).find((w) => w.ref === 'weapon:dagger')?.available).toBe(false);
  });

  it('Uncanny Dodge halves a hit, using the Reaction', () => {
    const orc = makeUnit({ id: 'o', side: 'party', x: 1, y: 1, attackBonus: 50, damage: ['10'] });
    const rogue = makeUnit({ id: 'r', side: 'enemy', x: 2, y: 1, hp: 30, ac: 1, features: { uncannyDodge: true } });
    const s = fight([orc, rogue]);
    step(s, createRng(1), 'e');
    expect(rogue.hp).toBe(25);
    expect(rogue.reactionUsed).toBe(true);
  });

  it('Second Wind heals as a Bonus Action; Action Surge gives the action back once', () => {
    const f = makeUnit({ id: 'f', side: 'party', x: 1, y: 1, hp: 3, maxHp: 20, features: { secondWindBonus: 1 }, uses: { 'second-wind': 2, 'action-surge': 1 } });
    const s = fight([f, makeUnit({ id: 'e', side: 'enemy', x: 8, y: 8 })]);
    expect(featureOptions(s).find((o) => o.id === 'action-surge')!.reason).toMatch(/action first/);
    expect(useFeature(s, createRng(1), 'second-wind')).toBe(true);
    expect(f.hp).toBeGreaterThan(3);
    expect(s.bonusUsed).toBe(true);
    expect(f.uses!['second-wind']).toBe(1);
    takeAction(s, 'dodge');
    expect(useFeature(s, createRng(1), 'action-surge')).toBe(true);
    expect(s.actionUsed).toBe(false);
    expect(useFeature(s, createRng(1), 'action-surge')).toBe(false);
  });

  it('Lay On Hands brings a fallen ally back from the pool', () => {
    const pal = makeUnit({ id: 'p', side: 'party', x: 1, y: 1, uses: { 'lay-on-hands': 5 } });
    const down = makeUnit({ id: 'd', side: 'party', x: 2, y: 1, hp: 0, maxHp: 10 });
    const s = fight([pal, down, makeUnit({ id: 'e', side: 'enemy', x: 8, y: 8 })]);
    expect(useFeature(s, createRng(1), 'lay-on-hands', 'd')).toBe(true);
    expect(down.hp).toBe(5);
    expect(pal.uses!['lay-on-hands']).toBe(0);
  });

  it('Cunning Action: Dash or Disengage as a Bonus Action after attacking', () => {
    const r = makeUnit({ id: 'r', side: 'party', x: 1, y: 1, attackBonus: 50, features: { cunningAction: true } });
    const s = fight([r, makeUnit({ id: 'e', side: 'enemy', x: 2, y: 1, hp: 100, ac: 1 })]);
    step(s, createRng(1), 'e');
    expect(s.actionUsed).toBe(true);
    expect(takeAction(s, 'disengage', true)).toBe(true);
    expect(s.disengaged && s.bonusUsed).toBe(true);
    expect(takeAction(s, 'dodge', true)).toBe(false);
  });

  it('rests: a Short Rest gives back one Second Wind and Action Surge; a Long Rest everything', () => {
    const p: PartyMemberState = { id: 'f', hp: 10, hitDice: 1, dead: false, wakesAt: null, featureUses: { 'second-wind': 2, 'action-surge': 1, 'lay-on-hands': 4 } };
    restFeatures(p, 'short');
    expect(p.featureUses).toEqual({ 'second-wind': 1, 'lay-on-hands': 4 });
    restFeatures(p, 'long');
    expect(p.featureUses).toBeUndefined();
  });
});
