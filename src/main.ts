import * as Phaser from 'phaser';
import { type CampSiteRef, CommandBus } from './engine/commands';
import { createRng, randomSeed } from './engine/rng';
import { newGameState } from './engine/state';
import { CampScene } from './game/scenes/CampScene';
import { CombatScene, TILE } from './game/scenes/CombatScene';
import { LOCATION_VIEW, LocationScene } from './game/scenes/LocationScene';
import { WorldScene } from './game/scenes/WorldScene';
import { Hud } from './ui/hud';
import { initMenu } from './ui/menu';
import { PrefsStore } from './ui/prefs';
import { BOARD, DEFAULT_ENCOUNTER, partyStats } from './content/encounters';
import type { CombatState } from './rules/combat';
import { afterCombat, afterDefeat, combatMinutes, freshParty, isConscious } from './rules/party';
import './ui/style.css';

// ?seed=123 in the URL jumps straight into the test fight with those dice — paste it into bug reports.
const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? Number(params.get('seed')) : randomSeed();
let encounter = params.get('encounter') ?? DEFAULT_ENCOUNTER; // ?encounter=ruins-crawlers for testing
let origin: string | undefined; // what the current fight belongs to (location:spot), for the cleared flag
type SceneKey = 'world' | 'combat' | 'location' | 'camp';
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
gameState.party = freshParty(partyStats);
const exploreRng = createRng(gameState.seed ^ 0x5eed); // rests and ambush rolls (combat has its own seeded Rng)
initMenu(prefs);

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
  notices.push(...afterCombat(gameState.party, partyStats, state, gameState.time, exploreRng));
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
  let data: object;
  if (key === 'combat') {
    const from = origin;
    const onVictory = () => {
      if (from) gameState.flags[`cleared:${from}`] = true;
    };
    data = { bus, hud, prefs, seed, encounter, onVictory, party: gameState.party, onEnd: onFightEnd };
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
    Object.assign(gameState, newGameState(randomSeed()), { party: freshParty(partyStats) });
    notices.push('A new band of adventurers sets out from Millbrook.');
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
    default:
      break;
  }
});

show(params.has('seed') || params.has('encounter') ? 'combat' : locationId ? 'location' : 'world');

// Debug handle for the browser console during playtests.
(window as unknown as { pf: unknown }).pf = { game, bus, gameState, get seed() { return seed; } };
