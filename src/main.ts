import * as Phaser from 'phaser';
import { CommandBus } from './engine/commands';
import { randomSeed } from './engine/rng';
import { newGameState } from './engine/state';
import { CombatScene, TILE } from './game/scenes/CombatScene';
import { LOCATION_VIEW, LocationScene } from './game/scenes/LocationScene';
import { WorldScene } from './game/scenes/WorldScene';
import { Hud } from './ui/hud';
import { initMenu } from './ui/menu';
import { PrefsStore } from './ui/prefs';
import { BOARD, DEFAULT_ENCOUNTER } from './content/encounters';
import './ui/style.css';

// ?seed=123 in the URL jumps straight into the test fight with those dice — paste it into bug reports.
const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? Number(params.get('seed')) : randomSeed();
let encounter = params.get('encounter') ?? DEFAULT_ENCOUNTER; // ?encounter=ruins-crawlers for testing
let origin: string | undefined; // what the current fight belongs to (location:spot), for the cleared flag
type ExploreScene = 'world' | 'location';
let returnTo: ExploreScene = 'world'; // where "Continue" goes after a fight
let locationId = params.get('location') ?? ''; // ?location=millbrook jumps straight into a location

const bus = new CommandBus();
const hud = new Hud(bus);
const prefs = new PrefsStore();
const gameState = newGameState(seed);
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

/** Canvas size + page layout for a scene (combat and world 4:3; locations two square panes). */
function layoutFor(key: 'world' | 'combat' | 'location'): void {
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

/** Stop whatever is running and start one scene. */
function show(key: 'world' | 'combat' | 'location'): void {
  for (const s of game.scene.getScenes(true)) s.scene.stop();
  layoutFor(key);
  if (key === 'combat') {
    const from = origin;
    const onVictory = () => {
      if (from) gameState.flags[`cleared:${from}`] = true;
    };
    game.scene.start('combat', { bus, hud, prefs, seed, encounter, onVictory });
  } else if (key === 'location') {
    returnTo = 'location';
    game.scene.start('location', { bus, hud, game: gameState, locationId });
  } else {
    returnTo = 'world';
    game.scene.start('world', { bus, hud, game: gameState });
  }
}

// Navigation commands (menu, banner, location panel). Gameplay commands go to the active scene.
bus.subscribe((cmd) => {
  switch (cmd.type) {
    case 'fight':
      encounter = cmd.encounter;
      origin = cmd.origin;
      seed = randomSeed();
      show('combat');
      break;
    case 'newFight':
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
      show(returnTo);
      break;
    default:
      break;
  }
});

show(params.has('seed') || params.has('encounter') ? 'combat' : locationId ? 'location' : 'world');

// Debug handle for the browser console during playtests.
(window as unknown as { pf: unknown }).pf = { game, bus, gameState, get seed() { return seed; } };
