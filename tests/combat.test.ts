import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/rng';
import {
  activeUnit,
  applyDamage,
  attackMode,
  deathSave,
  endTurn,
  hasEffect,
  isDown,
  isUp,
  planMoveTo,
  reachableSquares,
  startCombat,
  pathProvokes,
  step,
  takeAction,
  turnExhausted,
} from '../src/rules/combat';
import { makeUnit, scripted, skirmishUnits } from './helpers';

/** Party unit 'a' always acts first (huge init), enemy 'z' last. */
const duel = (aOver = {}, zOver = {}) => [
  makeUnit({ id: 'a', side: 'party', x: 1, y: 1, initBonus: 99, ...aOver }),
  makeUnit({ id: 'z', side: 'enemy', x: 2, y: 1, initBonus: -99, hp: 50, ...zOver }),
];

describe('combat flow (skirmish)', () => {
  it('starts on a party member (enemies that win initiative act immediately)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = startCombat(createRng(seed), 12, 9, skirmishUnits());
      expect(s.outcome === 'ongoing' ? activeUnit(s).side : 'party').toBe('party');
    }
  });

  it('always reaches a conclusion when the party just ends turns', () => {
    for (let seed = 0; seed < 25; seed++) {
      const rng = createRng(seed);
      const s = startCombat(rng, 12, 9, skirmishUnits());
      for (let i = 0; i < 500 && s.outcome === 'ongoing'; i++) endTurn(s, rng);
      expect(s.outcome).toBe('defeat');
    }
  });

  it('replays identically from the same seed', () => {
    const play = () => {
      const rng = createRng(1234);
      const s = startCombat(rng, 12, 9, skirmishUnits());
      for (let i = 0; i < 30 && s.outcome === 'ongoing'; i++) {
        step(s, rng, 'e');
        endTurn(s, rng);
      }
      return s.log;
    };
    expect(play()).toEqual(play());
  });
});

describe('movement', () => {
  it('reachableSquares covers a (2*speed+1)^2 square minus the start on an open board', () => {
    const s = startCombat(createRng(1), 12, 12, [
      makeUnit({ id: 'a', side: 'party', x: 5, y: 5, speed: 2, initBonus: 99 }),
      makeUnit({ id: 'z', side: 'enemy', x: 0, y: 0, initBonus: -99 }),
    ]);
    expect(reachableSquares(s)).toHaveLength(5 * 5 - 1);
  });

  it('planMoveTo finds shortest paths and walks up to attack', () => {
    const rng = createRng(9);
    const s = startCombat(rng, 10, 10, [
      makeUnit({ id: 'a', side: 'party', x: 0, y: 0, initBonus: 99 }),
      makeUnit({ id: 'z', side: 'enemy', x: 5, y: 0, ac: 1, hp: 50, initBonus: -99 }),
      makeUnit({ id: 'w', side: 'party', x: 1, y: 1, initBonus: -50 }),
    ]);
    expect(planMoveTo(s, 3, 3)).toHaveLength(4); // ally W on (1,1) blocks the 3-step diagonal
    expect(planMoveTo(s, 9, 9)).toBeNull(); // beyond speed 6
    expect(planMoveTo(s, 1, 1)).toBeNull(); // conscious ally
    const plan = planMoveTo(s, 5, 0)!;
    expect(plan).toHaveLength(5);
    for (const d of plan) step(s, rng, d);
    expect(s.actionUsed).toBe(true);
    expect(s.movesLeft).toBe(2); // SRD 5.2: movement left after attacking can still be used
    expect(turnExhausted(s)).toBe(false);
    s.movesLeft = 0;
    expect(turnExhausted(s)).toBe(true);
  });

  it('auto end turn: only once the action is used and no movement is left', () => {
    const rng = createRng(9);
    const s = startCombat(rng, 10, 10, [
      makeUnit({ id: 'a', side: 'party', x: 0, y: 0, speed: 6, initBonus: 99 }),
      makeUnit({ id: 'z', side: 'enemy', x: 2, y: 0, ac: 1, hp: 50, initBonus: -99 }),
    ]);
    expect(turnExhausted(s)).toBe(false); // fresh turn
    step(s, rng, 'e'); // move next to the enemy
    s.movesLeft = 0;
    expect(turnExhausted(s)).toBe(false); // the action is still there (attack, Dodge…)
    step(s, rng, 'e'); // attack
    expect(s.actionUsed).toBe(true);
    s.movesLeft = 4;
    expect(turnExhausted(s)).toBe(false); // may still walk away
    s.movesLeft = 0;
    expect(turnExhausted(s)).toBe(true);
  });
});

