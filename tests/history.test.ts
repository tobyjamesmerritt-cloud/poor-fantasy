import { describe, expect, it } from 'vitest';
import { History } from '../src/engine/history';
import { createRng } from '../src/engine/rng';
import { type Unit, endTurn, startCombat, step } from '../src/rules/combat';
import skirmish from '../src/content/skirmish.json';

const units = (): Unit[] => skirmish.units.map((u) => ({ ...u, side: u.side as Unit['side'], maxHp: u.hp }));

describe('History (rewind)', () => {
  it('stores deep copies, so later mutation does not leak into snapshots', () => {
    const h = new History<{ a: number[] }>();
    const s = { a: [1] };
    h.push(s);
    s.a.push(2);
    expect(h.pop()).toEqual({ a: [1] });
  });

  it('respects capacity', () => {
    const h = new History<number>(3);
    [1, 2, 3, 4].forEach((n) => h.push(n));
    expect(h.size).toBe(3);
    expect([h.pop(), h.pop(), h.pop(), h.pop()]).toEqual([4, 3, 2, undefined]);
  });

  it('restoring state + rng position replays identical outcomes (fate is fixed)', () => {
    let rng = createRng(77);
    let s = startCombat(rng, 12, 9, units());
    const h = new History<{ state: typeof s; rng: number }>();
    h.push({ state: s, rng: rng.state });
    step(s, rng, 'e');
    endTurn(s, rng);
    const firstLog = [...s.log];

    const snap = h.pop()!;
    s = snap.state;
    rng = createRng(snap.rng);
    step(s, rng, 'e');
    endTurn(s, rng);
    expect(s.log).toEqual(firstLog);
  });
});
