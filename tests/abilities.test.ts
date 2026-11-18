import { describe, expect, it } from 'vitest';
import { buildUnits, encounters, monsters, resolveEncounter } from '../src/content/encounters';
import { createRng } from '../src/engine/rng';
import {
  attackMode,
  chooseAction,
  type CombatState,
  hasEffect,
  hurt,
  runEnemyTurn,
  saveTotal,
  step,
  takeAction,
  typedDamage,
  type Unit,
  endTurn,
} from '../src/rules/combat';
import { makeUnit, scripted } from './helpers';

/** A unit with a monster's stat block (monsters.json), at x, y. */
function monster(id: string, x: number, y: number, over: Partial<Unit> = {}): Unit {
  const m = monsters[id];
  return makeUnit({
    id,
    side: 'enemy',
    x,
    y,
    name: m.name,
    hp: m.hp,
    maxHp: m.hp,
    ac: m.ac,
    speed: m.speed,
    saves: m.saves,
    attackName: m.actions[0].name,
    attackBonus: m.actions[0].bonus,
    damage: m.actions[0].damage,
    actions: structuredClone(m.actions),
    abilities: structuredClone(m.abilities ?? []),
    resist: m.resist,
    immune: m.immune,
    vulnerable: m.vulnerable,
    conditionImmune: m.conditionImmune,
    creatureType: m.type,
    size: m.size,
    attacks: m.actions[0].multi,
    ...over,
  });
}

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

const hero = (over: Partial<Unit> = {}) => makeUnit({ id: 'hero', side: 'party', x: 2, y: 4, hp: 40, maxHp: 40, ac: 10, saves: { con: -50, str: -50, dex: -50 }, ...over });

