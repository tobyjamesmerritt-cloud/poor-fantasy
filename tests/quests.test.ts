import { describe, expect, it } from 'vitest';
import { pregens } from '../src/content/characters';
import { checkRoller, questContext, questData } from '../src/content/quests';
import { createRng } from '../src/engine/rng';
import { newGameState, type GameState } from '../src/engine/state';
import {
  check,
  choose,
  type ChoiceResult,
  hooksAt,
  canWalkAway,
  nodeOf,
  openTalk,
  questStage,
  questSteps,
  type Request,
  run,
  runTriggers,
  siteBlocks,
  siteIcon,
  startTalk,
  type Talk,
  visibleChoices,
} from '../src/rules/quests';
import { scripted } from './helpers';

const ctx = (rng = createRng(1)) => questContext(rng);
const fresh = (): GameState => ({ ...newGameState(1), roster: pregens.map((p) => ({ ...p })) });

/** Pick the visible choice whose text contains `text`. */
function pick(g: GameState, t: Talk, text: string, rng = createRng(1), roller?: { name: string; bonus: number }): ChoiceResult {
  const c = visibleChoices(g, questData, t).find((x) => x.text.includes(text));
  if (!c) throw new Error(`no choice "${text}" in ${t.dialog}/${t.node}: ${visibleChoices(g, questData, t).map((x) => x.text)}`);
  return choose(g, t, c.index, ctx(rng), roller);
}

/** Open a conversation (running its first node). */
const talk = (g: GameState, id: string): Talk => openTalk(g, id, ctx())!.talk;

/** Pretend the fight a request asked for was won. */
function win(g: GameState, reqs: Request[]) {
  const f = reqs.find((r) => r.kind === 'fight');
  if (!f || f.kind !== 'fight') throw new Error('no fight requested');
  return run(g, f.onWin, ctx());
}

describe('quest engine', () => {
  it('evaluates conditions', () => {
    const g = fresh();
    g.flags.a = true;
    g.flags['quest:rats'] = 'accepted';
    g.inventory['consumable:ale'] = 2;
    expect(check(g, { flag: 'a' })).toBe(true);
    expect(check(g, { not: { flag: 'b' } })).toBe(true);
    expect(check(g, { quest: 'rats', stage: ['accepted', 'cleared'] })).toBe(true);
    expect(check(g, { quest: 'ale', stage: 'none' })).toBe(true);
    expect(check(g, { item: 'consumable:ale', count: 3 })).toBe(false);
    expect(check(g, { all: [{ flag: 'a' }, { any: [{ flag: 'x' }, { coins: 0 }] }] })).toBe(true);
  });

  it('runs actions and hands screen work back as requests', () => {
    const g = fresh();
    g.coins = 10;
    const r = run(g, [{ quest: 'rats', stage: 'accepted' }, { coins: 500 }, { fight: 'shrine-nave', difficulty: 'high' }, { buy: 'consumable:ale', price: 4 }], ctx());
    expect(questStage(g, 'rats')).toBe('accepted');
    expect(g.coins).toBe(506);
    expect(g.inventory['consumable:ale']).toBe(1);
    expect(r.log[0]).toMatch(/New quest: The Rats of Millbrook/);
    expect(r.requests).toEqual([{ kind: 'fight', encounter: 'shrine-nave', difficulty: 'high', onWin: [], onLose: [], onFlee: [] }]);
    g.coins = 1;
    expect(run(g, [{ buy: 'consumable:ale', price: 4 }, { set: 'never' }], ctx()).stop).toBe(true);
    expect(g.flags.never).toBeUndefined();
  });

  it('a skill check uses the chosen character and branches on DC', () => {
    const g = fresh();
    g.flags['found:shack'] = true; // knowing the shack is enough
    const t = startTalk(g, questData, 'troll')!;
    const pass = pick(g, t, 'old shack', scripted([12]), { name: 'Ysolde', bonus: 3 });
    expect(pass.roll).toMatchObject({ total: 15, dc: 15, success: true });
    expect(pass.next?.node).toBe('persuaded');
    const g2 = fresh();
    g2.flags['found:shack'] = true;
    const fail = pick(g2, startTalk(g2, questData, 'troll')!, 'old shack', scripted([11]), { name: 'Ysolde', bonus: 3 });
    expect(fail.next?.node).toBe('refused');
    // one try only
    expect(visibleChoices(g2, questData, startTalk(g2, questData, 'troll')!).some((c) => c.text.includes('old shack'))).toBe(false);
  });

  it('check bonus: ability modifier, plus proficiency if the background gives the skill', () => {
    const ysolde = pregens.find((p) => p.name === 'Ysolde')!;
    const r = checkRoller(ysolde, 'cha', 'Persuasion');
    expect(r.bonus).toBe(Math.floor((ysolde.scores.cha + (ysolde.increases.cha ?? 0) - 10) / 2) + (r.proficient ? 2 : 0));
  });
});

