import * as Phaser from 'phaser';
import { type CampSiteRef, CommandBus } from './engine/commands';
import { createRng, randomSeed } from './engine/rng';
import { type CharacterSheet, type GameState, newGameState } from './engine/state';
import { forget, makeSave, parseSave, remember, type SaveEnvelope } from './engine/save';
import { confirmDialog } from './ui/confirmDialog';
import { SaveDialog } from './ui/saveDialog';
import { SaveStore, SLOTS, type SlotId } from './ui/saveStore';
import { formatClock } from './rules/time';
import { CampScene } from './game/scenes/CampScene';
import { CombatScene, TILE } from './game/scenes/CombatScene';
import { LOCATION_VIEW, LocationScene } from './game/scenes/LocationScene';
import { WorldScene } from './game/scenes/WorldScene';
import { Hud } from './ui/hud';
import { initMenu } from './ui/menu';
import { PrefsStore } from './ui/prefs';
import { BOARD, DEFAULT_ENCOUNTER, encounters, locationContent, resolveEncounter } from './content/encounters';
import { characterData, checkSheet, derive, membersForFight, pregens, startingCoins, statsOf } from './content/characters';
import { roll4d6DropLowest, startingCopper } from './rules/character';
import { PartyScreen } from './ui/partyScreen';
import { ShopScreen } from './ui/shopScreen';
import { buy, equip, itemInfo, sell, unequip, useItem } from './rules/items';
import { loadSheetSizes, spriteCssFromSizes } from './game/spriteCss';
import type { CombatState } from './rules/combat';
import { afterCombat, afterDefeat, combatMinutes, formatCoins, freshParty, isConscious } from './rules/party';
import { awardXp, takeTreasure } from './rules/rewards';
import { canLevelUp, levelUp } from './rules/levelling';
import { describeTreasure, treasure } from './content/treasure';
import { addCharacter, benchMember, deleteCharacter, joinParty, restoreAll, useReadyMade } from './rules/roster';
import { SpellsDialog } from './ui/spellsDialog';
import { PackDialog } from './ui/packDialog';
import { PartyDialog } from './ui/partyDialog';
import { castOutside } from './rules/spells';
import { spendHitDice } from './rules/rest';
import { TalkDialog, type TalkView } from './ui/talkDialog';
import { JournalDialog } from './ui/journalDialog';
import { checkRoller, questContext, questData } from './content/quests';
import { ABILITY_NAMES } from './rules/character';
import {
  type Action,
  type ActionResult,
  canWalkAway,
  choose,
  type Difficulty,
  type FightTweaks,
  hooksAt,
  nodeOf,
  openTalk,
  type Request,
  run,
  runTriggers,
  type Talk,
  visibleChoices,
} from './rules/quests';
import './ui/style.css';

// ?seed=123 in the URL jumps straight into the test fight with those dice — paste it into bug reports.
const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? Number(params.get('seed')) : randomSeed();
let pinnedSeed: number | null = null; // debug console "seed N": the next fight uses these dice
const nextSeed = (): number => {
  const s = pinnedSeed ?? randomSeed();
  pinnedSeed = null;
  return s;
};
let encounter = params.get('encounter') ?? DEFAULT_ENCOUNTER; // ?encounter=ruins-crawlers for testing
let origin: string | undefined; // what the current fight belongs to (location:spot), for the cleared flag
type SceneKey = 'world' | 'combat' | 'location' | 'camp' | 'party' | 'shop';
type ReturnScene = 'world' | 'location' | 'camp';
let returnTo: ReturnScene = 'world'; // where "Continue" goes after a fight
let campReturn: 'world' | 'location' = 'world'; // where "Break camp" goes
let campSite: CampSiteRef | null = null;
let locationId = params.get('location') ?? ''; // ?location=millbrook jumps straight into a location
// Debug URLs (?seed, ?encounter, ?location) use the ready-made party and never touch your saves.
const debugStart = params.has('seed') || params.has('encounter') || !!locationId;
let notices: string[] = []; // shown by the next exploring scene (fight results, rescues)
let defeat: ReturnType<typeof afterDefeat> | null = null; // set when the party fell, handled on Continue

const bus = new CommandBus();
const hud = new Hud(bus);
const prefs = new PrefsStore();
const gameState = newGameState(seed);
let newGameMode = true; // party screen: building a new party (full editing) vs. managing during play
let partyReturn: ReturnScene = 'world';
let shopReturn: ReturnScene = 'location';
let shopName = 'Shop';
let exploreRng = createRng(gameState.seed ^ 0x5eed); // rests, ambushes, ability rolls (combat has its own seeded Rng); saved with the game
initMenu(prefs);

const freshOf = (sheet: CharacterSheet) => freshParty(statsOf([sheet]))[0];

// ---------------------------------------------------------------------------
// Saving: character library (all characters, across games) + game saves
// ---------------------------------------------------------------------------
const store = new SaveStore();
const library = store.loadLibrary();
let idCounter = 0;
/** Character ids unique across games and save files (not game logic, so no Rng). */
const newId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** Keep every character the player has made, whatever game they are in. */
function persistLibrary(): void {
  if (debugStart) return;
  remember(library, [...gameState.roster, ...gameState.bench.map((b) => b.sheet)]);
  store.saveLibrary(library);
}