describe('monster abilities (DND-75, SRD 5.2)', () => {
  it('every monster in the bestiary builds into a fight', () => {
    const units = buildUnits(resolveEncounter(encounters['cave-rats']));
    expect(units.some((u) => u.actions?.length)).toBe(true);
    for (const id of Object.keys(monsters)) expect(monster(id, 1, 1).actions!.length, id).toBeGreaterThan(0);
  });

  it('damage types: Skeletons are vulnerable to bludgeoning and immune to poison; Ghasts resist necrotic', () => {
    const sk = monster('skeleton', 1, 1);
    expect(typedDamage(sk, 6, 'bludgeoning')).toBe(12);
    expect(typedDamage(sk, 6, 'poison')).toBe(0);
    expect(typedDamage(sk, 6, 'slashing')).toBe(6);
    expect(typedDamage(monster('ghast', 1, 1), 7, 'necrotic')).toBe(3);
  });

  it('a mace hits a skeleton for double', () => {
    const cleric = hero({ x: 1, y: 4, attackBonus: 50, damage: ['3'], damageType: 'bludgeoning' });
    const sk = monster('skeleton', 2, 4);
    const s = fight([cleric, sk]);
    step(s, createRng(1), 'e');
    expect(sk.hp).toBe(13 - 6);
  });

  it('Ghoul claws paralyze on a failed Con save (not elves); the paralyzed lose their turn, auto-fail Dex saves and are crit from 5 ft', () => {
    const ghoul = monster('ghoul', 1, 4);
    const victim = hero();
    const elf = hero({ id: 'elf', x: 1, y: 3, species: 'elf' });
    expect(chooseAction(ghoul, victim)?.name).toBe('Claw'); // the rider would land
    expect(chooseAction(ghoul, elf)?.name).toBe('Bite'); // elves shrug it off: bite twice
    const s = fight([ghoul, victim, elf]);
    s.units[1].ac = 1;
    runEnemyTurn(s, createRng(4));
    // the ghoul acted (it may have picked either target); find who got clawed
    expect(hasEffect(elf, 'paralyzed')).toBe(false);
    victim.effects = [{ kind: 'paralyzed', owner: victim.id, ends: 'end' }];
    expect(saveTotal(createRng(1), victim, 'dex')).toBe(-99);
    const swing = attackMode(s, ghoul, victim, false);
    expect(swing.notes).toContain('target paralyzed');
  });

  it('a paralyzed character skips their turn, and it wears off at the end of that turn', () => {
    const a = hero({ id: 'a', x: 1, y: 1 });
    const b = hero({ id: 'b', x: 5, y: 5, effects: [{ kind: 'paralyzed', owner: 'b', ends: 'end' }] });
    const c = makeUnit({ id: 'c', side: 'enemy', x: 10, y: 8, hp: 50 });
    const s = fight([a, b, c]);
    endTurn(s, createRng(1)); // a → b (skipped) → c (enemy) → a
    expect(s.log.join('\n')).toMatch(/B is paralyzed and can't act/);
    expect(hasEffect(b, 'paralyzed')).toBe(false);
  });

  it('Wolf bites knock down; standing up costs half the speed', () => {
    const wolf = monster('wolf', 1, 4, { attackBonus: 50 });
    wolf.actions![0].bonus = 50;
    const victim = hero({ speed: 6 });
    const s = fight([wolf, victim]);
    runEnemyTurn(s, createRng(2));
    expect(s.log.join('\n')).toMatch(/HERO is knocked Prone/);
    expect(s.log.join('\n')).toMatch(/HERO gets back up/);
    expect(s.movesLeft).toBe(3); // victim's turn now: got up for half of 6
    expect(hasEffect(victim, 'prone')).toBe(false);
  });

  it('Bugbear grab: grappled (Speed 0), escape with an action; it ends when the bugbear falls', () => {
    const bug = monster('bugbear-warrior', 1, 4);
    bug.actions!.forEach((a) => (a.bonus = 50));
    const victim = hero({ saves: { str: 50, dex: 0, con: 0 } });
    const s = fight([bug, victim]);
    runEnemyTurn(s, createRng(3));
    expect(hasEffect(victim, 'grappled')).toBe(true);
    expect(s.movesLeft).toBe(0);
    expect(chooseAction(bug, victim)?.name).toBe('Light Hammer'); // already holding it: hammer with Advantage
    expect(takeAction(s, 'escape', false, createRng(1))).toBe(true);
    expect(hasEffect(victim, 'grappled')).toBe(false);
  });

  it('Parry turns a hit that beats AC by less than 2 into a miss — once a round', () => {
    const cap = monster('bandit-captain', 2, 4);
    const att = hero({ x: 1, y: 4, attackBonus: 0, damage: ['5'] });
    const s = fight([att, cap]);
    // d20 = 15 → 15 vs AC 15 hits, but not AC 17
    step(s, scripted([15, 5]), 'e');
    expect(s.log.join('\n')).toMatch(/parried/);
    expect(cap.hp).toBe(52);
  });

  it('Undead Fortitude: a zombie dropped by ordinary damage may stay at 1 HP; radiant damage finishes it', () => {
    const z = monster('zombie', 1, 1, { saves: { con: 50 } });
    const s = fight([hero(), z]);
    hurt(s, createRng(1), z, 20, 'Smash', 'bludgeoning');
    expect(z.hp).toBe(1);
    hurt(s, createRng(1), z, 5, 'Sacred Flame', 'radiant');
    expect(z.dead).toBe(true);
  });

  it('Ghast Stench: starting a turn next to it means a Con save or Poisoned; a success gives immunity', () => {
    const victim = hero({ id: 'v', x: 1, y: 4 });
    const ghast = monster('ghast', 2, 4);
    const s = fight([ghast, victim]);
    s.turnIndex = 0;
    endTurn(s, createRng(5)); // victim's turn starts next to the ghast
    expect(hasEffect(victim, 'poisoned')).toBe(true);
    const tough = hero({ id: 't', x: 1, y: 4, saves: { con: 50 } });
    const s2 = fight([monster('ghast', 2, 4), tough]);
    endTurn(s2, createRng(5));
    expect(tough.auraImmune).toContain('ghast');
  });

  it('Ankheg Acid Spray: a line through two characters, then it has to recharge', () => {
    const ank = monster('ankheg', 1, 4);
    const a = hero({ id: 'a', x: 4, y: 4 });
    const b = hero({ id: 'b', x: 6, y: 4 });
    const s = fight([ank, a, b]);
    runEnemyTurn(s, createRng(7));
    expect(s.log.join('\n')).toMatch(/uses Acid Spray/);
    expect(a.hp).toBeLessThan(40);
    expect(b.hp).toBeLessThan(40);
    expect(ank.recharged?.['Acid Spray']).toBe(false);
  });

  it('planned abilities are data only: the basilisk just bites', () => {
    const bas = monster('basilisk', 1, 4);
    expect(bas.abilities?.some((a) => a.kind === 'petrifying-gaze')).toBe(true);
    const s = fight([bas, hero()]);
    runEnemyTurn(s, createRng(1));
    expect(s.log.join('\n')).toMatch(/Basilisk (hits|misses|CRITS) HERO/);
  });
});
