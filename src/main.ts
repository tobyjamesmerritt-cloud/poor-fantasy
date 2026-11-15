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
import { BOARD, DEFAULT_ENCOUNTER } from './content/encounters';
import { characterData, checkSheet, derive, membersOf, pregens, startingCoins, statsOf } from './content/characters';
import { roll4d6DropLowest, startingCopper } from './rules/character';
import { PartyScreen } from './ui/partyScreen';
import { ShopScreen } from './ui/shopScreen';
import { buy, equip, sell, unequip } from './rules/items';
import { loadSheetSizes, spriteCssFromSizes } from './game/spriteCss';
import type { CombatState } from './rules/combat';
import { afterCombat, afterDefeat, combatMinutes, formatCoins, freshParty, isConscious } from './rules/party';
import { awardXp, takeTreasure } from './rules/rewards';
import { canLevelUp, levelUp } from './rules/levelling';
import { describeTreasure, treasure } from './content/treasure';
import { addCharacter, benchMember, deleteCharacter, joinParty, restoreAll, useReadyMade } from './rules/roster';
import { SpellsDialog } from './ui/spellsDialog';
import { castOutside } from './rules/spells';
import { spendHitDice } from './rules/rest';
import './ui/style.css';

// ?seed=123 in the URL jumps straight into the test fight with those dice — paste it into bug reports.
const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? Number(params.get('seed')) : randomSeed();
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
  const who = st.roster.map((r) => r.name).join(', ');
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
function beginAdventure(): void {
  const { roster, bench } = gameState;
  Object.assign(gameState, newGameState(gameState.seed), { roster, bench });
  restoreAll(gameState, freshOf);
  gameState.coins = startingCoins(gameState.roster);
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
const POTION = 'consumable:potion-of-healing';

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
      notices.push(`${r.name} can reach level ${r.level + 1}! Open Game → Party roster to level up.`);
    }
  }
  persistLibrary(); // XP lives on the character sheets
  notices.push(...afterCombat(gameState.party, statsOf(gameState.roster), state, gameState.time, exploreRng));
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
      members: membersOf(gameState.roster),
      party: gameState.party,
      potions: gameState.inventory[POTION] ?? 0,
      now: gameState.time,
      onEnd: onFightEnd,
    };
  } else {
    returnTo = key;
    if (key === 'location') data = { bus, hud, game: gameState, locationId, notices: take() };
    else if (key === 'camp') data = { bus, hud, game: gameState, site: campSite!, rng: exploreRng, notices: take() };
    else data = { bus, hud, game: gameState, notices: take() };
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
      if (cmd.type === 'fight') {
        encounter = cmd.encounter;
        origin = cmd.origin;
      }
      seed = randomSeed();
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
    case 'leaveLocation':
      gameState.location = null;
      show('world');
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
      spellsDialog.show(gameState, document.body.dataset.mode === 'camp' && !!gameState.flags[PREPARE_FLAG]);
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
      const r = castOutside(characterData.spells, cmd.spellId, cmd.slot, caster, gameState.party, stats, cmd.targetIds, gameState.time, exploreRng, (p, s, log) =>
        spendHitDice(p, s, exploreRng, log),
      );
      if (!r.ok) {
        spellsDialog.refresh(r.reason);
        break;
      }
      gameState.time += r.minutes;
      notices.push(...r.log);
      refreshScreen();
      spellsDialog.refresh(r.log.join(' '));
      break;
    }
    case 'partyScreen':
      newGameMode = false;
      partyReturn = returnTo;
      show('party');
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
      shopScreen.refresh(err ?? '');
      break;
    }
    case 'debug': {
      // Testing aids (About menu). Not available mid-fight, so a fight's numbers stay honest.
      const mode = document.body.dataset.mode;
      if (mode === 'combat') {
        hud.setStatus('Debug options are not available during a fight.');
        debugNote('Not available during a fight.');
        break;
      }
      if (cmd.text === 'gold') {
        gameState.coins += 100 * 100;
        notices.push('Debug: +100 gp.');
        debugNote(`+100 gp — purse now ${formatCoins(gameState.coins)}.`);
      } else if (cmd.text === 'xp') {
        for (const r of gameState.roster) r.xp = (r.xp ?? 0) + 300;
        persistLibrary();
        debugNote(`+300 XP each — ${gameState.roster.map((r) => `${r.name} ${r.xp}`).join(', ')}.`);
        notices.push('Debug: +300 XP for everyone in the party. Level up from Game → Party roster.');
      } else break;
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
        notices.push('The party sets out into the Vale.');
        show('world');
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