/** Library characters not in this game yet join its pool (fresh). */
function poolFromLibrary(): void {
  const have = new Set([...gameState.roster.map((s) => s.id), ...gameState.bench.map((b) => b.sheet.id)]);
  for (const s of library.sheets) {
    if (!have.has(s.id) && !checkSheet(s).length) gameState.bench.push({ sheet: structuredClone(s), state: null });
  }
}

const placeName = (id: string) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function saveLabel(st: GameState): string {
  const where = st.location ? placeName(st.location.id) : 'World map';
  const who = st.partyName ?? st.roster.map((r) => r.name).join(', ');
  return `${where} · ${formatClock(st.time)} · ${who}`;
}

/** Why the game can't be saved right now (null = it can). */
function saveBlocked(): string | null {
  if (document.body.dataset.mode === 'combat') return 'You can’t save in the middle of a fight.';
  if (newGameMode || !gameState.roster.length) return 'Begin the adventure first — then you can save.';
  return null;
}

function snapshot(): SaveEnvelope {
  return makeSave(gameState, exploreRng.state, new Date().toISOString(), saveLabel(gameState));
}

function autosave(): void {
  if (debugStart || saveBlocked()) return;
  store.write('auto', snapshot());
}

/** Replace the running game with a saved one and go where the party was. */
function loadGame(env: SaveEnvelope, how: string): string | null {
  const bad = [...env.state.roster, ...env.state.bench.map((b) => b.sheet)].flatMap((s) => checkSheet(s).map((e) => `${s.name}: ${e}`));
  if (bad.length) return `This save can't be used with this version of the game:\n${bad.slice(0, 3).join('\n')}`;
  for (const k of Object.keys(gameState)) delete (gameState as unknown as Record<string, unknown>)[k];
  Object.assign(gameState, structuredClone(env.state));
  gameState.bench = gameState.bench.filter((b) => !library.deleted.includes(b.sheet.id)); // good-bye means good-bye
  exploreRng = createRng(env.exploreRng);
  remember(library, [...gameState.roster, ...gameState.bench.map((b) => b.sheet)]);
  store.saveLibrary(library);
  newGameMode = false;
  defeat = null;
  locationId = gameState.location?.id ?? '';
  notices.push(`${how}: ${env.label}.`);
  show(gameState.location ? 'location' : 'world');
  return null;
}

// Autosave whenever the page is hidden or closed (reload, tab switch, closing the window).
addEventListener('pagehide', autosave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') autosave();
});

/** Start the adventure with the current line-up: everyone restored, starting coins from their kits. */
const POTION = 'consumable:potion-of-healing';
const STARTING_POTIONS = 2; // house rule: a new party starts with two Potions of Healing

function beginAdventure(): void {
  const { roster, bench, partyName } = gameState;
  Object.assign(gameState, newGameState(gameState.seed), { roster, bench }, partyName ? { partyName } : {});
  restoreAll(gameState, freshOf);
  gameState.coins = startingCoins(gameState.roster);
  gameState.inventory[POTION] = STARTING_POTIONS;
}

let sheetSizes: Record<string, { width: number; height: number }> = {};
const partyScreen = new PartyScreen({
  bus,
  rollScores: () => roll4d6DropLowest(exploreRng),
  spriteCss: (key) => spriteCssFromSizes(sheetSizes, key),
  newId,
  confirm: confirmDialog,
});
document.getElementById('menu-new-game')!.addEventListener('click', () => {
  void confirmDialog({
    title: 'Start a new game?',
    text: 'Your progress in this game is lost unless you saved it. Your characters stay in the character pool.',
    ok: 'New game',
    cancel: 'Cancel',
  }).then((yes) => yes && bus.dispatch({ type: 'newGame' }));
});

const shopScreen = new ShopScreen(bus);
const spellsDialog = new SpellsDialog(bus);
const packDialog = new PackDialog({ bus, spriteCss: (key) => spriteCssFromSizes(sheetSizes, key) });
const partyDialog = new PartyDialog({ bus, spriteCss: (key) => spriteCssFromSizes(sheetSizes, key) });

// ---------------------------------------------------------------------------
// Quests (rules/quests.ts + content/quests.json): conversations, hooks, quest fights
// ---------------------------------------------------------------------------
const talkDialog = new TalkDialog(bus);
const journal = new JournalDialog(questData);
document.getElementById('menu-journal')!.addEventListener('click', () => journal.show(gameState));
let talk: Talk | null = null; // the conversation on screen
let talkNotes: string[] = []; // what happened in it, for the log afterwards
let questFight: { onWin: Action[]; onLose: Action[]; onFlee: Action[] } | null = null; // what the current fight decides
let fightDifficulty: Difficulty | undefined; // a quest's override of the encounter's difficulty
let fightTweaks: FightTweaks | undefined;
let wanderDifficulty: Difficulty | undefined; // a random encounter's zone difficulty, while its dialog is open
let wanderShare = 1; // …and how many monsters it may bring, as a share of the party
let fightShare: number | undefined;