describe('Pack Tactics (SRD 5.2)', () => {
  it('rolls with advantage when an ally of the attacker is adjacent to the target', () => {
    // Party 'p' at (1,1); rats at (2,1) and (0,1). Rat 'r1' acts first.
    const units = [
      makeUnit({ id: 'p', side: 'party', x: 1, y: 1, initBonus: -99, ac: 15, hp: 30 }),
      makeUnit({ id: 'r1', side: 'enemy', x: 2, y: 1, initBonus: 99, traits: ['pack-tactics'], attackBonus: 0 }),
      makeUnit({ id: 'r2', side: 'enemy', x: 0, y: 1, initBonus: 50, traits: ['pack-tactics'], attackBonus: 0 }),
    ];
    // init rolls (3) then r1 attack with advantage: dice 2 and 18 -> keeps 18 (hits AC 15), damage 1d4 = 3.
    const s = startCombat(scripted([10, 10, 10, 2, 18, 3, 1, 1]), 5, 5, units);
    expect(s.log.some((l) => l.includes('hits') && l.includes('[pack tactics]'))).toBe(true);
  });
});

describe('0 HP and death saves (SRD 5.2)', () => {
  it('a character dropped to 0 falls unconscious and still occupies the square; a monster dies', () => {
    const pc = makeUnit({ id: 'a', side: 'party', x: 0, y: 0, hp: 10 });
    expect(applyDamage(pc, 12)).toContain('unconscious');
    expect(isDown(pc)).toBe(true);
    const m = makeUnit({ id: 'z', side: 'enemy', x: 0, y: 0, hp: 5 });
    applyDamage(m, 9);
    expect(m.dead).toBe(true);
  });

  it('Instant Death: remainder ≥ HP maximum kills outright', () => {
    const pc = makeUnit({ id: 'a', side: 'party', x: 0, y: 0, hp: 6, maxHp: 10 });
    expect(applyDamage(pc, 16)).toContain('killed outright'); // remainder 10 = max
    expect(pc.dead).toBe(true);
  });

  it('damage at 0 HP is a death save failure', () => {
    const pc = makeUnit({ id: 'a', side: 'party', x: 0, y: 0, hp: 0, maxHp: 10 });
    applyDamage(pc, 3);
    expect(pc.deathSaves.failures).toBe(1);
  });

  it('death saves: 10+ success, 1 = two failures, 20 = regain 1 HP, 3 successes = stable, 3 failures = dead', () => {
    const s = startCombat(createRng(1), 5, 5, duel());
    const pc = makeUnit({ id: 'x', side: 'party', x: 3, y: 3, hp: 0 });
    s.units.push(pc);
    deathSave(s, scripted([12]), pc);
    expect(pc.deathSaves).toEqual({ successes: 1, failures: 0 });
    deathSave(s, scripted([1]), pc);
    expect(pc.deathSaves.failures).toBe(2);
    deathSave(s, scripted([20]), pc);
    expect(pc.hp).toBe(1);
    expect(isUp(pc)).toBe(true);

    const pc2 = makeUnit({ id: 'y', side: 'party', x: 4, y: 4, hp: 0 });
    s.units.push(pc2);
    [10, 15, 19].forEach((r) => deathSave(s, scripted([r]), pc2));
    expect(pc2.stable).toBe(true);

    const pc3 = makeUnit({ id: 'w', side: 'party', x: 4, y: 3, hp: 0 });
    s.units.push(pc3);
    [5, 1].forEach((r) => deathSave(s, scripted([r]), pc3));
    expect(pc3.dead).toBe(true);
  });

  it('unconscious characters roll a death save at the start of their turn, then the turn passes', () => {
    // a acts first; d is down with initiative between a and z.
    const units = [
      makeUnit({ id: 'a', side: 'party', x: 0, y: 0, initBonus: 99 }),
      makeUnit({ id: 'd', side: 'party', x: 0, y: 4, initBonus: 50, hp: 0, maxHp: 10 }),
      makeUnit({ id: 'z', side: 'enemy', x: 4, y: 4, initBonus: -99, hp: 50, speed: 0 }),
    ];
    const rng = createRng(3);
    const s = startCombat(rng, 5, 5, units);
    expect(activeUnit(s).id).toBe('a');
    endTurn(s, rng);
    expect(s.log.some((l) => l.includes('D') && l.includes('death save'))).toBe(true);
    expect(activeUnit(s).id).toBe('a'); // d's turn was consumed by the save, z did nothing (speed 0)
  });

  it('moving into an unconscious ally uses the Help action to stabilise (DC 10 Medicine)', () => {
    const units = [
      makeUnit({ id: 'a', side: 'party', x: 1, y: 1, initBonus: 99, medicine: 5 }),
      makeUnit({ id: 'd', side: 'party', x: 2, y: 1, initBonus: -50, hp: 0, maxHp: 10 }),
      makeUnit({ id: 'z', side: 'enemy', x: 4, y: 4, initBonus: -99 }),
    ];
    const s = startCombat(scripted([10, 10, 10]), 5, 5, units);
    expect(planMoveTo(s, 2, 1)).toEqual(['e']);
    step(s, scripted([6]), 'e'); // 6 + 5 = 11 ≥ 10
    expect(s.units.find((u) => u.id === 'd')!.stable).toBe(true);
    expect(s.actionUsed).toBe(true);
  });

  it('defeat when no party member is conscious, even if some are only unconscious', () => {
    const units = [
      makeUnit({ id: 'a', side: 'party', x: 1, y: 1, initBonus: -99, hp: 1, ac: 1 }),
      makeUnit({ id: 'z', side: 'enemy', x: 2, y: 1, initBonus: 99, attackBonus: 10, damage: ['1'] }),
    ];
    const s = startCombat(scripted([10, 10, 15]), 5, 5, units);
    expect(s.outcome).toBe('defeat');
    expect(isDown(s.units[0])).toBe(true);
  });
});