describe('the troll and the shack', () => {
  it('a persuaded troll that moves in before the shack is searched hands over the brewing gear', () => {
    const g = fresh();
    Object.assign(g.flags, { 'quest:ale': 'find-parts', 'found:shack': true, 'troll:moved': true });
    const t = startTalk(g, questData, 'shack')!;
    expect(nodeOf(questData, t).speaker).toBe('The troll');
    expect(visibleChoices(g, questData, t).some((c) => c.text.includes('brewing gear'))).toBe(true);
    const i = nodeOf(questData, t).choices!.findIndex((c) => c.text.includes('brewing gear'));
    expect(i).toBeGreaterThanOrEqual(0);
    choose(g, t, i, ctx(), undefined);
    expect(g.flags['quest:ale']).toBe('return-parts');
    expect(g.inventory['misc:spigot-parts']).toBe(1);
  });
});

describe('the three quests (content walk-through)', () => {
  it('1. The Rats of Millbrook', () => {
    const g = fresh();
    // the shrine is shut before the quest
    const door = hooksAt(g, questData, 'millbrook/Shrine of the Dawn');
    expect(door).toHaveLength(1);
    expect(door[0].replaces).toBe(true);
    expect(talk(g, 'shrine-door').node).toBe('closed');
    // the reeve gives the quest
    pick(g, talk(g, 'reeve'), 'clear the shrine');
    expect(questStage(g, 'rats')).toBe('accepted');
    const open = pick(g, talk(g, 'shrine-door'), 'Go in');
    expect(open.requests).toEqual([{ kind: 'enter', location: 'shrine-of-the-dawn' }]);
    // both shrine fights won → the trigger moves the quest on
    g.flags['cleared:shrine-of-the-dawn:nave'] = true;
    expect(runTriggers(g, ctx()).log).toEqual([]);
    g.flags['cleared:shrine-of-the-dawn:crypt'] = true;
    expect(runTriggers(g, ctx()).log.join(' ')).toMatch(/Quest updated/);
    expect(runTriggers(g, ctx()).log).toEqual([]); // once only
    const coins = g.coins;
    expect(talk(g, 'reeve').node).toBe('reward'); // paid on arrival at the node
    expect(g.coins).toBe(coins + 2500);
    expect(questStage(g, 'rats')).toBe('done');
    // the temple works again
    expect(hooksAt(g, questData, 'millbrook/Shrine of the Dawn').some((h) => h.replaces)).toBe(false);
  });

  it('2. Dry Taps', () => {
    const g = fresh();
    expect(hooksAt(g, questData, 'millbrook/The Leaky Bucket').some((h) => h.dialog === 'innkeeper')).toBe(false); // after the rats
    g.flags['quest:rats'] = 'done';
    pick(g, talk(g, 'innkeeper'), 'find the brewery');
    expect(questStage(g, 'ale')).toBe('find-brewery');
    // the brewery: hidden until found
    expect(hooksAt(g, questData, 'site:brewery')).toHaveLength(1);
    const brew = talk(g, 'brewery');
    run(g, questData.dialogs.brewery.nodes[brew.node].do, ctx());
    expect(g.flags['found:brewery']).toBe(true);
    expect(questStage(g, 'ale')).toBe('find-parts');
    // the shack: fight, then the loot
    const go = pick(g, talk(g, 'shack'), 'Go in');
    expect(g.flags['found:shack']).toBe(true);
    const loot = win(g, go.requests);
    const refs = Object.keys(g.inventory);
    expect(refs.filter((r) => /^weapon:.+\+1$/.test(r)).reduce((n, r) => n + g.inventory[r], 0)).toBe(2);
    expect(refs.some((r) => r.startsWith('scroll:'))).toBe(true);
    expect(g.inventory['misc:spigot-parts']).toBe(1);
    expect(loot.log.join(' ')).toMatch(/Spell Scroll/);
    expect(questStage(g, 'ale')).toBe('return-parts');
    // back to Odo
    pick(g, talk(g, 'brewery'), 'Hand over');
    expect(g.inventory['misc:spigot-parts']).toBeUndefined();
    expect(g.flags['ale:flowing']).toBe(true);
    runTriggers(g, ctx());
    expect(g.inventory['consumable:ale']).toBe(1); // the free first round
    const inn = hooksAt(g, questData, 'millbrook/The Leaky Bucket').map((h) => h.label);
    expect(inn).toContain('Buy a mug of ale (4 cp)');
    expect(inn).toContain('Drink a mug of ale');
  });

  it('3. The Troll Toll: blocks the bridge until it is dealt with', () => {
    const g = fresh();
    expect(siteBlocks(g, questData, 'bridge')).toBe(true);
    expect(siteIcon(g, questData, 'bridge')).toBe('broken-bridge');
    const t = talk(g, 'troll');
    expect(questStage(g, 'troll')).toBe('met');
    // without the ale quest or ale: only fight or back away
    expect(visibleChoices(g, questData, t).map((c) => c.text)).toEqual(['Fight!', 'Back away slowly.']);
    // with ale: the troll gets drunk and fumbles 75% of its attacks
    g.inventory['consumable:ale'] = 1;
    const drunk = pick(g, t, 'mug of ale');
    expect(drunk.next?.node).toBe('drunk');
    const fight = pick(g, drunk.next!, 'tipsy').requests[0];
    expect(fight).toMatchObject({ kind: 'fight', encounter: 'troll-bridge', tweaks: { troll: { fumble: 0.75 } } });
    win(g, [fight]);
    expect(questStage(g, 'troll')).toBe('done');
    expect(siteBlocks(g, questData, 'bridge')).toBe(false);
    expect(siteIcon(g, questData, 'bridge')).toBeNull();
    expect(siteIcon(g, questData, 'troll')).toBeNull();
  });
});