/** Why the party shouldn't pick a fight right now (null = they're fit): anyone down or dead, or under half HP. */
function partyHurt(): string | null {
  const stats = statsOf(gameState.roster);
  let hp = 0;
  let max = 0;
  let down = 0;
  let dead = 0;
  for (const p of gameState.party) {
    const s = stats.find((x) => x.id === p.id);
    if (!s) continue;
    if (p.dead) dead++;
    else if (p.hp <= 0) down++;
    hp += Math.max(0, p.dead ? 0 : p.hp);
    max += s.hp;
  }
  if (!down && !dead && hp >= max / 2) return null;
  const parts = [`${hp}/${max} HP`, down && `${down} unconscious`, dead && `${dead} dead`].filter(Boolean).join(', ');
  return `Your party is in poor shape (${parts}). A long rest at an inn — or the temple — would help before this fight.`;
}

/** Ask before a fight when the party is hurt; `go` runs if they fight anyway. */
function warnIfHurt(go: () => void, onBackOff: () => void): void {
  const why = partyHurt();
  if (!why) return go();
  void confirmDialog({ title: 'Fight now?', text: why, ok: 'Fight anyway', cancel: 'Not yet' }).then((yes) => (yes ? go() : onBackOff()));
}
const qctx = () => questContext(exploreRng);

/** Who fights: party members who aren't dead, and their average level (rules/scaling.ts). */
function fightContext() {
  const alive = gameState.party.filter((p) => !p.dead);
  const levels = alive.map((p) => gameState.roster.find((r) => r.id === p.id)?.level ?? 1);
  return {
    partySize: alive.length,
    level: levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length),
    difficulty: fightDifficulty,
    share: fightShare,
  };
}

function talkView(results: string[]): TalkView {
  const node = nodeOf(questData, talk!);
  const able = gameState.roster.filter((r) => {
    const p = gameState.party.find((x) => x.id === r.id);
    return p && !p.dead && p.hp > 0;
  });
  return {
    speaker: node.speaker,
    text: node.text,
    results,
    choices: visibleChoices(gameState, questData, talk!).map((c) => ({
      index: c.index,
      text: c.text,
      check: c.check && {
        label: `${ABILITY_NAMES[c.check.ability]}${c.check.skill ? ` (${c.check.skill})` : ''} check, DC ${c.check.dc}`,
        rollers: able
          .map((r) => {
            const roll = checkRoller(r, c.check!.ability, c.check!.skill);
            return { id: r.id, name: r.name, bonus: roll.bonus, note: roll.proficient ? 'proficient' : '' };
          })
          .sort((a, b) => b.bonus - a.bonus),
      },
    })),
  };
}

/** Carry out what quest actions did: log lines, then any fight, place or new conversation they ask for. */
function questOutcome(r: ActionResult): void {
  const trig = runTriggers(gameState, qctx());
  const log = [...r.log, ...trig.log];
  const requests: Request[] = [...r.requests, ...trig.requests];
  talkNotes.push(...log);
  const fight = requests.find((x) => x.kind === 'fight');
  const enter = requests.find((x) => x.kind === 'enter');
  const next = requests.find((x) => x.kind === 'dialog');
  if (fight || enter) {
    endTalk(false);
    if (fight?.kind === 'fight') startQuestFight(fight);
    else if (enter?.kind === 'enter') {
      locationId = enter.location;
      gameState.location = null;
      show('location');
    }
    return;
  }
  if (next?.kind === 'dialog') {
    const opened = openTalk(gameState, next.id, qctx());
    if (opened) {
      talk = opened.talk;
      log.push(...opened.log);
      talkNotes.push(...opened.log);
    }
  }
  if (talk) talkDialog.show(talkView(log));
  else endTalk(true);
}

/** Close the conversation; its results go to the log of the place you're in. */
function endTalk(redraw: boolean): void {
  talk = null;
  if (redraw) wanderDifficulty = undefined; // closed without a fight (slipped away)
  talkDialog.close();
  notices.push(...talkNotes);
  talkNotes = [];
  if (redraw) refreshScreen();
}

function startDialog(id: string): void {
  const opened = openTalk(gameState, id, qctx());
  if (!opened) return;
  talk = opened.talk;
  talkNotes = [];
  questOutcome(opened);
}

function runHook(index: number, at?: string): void {
  const h = questData.hooks[index];
  if (!h || (at && h.at !== at) || !hooksAt(gameState, questData, h.at).includes(h)) return;
  if (h.dialog) startDialog(h.dialog);
  else {
    talkNotes = [];
    questOutcome(run(gameState, h.do, qctx()));
  }
}

