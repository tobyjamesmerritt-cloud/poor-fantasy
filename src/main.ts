import * as Phaser from 'phaser';
import { CommandBus } from './engine/commands';
import { randomSeed } from './engine/rng';
import { newGameState } from './engine/state';
import { CombatScene, TILE } from './game/scenes/CombatScene';
import { WorldScene } from './game/scenes/WorldScene';
import { Hud } from './ui/hud';
import { initMenu } from './ui/menu';
import { PrefsStore } from './ui/prefs';
import skirmish from './content/skirmish.json';
import './ui/style.css';

// ?seed=123 in the URL jumps straight into the test fight with those dice — paste it into bug reports.
const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? Number(params.get('seed')) : randomSeed();

// The board keeps the combat grid's aspect ratio and shrinks to fit the window.
document.documentElement.style.setProperty('--board-ratio', String(skirmish.width / skirmish.height));

const bus = new CommandBus();
const hud = new Hud(bus);
const prefs = new PrefsStore();
const gameState = newGameState(seed);
initMenu(prefs);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: skirmish.width * TILE,
  height: skirmish.height * TILE,
  backgroundColor: '#111111',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
});

game.scene.add('world', WorldScene, false);
game.scene.add('combat', CombatScene, false);

/** Stop whatever is running and start one scene. */
function show(key: 'world' | 'combat'): void {
  for (const s of game.scene.getScenes(true)) if (s.scene.key !== key) s.scene.stop();
  if (key === 'combat') game.scene.start('combat', { bus, hud, prefs, seed });
  else game.scene.start('world', { bus, hud, game: gameState });
}

// Navigation commands (menu, banner, location panel). Gameplay commands go to the active scene.
bus.subscribe((cmd) => {
  switch (cmd.type) {
    case 'newFight':
      seed = randomSeed();
      show('combat');
      break;
    case 'restart':
      if (game.scene.isActive('combat')) show('combat'); // same seed = same dice
      break;
    case 'worldMap':
      show('world');
      break;
    default:
      break;
  }
});

show(params.has('seed') ? 'combat' : 'world');

// Debug handle for the browser console during playtests.
(window as unknown as { pf: unknown }).pf = { game, bus, gameState, get seed() { return seed; } };
