import { describe, expect, it } from 'vitest';
import { createRng } from '../src/engine/rng';
import type { PartyMemberState } from '../src/engine/state';
import { startCombat } from '../src/rules/combat';
import { afterCombat, afterDefeat, formatCoins, freshParty, type MemberStats, passTime } from '../src/rules/party';
import { type CampSite, canRest, innCost, rest, type RestInput } from '../src/rules/rest';
import { makeUnit, scripted } from './helpers';

const STATS: MemberStats[] = [
  { id: 'a', name: 'Fighter', hp: 12, hitDie: 10, conMod: 2 },
  { id: 'b', name: 'Wizard', hp: 7, hitDie: 6, conMod: 1 },
];
const FOREST: CampSite = { kind: 'forest', name: 'Forest camp', risk: 0.25 };
const INN: CampSite = { kind: 'inn', name: 'The Leaky Bucket', risk: 0 };

function input(party: PartyMemberState[], over: Partial<RestInput> = {}): RestInput {
  return { party, stats: STATS, now: 600, lastLongRest: null, coins: 1000, site: FOREST, ...over };
}

describe('party between fights', () => {
  it('starts fresh and formats coins', () => {
    expect(freshParty(STATS)).toEqual([
      { id: 'a', hp: 12, hitDice: 1, dead: false, wakesAt: null },
      { id: 'b', hp: 7, hitDice: 1, dead: false, wakesAt: null },
    ]);
    expect(formatCoins(6000)).toBe('60 gp');
    expect(formatCoins(345)).toBe('3 gp 4 sp 5 cp');
  });

  it('copies combat results back; the unconscious wake with 1 HP after 1d4 hours', () => {
    const party = freshParty(STATS);
    const combat = startCombat(createRng(1), 6, 6, [
      makeUnit({ id: 'a', side: 'party', x: 0, y: 0, hp: 5, maxHp: 12 }),
      makeUnit({ id: 'b', side: 'party', x: 1, y: 0, hp: 0, maxHp: 7, stable: true }),
      makeUnit({ id: 'z', side: 'enemy', x: 5, y: 5, hp: 0, dead: true }),
    ]);
    const notes = afterCombat(party, STATS, combat, 600, scripted([3]));
    expect(party[0].hp).toBe(5);
    expect(party[1]).toMatchObject({ hp: 0, dead: false, wakesAt: 600 + 180 });
    expect(notes[0]).toMatch(/Wizard is unconscious.*3 hours/);
    expect(passTime(party, STATS, 779)).toEqual([]);
    expect(passTime(party, STATS, 780)).toEqual(['Wizard']);
    expect(party[1].hp).toBe(1);
  });

  it('after fleeing, whoever was left on the field is lost', () => {
    const party = freshParty(STATS);
    const combat = startCombat(createRng(1), 6, 6, [
      makeUnit({ id: 'a', side: 'party', x: 0, y: 0, fled: true }),
      makeUnit({ id: 'b', side: 'party', x: 1, y: 0, hp: 0, maxHp: 7 }),
      makeUnit({ id: 'z', side: 'enemy', x: 5, y: 5 }),
    ]);
    combat.outcome = 'fled';
    const notes = afterCombat(party, STATS, combat, 600, createRng(1));
    expect(party[1].dead).toBe(true);
    expect(notes).toContain('Wizard was left behind and is lost.');
  });

  it('defeat: Hard ends the game; Normal/Casual are rescued with 1 HP and half the coin', () => {
    const p1 = freshParty(STATS).map((p) => ({ ...p, hp: 0 }));
    expect(afterDefeat(p1, 1000, 'hard').gameOver).toBe(true);
    const p2 = freshParty(STATS).map((p, i) => ({ ...p, hp: 0, dead: i === 1 }));
    const r = afterDefeat(p2, 1001, 'normal');
    expect(r).toMatchObject({ gameOver: false, coins: 500 });
    expect(p2[0].hp).toBe(1);
    expect(p2[1].dead).toBe(true); // the dead stay dead
  });
});

describe('resting (SRD 5.2)', () => {
  it('long rest restores HP and Hit Dice for those with at least 1 HP', () => {
    const party = freshParty(STATS);
    party[0].hp = 3;
    party[0].hitDice = 0;
    party[1].hp = 0;
    party[1].wakesAt = 600 + 120; // wakes during the rest: 1 HP, but no benefit
    const r = rest('long', input(party, { site: INN }), createRng(5));
    expect(r.completed).toBe(true);
    expect(party[0]).toMatchObject({ hp: 12, hitDice: 1 });
    expect(party[1].hp).toBe(1);
    expect(r.minutes).toBe(480);
    expect(r.lastLongRest).toBe(1080);
    expect(r.coinsSpent).toBe(100); // 2 people × 5 sp
  });

  it('short rest spends Hit Dice: die + Con, minimum 1', () => {
    const party = freshParty(STATS);
    party[0].hp = 2;
    const log: string[] = [];
    const r = rest('short', input(party, { site: INN }), scripted([4]));
    log.push(...r.log);
    expect(party[0]).toMatchObject({ hp: 8, hitDice: 0 }); // 2 + (4 + 2)
    expect(party[1].hitDice).toBe(1); // unhurt: keeps the die
    expect(r.coinsSpent).toBe(0);
  });

  it('16 hours between long rests; inns need coin; nobody awake, no rest', () => {
    const party = freshParty(STATS);
    expect(canRest('long', input(party, { lastLongRest: 500, now: 600 }))).toMatchObject({ ok: false });
    expect(canRest('long', input(party, { lastLongRest: 500, now: 500 + 960 })).ok).toBe(true);
    expect(innCost(party)).toBe(100);
    expect(canRest('long', input(party, { site: INN, coins: 99 }))).toMatchObject({ ok: false });
    expect(canRest('short', input(party.map((p) => ({ ...p, hp: 0 }))))).toMatchObject({ ok: false });
  });

  it('camping outside can be ambushed; an interrupted long rest after 1 hour gives short rest benefits', () => {
    const party = freshParty(STATS);
    party[0].hp = 2;
    // ambush roll 10 (≤ 25%), ambush at minute 200, then Hit Die roll 3
    const r = rest('long', input(party), scripted([10, 200, 3]));
    expect(r).toMatchObject({ completed: false, ambushAt: 200, minutes: 200, lastLongRest: null });
    expect(party[0].hp).toBe(7); // 2 + 3 + 2: short rest benefit only
    // a quiet night
    const q = rest('long', input(freshParty(STATS)), scripted([90]));
    expect(q.completed).toBe(true);
    // inns are never ambushed (no roll consumed)
    expect(rest('long', input(freshParty(STATS), { site: INN }), scripted([])).completed).toBe(true);
  });
});