function startQuestFight(f: Extract<Request, { kind: 'fight' }>, confirmed = false): void {
  if (!gameState.party.some(isConscious)) {
    notices.push('Nobody in the party can fight right now — rest first.');
    refreshScreen();
    return;
  }
  const zone = wanderDifficulty;
  // a random encounter can't be put off; a quest fight can
  if (!zone && !confirmed) {
    warnIfHurt(
      () => startQuestFight(f, true),
      () => {
        notices.push('You decide to come back when the party is fit to fight.');
        refreshScreen();
      },
    );
    return;
  }
  wanderDifficulty = undefined;
  questFight = { onWin: f.onWin, onLose: f.onLose, onFlee: f.onFlee };
  encounter = f.encounter;
  origin = undefined;
  fightDifficulty = f.difficulty ?? zone;
  fightShare = zone ? wanderShare : undefined;
  fightTweaks = f.tweaks;
  seed = nextSeed();
  show('combat');
}
const PREPARE_FLAG = 'spells:prepare'; // set at camp after a Long Rest, cleared on leaving camp

/** Redraw whatever is on screen after a change made from a dialog. */
function refreshScreen(): void {
  const mode = document.body.dataset.mode;
  if (mode === 'shop') shopScreen.refresh();
  else if (mode === 'party') partyScreen.refresh();
  else if (mode !== 'combat') show(returnTo);
}

const saveDialog = new SaveDialog({
  summaries: () => SLOTS.map((slot) => store.summary(slot)),
  canSave: saveBlocked,
  save: (slot) => saveBlocked() ?? (store.write(slot, snapshot()) ? null : store.lastError),
  load: (slot) => {
    const env = store.read(slot);
    return env ? loadGame(env, 'Loaded') : store.lastError || 'Nothing to load.';
  },
  remove: (slot: SlotId) => store.remove(slot),
  exportCurrent: () => {
    const why = saveBlocked();
    if (why) return why;
    const day = Math.floor(gameState.time / 1440) + 1;
    return { name: `poor-fantasy-day${day}-${new Date().toISOString().slice(0, 10)}.json`, json: JSON.stringify(snapshot(), null, 1) };
  },
  importJson: (json) => {
    try {
      return loadGame(parseSave(json), 'Imported');
    } catch (e) {
      return (e as Error).message;
    }
  },
  confirm: confirmDialog,
});
document.getElementById('menu-saves')!.addEventListener('click', () => saveDialog.open());

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: BOARD.width * TILE,
  height: BOARD.height * TILE,
  backgroundColor: '#111111',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
});

game.scene.add('world', WorldScene, false);
game.scene.add('combat', CombatScene, false);
game.scene.add('location', LocationScene, false);
game.scene.add('camp', CampScene, false);

/** Canvas size + page layout for a scene (combat, world, camp 4:3; locations two square panes). */
function layoutFor(key: SceneKey): void {
  if (key === 'party' || key === 'shop') {
    document.body.dataset.mode = key;
    hud.setStatus(key === 'shop' ? shopName : newGameMode ? 'New game · create your party' : 'Party roster');
    return;
  }
  const { width, height } = key === 'location' ? LOCATION_VIEW : { width: BOARD.width * TILE, height: BOARD.height * TILE };
  if (game.scale.width !== width || game.scale.height !== height) game.scale.setGameSize(width, height);
  document.documentElement.style.setProperty('--board-ratio', String(width / height));
  document.body.dataset.mode = key;
}

// Re-fit the canvas whenever its box changes (scene switch, window resize, text size).
new ResizeObserver(() => {
  game.scale.getParentBounds();
  game.scale.refresh();
}).observe(document.getElementById('game')!);

/** Fight results go back onto the persistent party. */

function onFightEnd(state: CombatState): void {
  gameState.time += combatMinutes(state.round);
  // potions drunk in the fight leave the pack
  if (state.potions > 0) gameState.inventory[POTION] = state.potions;
  else delete gameState.inventory[POTION];
  const couldLevel = new Set(gameState.roster.filter(canLevelUp).map((r) => r.id));
  const xp = awardXp(gameState.party, gameState.roster, state);
  if (xp.each) notices.push(`Each survivor earns ${xp.each} XP (${xp.total} XP in all).`);
  if (state.outcome === 'victory' && origin && treasure[origin] && !gameState.flags[`looted:${origin}`]) {
    gameState.flags[`looted:${origin}`] = true;
    takeTreasure(gameState, treasure[origin]);
    notices.push(`You search the area and find: ${describeTreasure(treasure[origin])}.`);
  }
  for (const r of gameState.roster) {
    if (canLevelUp(r) && !couldLevel.has(r.id)) {
      notices.push(`${r.name} can reach level ${r.level + 1}! Click Party (above the names) to level up.`);
    }
  }
  persistLibrary(); // XP lives on the character sheets
  notices.push(...afterCombat(gameState.party, statsOf(gameState.roster), state, gameState.time, exploreRng));
  // scrolls read in the fight are gone
  for (const [id, n] of Object.entries(state.scrolls ?? {})) {
    if (n > 0) gameState.inventory[`scroll:${id}`] = n;
    else delete gameState.inventory[`scroll:${id}`];
  }
  // a quest fight decides what happens next
  if (questFight) {
    const then = state.outcome === 'victory' ? questFight.onWin : state.outcome === 'fled' ? questFight.onFlee : questFight.onLose;
    questFight = null;
    notices.push(...run(gameState, then, qctx()).log);
  }
  if (state.outcome === 'defeat') {
    defeat = afterDefeat(gameState.party, gameState.coins, prefs.get().difficulty);
    gameState.coins = defeat.coins;
  }
}

