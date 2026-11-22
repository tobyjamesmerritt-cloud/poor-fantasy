/**
 * Quest engine. Pure TypeScript: quests, dialogs, hooks and triggers are
 * data (src/content/quests.json); this module evaluates conditions, runs
 * actions against the game state and walks dialogs. Anything that needs the
 * screen (a dialog, a fight, entering a place) comes back as a Request for
 * main.ts to carry out.
 *
 * Quest progress lives in `GameState.flags`: `quest:<id>` = current stage
 * ("done" when finished), `found:<site>` for discovered world sites, plus any
 * flags the quest data sets itself. Nothing about a particular quest is
 * hard-coded here.
 */
import type { Rng } from '../engine/rng';
import type { Ability, GameState } from '../engine/state';
import { isNight } from './time';

// ---------------------------------------------------------------------------
// Data shapes (quests.json)
// ---------------------------------------------------------------------------

export type FlagValue = boolean | number | string;

export type Condition =
  | { flag: string; is?: FlagValue }
  | { quest: string; stage: string | string[] } // stage "none" = not started
  | { item: string; count?: number }
  | { cleared: string } // "<location>:<spot>" fight won
  | { coins: number } // at least this much copper
  | { night: boolean } // dusk to dawn (rules/time.ts isNight); dawn counts as day
  | { partyFallen: boolean } // someone in the party is dead or unconscious (or nobody is)
  | { not: Condition }
  | { all: Condition[] }
  | { any: Condition[] };

export type Difficulty = 'low' | 'moderate' | 'high';

/** Changes to monsters in one fight, by monster id. fumble: chance (0–1) each of its attacks simply misses. */
export type FightTweaks = Record<string, { fumble?: number }>;

export type Action =
  | { say: string }
  | { set: string; to?: FlagValue }
  | { unset: string }
  | { quest: string; stage: string } // also writes the journal entry
  | { give: string; count?: number } // item ref, or "random:<kind>" (see rules/items.ts rollLoot)
  | { take: string; count?: number; quiet?: boolean }
  | { coins: number } // + gain, − pay
  | { buy: string; price: number } // pay `price` copper for one item (fails with a message if short)
  | { reveal: string } // a hidden world site becomes visible
  | { dialog: string }
  | { fight: string; difficulty?: Difficulty; tweaks?: FightTweaks; onWin?: Action[]; onLose?: Action[]; onFlee?: Action[] }
  | { enter: string } // go into a location (e.g. a building's interior)
  | { time: number } // minutes pass
  | { revive: 'fallen' }; // every dead or unconscious party member is back on their feet with 1 HP (a quest reward)

export interface SkillCheck {
  ability: Ability;
  skill?: string; // proficient if a character's background gives this skill
  dc: number;
  pass: string; // node to go to
  fail: string;
}

export interface Choice {
  text: string;
  when?: Condition;
  do?: Action[];
  next?: string; // node id; absent = the conversation ends
  check?: SkillCheck; // the player picks who tries
}

export interface DialogNode {
  speaker?: string;
  picture?: string | null; // overrides the dialog's picture; null = none on this node
  pictureWhen?: { when: Condition; picture: string }[]; // first match replaces `picture` (e.g. shack by day / night)
  text: string;
  do?: Action[]; // run on arriving at this node
  choices?: Choice[]; // none = a single "Farewell"
}

export interface DialogDef {
  /** NPC / encounter picture id (DND-63/69): an image in the git-ignored local/pictures/ folder; hidden when absent. */
  picture?: string;
  pictureWhen?: { when: Condition; picture: string }[]; // first match replaces `picture` (e.g. bandits by day / night)
  /** Sprite id (assets.json): the large portrait when there is no local picture (monster encounters, DND-89). */
  sprite?: string;
  /** Encounter layout (DND-89): the party's HP strip under the portrait, so you see who is hurt before choosing. */
  showParty?: boolean;
  entry: { when?: Condition; node: string }[]; // first match starts the conversation
  nodes: Record<string, DialogNode>;
}

/**
 * Where quest content attaches. `at`: "<location>/<building spot name>" or
 * "site:<site id>" (a world-map site). Building hooks appear as buttons in the
 * building's panel (`label`); `replaces` hides the building's own services
 * while the hook applies. Site hooks fire when the party steps on (or bumps
 * into) the site.
 */
export interface Hook {
  at: string;
  when?: Condition;
  label?: string;
  dialog?: string;
  do?: Action[];
  replaces?: boolean;
}

