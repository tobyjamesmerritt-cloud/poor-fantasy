import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/rng';
import { type Unit, activeUnit, endTurn, startCombat, step } from '../src/rules/combat';
import skirmish from '../src/content/skirmish.json';

const units = (): Unit[] => skirmish.units.map((u) => ({ ...u, side: u.side as Unit['side'], maxHp: u.hp }));

describe('combat skeleton', () => {
  it('starts on a party member (enemies that win initiative act immediately)', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = startCombat(createRng(seed), 12, 9, units());
      expect(s.outcome === 'ongoing' ? activeUnit(s).side : 'party').toBe('party');
    }
  });

  it('limits movement to speed', () => {
    const rng = createRng(3);
    const s = startCombat(rng, 12, 9, units());
    const u = activeUnit(s);
    let moved = 0;
    for (let i = 0; i < 20; i++) if (step(s, rng, u.y > 0 && !s.units.some((o) => o.x === u.x && o.y === u.y - 1) ? 'n' : 's')) moved++;
    expect(moved).toBeLessThanOrEqual(u.speed + 1); // +1: a final step may be an attack
  });

  it('always reaches a conclusion when the party just ends turns', () => {
    for (let seed = 0; seed < 25; seed++) {
      const rng = createRng(seed);
      const s = startCombat(rng, 12, 9, units());
      for (let i = 0; i < 500 && s.outcome === 'ongoing'; i++) endTurn(s, rng);
      expect(s.outcome).toBe('defeat');
    }
  });

  it('replays identically from the same seed', () => {
    const play = () => {
      const rng = createRng(1234);
      const s = startCombat(rng, 12, 9, units());
      for (let i = 0; i < 30 && s.outcome === 'ongoing'; i++) {
        step(s, rng, 'e');
        endTurn(s, rng);
      }
      return s.log;
    };
    expect(play()).toEqual(play());
  });
});

describe('reachableSquares', () => {
  const lone = (extra: Unit[] = []): Unit[] => [
    { id: 'a', name: 'A', side: 'party', x: 5, y: 5, hp: 10, maxHp: 10, ac: 10, speed: 2, initBonus: 99, attackBonus: 0, damage: '1d4' },
    { id: 'z', name: 'Z', side: 'enemy', x: 0, y: 0, hp: 10, maxHp: 10, ac: 10, speed: 0, initBonus: -99, attackBonus: 0, damage: '1d4' },
    ...extra,
  ];

  it('covers a (2*speed+1)^2 square minus the start on an open board', async () => {
    const { reachableSquares } = await import('../src/rules/combat');
    const s = startCombat(createRng(1), 12, 12, lone());
    expect(reachableSquares(s)).toHaveLength(5 * 5 - 1);
  });

  it('shrinks as movement is used and never includes occupied squares', async () => {
    const { reachableSquares } = await import('../src/rules/combat');
    const rng = createRng(1);
    const s = startCombat(rng, 12, 12, lone([{ ...lone()[1], id: 'b', x: 6, y: 5 }]));
    expect(reachableSquares(s).some((p) => p.x === 6 && p.y === 5)).toBe(false);
    step(s, rng, 'n');
    expect(reachableSquares(s)).toHaveLength(8 - 1); // 1 move left: 8 neighbours minus the one occupied by 'b'
  });
});