/** Stop whatever is running and start one scene (restart it if it is already running). */
function show(key: SceneKey): void {
  const take = () => {
    const n = notices;
    notices = [];
    return n;
  };
  if (key === 'party' || key === 'shop') {
    for (const sc of game.scene.getScenes(true)) sc.scene.stop();
    layoutFor(key);
    if (key === 'party') partyScreen.show(gameState, newGameMode);
    else shopScreen.show(gameState, shopName);
    return;
  }
  let data: object;
  if (key === 'combat') {
    const from = origin;
    const onVictory = () => {
      if (from) gameState.flags[`cleared:${from}`] = true;
    };
    data = {
      bus,
      hud,
      prefs,
      seed,
      encounter,
      onVictory,
      members: membersForFight(gameState.roster, gameState.inventory),
      party: gameState.party,
      potions: gameState.inventory[POTION] ?? 0,
      packWeapons: Object.fromEntries(Object.entries(gameState.inventory).filter(([ref, n]) => ref.startsWith('weapon:') && n > 0)),
      scrolls: Object.fromEntries(
        Object.entries(gameState.inventory)
          .filter(([ref]) => ref.startsWith('scroll:'))
          .map(([ref, n]) => [ref.slice(7), n]),
      ),
      encounterDef: resolveEncounter(encounters[encounter], fightContext()),
      tweaks: fightTweaks,
      now: gameState.time,
      onEnd: onFightEnd,
    };
  } else {
    returnTo = key;
    notices.push(...runTriggers(gameState, qctx()).log); // e.g. the last shrine fight just won
    if (key === 'location') data = { bus, hud, game: gameState, locationId, notices: take() };
    else if (key === 'camp') data = { bus, hud, game: gameState, site: campSite!, rng: exploreRng, notices: take() };
    else data = { bus, hud, game: gameState, rng: exploreRng, notices: take() };
  }
  layoutFor(key);
  let running = false;
  for (const s of game.scene.getScenes(true)) {
    if (s.scene.key === key) running = true;
    else s.scene.stop();
  }
  if (key !== 'combat') autosave(); // arriving somewhere, after fights, rests and roster changes
  // Stopping and starting the same scene in one tick would shut down the fresh copy; restart is ordered.
  if (running) game.scene.getScene(key)!.scene.restart(data);
  else game.scene.start(key, data);
}

/** The whole party fell: rescued back near Millbrook, or (Hard / everyone dead) a fresh party starts over. */
function handleDefeat(d: NonNullable<typeof defeat>): void {
  defeat = null;
  gameState.location = null;
  gameState.world = null; // the map's start square, by Millbrook
  notices.push(...d.notes);
  if (d.gameOver) {
    store.remove('auto'); // Hard means it: no reloading your way out
    newGameMode = true; // the same heroes may try again — or recruit new ones
    show('party');
    return;
  }
  show('world');
}

