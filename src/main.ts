import * as Phaser from 'phaser';
import { type CampSiteRef, CommandBus } from './engine/commands';
import { createRng, randomSeed } from './engine/rng';
import { type CharacterSheet, newGameState } from './engine/state';
import { CampScene } from './game/scenes/CampScene';
import { CombatScene, TILE } from './game/scenes/CombatScene';
import { LOCATION_VIEW, LocationScene } from './game/scenes/LocationScene';
import { WorldScene } from './game/scenes/WorldScene';
import { Hud } from './ui/hud';
import { initMenu } from './ui/menu';
import { PrefsStore } from './ui/prefs';
import { BOARD, DEFAULT_ENCOUNTER } from './content/encounters';
import { characterData, checkSheet, derive, MAX_PARTY, membersOf, pregens, startingCoins, statsOf } from './content/characters';
import { roll4d6DropLowest, startingCopper } from './rules/character';
import { PartyScreen } from './ui/partyScreen';
import { loadSheetSizes, spriteCssFromSizes } from './game/spriteCss';
import type { CombatState } from './rules/combat';
import { afterCombat, afterDefeat, combatMinutes, freshParty, isConscious } from './rules/party';
import './ui/style.css';

// ?seed=123 in the URL jumps straight into the test fight with those dice — paste it into bug reports.
const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? Number(params.get('seed')) : randomSeed();
let encounter = params.get('encounter') ?? DEFAULT_ENCOUNTER; // ?encounter=ruins-crawlers for testing
let origin: string | undefined; // what the current fight belongs to (location:spot), for the cleared flag
type SceneKey = 'world' | 'combat' | 'location' | 'camp' | 'party';
type ReturnScene = 'world' | 'location' | 'camp';
let returnTo: ReturnScene = 'world'; // where "Continue" goes after a fight
let campReturn: 'world' | 'location' = 'world'; // where "Break camp" goes
let campSite: CampSiteRef | null = null;
let locationId = params.get('location') ?? ''; // ?location=millbrook jumps straight into a location
let notices: string[] = []; // shown by the next exploring scene (fight results, rescues)
let defeat: ReturnType<typeof afterDefeat> | null = null; // set when the party fell, handled on Continue

const bus = new CommandBus();
const hud = new Hud(bus);
const prefs = new PrefsStore();
const gameState = newGameState(seed);
let newGameMode = true; // party screen: building a new party (full editing) vs. managing during play
let partyReturn: ReturnScene = 'world';
const exploreRng = createRng(gameState.seed ^ 0x5eed); // rests, ambushes, ability rolls (combat has its own seeded Rng)
initMenu(prefs);

/** Use a roster as a brand-new party: fresh health, starting coins from class + background kits. */
function beginWith(roster: readonly CharacterSheet[]): void {
  const fresh = newGameState(gameState.seed);
  Object.assign(gameState, fresh, {
    roster: structuredClone([...roster]),
    party: freshParty(statsOf(roster)),
    coins: startingCoins(roster),
  });
}

let sheetSizes: Record<string, { width: number; height: number }> = {};
const partyScreen = new PartyScreen({
  bus,
  rollScores: () => roll4d6DropLowest(exploreRng),
  spriteCss: (key) => spriteCssFromSizes(sheetSizes, key),
});
document.getElementById('menu-new-game')!.addEventListener('click', () => {
  if (confirm('Start a new game? The current party and progress will be lost.')) bus.dispatch({ type: 'newGame' });
});

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
  if (key === 'party') {
    document.body.dataset.mode = key;
    hud.setStatus(newGameMode ? 'New game · create your party' : 'Party roster');
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
  if (key === 'party') {
    for (const sc of game.scene.getScenes(true)) sc.scene.stop();
    layoutFor('party');
    partyScreen.show(gameState, newGameMode);
    return;
  }
  let data: object;
  if (key === 'combat') {
    const from = origin;
    const onVictory = () => {
      if (from) gameState.flags[`cleared:${from}`] = true;
    };
    data = { bus, hud, prefs, seed, encounter, onVictory, members: membersOf(gameState.roster), party: gameState.party, onEnd: onFightEnd };
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
    newGameMode = true;
    gameState.roster = [];
    gameState.party = [];
    show('party'); // a new band of adventurers
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
      show(campReturn);
      break;
    case 'partyScreen':
      newGameMode = false;
      partyReturn = returnTo;
      show('party');
      break;
    case 'newGame':
      newGameMode = true;
      Object.assign(gameState, newGameState(randomSeed()));
      show('party');
      break;
    case 'quickStart':
      beginWith(pregens);
      newGameMode = false;
      notices.push('The party sets out into the Vale.');
      show('world');
      break;
    case 'saveCharacter': {
      const errors = checkSheet(cmd.sheet);
      const i = gameState.roster.findIndex((r) => r.id === cmd.sheet.id);
      if (errors.length || (i < 0 && gameState.roster.length >= MAX_PARTY)) break;
      if (i >= 0) {
        const old = gameState.roster[i];
        // During play only name and portrait may change (the party screen enforces it; double-check here).
        gameState.roster[i] = newGameMode ? cmd.sheet : { ...old, name: cmd.sheet.name, sprite: cmd.sheet.sprite };
        const st = gameState.party.find((p) => p.id === cmd.sheet.id);
        if (st && newGameMode) Object.assign(st, { hp: derive(gameState.roster[i]).hp, hitDice: 1 });
      } else {
        gameState.roster.push(cmd.sheet);
        gameState.party.push(freshParty(statsOf([cmd.sheet]))[0]);
        if (!newGameMode) {
          const cp = startingCopper(cmd.sheet, characterData);
          gameState.coins += cp;
          notices.push(`${cmd.sheet.name} joins the party, bringing ${cp / 100} gp.`);
        }
      }
      partyScreen.refresh(cmd.sheet.id);
      break;
    }
    case 'removeCharacter':
      gameState.roster = gameState.roster.filter((r) => r.id !== cmd.id);
      gameState.party = gameState.party.filter((p) => p.id !== cmd.id);
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
    case 'closePartyScreen':
      if (!gameState.party.some((p) => !p.dead)) break;
      if (newGameMode) {
        beginWith(gameState.roster);
        newGameMode = false;
        notices.push('The party sets out into the Vale.');
        show('world');
      } else show(partyReturn);
      break;
    default:
      break;
  }
});

// Debug URLs (?seed, ?encounter, ?location) skip party creation and use the quick-start party.
const debugStart = params.has('seed') || params.has('encounter') || !!locationId;
if (debugStart) {
  beginWith(pregens);
  newGameMode = false;
}
loadSheetSizes()
  .catch(() => ({}))
  .then((sizes) => {
    sheetSizes = sizes;
    show(params.has('seed') || params.has('encounter') ? 'combat' : locationId ? 'location' : debugStart ? 'world' : 'party');
  });

// Debug handle for the browser console during playtests.
(window as unknown as { pf: unknown }).pf = { game, bus, gameState, get seed() { return seed; } };