/** World-map sites: position and icon come from the Tiled map; behaviour from here. */
export interface SiteDef {
  blocks?: Condition; // while true the party can't step onto it (the hook fires instead)
  icon?: string; // sprite id (assets.json) while visible
  iconWhen?: { when: Condition; icon: string | null }[]; // icon changes (null = none)
  /** Arriving shows the place panel first (picture + Enter / Leave); Enter runs the site's hook. Without it the hook fires at once. */
  panel?: { picture?: string; enter?: string };
}

/** Fires once when its condition becomes true (checked after fights and moves). */
export interface Trigger {
  id: string;
  when: Condition;
  do: Action[];
}

export interface QuestDef {
  name: string;
  summary: string; // one line for the journal list
  level: string; // recommended level, shown in the journal
  difficulty: 'easy' | 'medium' | 'hard';
  stages: Record<string, string>; // stage id → journal text, in order
  tips?: Record<string, string>; // stage id → the short next step (the journal's checklist)
}

/** A quest's checklist for the journal: every step up to the current stage (earlier ones done) and what to do now. */
export function questSteps(g: GameState, q: QuestDef, id: string): { steps: { text: string; done: boolean }[]; now: string; next?: string } {
  const stage = questStage(g, id);
  const order = Object.keys(q.stages);
  const at = order.indexOf(stage);
  const steps = order
    .slice(0, at + 1)
    .filter((s) => q.tips?.[s])
    .map((s) => ({ text: q.tips![s], done: s !== stage }));
  return { steps, now: q.stages[stage] ?? '', next: q.tips?.[stage] };
}

