/**
 * Balance simulator — not part of `npm test`. Run with `npm run sim`.
 * Auto-plays every encounter many times with a simple party bot
 * (walk to nearest enemy and attack; casters heal a dying ally with Healing
 * Word, otherwise cast at the nearest enemy unless one is adjacent) and
 * prints win rate and casualties.
 * A human should do noticeably better than the bot.
 */
import { it } from 'vitest';
import { createRng } from '../src/engine/rng';
import { activeUnit, chebyshev, endTurn, isDown, isUp, planMoveTo, reachableSquares, startCombat, step } from '../src/rules/combat';
import { encounters, encounterXp } from '../src/content/encounters';
import { spells } from '../src/content/characters';
import { castOptions, castSpell, targetingOf, validTargets } from '../src/rules/spells';
import { skirmishUnits } from './helpers';

for (const id of Object.keys(encounters)) it(`balance: ${id}`, () => {
  const N = 500;
  let wins = 0, dead = 0, down = 0, rounds = 0;
  for (let seed = 0; seed < N; seed++) {
    const rng = createRng(seed);
    const s = startCombat(rng, 12, 9, skirmishUnits(id));
    for (let t = 0; t < 400 && s.outcome === 'ongoing'; t++) {
      const u = activeUnit(s);
      const foes = s.units.filter((e) => e.side === 'enemy' && isUp(e)).sort((a, b) => chebyshev(u, a) - chebyshev(u, b));
      if (u.caster) botCast(s, rng, foes);
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
    `${id.padEnd(16)} XP ${encounterXp(encounters[id])} · bot win ${((100 * wins) / N).toFixed(0)}% · ` +
      `avg rounds ${(rounds / N).toFixed(1)} · avg dead ${(dead / N).toFixed(2)} · avg down at end ${(down / N).toFixed(2)}`,
  );
});

/** Simple caster bot: Healing Word on a dying ally; else, with no enemy adjacent, the first attack spell that reaches. */
function botCast(s: ReturnType<typeof startCombat>, rng: ReturnType<typeof createRng>, foes: ReturnType<typeof activeUnit>[]): void {
  const u = activeUnit(s);
  const ready = castOptions(s, spells).filter((o) => !o.reason);
  const word = ready.find((o) => o.id === 'healing-word');
  const dying = s.units.find((x) => x.side === 'party' && isDown(x) && !x.dead && !x.carriedBy);
  if (word && dying && validTargets(s, spells, 'healing-word', word.levels[0]).some((p) => p.x === dying.x && p.y === dying.y)) {
    castSpell(s, rng, spells, 'healing-word', word.levels[0], [{ x: dying.x, y: dying.y }]);
  }
  if (!foes.length || chebyshev(u, foes[0]) === 1) return;
  for (const id of ['magic-missile', 'guiding-bolt', 'fire-bolt', 'sacred-flame']) {
    const o = castOptions(s, spells).find((x) => x.id === id && !x.reason);
    if (!o) continue;
    const t = targetingOf(o.spell, o.levels[0], u.caster!.level);
    const valid = validTargets(s, spells, id, o.levels[0]);
    const target = foes.find((f) => valid.some((p) => p.x === f.x && p.y === f.y));
    if (!target) continue;
    const n = t.kind === 'creatures' ? t.count : 1;
    castSpell(s, rng, spells, id, o.levels[0], Array.from({ length: n }, () => ({ x: target.x, y: target.y })));
    return;
  }
}
