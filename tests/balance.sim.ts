/**
 * Balance simulator — not part of `npm test`. Run with `npm run sim`.
 * Auto-plays the test skirmish many times with a simple party bot
 * (walk to nearest enemy and attack) and prints win rate and casualties.
 * A human should do noticeably better than the bot.
 */
import { it } from 'vitest';
import { createRng } from '../src/engine/rng';
import { activeUnit, chebyshev, endTurn, isDown, isUp, planMoveTo, reachableSquares, startCombat, step } from '../src/rules/combat';
import { encounterXp, type EncounterDef } from '../src/content/encounters';
import skirmish from '../src/content/skirmish.json';
import { skirmishUnits } from './helpers';

it('balance: test skirmish', () => {
  const N = 500;
  let wins = 0, dead = 0, down = 0, rounds = 0;
  for (let seed = 0; seed < N; seed++) {
    const rng = createRng(seed);
    const s = startCombat(rng, 12, 9, skirmishUnits());
    for (let t = 0; t < 400 && s.outcome === 'ongoing'; t++) {
      const u = activeUnit(s);
      const foes = s.units.filter((e) => e.side === 'enemy' && isUp(e)).sort((a, b) => chebyshev(u, a) - chebyshev(u, b));
      const plan = foes.length ? planMoveTo(s, foes[0].x, foes[0].y) : null;
      if (plan) for (const d of plan) step(s, rng, d);
      else if (foes.length) {
        const sq = reachableSquares(s).sort((a, b) => chebyshev(a, foes[0]) - chebyshev(b, foes[0]))[0];
        const p = sq && planMoveTo(s, sq.x, sq.y);
        if (p) for (const d of p) step(s, rng, d);
      }
      if (s.outcome === 'ongoing' && activeUnit(s) === u) endTurn(s, rng);
    }
    if (s.outcome === 'victory') wins++;
    rounds += s.round;
    const party = s.units.filter((x) => x.side === 'party');
    dead += party.filter((x) => x.dead).length;
    down += party.filter(isDown).length;
  }
  console.log(
    `XP ${encounterXp(skirmish as EncounterDef)} · bot win ${((100 * wins) / N).toFixed(0)}% · ` +
      `avg rounds ${(rounds / N).toFixed(1)} · avg dead ${(dead / N).toFixed(2)} · avg down at end ${(down / N).toFixed(2)}`,
  );
});