export interface QuestData {
  quests: Record<string, QuestDef>;
  dialogs: Record<string, DialogDef>;
  hooks: Hook[];
  sites: Record<string, SiteDef>;
  triggers: Trigger[];
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const questStage = (g: GameState, id: string): string => {
  const v = g.flags[`quest:${id}`];
  return typeof v === 'string' ? v : 'none';
};

export function check(g: GameState, c: Condition | undefined): boolean {
  if (!c) return true;
  if ('all' in c) return c.all.every((x) => check(g, x));
  if ('any' in c) return c.any.some((x) => check(g, x));
  if ('not' in c) return !check(g, c.not);
  if ('quest' in c) {
    const stages = Array.isArray(c.stage) ? c.stage : [c.stage];
    return stages.includes(questStage(g, c.quest));
  }
  if ('item' in c) return (g.inventory[c.item] ?? 0) >= (c.count ?? 1);
  if ('cleared' in c) return g.flags[`cleared:${c.cleared}`] === true;
  if ('coins' in c) return g.coins >= c.coins;
  if ('night' in c) return isNight(g.time) === c.night;
  if ('partyFallen' in c) return g.party.some((p) => p.dead || p.hp <= 0) === c.partyFallen;
  const v = g.flags[c.flag];
  return c.is === undefined ? !!v : v === c.is;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Things only main.ts can do: show a dialog, start a fight, move to another place. */
export type Request =
  | { kind: 'dialog'; id: string }
  | { kind: 'fight'; encounter: string; difficulty?: Difficulty; tweaks?: FightTweaks; onWin: Action[]; onLose: Action[]; onFlee: Action[] }
  | { kind: 'enter'; location: string };

export interface ActionContext {
  rng: Rng;
  data: QuestData;
  /** Turns "random:<kind>" into a concrete item ref; display name for log lines. */
  loot: (kind: string, rng: Rng) => string;
  /** "random:table:<id>" — a whole loot table (coins and items). */
  lootTable?: (id: string, rng: Rng) => { coins: number; items: Record<string, number> };
  itemName: (ref: string) => string;
}

export interface ActionResult {
  log: string[];
  requests: Request[];
  stop?: boolean; // an action failed (e.g. couldn't pay): the rest were skipped
}

const addItem = (g: GameState, ref: string, n: number) => {
  const v = (g.inventory[ref] ?? 0) + n;
  if (v > 0) g.inventory[ref] = v;
  else delete g.inventory[ref];
};

export function formatCp(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const c = cp % 10;
  return [gp && `${gp} gp`, sp && `${sp} sp`, c && `${c} cp`].filter(Boolean).join(' ') || '0 cp';
}

export function run(g: GameState, actions: readonly Action[] | undefined, ctx: ActionContext): ActionResult {
  const out: ActionResult = { log: [], requests: [] };
  for (const a of actions ?? []) {
    if ('say' in a) out.log.push(a.say);
    else if ('set' in a) g.flags[a.set] = a.to ?? true;
    else if ('unset' in a) delete g.flags[a.unset];
    else if ('quest' in a) {
      const q = ctx.data.quests[a.quest];
      const was = questStage(g, a.quest);
      g.flags[`quest:${a.quest}`] = a.stage;
      if (q && was !== a.stage) {
        const head = a.stage === 'done' ? 'Quest complete' : was === 'none' ? 'New quest' : 'Quest updated';
        out.log.push(`📜 ${head}: ${q.name} — ${q.stages[a.stage] ?? ''}`.trimEnd());
      }
    } else if ('give' in a) {
      for (let i = 0; i < (a.count ?? 1); i++) {
        if (a.give.startsWith('random:table:') && ctx.lootTable) {
          // a whole loot table (DND-74): coins and items
          const haul = ctx.lootTable(a.give.slice(13), ctx.rng);
          g.coins += haul.coins;
          if (haul.coins) out.log.push(`You get ${formatCp(haul.coins)}.`);
          for (const [ref, n] of Object.entries(haul.items)) {
            addItem(g, ref, n);
            out.log.push(`You get: ${n > 1 ? `${n} × ` : ''}${ctx.itemName(ref)}.`);
          }
          continue;
        }
        const ref = a.give.startsWith('random:') ? ctx.loot(a.give.slice(7), ctx.rng) : a.give;
        addItem(g, ref, 1);
        out.log.push(`You get: ${ctx.itemName(ref)}.`);
      }
    } else if ('take' in a) {
      addItem(g, a.take, -(a.count ?? 1));
      if (!a.quiet) out.log.push(`You hand over: ${ctx.itemName(a.take)}.`);
    } else if ('coins' in a) {
      g.coins = Math.max(0, g.coins + a.coins);
      out.log.push(a.coins >= 0 ? `You receive ${formatCp(a.coins)}.` : `You pay ${formatCp(-a.coins)}.`);
    } else if ('buy' in a) {
      if (g.coins < a.price) {
        out.log.push(`You can't afford that (${formatCp(a.price)}).`);
        out.stop = true;
        return out;
      }
      g.coins -= a.price;
      addItem(g, a.buy, 1);
      out.log.push(`You buy ${ctx.itemName(a.buy)} for ${formatCp(a.price)}.`);
    } else if ('reveal' in a) g.flags[`found:${a.reveal}`] = true;
    else if ('dialog' in a) out.requests.push({ kind: 'dialog', id: a.dialog });
    else if ('fight' in a) {
      out.requests.push({
        kind: 'fight',
        encounter: a.fight,
        difficulty: a.difficulty,
        tweaks: a.tweaks,
        onWin: a.onWin ?? [],
        onLose: a.onLose ?? [],
        onFlee: a.onFlee ?? [],
      });
    } else if ('enter' in a) out.requests.push({ kind: 'enter', location: a.enter });
    else if ('time' in a) g.time += a.time;
    else if ('revive' in a) {
      const names: string[] = [];
      for (const p of g.party) {
        if (!p.dead && p.hp > 0) continue;
        names.push(g.roster.find((r) => r.id === p.id)?.name ?? p.id);
        Object.assign(p, { dead: false, hp: 1, wakesAt: null });
      }
      if (names.length) out.log.push(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} back on their feet (1 HP).`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hooks, sites, triggers
// ---------------------------------------------------------------------------

/** Hooks that apply at a place right now (building "<loc>/<spot>" or "site:<id>"). */
export const hooksAt = (g: GameState, data: QuestData, at: string): Hook[] => data.hooks.filter((h) => h.at === at && check(g, h.when));

/** Is the world site visible: not hidden in the map, or found. */
export const siteVisible = (g: GameState, siteId: string, hidden: boolean): boolean => !hidden || g.flags[`found:${siteId}`] === true;

export const siteBlocks = (g: GameState, data: QuestData, siteId: string): boolean => check(g, data.sites[siteId]?.blocks) && !!data.sites[siteId]?.blocks;

/** The sprite to draw for a site now (null = none). */
export function siteIcon(g: GameState, data: QuestData, siteId: string): string | null {
  const s = data.sites[siteId];
  if (!s) return null;
  for (const w of s.iconWhen ?? []) if (check(g, w.when)) return w.icon;
  return s.icon ?? null;
}

/** Run every trigger whose condition is now true and that hasn't fired yet. */
export function runTriggers(g: GameState, ctx: ActionContext): ActionResult {
  const out: ActionResult = { log: [], requests: [] };
  for (let pass = 0; pass < 5; pass++) {
    let fired = false;
    for (const t of ctx.data.triggers) {
      const key = `fired:${t.id}`;
      if (g.flags[key] || !check(g, t.when)) continue;
      g.flags[key] = true;
      fired = true;
      const r = run(g, t.do, ctx);
      out.log.push(...r.log);
      out.requests.push(...r.requests);
    }
    if (!fired) break; // a trigger may make another one true
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export interface Talk {
  dialog: string;
  node: string;
}

export interface ShownChoice {
  index: number; // index into the node's choices (for the command)
  text: string;
  check?: SkillCheck;
}

/** The node a dialog opens with, or null if no entry applies. */
export function startTalk(g: GameState, data: QuestData, dialogId: string): Talk | null {
  const d = data.dialogs[dialogId];
  const e = d?.entry.find((x) => check(g, x.when));
  return e ? { dialog: dialogId, node: e.node } : null;
}

/** Start a conversation: the entry node, with its actions run. */
export function openTalk(g: GameState, dialogId: string, ctx: ActionContext): (ActionResult & { talk: Talk }) | null {
  const talk = startTalk(g, ctx.data, dialogId);
  if (!talk) return null;
  return { talk, ...enterNode(g, talk, ctx) };
}

export function nodeOf(data: QuestData, t: Talk): DialogNode {
  return data.dialogs[t.dialog].nodes[t.node];
}

export const visibleChoices = (g: GameState, data: QuestData, t: Talk): ShownChoice[] =>
  (nodeOf(data, t).choices ?? []).flatMap((c, index) => (check(g, c.when) ? [{ index, text: c.text, check: c.check }] : []));

/**
 * Can the party simply walk away (Esc) from this point of the conversation? Yes when the
 * node offers no choices, or one of its visible choices is a plain exit (no actions, no
 * check, no next node). A forced moment — fight or try to slip away — must be answered.
 */
export function canWalkAway(g: GameState, data: QuestData, t: Talk): boolean {
  const choices = (nodeOf(data, t).choices ?? []).filter((c) => check(g, c.when));
  return choices.length === 0 || choices.some((c) => !c.do?.length && !c.check && !c.next);
}

/** Arrive at a node: run its actions. */
export function enterNode(g: GameState, t: Talk, ctx: ActionContext): ActionResult {
  return run(g, nodeOf(ctx.data, t).do, ctx);
}

/** A character's bonus for a check: ability modifier, + Proficiency Bonus with the skill. */
export interface CheckRoller {
  name: string;
  bonus: number;
}

export interface ChoiceResult extends ActionResult {
  next: Talk | null; // null = conversation over
  roll?: { who: string; d20: number; total: number; dc: number; success: boolean };
}

/** Pick a choice (by its index in the node). Skill checks need the character who tries. */
export function choose(g: GameState, t: Talk, index: number, ctx: ActionContext, roller?: CheckRoller): ChoiceResult {
  const node = nodeOf(ctx.data, t);
  const c = node.choices?.[index];
  if (!c || !check(g, c.when)) return { log: [], requests: [], next: t }; // stale click: stay
  const r = run(g, c.do, ctx);
  let target = c.next;
  let roll: ChoiceResult['roll'];
  if (c.check) {
    if (!roller) return { log: [], requests: [], next: t };
    const d20 = ctx.rng.int(1, 20);
    const total = d20 + roller.bonus;
    const success = total >= c.check.dc;
    roll = { who: roller.name, d20, total, dc: c.check.dc, success };
    const sign = roller.bonus >= 0 ? '+' : '−';
    r.log.push(`🎲 ${roller.name}: ${d20} ${sign} ${Math.abs(roller.bonus)} = ${total} vs DC ${c.check.dc} — ${success ? 'success!' : 'failure.'}`);
    target = success ? c.check.pass : c.check.fail;
  }
  if (r.stop || !target) return { ...r, next: r.stop ? t : null, roll };
  const next = { dialog: t.dialog, node: target };
  const arrived = enterNode(g, next, ctx);
  return { log: [...r.log, ...arrived.log], requests: [...r.requests, ...arrived.requests], next, roll };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Problems in quest data (references to dialogs, nodes, quests, stages, encounters, items). */
export function validateQuests(data: QuestData, known: { encounters: string[]; locations: string[]; isItem: (ref: string) => boolean }): string[] {
  const errors: string[] = [];
  for (const [id, q] of Object.entries(data.quests)) {
    if (!q.summary) errors.push(`quest "${id}": needs a one-line summary`);
    for (const s of Object.keys(q.tips ?? {})) if (!q.stages[s]) errors.push(`quest "${id}": tip for unknown stage "${s}"`);
  }
  const checkCond = (c: Condition | undefined, where: string) => {
    if (!c) return;
    if ('all' in c) return c.all.forEach((x) => checkCond(x, where));
    if ('any' in c) return c.any.forEach((x) => checkCond(x, where));
    if ('not' in c) return checkCond(c.not, where);
    if ('quest' in c) {
      const q = data.quests[c.quest];
      if (!q) errors.push(`${where}: unknown quest "${c.quest}"`);
      else for (const s of Array.isArray(c.stage) ? c.stage : [c.stage]) if (s !== 'none' && !q.stages[s]) errors.push(`${where}: quest "${c.quest}" has no stage "${s}"`);
    }
    if ('item' in c && !known.isItem(c.item)) errors.push(`${where}: unknown item "${c.item}"`);
  };
  const checkActions = (as: Action[] | undefined, where: string) => {
    for (const a of as ?? []) {
      if ('quest' in a) {
        const q = data.quests[a.quest];
        if (!q) errors.push(`${where}: unknown quest "${a.quest}"`);
        else if (!q.stages[a.stage]) errors.push(`${where}: quest "${a.quest}" has no stage "${a.stage}"`);
      }
      if ('dialog' in a && !data.dialogs[a.dialog]) errors.push(`${where}: unknown dialog "${a.dialog}"`);
      if ('fight' in a) {
        if (!known.encounters.includes(a.fight)) errors.push(`${where}: unknown encounter "${a.fight}"`);
        checkActions(a.onWin, where);
        checkActions(a.onLose, where);
        checkActions(a.onFlee, where);
      }
      if ('enter' in a && !known.locations.includes(a.enter)) errors.push(`${where}: unknown location "${a.enter}"`);
      for (const ref of ['give' in a ? a.give : '', 'take' in a ? a.take : '', 'buy' in a ? a.buy : '']) {
        if (ref && !ref.startsWith('random:') && !known.isItem(ref)) errors.push(`${where}: unknown item "${ref}"`);
      }
    }
  };
  for (const [id, q] of Object.entries(data.quests)) if (!q.stages.done) errors.push(`quest "${id}": needs a "done" stage`);
  for (const [id, d] of Object.entries(data.dialogs)) {
    if (!d.entry.length) errors.push(`dialog "${id}": no entry`);
    for (const e of d.entry) {
      checkCond(e.when, `dialog "${id}" entry`);
      if (!d.nodes[e.node]) errors.push(`dialog "${id}": entry goes to unknown node "${e.node}"`);
    for (const pic of [d.picture, ...(d.pictureWhen ?? []).map((w) => w.picture), ...Object.values(d.nodes).flatMap((n) => [n.picture, ...(n.pictureWhen ?? []).map((w) => w.picture)])])
      if (typeof pic === 'string' && !/^[a-z0-9-]+$/.test(pic)) errors.push(`dialog "${id}": picture id "${pic}" must be lower-case letters, digits and dashes`);
    }
    for (const [nid, n] of Object.entries(d.nodes)) {
      const where = `dialog "${id}" node "${nid}"`;
      checkActions(n.do, where);
      for (const c of n.choices ?? []) {
        checkCond(c.when, where);
        checkActions(c.do, where);
        for (const to of [c.next, c.check?.pass, c.check?.fail]) if (to && !d.nodes[to]) errors.push(`${where}: choice goes to unknown node "${to}"`);
      }
    }
  }
  data.hooks.forEach((h, i) => {
    const where = `hook ${i} (${h.at})`;
    checkCond(h.when, where);
    checkActions(h.do, where);
    if (h.dialog && !data.dialogs[h.dialog]) errors.push(`${where}: unknown dialog "${h.dialog}"`);
    if (!h.dialog && !h.do) errors.push(`${where}: needs a dialog or actions`);
  });
  for (const [id, s] of Object.entries(data.sites)) {
    checkCond(s.blocks, `site "${id}"`);
    for (const w of s.iconWhen ?? []) checkCond(w.when, `site "${id}"`);
  }
  for (const t of data.triggers) {
    checkCond(t.when, `trigger "${t.id}"`);
    checkActions(t.do, `trigger "${t.id}"`);
  }
  return errors;
}

/** The picture for a dialog node: the node's own (a matching `pictureWhen`, else `picture`), else the dialog's (same rule). */
export function nodePicture(g: GameState, node: DialogNode, dialog?: Pick<DialogDef, 'picture' | 'pictureWhen'>): string | undefined {
  const hit = node.pictureWhen?.find((w) => check(g, w.when));
  if (hit) return hit.picture;
  if (node.picture === null) return undefined;
  if (node.picture !== undefined) return node.picture;
  return dialog?.pictureWhen?.find((w) => check(g, w.when))?.picture ?? dialog?.picture;
}
