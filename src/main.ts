import * as Phaser from 'phaser';
import { CommandBus } from './engine/commands';
import { randomSeed } from './engine/rng';
import { CombatScene, TILE } from './game/scenes/CombatScene';
import { Hud } from './ui/hud';
import skirmish from './content/skirmish.json';
import './ui/style.css';

// ?seed=123 in the URL replays an exact fight — paste it into bug reports.
const params = new URLSearchParams(location.search);
const seed = params.has('seed') ? Number(params.get('seed')) : randomSeed();

const bus = new CommandBus();
const hud = new Hud(bus);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: skirmish.width * TILE,
  height: skirmish.height * TILE,
  backgroundColor: '#111111',
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
});

game.scene.add('combat', CombatScene, true, { bus, hud, seed });

// Debug handle for the browser console during playtests.
(window as unknown as { pf: unknown }).pf = { game, bus, seed };