describe('Mother Ilse tends the fallen (once, after the shrine)', () => {
  it('raises the dead and wakes the unconscious with 1 HP', () => {
    const g = fresh();
    g.party = pregens.map((p) => ({ id: p.id, hp: 5, hitDice: 1, dead: false, wakesAt: null }));
    g.flags['quest:rats'] = 'cleared';
    g.party[0].dead = true;
    g.party[0].hp = 0;
    g.party[1].hp = 0;
    g.party[1].wakesAt = 500;
    const t = talk(g, 'shrine-door');
    expect(t.node).toBe('tend');
    expect(g.party[0]).toMatchObject({ dead: false, hp: 1 });
    expect(g.party[1]).toMatchObject({ hp: 1, wakesAt: null });
    expect(g.party[2].hp).toBe(5);
    // only once
    g.party[2].hp = 0;
    expect(talk(g, 'shrine-door').node).toBe('cleared');
    expect(g.party[2].hp).toBe(0);
  });

  it('is offered after the reeve has paid, too — but not when nobody fell', () => {
    const g = fresh();
    g.party = pregens.map((p) => ({ id: p.id, hp: 5, hitDice: 1, dead: false, wakesAt: null }));
    g.flags['quest:rats'] = 'done';
    expect(hooksAt(g, questData, 'millbrook/Shrine of the Dawn').some((h) => h.dialog === 'shrine-door')).toBe(false);
    g.party[3].dead = true;
    expect(hooksAt(g, questData, 'millbrook/Shrine of the Dawn').some((h) => h.dialog === 'shrine-door')).toBe(true);
  });
});

describe('quest journal', () => {
  it('lists steps up to the current stage, earlier ones ticked, and the next tip', () => {
    const g = fresh();
    g.flags['quest:ale'] = 'return-parts';
    const r = questSteps(g, questData.quests.ale, 'ale');
    expect(r.steps.map((s) => s.done)).toEqual([true, true, false]);
    expect(r.next).toMatch(/Odo/);
    g.flags['quest:ale'] = 'done';
    const d = questSteps(g, questData.quests.ale, 'ale');
    expect(d.steps.every((s) => s.done)).toBe(true);
    expect(d.next).toBeUndefined();
  });
});

describe('walking away from a conversation (Esc)', () => {
  it('a random encounter must be answered; a conversation with a plain exit can be left', () => {
    const g = fresh();
    const rats = startTalk(g, questData, 'wander-rats')!;
    expect(canWalkAway(g, questData, rats)).toBe(false);
    g.flags['quest:troll'] = 'met';
    const troll = startTalk(g, questData, 'troll')!;
    expect(canWalkAway(g, questData, troll)).toBe(true);
  });
});
