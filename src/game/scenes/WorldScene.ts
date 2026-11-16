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
import { locationContent } from '../../content/encounters';
import { statsOf } from '../../content/characters';
import { formatCoins, passTime } from '../../rules/party';
import { SITE_RISK } from '../../rules/rest';
import { rosterEntries } from '../partyView';
import { loadTravelMap, type TiledMap } from '../../content/world';
import { canStep, findPath, isBlocked, locationAt, type MapLocation, siteAt, squaresAround, type TravelMap, worldCampSite, worldSight } from '../../rules/world';
import { isSeen, markSeen } from '../../rules/location';
import { questData, wandering } from '../../content/quests';
import { wanderingCheck, zoneAt } from '../../rules/wandering';
import type { Rng } from '../../engine/rng';
import { hooksAt, siteBlocks, siteIcon, siteVisible } from '../../rules/quests';
import { darkness, formatClock, MINUTES } from '../../rules/time';
import type { Hud } from '../../ui/hud';
import { commandForKey } from '../input/keyboard';
import { preloadSheets, SoftFog } from '../spriteCss';

const MAP_KEY = 'world';
const WORLD_SCALE = 2; // 16-px tiles drawn at 32 px: ~18×13 squares visible
const TILE = 16 * WORLD_SCALE;
const KIND_LABEL: Record<MapLocation['kind'], string> = { town: 'Town', cave: 'Cave', ruins: 'Ruins' };

export interface WorldSceneDeps {
  bus: CommandBus;
  hud: Hud;
  game: GameState; // shared; the party's position lives here
  notices: string[]; // messages to show on arrival (fight results, rescues)
  rng: Rng; // exploration dice (random encounters)
}

const FOG_COLOUR = 0x000000;
const WORLD_KEY = 'world'; // GameState.explored key for the world map
const NIGHT_COLOUR = 0x0a0f2e;
const NIGHT_ALPHA = 0.6; // how dark full night gets

export class WorldScene extends Phaser.Scene {
  private deps!: WorldSceneDeps;
  private map!: TravelMap;
  private token!: Phaser.GameObjects.Image;
  private night!: Phaser.GameObjects.Rectangle;
  private fog!: SoftFog;
  private pos = { x: 0, y: 0 };
  private busy = false;
  private log: string[] = [];
  private here: MapLocation | undefined;
  private cursor = '';
  private zone = '';

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

    const saved = this.deps.game.world;
    this.pos = saved ? { ...saved } : { ...this.map.start };
    const ref = assets.sprites['party-token'];
    // night: a dark blue wash over the land and sites (the party token stays on top, lantern-lit)
    this.night = this.add.rectangle(0, 0, this.map.width * TILE, this.map.height * TILE, NIGHT_COLOUR).setOrigin(0, 0).setDepth(4);
    this.fog = new SoftFog(this, 'fog:world', 0, 0, this.map.width, this.map.height, TILE, 4.5); // land the party hasn't seen yet
    this.fogDrawn = false;
    this.token = this.add.image(0, 0, ref.sheet, ref.frame).setScale(WORLD_SCALE).setDepth(5);
    this.placeToken();
    this.drawSites();

    const cam = this.cameras.main;
    cam.setZoom(1).setBounds(0, 0, this.map.width * TILE, this.map.height * TILE);
    cam.startFollow(this.token, true, 0.15, 0.15);

