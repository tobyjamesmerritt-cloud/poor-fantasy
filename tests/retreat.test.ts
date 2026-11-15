import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/rng';
import {
  activeUnit,
  canFlee,
  endTurn,
  planMoveTo,
  type RetreatRule,
  startCombat,
  step,
  turnExhausted,
  unitAt,
  unitById,
} from '../src/rules/combat';
import { makeUnit } from './helpers';

/** Party 'a' acts first at the west edge; 'b' (stable, down) next to it; a far-away enemy acts last. */
function setup(retreat: RetreatRule, bDown = true) {
  const rng = createRng(3);
  const s = startCombat(
    rng,
    10,
    10,
    [
      makeUnit({ id: 'a', side: 'party', x: 0, y: 5, initBonus: 99 }),
      makeUnit({ id: 'b', side: 'party', x: 1, y: 5, initBonus: 50, hp: bDown ? 0 : 10, maxHp: 10, stable: bDown }),
      makeUnit({ id: 'z', side: 'enemy', x: 9, y: 0, initBonus: -99, hp: 50 }),
    ],
    retreat,
  );
  return { rng, s };
}

describe('retreat (fleeing over the map edge)', () => {
  it('only from an edge square, with movement left', () => {
    const { rng, s } = setup('hard', false);
    expect(canFlee(s).ok).toBe(true); // a is on the west edge
    step(s, rng, 'e'); // blocked by b? b is at (1,5): standing ally blocks, no move
    s.movesLeft = 0;
    expect(canFlee(s)).toMatchObject({ ok: false, reason: expect.stringMatching(/no movement/) });
  });

  it('stepping off the edge flees; the battle ends as a retreat when nobody conscious is left on the field', () => {
    const { rng, s } = setup('hard', false);
    step(s, rng, 'w');
    expect(unitById(s, 'a').fled).toBe(true);
    expect(unitAt(s, 0, 5)).toBeUndefined();
    expect(s.outcome).toBe('ongoing'); // b is still fighting
    expect(activeUnit(s).id).toBe('b');
    step(s, rng, 'w'); // b moves onto the edge square
    step(s, rng, 'w'); // and off
    expect(s.outcome).toBe('fled');
  });

  it('hard: the last character standing may leave a fallen ally behind', () => {
    const { rng, s } = setup('hard');
    step(s, rng, 'w');
    expect(s.outcome).toBe('fled');
    expect(unitById(s, 'b').fled).toBeFalsy(); // left behind
  });

  it('normal: the last character standing will not abandon a fallen ally', () => {
    const { rng, s } = setup('normal');
    expect(canFlee(s)).toMatchObject({ ok: false, reason: expect.stringMatching(/won't abandon B/) });
    step(s, rng, 'w');
    expect(s.outcome).toBe('ongoing');
    expect(unitById(s, 'a').fled).toBeFalsy();
  });

  it('normal: carry the fallen ally (double movement cost), then flee together', () => {
    const { rng, s } = setup('normal');
    expect(planMoveTo(s, 1, 5)).toEqual(['e']); // walk into the stable ally = pick up
    step(s, rng, 'e');
    const a = unitById(s, 'a');
    expect(a.carrying).toBe('b');
    expect(unitAt(s, 1, 5)).toBeUndefined(); // b is off the grid while carried
    expect(turnExhausted(s)).toBe(false); // the carrier may still walk
    step(s, rng, 's');
    expect(s.movesLeft).toBe(4); // 6 − 2
    expect(canFlee(s).ok).toBe(true);
    step(s, rng, 'w');
    expect(s.outcome).toBe('fled');
    expect(unitById(s, 'b').fled).toBe(true);
  });

  it('casual: one character fleeing takes the whole party out', () => {
    const { rng, s } = setup('casual');
    step(s, rng, 'w');
    expect(s.outcome).toBe('fled');
    expect(unitById(s, 'b').fled).toBe(true);
  });

  it('a carrier who drops puts their load down on a free square', () => {
    const { rng, s } = setup('normal');
    step(s, rng, 'e'); // pick up b
    const a = unitById(s, 'a');
    const z = unitById(s, 'z');
    Object.assign(z, { x: 1, y: 5, attackBonus: 99, damage: ['20'] });
    endTurn(s, rng); // b's turn passes (stable), then z attacks a
    expect(a.hp).toBe(0);
    expect(a.carrying).toBeUndefined();
    const b = unitById(s, 'b');
    expect(b.carriedBy).toBeUndefined();
    expect(unitAt(s, b.x, b.y)).toBe(b);
  });
});