describe('action economy and opportunity attacks (SRD 5.2)', () => {
  // party 'a' (acts first) next to enemy 'z'; 'z' always hits (attack +99), 1 damage
  const setup = (aHp = 30) => {
    const rng = createRng(3);
    const s = startCombat(rng, 10, 10, [
      makeUnit({ id: 'a', side: 'party', x: 1, y: 1, speed: 6, hp: aHp, initBonus: 99 }),
      makeUnit({ id: 'z', side: 'enemy', x: 2, y: 1, hp: 50, ac: 30, attackBonus: 99, damage: ['1'], initBonus: -99 }),
      makeUnit({ id: 'b', side: 'party', x: 8, y: 8, initBonus: -50 }), // an ally far away keeps the battle going
    ]);
    return { rng, s, a: s.units[0], z: s.units[1] };
  };

  it('leaving an enemy’s reach provokes one opportunity attack per round (its Reaction)', () => {
    const { rng, s, a, z } = setup();
    expect(step(s, rng, 'w')).toBe(true); // (1,1) → (0,1): out of reach
    expect(a.hp).toBe(29);
    expect(z.reactionUsed).toBe(true);
    expect(s.log.some((l) => l.startsWith('Opportunity attack!'))).toBe(true);
    step(s, rng, 'e'); // back into reach: no attack
    step(s, rng, 'w'); // out again: its reaction is spent this round
    expect(a.hp).toBe(29);
  });

  it('moving within reach does not provoke', () => {
    const { rng, s, a } = setup();
    step(s, rng, 'n'); // (1,0): still next to (2,1)
    expect(a.hp).toBe(30);
  });

  it('Disengage: moving away provokes nothing', () => {
    const { rng, s, a } = setup();
    expect(takeAction(s, 'disengage')).toBe(true);
    step(s, rng, 'w');
    expect(a.hp).toBe(30);
    expect(takeAction(s, 'dash')).toBe(false); // one action per turn
  });

  it('Dash adds movement equal to Speed; attacking does not end movement', () => {
    const { s } = setup();
    expect(takeAction(s, 'dash')).toBe(true);
    expect(s.movesLeft).toBe(12);
    const r = setup();
    step(r.s, r.rng, 'e'); // attack z
    expect(r.s.actionUsed).toBe(true);
    expect(r.s.movesLeft).toBe(6);
  });

  it('Dodge: attacks against the dodger have disadvantage until its next turn', () => {
    const { s, a, z } = setup();
    takeAction(s, 'dodge');
    expect(attackMode(s, z, a, false).notes).toContain('dodging');
    expect(hasEffect(a, 'dodging')).toBe(true);
  });

  it('an opportunity attack that drops the mover ends its move (and its turn’s options)', () => {
    const { rng, s, a } = setup(1);
    step(s, rng, 'w');
    expect(a.hp).toBe(0);
    expect(a.x).toBe(1); // never left the square
    expect(s.movesLeft).toBe(0);
    expect(turnExhausted(s)).toBe(true);
  });
});

describe('opportunity attack warning', () => {
  it('a path out of an enemy’s reach names the enemy; Disengage or staying close does not', () => {
    const rng = createRng(3);
    const s = startCombat(rng, 10, 10, [
      makeUnit({ id: 'a', side: 'party', x: 1, y: 1, speed: 6, initBonus: 99 }),
      makeUnit({ id: 'z', side: 'enemy', x: 2, y: 1, hp: 50, initBonus: -99 }),
    ]);
    expect(pathProvokes(s, ['w', 'w']).map((u) => u.id)).toEqual(['z']);
    expect(pathProvokes(s, ['n'])).toEqual([]); // still next to it
    takeAction(s, 'disengage');
    expect(pathProvokes(s, ['w', 'w'])).toEqual([]);
  });
});