// Navigation commands (menu, banner, location panel). Gameplay commands go to the active scene.
bus.subscribe((cmd) => {
  switch (cmd.type) {
    case 'fight':
    case 'newFight':
      if (defeat) {
        handleDefeat(defeat); // the party fell: deal with that before any new fight
        break;
      }
      if (!gameState.party.some(isConscious)) {
        hud.setStatus('Nobody in the party can fight right now — rest first.');
        break;
      }
      // a dungeon fight (it has an origin) can wait if the party is hurt; ambushes can't
      if (cmd.type === 'fight' && cmd.origin && !cmd.confirmed && partyHurt()) {
        const again = { ...cmd, confirmed: true };
        warnIfHurt(
          () => bus.dispatch(again),
          () => hud.setStatus('You hold back. Rest, then come back to fight.'),
        );
        break;
      }
      if (cmd.type === 'fight') {
        encounter = cmd.encounter;
        origin = cmd.origin;
        questFight = null;
        fightDifficulty = undefined;
        fightTweaks = undefined;
        fightShare = undefined;
      }
      seed = nextSeed();
      delete gameState.flags[PREPARE_FLAG];
      show('combat');
      break;
    case 'restart':
      if (game.scene.isActive('combat')) show('combat'); // same seed = same dice
      break;
    case 'worldMap':
      gameState.location = null;
      show('world');
      break;
    case 'enter':
      locationId = cmd.location;
      gameState.location = null; // walk in at the entrance
      show('location');
      break;
    case 'leaveLocation': {
      // a place inside a town (the shrine) lets you out at its door; anywhere else onto the world map
      const parent = locationContent[locationId]?.parent;
      if (parent) {
        locationId = parent.location;
        gameState.location = { id: parent.location, x: parent.x, y: parent.y, facing: parent.facing };
        show('location');
        break;
      }
      gameState.location = null;
      show('world');
      break;
    }
    case 'hook':
      runHook(cmd.index);
      break;
    case 'wander':
      if (talk) break;
      wanderDifficulty = cmd.difficulty;
      wanderShare = cmd.share;
      startDialog(cmd.dialog);
      break;
    case 'atSite': {
      const h = hooksAt(gameState, questData, `site:${cmd.site}`)[0];
      if (h) runHook(questData.hooks.indexOf(h));
      break;
    }
    case 'talkChoice': {
      if (!talk) break;
      const sheet = cmd.characterId ? gameState.roster.find((r) => r.id === cmd.characterId) : undefined;
      const c = nodeOf(questData, talk).choices?.[cmd.index];
      const roller = sheet && c?.check ? checkRoller(sheet, c.check.ability, c.check.skill) : undefined;
      const r = choose(gameState, talk, cmd.index, qctx(), roller);
      talk = r.next;
      questOutcome(r);
      break;
    }
    case 'talkClose':
      if (talk && !canWalkAway(gameState, questData, talk)) {
        hud.setStatus('You can’t just walk away — choose what to do.');
        break;
      }
      endTalk(true);
      break;
    case 'endFight':
      if (defeat) handleDefeat(defeat);
      else show(returnTo);
      break;
    case 'camp':
      campSite = cmd.site;
      campReturn = returnTo === 'location' ? 'location' : 'world';
      show('camp');
      break;
    case 'breakCamp':
      delete gameState.flags[PREPARE_FLAG];
      show(campReturn);
      break;
    case 'openSpells':
      if (document.body.dataset.mode === 'combat') break;
      spellsDialog.show(gameState, document.body.dataset.mode === 'camp' && !!gameState.flags[PREPARE_FLAG], cmd.characterId);
      break;
    case 'prepareSpells': {
      const sheet = gameState.roster.find((r) => r.id === cmd.characterId);
      if (!sheet || !gameState.flags[PREPARE_FLAG]) break;
      const errors = checkSheet({ ...sheet, prepared: cmd.prepared });
      if (errors.length) {
        spellsDialog.refresh(errors[0]);
        break;
      }
      sheet.prepared = [...cmd.prepared];
      persistLibrary(); // prepared spells live on the character sheet
      spellsDialog.refresh(`${sheet.name} prepares ${cmd.prepared.length} spell${cmd.prepared.length === 1 ? '' : 's'}.`, sheet.id);
      break;
    }
    case 'castOutside': {
      const stats = statsOf(gameState.roster);
      const caster = stats.find((s) => s.id === cmd.casterId);
      if (!caster) break;
      const r = castOutside(
        characterData.spells,
        cmd.spellId,
        cmd.slot,
        caster,
        gameState.party,
        stats,
        cmd.targetIds,
        gameState.time,
        exploreRng,
        (p, s, log) => spendHitDice(p, s, exploreRng, log),
        gameState.inventory,
      );
      if (!r.ok) {
        spellsDialog.refresh(r.reason);
        break;
      }
      gameState.time += r.minutes;
      notices.push(...r.log);
      refreshScreen();
      spellsDialog.refresh(r.log.join(' '));
      partyDialog.refresh();
      break;
    }
    case 'partyScreen':
      partyDialog.close();
      if (document.body.dataset.mode !== 'party') {
        newGameMode = false;
        partyReturn = returnTo;
        show('party');
      }
      if (cmd.levelUp) partyScreen.levelUpFor(cmd.levelUp);
      break;
    case 'openParty':
    case 'openCharacter':
      if (document.body.dataset.mode === 'combat') {
        hud.setStatus('Not during a fight — each character’s card shows their numbers.');
        break;
      }
      if (cmd.type === 'openParty') partyDialog.showGroup(gameState);
      else partyDialog.showCharacter(gameState, cmd.characterId);
      break;
    case 'newGame': {
      newGameMode = true;
      if (!debugStart) store.remove('auto'); // the old game lives on only in save slots / files
      const { roster, bench } = gameState; // the character pool survives a new game
      Object.assign(gameState, newGameState(randomSeed()), { roster, bench });
      poolFromLibrary();
      restoreAll(gameState, freshOf);
      show('party');
      break;
    }
    case 'readyMadeParty':
      if (!newGameMode) break;
      useReadyMade(gameState, pregens, freshOf, newId);
      persistLibrary();
      partyScreen.refresh();
      break;
    case 'saveCharacter': {
      if (checkSheet(cmd.sheet).length) break;
      const i = gameState.roster.findIndex((r) => r.id === cmd.sheet.id);
      const b = gameState.bench.find((e) => e.sheet.id === cmd.sheet.id);
      // During play only name and portrait of an existing character may change (the screen enforces it too).
      const edited = (old: CharacterSheet) => (newGameMode ? cmd.sheet : { ...old, name: cmd.sheet.name, sprite: cmd.sheet.sprite });
      if (i >= 0) {
        gameState.roster[i] = edited(gameState.roster[i]);
        const st = gameState.party.find((p) => p.id === cmd.sheet.id);
        if (st && newGameMode) Object.assign(st, { hp: derive(gameState.roster[i]).hp, hitDice: 1 });
      } else if (b) {
        b.sheet = edited(b.sheet);
        if (newGameMode) b.state = null;
      } else {
        const where = addCharacter(gameState, cmd.sheet, freshOf);
        if (!newGameMode) {
          const cp = startingCopper(cmd.sheet, characterData);
          gameState.coins += cp;
          notices.push(`${cmd.sheet.name} ${where === 'party' ? 'joins the party' : 'waits at the inn'}, bringing ${cp / 100} gp.`);
        }
      }
      persistLibrary();
      partyScreen.refresh(cmd.sheet.id);
      break;
    }
    case 'benchCharacter':
      benchMember(gameState, cmd.id);
      partyScreen.refresh();
      break;
    case 'joinParty':
      joinParty(gameState, cmd.id, freshOf);
      partyScreen.refresh();
      break;
    case 'deleteCharacter':
      if (deleteCharacter(gameState, cmd.id) && !debugStart) {
        forget(library, cmd.id); // good-bye for ever: not brought back by old saves either
        store.saveLibrary(library);
      }
      partyScreen.refresh();
      break;
    case 'moveCharacter': {
      const i = gameState.roster.findIndex((r) => r.id === cmd.id);
      const j = i + cmd.by;
      if (i < 0 || j < 0 || j >= gameState.roster.length) break;
      [gameState.roster[i], gameState.roster[j]] = [gameState.roster[j], gameState.roster[i]];
      partyScreen.refresh();
      break;
    }
    case 'openShop':
      shopName = cmd.name;
      shopReturn = returnTo;
      show('shop');
      break;
    case 'closeShop':
      persistLibrary(); // equipment lives on the character sheets
      show(shopReturn);
      break;
    case 'shopBuy':
      shopScreen.refresh(buy(gameState, cmd.ref, characterData) ?? '');
      break;
    case 'shopSell':
      shopScreen.refresh(sell(gameState, cmd.ref, characterData) ?? '');
      break;
    case 'equipItem':
    case 'unequipItem': {
      const sheet = gameState.roster.find((r) => r.id === cmd.characterId);
      if (!sheet) break;
      const before = derive(sheet).hp;
      const err =
        cmd.type === 'equipItem'
          ? equip(sheet, gameState, cmd.ref, characterData)
          : unequip(sheet, gameState, cmd.slot, characterData);
      // HP max doesn't depend on gear today, but keep current HP within the maximum if it ever does
      const st = gameState.party.find((p) => p.id === sheet.id);
      if (st) st.hp = Math.min(st.hp, derive(sheet).hp || before);
      persistLibrary(); // gear lives on the character sheet
      if (packDialog.open || partyDialog.open) {
        const done = err ?? `${sheet.name}: ${cmd.type === 'equipItem' ? `now using ${itemInfo(cmd.ref, characterData)?.name ?? cmd.ref}` : `${cmd.slot === 'armor' ? 'armour' : 'shield'} taken off`} (old gear goes to the pack).`;
        packDialog.refresh(done);
        partyDialog.refresh(done);
        refreshScreen();
      } else shopScreen.refresh(err ?? '');
      break;
    }
    case 'openPack':
      if (document.body.dataset.mode === 'combat') {
        hud.setStatus('In a fight, potions are on each character’s card (Bonus Action).');
        break;
      }
      packDialog.show(gameState, cmd.characterId);
      break;
    case 'setPartyName':
      gameState.partyName = cmd.name.trim().slice(0, 30) || undefined;
      if (!gameState.partyName) delete gameState.partyName;
      partyScreen.refresh();
      break;
    case 'useItem': {
      if (document.body.dataset.mode === 'combat') break;
      const stats = statsOf(gameState.roster);
      const target = cmd.targetId ? gameState.party.find((p) => p.id === cmd.targetId) : undefined;
      const r = useItem(gameState.inventory, cmd.ref, target, stats.find((s) => s.id === cmd.targetId), exploreRng, characterData);
      if (typeof r === 'string') {
        packDialog.refresh(r);
        break;
      }
      gameState.time += 1;
      notices.push(...r.log);
      refreshScreen();
      packDialog.refresh(r.log.join(' '));
      partyDialog.refresh();
      break;
    }
    case 'debug': {
      // Testing aids: About menu buttons + the debug console (DND-20). Only "kill" works
      // mid-fight (CombatScene handles it); everything else waits, so a fight's numbers stay honest.
      const mode = document.body.dataset.mode;
      const [verb = '', arg] = cmd.text.trim().toLowerCase().split(/\s+/);
      const n = arg !== undefined && Number.isFinite(Number(arg)) ? Number(arg) : undefined;
      if (verb === 'help' || verb === '') {
        debugNote(
          'Commands: gold [gp] · xp [n] · heal (everyone full, raises the dead) · fight <encounter> · time <hours> · seed <n> (next fight’s dice) · fog · kill (in a fight: all enemies drop).',
        );
        break;
      }
      if (verb === 'kill') {
        if (mode !== 'combat') debugNote('kill only works during a fight.');
        break; // CombatScene does the killing
      }
      if (mode === 'combat') {
        hud.setStatus('Debug options are not available during a fight (except kill).');
        debugNote('Not available during a fight — only kill works here.');
        break;
      }
      if (verb === 'seed') {
        if (n === undefined) debugNote(`Usage: seed <number>. Current fight seed: ${seed}.`);
        else {
          pinnedSeed = n;
          exploreRng = createRng(n ^ 0x5eed);
          debugNote(`Next fight uses seed ${n}; exploration dice reseeded too.`);
        }
        break;
      }
      if (verb === 'fight' || verb === 'spawn') {
        if (!arg || !encounters[arg]) {
          debugNote(`Unknown encounter. Try one of: ${Object.keys(encounters).sort().join(', ')}.`);
          break;
        }
        (document.getElementById('about') as HTMLDialogElement | null)?.close();
        bus.dispatch({ type: 'fight', encounter: arg, confirmed: true });
        break;
      }
      if (verb === 'gold') {
        const gp = n ?? 100;
        gameState.coins = Math.max(0, gameState.coins + gp * 100);
        notices.push(`Debug: ${gp >= 0 ? '+' : ''}${gp} gp.`);
        debugNote(`${gp >= 0 ? '+' : ''}${gp} gp — purse now ${formatCoins(gameState.coins)}.`);
      } else if (verb === 'xp') {
        const xp = n ?? 300;
        for (const r of gameState.roster) r.xp = Math.max(0, (r.xp ?? 0) + xp);
        persistLibrary();
        debugNote(`+${xp} XP each — ${gameState.roster.map((r) => `${r.name} ${r.xp}`).join(', ')}.`);
        notices.push(`Debug: +${xp} XP for everyone in the party. Level up from Party (above the names).`);
      } else if (verb === 'heal') {
        gameState.party = gameState.roster.map(freshOf);
        debugNote('Everyone is alive, awake and at full HP and Hit Dice (spell slots: take a Long Rest).');
        notices.push('Debug: the party is fully healed.');
      } else if (verb === 'time') {
        const h = n ?? 8;
        gameState.time += Math.round(h * 60);
        debugNote(`${h} hour${h === 1 ? '' : 's'} pass.`);
        notices.push(`Debug: ${h} hours pass.`);
      } else if (verb === 'fog') {
        gameState.explored = {};
        debugNote('Fog of war reset — every map is unexplored again (except what the party sees right now).');
        notices.push('Debug: fog of war reset on every map.');
      } else {
        debugNote(`Unknown command “${verb}”. Type help.`);
        break;
      }
      if (mode === 'shop') shopScreen.refresh(notices.pop());
      else if (mode === 'party') partyScreen.refresh(undefined, notices.pop());
      else show(returnTo); // redraw the current place with the new purse
      break;
    }
    case 'levelUp': {
      const inParty = gameState.roster.find((r) => r.id === cmd.characterId);
      const benched = gameState.bench.find((b) => b.sheet.id === cmd.characterId);
      const sheet = inParty ?? benched?.sheet;
      if (!sheet) break;
      const r = levelUp(sheet, { hp: cmd.hp, asi: cmd.asi, spells: cmd.spells }, exploreRng, characterData);
      if (typeof r === 'string') {
        partyScreen.refresh(undefined, r);
        break;
      }
      const st = inParty ? gameState.party.find((p) => p.id === sheet.id) : benched?.state;
      if (st && !st.dead) {
        st.hp += r.hpGain; // the new hit points are there straight away
        st.hitDice += 1;
      }
      persistLibrary();
      partyScreen.refresh(
        undefined,
        `${sheet.name} reaches level ${r.level}! +${r.hpGain} HP${cmd.hp === 'roll' ? ` (rolled ${r.roll})` : ''}.` +
          (r.features.length ? ` New: ${r.features.join(', ')}.` : ''),
      );
      break;
    }
    case 'closePartyScreen':
      if (!gameState.party.some((p) => !p.dead)) break;
      if (newGameMode) {
        beginAdventure();
        newGameMode = false;
        // every adventure begins in Millbrook
        locationId = 'millbrook';
        gameState.location = null;
        notices.push('The party gathers in Millbrook. The reeve, they say, is looking for help.');
        show('location');
      } else show(partyReturn);
      break;
    default:
      break;
  }
});

if (debugStart) {
  useReadyMade(gameState, pregens, freshOf, newId);
  beginAdventure();
  newGameMode = false;
}
loadSheetSizes()
  .catch(() => ({}))
  .then((sizes) => {
    sheetSizes = sizes;
    if (debugStart) return show(params.has('seed') || params.has('encounter') ? 'combat' : 'location');
    // Returning player: carry on from the autosave. Otherwise: make a party (the character pool is remembered).
    const auto = store.read('auto');
    if (auto && !loadGame(auto, 'Welcome back — continuing from the autosave')) return;
    poolFromLibrary();
    show('party');
  });

// Debug handle for the browser console during playtests.
(window as unknown as { pf: unknown }).pf = { game, bus, gameState, get seed() { return seed; } };

/** Feedback line inside the About dialog's debug section. */
function debugNote(text: string): void {
  const el = document.getElementById('about-debug-note');
  if (el) el.textContent = text;
}

// Debug console in the About dialog (DND-20): type a command, Enter runs it.
document.getElementById('debug-console')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('debug-input') as HTMLInputElement;
  const text = input.value.trim();
  input.value = '';
  bus.dispatch({ type: 'debug', text: text || 'help' });
});
