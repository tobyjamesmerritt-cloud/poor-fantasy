/**
 * World map: the party travels as one token over a Tiled map.
 * Rules (blocked squares, paths, locations) come from rules/world.ts; this
 * scene only renders and forwards input. Map file: public/assets/maps/world.json.
 */
import * as Phaser from 'phaser';
import type { Command, CommandBus, Direction } from '../../engine/commands';
import { DIRECTION_VECTORS } from '../../engine/commands';
import type { GameState } from '../../engine/state';
import { assets, cursorCss } from '../../content/assets';
import { locationContent, party } from '../../content/encounters';
import { loadTravelMap, type TiledMap } from '../../content/world';
import { canStep, findPath, isBlocked, locationAt, type MapLocation, type TravelMap } from '../../rules/world';
import type { Hud } from '../../ui/hud';
import { commandForKey } from '../input/keyboard';
import { preloadSheets, spriteCss } from '../spriteCss';

const MAP_KEY = 'world';
const WORLD_SCALE = 2; // 16-px tiles drawn at 32 px: ~18×13 squares visible
const TILE = 16 * WORLD_SCALE;
const KIND_LABEL: Record<MapLocation['kind'], string> = { town: 'Town', cave: 'Cave', ruins: 'Ruins' };

export interface WorldSceneDeps {
  bus: CommandBus;
  hud: Hud;
  game: GameState; // shared; the party's position lives here
}

export class WorldScene extends Phaser.Scene {
  private deps!: WorldSceneDeps;
  private map!: TravelMap;
  private token!: Phaser.GameObjects.Image;
  private pos = { x: 0, y: 0 };
  private busy = false;
  private log: string[] = [];
  private here: MapLocation | undefined;
  private cursor = '';

  constructor() {
    super('world');
  }

  init(deps: WorldSceneDeps): void {
    this.deps = deps;
    this.busy = false;
    this.cursor = '';
  }

  preload(): void {
    preloadSheets(this.load);
    this.load.tilemapTiledJSON(MAP_KEY, 'assets/maps/world.json');
  }

  create(): void {
    const tiled = this.cache.tilemap.get(MAP_KEY).data as TiledMap;
    this.map = loadTravelMap(tiled);

    const tm = this.make.tilemap({ key: MAP_KEY });
    const tilesets = [tm.addTilesetImage('tiny-battle', 'battle')!, tm.addTilesetImage('tiny-dungeon', 'dungeon')!];
    for (const name of ['ground', 'decor', 'structures']) tm.createLayer(name, tilesets)?.setScale(WORLD_SCALE);

    const saved = this.deps.game.position;
    this.pos = saved?.map === MAP_KEY ? { x: saved.x, y: saved.y } : { ...this.map.start };
    const ref = assets.sprites['party-token'];
    this.token = this.add.image(0, 0, ref.sheet, ref.frame).setScale(WORLD_SCALE).setDepth(5);
    this.placeToken();

    const cam = this.cameras.main;
    cam.setZoom(1).setBounds(0, 0, this.map.width * TILE, this.map.height * TILE);
    cam.startFollow(this.token, true, 0.15, 0.15);

    const hud = this.deps.hud;
    hud.setCombatControls(false);
    hud.setOutcome('none');
    hud.setEndTurnHint(false);
    hud.setNames([]);
    hud.setRoster(party.map((p) => ({ name: p.name, hp: p.hp, maxHp: p.hp, sprite: spriteCss(this.textures, p.sprite) })));
    if (!this.log.length) {
      this.log.push('The party sets out into the Vale.', 'Click a square to travel there, or use WASD. Visit the towns, the cave and the ruins.');
    }
    this.arrive(false);

    const unsubscribe = this.deps.bus.subscribe((cmd) => this.handle(cmd));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const cmd = commandForKey(e.code);
      if (cmd) {
        e.preventDefault();
        this.deps.bus.dispatch(cmd);
      }
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.deps.bus.dispatch({ type: 'moveTo', x: Math.floor(p.worldX / TILE), y: Math.floor(p.worldY / TILE) });
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const blocked = isBlocked(this.map, Math.floor(p.worldX / TILE), Math.floor(p.worldY / TILE));
      this.setCursor(this.busy || blocked ? 'default' : 'move');
    });
  }

  private handle(cmd: Command): void {
    if (this.busy) return;
    switch (cmd.type) {
      case 'move':
        if (canStep(this.map, this.pos, cmd.dir)) this.walk([cmd.dir]);
        break;
      case 'moveTo': {
        const path = findPath(this.map, this.pos, cmd);
        if (path?.length) this.walk(path);
        break;
      }
      case 'leavePlace':
        this.deps.hud.setPlace(null);
        break;
      default:
        break;
    }
  }

  private walk(path: Direction[]): void {
    this.busy = true;
    this.deps.hud.setPlace(null);
    const next = (i: number) => {
      if (i >= path.length) {
        this.busy = false;
        this.arrive(true);
        return;
      }
      const [dx, dy] = DIRECTION_VECTORS[path[i]];
      this.pos = { x: this.pos.x + dx, y: this.pos.y + dy };
      this.placeToken();
      // stop early when walking onto a location on the way
      if (i < path.length - 1 && locationAt(this.map, this.pos.x, this.pos.y)) return next(path.length);
      this.time.delayedCall(90, () => next(i + 1));
    };
    next(0);
  }

  private placeToken(): void {
    this.token.setPosition(this.pos.x * TILE + TILE / 2, this.pos.y * TILE + TILE / 2);
    this.deps.game.position = { map: MAP_KEY, x: this.pos.x, y: this.pos.y };
  }

  /**
   * Update status/log for the current square. Walking onto a location with an
   * uncleared autoFight encounter starts the fight; otherwise show its panel.
   */
  private arrive(announce: boolean): void {
    const loc = locationAt(this.map, this.pos.x, this.pos.y);
    if (loc && (announce || loc !== this.here)) this.log.push(`You arrive at ${loc.name}.`);
    this.here = loc;
    this.deps.hud.setLog(this.log);
    this.deps.hud.setStatus(`World map · ${loc ? loc.name : 'Wilderness'} · (${this.pos.x}, ${this.pos.y})`);
    if (!loc) return this.deps.hud.setPlace(null);

    const content = locationContent[loc.id] ?? {};
    const cleared = this.deps.game.flags[`cleared:${loc.id}`] === true;
    const fight: Command | undefined = content.encounter
      ? { type: 'fight', encounter: content.encounter, origin: loc.id }
      : undefined;

    if (fight && content.autoFight && !cleared && announce) {
      if (content.intro) this.log.push(content.intro);
      this.deps.hud.setLog(this.log);
      this.busy = true; // short beat to read the intro, then into battle
      this.time.delayedCall(900, () => this.deps.bus.dispatch(fight));
      return;
    }

    const actions = fight
      ? [{ label: cleared ? 'Fight again (test)' : 'Fight', command: fight }]
      : [{ label: 'Enter — not designed yet' }];
    this.deps.hud.setPlace({
      name: loc.name,
      kind: KIND_LABEL[loc.kind] + (cleared ? ' · cleared ✔' : ''),
      description: loc.description,
      actions: [...actions, { label: 'Leave', command: { type: 'leavePlace' } }],
    });
  }

  private setCursor(name: string): void {
    if (name === this.cursor) return;
    this.cursor = name;
    this.input.setDefaultCursor(cursorCss(assets.cursors[name] ?? assets.cursors.default));
  }
}
