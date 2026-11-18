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
import { buildUnits, encounters, encounterXp, resolveEncounter } from '../src/content/encounters';
import { membersOf, pregens, spells, characterData } from '../src/content/characters';
import { averageHitDie } from '../src/rules/character';
import type { FightTweaks } from '../src/rules/quests';
import { castOptions, castSpell, targetingOf, validTargets } from '../src/rules/spells';

/** The ready-made party at a level (average hit points per level). */
const partyAt = (level: number) =>
  membersOf(pregens.map((p) => ({ ...p, level, hpGains: Array.from({ length: level - 1 }, () => averageHitDie(characterData.classes[p.classId].hitDie)) })));

// Every encounter at level 1 and level 3 (scaled to the party: 6 characters → budget for 5), plus the drunk troll.
const runs: { id: string; level: number; tweaks?: FightTweaks; label?: string; difficulty?: 'low' | 'moderate' | 'high'; share?: number }[] = [
  ...Object.keys(encounters).flatMap((id) => [1, 3].map((level) => ({ id, level }))),
  { id: 'troll-bridge', level: 3, tweaks: { troll: { fumble: 0.75 } }, label: 'troll (ale)' },
  // random encounters at the zone difficulties a level-1 party meets (wandering.json)
  ...(['wild-rats', 'wild-bats', 'wild-spiders'] as const).flatMap((id) =>
    ([['low', 0.5], ['moderate', 0.75], ['high', 1]] as const).map(([difficulty, share]) => ({ id, level: 1, difficulty, share, label: `${id} ${difficulty}` })),
  ),
];

for (const r of runs) it(`balance: ${r.label ?? r.id} L${r.level}`, () => {
  const N = 300;
  const def = resolveEncounter(encounters[r.id], { partySize: 6, level: r.level, difficulty: r.difficulty, share: r.share });
  const members = partyAt(r.level);
  let wins = 0, dead = 0, down = 0, rounds = 0;
  for (let seed = 0; seed < N; seed++) {
    const rng = createRng(seed);
    const s = startCombat(rng, 12, 9, buildUnits(def, members, undefined, 0, r.tweaks));
    for (let t = 0; t < 400 && s.outcome === 'ongoing'; t++) {
      const u = activeUnit(s);
      const foes = s.units.filter((e) => e.side === 'enemy' && isUp(e)).sort((a, b) => chebyshev(u, a) - chebyshev(u, b));
      if (u.caster) botCast(s, rng, foes);
      // a bot that has already acted (cast a spell) stays where it is: walking up to a foe afterwards only gets it hurt
      const plan = foes.length && !s.actionUsed ? planMoveTo(s, foes[0].x, foes[0].y) : null;
      if (plan) for (const d of plan) step(s, rng, d);
      else if (foes.length && !s.actionUsed) {
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
    `${(r.label ?? r.id).padEnd(21)} L${r.level} XP ${String(encounterXp(def)).padStart(4)} · bot win ${((100 * wins) / N).toFixed(0)}% · ` +
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
  // Ranger: Hunter's Mark on the nearest foe (free casts first) when not already concentrating on it
  const mark = ready.find((o) => o.id === 'hunters-mark');
  if (mark && foes.length && (u.concentration?.spell !== 'hunters-mark' || mark.move)) {
    const valid = validTargets(s, spells, 'hunters-mark', mark.levels[0]);
    const quarry = foes.find((f) => valid.some((p) => p.x === f.x && p.y === f.y));
    if (quarry) castSpell(s, rng, spells, 'hunters-mark', mark.levels[0], [{ x: quarry.x, y: quarry.y }]);
  }
  // Paladin / Ranger: ready a smite before closing in (free cast first; slots kept for when one is free)
  for (const id of ['divine-smite', 'ensnaring-strike']) {
    const o = castOptions(s, spells).find((x) => x.id === id && !x.reason);
    if (o && !s.smite && (o.levels[0] === 0 || id === 'divine-smite')) castSpell(s, rng, spells, id, o.levels[0], [{ x: u.x, y: u.y }]);
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