    const hud = this.deps.hud;
    hud.setCombatControls(false);
    hud.setOutcome('none');
    hud.setEndTurnHint(false);
    hud.setNames([]);
    this.showRoster();
    if (!this.log.length) {
      this.log.push('The party sets out into the Vale.', 'Click a square to travel there, or use WASD. Visit the towns, the cave and the ruins.');
    }
    this.log.push(...this.deps.notices);
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
        const path = findPath(this.map, this.pos, cmd, this.unseen);
        if (path?.length) this.walk(path);
        break;
      }
      case 'leavePlace':
        this.deps.hud.setPlace(null);
        break;
      case 'encamp': {
        const site = worldCampSite(this.map, this.pos.x, this.pos.y);
        if (!site.ok) {
          this.log.push(site.reason);
          this.deps.hud.setLog(this.log);
          break;
        }
        const names = { forest: 'Forest camp', meadow: 'Meadow camp', rocks: 'Camp among the rocks', riverside: 'Riverside camp' };
        this.deps.bus.dispatch({
          type: 'camp',
          site: { kind: site.kind, name: names[site.kind], risk: SITE_RISK[site.kind], ambush: 'ambush-wilds' },
        });
        break;
      }
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
      // A blocking site (the troll, the broken bridge) stops the party in front of it — and speaks up.
      const ahead = siteAt(this.map, this.pos.x + dx, this.pos.y + dy);
      if (ahead && siteBlocks(this.deps.game, questData, ahead.id)) {
        this.busy = false;
        this.arrive(false);
        this.deps.bus.dispatch({ type: 'atSite', site: ahead.id });
        return;
      }
      this.pos = { x: this.pos.x + dx, y: this.pos.y + dy };
      this.deps.game.time += MINUTES.worldStep;
      for (const name of passTime(this.deps.game.party, statsOf(this.deps.game.roster), this.deps.game.time)) this.log.push(`${name} comes round (1 HP).`);
      this.placeToken();
      this.showRoster();
      // something out here may have noticed the party
      const met = wanderingCheck(this.deps.game, this.map, this.pos.x, this.pos.y, wandering, this.deps.rng);
      if (met) {
        this.busy = false;
        this.arrive(false);
        this.deps.bus.dispatch({ type: 'wander', dialog: met.dialog, difficulty: met.difficulty, share: met.share });
        return;
      }
      // stop early when walking onto a location, or a site that does something
      if (i < path.length - 1 && (locationAt(this.map, this.pos.x, this.pos.y) || this.siteHere())) return next(path.length);
      this.time.delayedCall(90, () => next(i + 1));
    };
    next(0);
  }

  /** A site on the party's square that shows on the map or has something to say. */
  private siteHere() {
    const s = siteAt(this.map, this.pos.x, this.pos.y);
    if (!s) return undefined;
    return this.siteShown(s) || hooksAt(this.deps.game, questData, `site:${s.id}`).length ? s : undefined;
  }

  /** Drawn on the map: found (or never hidden) and with an icon right now (a troll that left has none). */
  private siteShown(s: { id: string; hidden: boolean }): boolean {
    return siteVisible(this.deps.game, s.id, s.hidden) && siteIcon(this.deps.game, questData, s.id) !== null;
  }

  /** Quest sites: icons for those found or never hidden (quest data may change or remove them). */
  private drawSites(): void {
    for (const s of this.map.sites) {
      if (!siteVisible(this.deps.game, s.id, s.hidden)) continue;
      const key = siteIcon(this.deps.game, questData, s.id);
      const ref = key ? assets.sprites[key] : undefined;
      if (!ref) continue;
      this.add.image(s.x * TILE + TILE / 2, s.y * TILE + TILE / 2, ref.sheet, ref.frame).setScale(WORLD_SCALE).setDepth(3);
    }
  }

  private showRoster(): void {
    const g = this.deps.game;
    this.deps.hud.setRoster(rosterEntries(this.textures, g), {
      purse: formatCoins(g.coins),
      clock: formatClock(g.time),
      encamp: { type: 'encamp' },
    }, g.partyName);
  }

  private placeToken(): void {
    this.token.setPosition(this.pos.x * TILE + TILE / 2, this.pos.y * TILE + TILE / 2);
    this.night.setAlpha(NIGHT_ALPHA * darkness(this.deps.game.time));
    this.deps.game.world = { x: this.pos.x, y: this.pos.y };
    this.explore();
  }

  /** Fog of war: reveal the land around the party (3 squares by day, 1 at night) — for good. */
  private explore(): void {
    const g = this.deps.game;
    const size = this.map.width * this.map.height;
    const radius = worldSight(darkness(g.time));
    const before = g.explored?.[WORLD_KEY];
    const mask = markSeen(before, size, squaresAround(this.map, this.pos.x, this.pos.y, radius));
    if (mask === before && this.fogDrawn) return;
    g.explored = { ...g.explored, [WORLD_KEY]: mask };
    this.fogDrawn = true;
    this.fog.update((x, y) => !isSeen(mask, y * this.map.width + x), FOG_COLOUR);
  }
  private fogDrawn = false;

  /** Land still under the fog (click-walking can't aim at or route through it). */
  private unseen = (x: number, y: number): boolean => !isSeen(this.deps.game.explored?.[WORLD_KEY], y * this.map.width + x);

  /**
   * Update status/log for the current square. Walking onto a location with a
   * map goes inside; standing on one (e.g. just came out) shows its panel.
   */
  private arrive(announce: boolean): void {
    const site = this.siteHere();
    if (site) {
      const name = this.siteShown(site) ? site.name : 'Wilderness';
      this.deps.hud.setStatus(`World map · ${name} · (${this.pos.x}, ${this.pos.y}) · ${formatClock(this.deps.game.time)}`);
    }
    if (site && announce) {
      // quest content takes over (main.ts runs the site's hooks); a plain visible site just shows its panel
      if (hooksAt(this.deps.game, questData, `site:${site.id}`).length) {
        this.deps.hud.setLog(this.log);
        this.deps.bus.dispatch({ type: 'atSite', site: site.id });
        return;
      }
    }
    if (site && this.siteShown(site)) {
      this.deps.hud.setLog(this.log);
      this.deps.hud.setPlace({ name: site.name, kind: 'Site', description: site.description, actions: [{ label: 'Leave', command: { type: 'leavePlace' } }] });
      return;
    }
    const loc = locationAt(this.map, this.pos.x, this.pos.y);
    if (loc && (announce || loc !== this.here)) this.log.push(`You arrive at ${loc.name}.`);
    this.zone = zoneAt(this.map, this.pos.x, this.pos.y, wandering).name;
    this.here = loc;
    this.deps.hud.setLog(this.log);
    this.deps.hud.setStatus(
      `World map · ${loc ? loc.name : `Wilderness — ${this.zone}`} · (${this.pos.x}, ${this.pos.y}) · ${formatClock(this.deps.game.time)}`,
    );
    if (!loc) return this.deps.hud.setPlace(null);

    const content = locationContent[loc.id] ?? {};
    const enter: Command | undefined = content.map ? { type: 'enter', location: loc.id } : undefined;
    if (enter && announce) {
      this.busy = true; // a short beat, then inside
      this.time.delayedCall(400, () => this.deps.bus.dispatch(enter));
      return;
    }
    this.deps.hud.setPlace({
      name: loc.name,
      kind: KIND_LABEL[loc.kind],
      description: loc.description,
      actions: [
        enter ? { label: 'Enter', command: enter } : { label: 'Enter — not designed yet' },
        { label: 'Leave', command: { type: 'leavePlace' } },
      ],
    });
  }

  private setCursor(name: string): void {
    if (name === this.cursor) return;
    this.cursor = name;
    this.input.setDefaultCursor(cursorCss(assets.cursors[name] ?? assets.cursors.default));
  }
}
