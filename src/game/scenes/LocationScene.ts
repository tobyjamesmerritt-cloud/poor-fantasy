/**
 * Inside a town or dungeon. Left half of the canvas: Gold Box-style
 * first-person view; right half: the overhead map with the party arrow.
 * The HTML side panel (party, position, clock, buttons) and the message log
 * are set through the Hud.
 *
 * All movement and view geometry comes from rules/location.ts; this scene
 * only renders and forwards commands.
 */
import { drawRoads } from '../roadTiles';
import { questData, wandering } from '../../content/quests';
import { hooksAt } from '../../rules/quests';
import * as Phaser from 'phaser';
import type { Command, CommandBus } from '../../engine/commands';
import type { GameState } from '../../engine/state';
import type { Rng } from '../../engine/rng';
import { locationWanderCheck } from '../../rules/wandering';
import { encounters, locationContent } from '../../content/encounters';
import { statsOf } from '../../content/characters';
import { imageKey, spriteTexture } from '../../content/assets';
import { loadLocationMap } from '../../content/locationMap';
import { loadTravelMap, type TiledMap } from '../../content/world';
import {
  type Face,
  FACING_VECTORS,
  doorLocked,
  findPath4,
  isSeen,
  markSeen,
  SIGHT,
  visibleSquares,
  isExit,
  stairsArrival,
  type LocationMap,
  type Pose,
  type Spot,
  spotAt,
  type StepDir,
  turn,
  tryStep,
  type Turn,
  viewFaces,
  locationCampCheck,
  spotPicture,
  roadAt,
  squareVariant,
  viewProps,
  type ViewProp,
} from '../../rules/location';
import { floorPiece, turnedUV } from '../../rules/pathTiles';
import { darkness, formatClock, MINUTES } from '../../rules/time';
import { formatCoins, passTime } from '../../rules/party';
import { healCost, templeHeal, templeRaise, type TemplePrices } from '../../rules/services';
import servicesRaw from '../../content/services.json';

const templePrices = servicesRaw as unknown as TemplePrices;
import { SITE_RISK } from '../../rules/rest';
import { rosterEntries } from '../partyView';
import type { Hud } from '../../ui/hud';
import { commandForKey } from '../input/keyboard';
import { preloadSheets, SoftFog } from '../spriteCss';

export const LOCATION_VIEW = { width: 1024, height: 512 }; // two 512-px panes
const PANE = 512;
const MAP_SCALE = 2; // 16-px tiles at 32 px: a 16×16 map fills its pane
const CELL = 16 * MAP_SCALE;
const MAX_DEPTH = 4;
const F = PANE / 3; // focal length (~112° view). Was PANE / 4 (~127°): near walls looked stretched; PANE / 2 hides doors beside you
const Z_NEAR = 0.25;

const FOG_COLOUR = 0x000000;
const DOOR_WOOD = 0x8b5a2b;
const DOOR_FRAME = 0x3b230c;
const NIGHT_COLOUR = 0x0a0f2e;
const NIGHT_ALPHA = 0.55; // how dark full night gets outdoors
const NIGHT_SKY = 0x0b1230;

type Style = 'cave' | 'ruins' | 'town' | 'interior';
const STYLES: Record<Style, { ceiling: number; floor: number; fog: number; minLight: number; sky?: boolean }> = {
  cave: { ceiling: 0x000000, floor: 0x8a5a2b, fog: 0.2, minLight: 0.15 },
  ruins: { ceiling: 0x0b0b16, floor: 0x7a6a55, fog: 0.13, minLight: 0.25 },
  town: { ceiling: 0x6fb1ec, floor: 0x5d9440, fog: 0.07, minLight: 0.5, sky: true },
  interior: { ceiling: 0x4a3322, floor: 0x7b5a3a, fog: 0.1, minLight: 0.3 }, // rooms upstairs / inside buildings (flat until floor-interior / ceiling-interior art lands)
};
const MATERIALS: Record<string, { face: number; edge: number }> = {
  stone: { face: 0xa3a3a3, edge: 0x1f9e9e }, // grey with teal edges, after the originals
  rock: { face: 0x7d5f42, edge: 0x2e2014 },
  tree: { face: 0x2f7d32, edge: 0x143d16 },
  wood: { face: 0x8b5a2b, edge: 0x3b230c },
  wall: { face: 0x8a8a8a, edge: 0x333333 },
};
/** 3D floor / ceiling art per style (assets.json images): ground variants picked per square; path pieces in towns. */
const FLOOR_TEX: Record<Style, string[]> = {
  cave: ['floor-cave-1', 'floor-cave-2'],
  ruins: ['floor-ruins-1', 'floor-ruins-2'],
  town: ['floor-town-1', 'floor-town-2'],
  interior: ['floor-interior-1'], // floor-interior-2 (stone flags) is for cellars / halls later
};
const CEILING_TEX: Partial<Record<Style, string>> = { interior: 'ceiling-interior' };
const TEX = 128; // floor / ceiling texture size (px)
interface FloorPick {
  data: Uint8ClampedArray;
  turns: number;
}
const BUILDING_LABEL: Record<string, string> = { inn: 'Inn', shop: 'Shop', temple: 'Temple', hall: 'Hall', house: 'House' };
const FACING_NAME = { n: 'N', e: 'E', s: 'S', w: 'W' } as const;

export interface LocationSceneDeps {
  bus: CommandBus;
  hud: Hud;
  game: GameState;
  locationId: string; // key in content/locations.json
  notices: string[]; // messages to show on arrival (fight results, rescues)
  rng: Rng; // exploration dice (random encounters inside)
  arrival?: string; // came by stairs: id of the stairs spot to arrive at (in front of it)
}

export class LocationScene extends Phaser.Scene {
  private deps!: LocationSceneDeps;
  private map!: LocationMap;
  private name = '';
  private style: Style = 'cave';
  private pose!: Pose;
  private view!: Pane; // the 3D view: a 2D canvas (so walls can be textured), shown as one image
  private viewTex!: Phaser.Textures.CanvasTexture;
  private wallTex: Record<string, CanvasImageSource[]> = {}; // wall textures per material (assets.json images wall-<material>[-n]); a square picks one by its variant
  private wallImg?: CanvasImageSource; // the texture chosen for the face being drawn
  private upperImg?: CanvasImageSource; // wall-stone-upper (storeys above the first), else wall-stone again
  private roofImg?: CanvasImageSource; // roof-tile: transparent top half, so the sky shows behind it
  private texPixels = new Map<string, Uint8ClampedArray | null>(); // decoded floor / ceiling textures
  private floorBuf?: ImageData; // scratch buffer for the per-pixel floor and ceiling
  private roofShaded = new Map<number, HTMLCanvasElement>(); // the roof tile pre-darkened per light step
  private arrow!: Phaser.GameObjects.Graphics;
  private night!: Phaser.GameObjects.Rectangle;
  private fog!: SoftFog;
  private leader?: Phaser.GameObjects.Image; // the party's first (living) member stands for the party on the map
  private busy = false;
  private log: string[] = [];

  constructor() {
    super('location');
  }

  init(deps: LocationSceneDeps): void {
    // Keep the location's message log when coming back from a fight; start fresh in a new location.
    if (deps.locationId !== this.deps?.locationId || deps.game.location?.id !== deps.locationId) this.log = [];
    this.deps = deps;
    this.busy = false;
  }

  private get mapFile(): string {
    const file = locationContent[this.deps.locationId]?.map;
    if (!file) throw new Error(`Location "${this.deps.locationId}" has no map in locations.json`);
    return file;
  }

  preload(): void {
    preloadSheets(this.load);
    if (!this.cache.tilemap.exists('world')) this.load.tilemapTiledJSON('world', 'assets/maps/world.json');
    this.load.tilemapTiledJSON(`loc:${this.mapFile}`, `assets/maps/${this.mapFile}.json`);
  }

  create(): void {
    const id = this.deps.locationId;
    const key = `loc:${this.mapFile}`;
    this.map = loadLocationMap(this.mapFile, this.cache.tilemap.get(key).data as TiledMap, Object.keys(encounters));
    const world = loadTravelMap(this.cache.tilemap.get('world').data as TiledMap).locations.find((l) => l.id === id);
    const content = locationContent[id];
    this.name = world?.name ?? content?.name ?? id;
    this.style = (world?.kind ?? content?.style ?? 'cave') as Style;

    // Overhead map in the right pane.
    const tm = this.make.tilemap({ key });
    const tilesets = [tm.addTilesetImage('tiny-battle', 'battle')!, tm.addTilesetImage('tiny-dungeon', 'dungeon')!];
    for (const name of ['ground', 'structures']) {
      tm.createLayer(name, tilesets, PANE, 0)?.setScale(MAP_SCALE).setDepth(1);
      if (name === 'ground') drawRoads(this, tm, 'ground', MAP_SCALE, PANE, 0, 1); // auto-tiled path art over road squares
    }
    this.add.rectangle(PANE, 0, 3, PANE, 0x000000).setOrigin(0.5, 0).setDepth(3); // pane divider
    if (this.textures.exists('loc:view')) this.textures.remove('loc:view');
    this.viewTex = this.textures.createCanvas('loc:view', PANE, PANE)!;
    this.view = new Pane(this.viewTex.getContext());
    this.add.image(0, 0, 'loc:view').setOrigin(0, 0).setDepth(0);
    this.arrow = this.add.graphics().setDepth(4);
    this.leader = undefined;
    // night under an open sky: a dark blue wash over the 3D view and the map (the party stays lit)
    this.night = this.add.rectangle(0, 0, PANE * 2, PANE, NIGHT_COLOUR).setOrigin(0, 0).setDepth(2).setAlpha(0);
    this.fog = new SoftFog(this, 'fog:location', PANE, 0, this.map.width, this.map.height, CELL, 2.5); // unexplored squares of the overhead map

    // Resume where the party stood (back from a fight), or walk in at the entrance.
    const saved = this.deps.game.location;
    const arrivalSpot = this.deps.arrival ? this.map.spots.find((x) => x.kind === 'stairs' && x.id === this.deps.arrival) : undefined;
    const resuming = saved?.id === id;
    this.pose = arrivalSpot ? stairsArrival(arrivalSpot) : resuming ? { x: saved.x, y: saved.y, facing: saved.facing } : { ...this.map.entrance };
    const hud = this.deps.hud;
    hud.setCombatControls(false);
    hud.setOutcome('none');
    hud.setEndTurnHint(false);
    hud.setNames(this.deps.game.roster.map((p) => ({ name: p.name, side: 'party' as const })));
    hud.setPlace(null);
    if (arrivalSpot) this.say(`You ${arrivalSpot.dir === 'down' ? 'climb up from below' : 'come down the stairs'} into ${this.name}.`);
    else if (!resuming) this.say(locationContent[id]?.intro ?? `You enter ${this.name}.`);
    else {
      const here = spotAt(this.map, this.pose.x, this.pose.y);
      if (here?.kind === 'fight' && this.cleared(here)) this.say(`The ${here.name} falls silent. The way is clear.`);
      else this.deps.hud.setLog(this.log);
    }
    for (const n of this.deps.notices) this.say(n);
    this.render();
    if (resuming && !arrivalSpot) this.showSpotPanel(spotAt(this.map, this.pose.x, this.pose.y));

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
      if (p.x >= PANE) {
        this.deps.bus.dispatch({ type: 'moveTo', x: Math.floor((p.x - PANE) / CELL), y: Math.floor(p.y / CELL) });
      } else if (p.x < PANE / 3) this.deps.bus.dispatch({ type: 'turn', dir: 'left' });
      else if (p.x > (2 * PANE) / 3) this.deps.bus.dispatch({ type: 'turn', dir: 'right' });
      else this.deps.bus.dispatch({ type: 'step', dir: 'forward' });
    });
  }

  private handle(cmd: Command): void {
    if (cmd.type === 'leavePlace') return this.deps.hud.setPlace(null);
    if (this.busy) return;
    switch (cmd.type) {
      // Keyboard arrows/WASD arrive as compass moves; inside a location they mean
      // forward/back/turn, Gold Box style. Q/E (nw/ne) step sideways.
      case 'move': {
        const map: Partial<Record<typeof cmd.dir, Command>> = {
          n: { type: 'step', dir: 'forward' },
          s: { type: 'step', dir: 'back' },
          w: { type: 'turn', dir: 'left' },
          e: { type: 'turn', dir: 'right' },
          nw: { type: 'step', dir: 'left' },
          ne: { type: 'step', dir: 'right' },
        };
        const mapped = map[cmd.dir];
        if (mapped) this.handle(mapped);
        break;
      }
      case 'turn':
        this.turn(cmd.dir);
        break;
      case 'step':
        this.step(cmd.dir);
        break;
      case 'encamp':
        this.encamp();
        break;
      case 'templeHeal':
      case 'templeRaise': {
        const g = this.deps.game;
        const err =
          cmd.type === 'templeHeal'
            ? templeHeal(g, g.party, statsOf(g.roster), templePrices)
            : templeRaise(g, g.party.find((p) => p.id === cmd.characterId)!, templePrices);
        if (err) this.say(err);
        else this.say(cmd.type === 'templeHeal' ? 'The priests lay hands on the wounded. Everyone is whole again.' : 'Candles flare. A gasp, a cough — they live again (1 HP).');
        this.render();
        this.showSpotPanel(spotAt(this.map, this.pose.x, this.pose.y));
        break;
      }
      case 'moveTo': {
        const lockedDoor = doorLocked(spotAt(this.map, cmd.x, cmd.y), this.deps.game.flags);
        if (lockedDoor) {
          this.say(`The door of ${spotAt(this.map, cmd.x, cmd.y)!.name} is locked.`);
          break;
        }
        const path = findPath4(this.map, this.pose, cmd, (x, y) => this.lockedAt(x, y) || this.unseen(x, y));
        if (path?.length) this.walk(path);
        break;
      }
      default:
        break;
    }
  }

  private turn(t: Turn): void {
    this.deps.hud.setPlace(null);
    this.pose = { ...this.pose, facing: turn(this.pose.facing, t) };
    this.render();
  }

  /** A locked door at (x, y)? (blocks steps and paths; drawn barred in the 3D view) */
  private lockedAt = (x: number, y: number): boolean => doorLocked(spotAt(this.map, x, y), this.deps.game.flags);

  private step(d: StepDir): void {
    const next = tryStep(this.map, this.pose, d, this.lockedAt);
    if (!next) {
      const ahead = tryStep(this.map, this.pose, d); // open but for a locked door?
      if (ahead && this.lockedAt(ahead.x, ahead.y)) {
        this.say(`The door of ${spotAt(this.map, ahead.x, ahead.y)!.name} is locked.`);
        this.cameras.main.shake(80, 0.004);
        return;
      }
      this.deps.hud.setStatus(`${this.name} · Something blocks the way.`);
      this.cameras.main.shake(80, 0.004);
      return;
    }
    this.moveTo(next);
    if (this.wanderCheck()) return;
    this.arrive();
  }

  /** Something wandering the halls (locations.json `wander`) may find the party on a quiet square. */
  private wanderCheck(): boolean {
    const w = locationContent[this.deps.locationId]?.wander;
    if (!w) return false;
    const { x, y } = this.pose;
    const busySquare = isExit(this.map, x, y) || !!spotAt(this.map, x, y);
    const met = locationWanderCheck(this.deps.game, this.name, w, wandering.grace, busySquare, this.deps.rng);
    if (!met) return false;
    this.busy = false;
    this.deps.bus.dispatch({ type: 'wander', dialog: met.dialog, difficulty: met.difficulty, share: met.share });
    return true;
  }

  private walk(path: readonly Pose['facing'][]): void {
    this.busy = true;
    const next = (i: number) => {
      const dir = path[i];
      const [dx, dy] = FACING_VECTORS[dir];
      this.moveTo({ x: this.pose.x + dx, y: this.pose.y + dy, facing: dir });
      if (this.wanderCheck()) return;
      // Stop early for anything that needs the player: exits, buildings, uncleared fights.
      // Messages (text spots) are shown in passing.
      const spot = spotAt(this.map, this.pose.x, this.pose.y);
      const stopsHere =
        isExit(this.map, this.pose.x, this.pose.y) ||
        spot?.kind === 'building' ||
        spot?.kind === 'stairs' ||
        (spot?.kind === 'fight' && !this.cleared(spot));
      if (i === path.length - 1 || stopsHere) {
        this.busy = false;
        this.arrive();
      } else {
        if (spot?.kind === 'text') this.say(spot.description);
        this.time.delayedCall(110, () => next(i + 1));
      }
    };
    this.deps.hud.setPlace(null);
    next(0);
  }

  private moveTo(p: Pose): void {
    this.deps.hud.setPlace(null);
    this.pose = p;
    this.deps.game.time += MINUTES.locationStep;
    for (const name of passTime(this.deps.game.party, statsOf(this.deps.game.roster), this.deps.game.time)) this.say(`${name} comes round (1 HP).`);
    this.render();
  }

  /** What happens on the square the party just stepped onto. */
  private arrive(): void {
    const { x, y } = this.pose;
    if (isExit(this.map, x, y)) {
      this.say(`You leave ${this.name}.`);
      this.busy = true;
      this.time.delayedCall(350, () => this.deps.bus.dispatch({ type: 'leaveLocation' }));
      return;
    }
    const spot = spotAt(this.map, x, y);
    if (!spot) return;
    if (spot.kind === 'text') return this.say(spot.description);
    if (spot.kind === 'stairs') {
      this.say(spot.description || `You ${spot.dir === 'down' ? 'go down' : 'climb'} the stairs.`);
      this.busy = true;
      this.time.delayedCall(350, () => this.deps.bus.dispatch({ type: 'takeStairs', to: spot.to!, link: spot.link! }));
      return;
    }
    if (spot.kind === 'building') {
      this.say(`You step into ${spot.name}.`);
      return this.showSpotPanel(spot);
    }
    // fight
    if (this.cleared(spot)) return this.say(`${spot.name}: all is quiet now.`);
    this.say(spot.description);
    this.busy = true; // a beat to read it, then into battle
    this.time.delayedCall(900, () => this.deps.bus.dispatch(this.fightCommand(spot)));
  }

  /** Camp here: dungeons anywhere quiet; in town only at an inn. */
  private encamp(): void {
    if (this.style === 'town') return this.say(`No camping in the streets of ${this.name} — take a room at the inn.`);
    const check = locationCampCheck(this.map, this.pose);
    if (!check.ok) return this.say(check.reason);
    const kind = this.style === 'cave' ? 'cave' : 'ruins';
    this.deps.bus.dispatch({
      type: 'camp',
      site: { kind, name: `Camp in ${this.name}`, risk: SITE_RISK[kind], ambush: 'ambush-dark' },
    });
  }

  private cleared(spot: Spot): boolean {
    return this.deps.game.flags[`cleared:${this.deps.locationId}:${spot.id}`] === true;
  }

  private fightCommand(spot: Spot): Command {
    return { type: 'fight', encounter: spot.encounter!, origin: `${this.deps.locationId}:${spot.id}` };
  }

  /** Panel for a building, or for an unfinished fight when coming back to it. */
  private showSpotPanel(spot: Spot | undefined): void {
    if (!spot) return;
    if (spot.kind === 'building') {
      this.deps.hud.setPlace({
        name: spot.name,
        kind: BUILDING_LABEL[spot.building!] ?? 'Building',
        description: spot.description,
        picture: spotPicture(spot, this.deps.game.flags),
        actions: [
          ...this.buildingActions(spot),
          { label: 'Leave', command: { type: 'leavePlace' } },
        ],
      });
    } else if (spot.kind === 'fight' && !this.cleared(spot)) {
      this.deps.hud.setPlace({
        name: spot.name,
        kind: 'Danger',
        description: spot.description,
        actions: [{ label: 'Fight', command: this.fightCommand(spot) }, { label: 'Back away', command: { type: 'leavePlace' } }],
      });
    }
  }

  /**
   * What you can do in a building: quest hooks first (people to talk to,
   * things to buy), then the building's own services — unless a hook
   * replaces them (a shrine full of rats has no temple services).
   */
  private buildingActions(spot: Spot): { label: string; command?: Command }[] {
    const hooks = hooksAt(this.deps.game, questData, `${this.deps.locationId}/${spot.name}`);
    const hookActions = hooks.map((h) => ({ label: h.label ?? 'Look around', command: { type: 'hook', index: questData.hooks.indexOf(h) } as Command }));
    if (hooks.some((h) => h.replaces)) return hookActions;
    return [...hookActions, ...this.services(spot)];
  }

  private services(spot: Spot): { label: string; command?: Command }[] {
    const g = this.deps.game;
    if (spot.building === 'inn') {
      return [
        { label: 'Take rooms and rest', command: { type: 'camp', site: { kind: 'inn', name: spot.name, risk: 0 } } },
        { label: 'Party roster (recruit, dismiss)', command: { type: 'partyScreen' } },
      ];
    }
    if (spot.building === 'shop') return [{ label: 'Browse the wares', command: { type: 'openShop', name: spot.name, picture: spotPicture(spot, this.deps.game.flags) } }];
    if (spot.building === 'temple') {
      const stats = statsOf(g.roster);
      const cost = healCost(g.party, stats, templePrices);
      const actions: { label: string; command?: Command }[] = [
        cost
          ? { label: `Heal the wounded (${formatCoins(cost)})`, command: { type: 'templeHeal' } }
          : { label: 'Nobody needs healing' },
      ];
      for (const p of g.party.filter((m) => m.dead)) {
        const name = g.roster.find((r) => r.id === p.id)?.name ?? p.id;
        actions.push({ label: `Raise ${name} from the dead (${formatCoins(templePrices.raiseDead)})`, command: { type: 'templeRaise', characterId: p.id } });
      }
      return actions;
    }
    return spot.building === 'hall' ? [] : [{ label: 'Nothing to do here yet' }];
  }

  private say(line: string): void {
    this.log.push(line);
    this.deps.hud.setLog(this.log);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    const game = this.deps.game;
    game.location = { id: this.deps.locationId, ...this.pose };
    this.explore();
    this.drawView();
    this.drawArrow();
    this.night.setAlpha(STYLES[this.style].sky ? NIGHT_ALPHA * darkness(game.time) : 0);
    const where = `${this.pose.x},${this.pose.y} ${FACING_NAME[this.pose.facing]}`;
    const clock = formatClock(game.time);
    this.deps.hud.setStatus(`${this.name} · ${where} · ${clock}`);
    this.deps.hud.setExplore({
      title: this.name,
      partyName: game.partyName,
      party: rosterEntries(this.textures, game),
      where,
      clock,
      purse: formatCoins(game.coins),
    });
  }

  /** Fog of war: reveal what the party sees from here (remembered for good), then hide the rest. */
  private explore(): void {
    const game = this.deps.game;
    const id = this.deps.locationId;
    const town = this.style === 'town';
    const sight = locationContent[id]?.sight ?? (town ? SIGHT.town : this.style === 'interior' ? SIGHT.interior : SIGHT.dungeon);
    const seenNow = visibleSquares(this.map, this.pose.x, this.pose.y, sight, !town);
    const mask = markSeen(game.explored?.[id], this.map.width * this.map.height, seenNow);
    game.explored = { ...game.explored, [id]: mask };
    this.fog.update((x, y) => !isSeen(mask, y * this.map.width + x), FOG_COLOUR);
  }

  /** Squares still under the fog (click-walking can't aim at or route through them). */
  private unseen = (x: number, y: number): boolean => !isSeen(this.deps.game.explored?.[this.deps.locationId], y * this.map.width + x);

  /** The party on the overhead map: the leader's icon, with a small arrow on top showing which way they face. */
  private drawArrow(): void {
    const g = this.arrow.clear();
    const cx = PANE + this.pose.x * CELL + CELL / 2;
    const cy = this.pose.y * CELL + CELL / 2;
    const game = this.deps.game;
    const first = game.roster.find((r) => !game.party.find((p) => p.id === r.id)?.dead) ?? game.roster[0];
    const tex = first ? spriteTexture(first.sprite) : undefined;
    if (tex) {
      if (!this.leader) this.leader = this.add.image(cx, cy, tex.key, tex.frame).setScale(MAP_SCALE).setDepth(3.5);
      this.leader.setTexture(tex.key, tex.frame).setPosition(cx, cy);
    }
    const [fx, fy] = FACING_VECTORS[this.pose.facing];
    // a small triangle on the facing edge of the square, over the icon
    const r = CELL * 0.22;
    const ox = cx + fx * CELL * 0.36;
    const oy = cy + fy * CELL * 0.36;
    const tip = { x: ox + fx * r, y: oy + fy * r };
    const left = { x: ox - fx * r * 0.5 + fy * r, y: oy - fy * r * 0.5 - fx * r };
    const right = { x: ox - fx * r * 0.5 - fy * r, y: oy - fy * r * 0.5 + fx * r };
    g.fillStyle(0xf1c40f, 1).lineStyle(2, 0x000000, 1);
    g.fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    g.strokeTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
  }

  /** Gold Box-style first-person view: shaded floor/ceiling bands, then walls far → near. */
  private drawView(): void {
    const g = this.view.clear();
    const tex = (id: string) => (this.textures.exists(imageKey(id)) ? (this.textures.get(imageKey(id)).getSourceImage() as CanvasImageSource) : undefined);
    this.wallTex = {};
    for (const m of ['stone', 'rock', 'tree', 'wood']) {
      const list = [tex(`wall-${m}`), tex(`wall-${m}-1`), tex(`wall-${m}-2`)].filter((t): t is CanvasImageSource => !!t);
      if (list.length) this.wallTex[m] = list;
    }
    this.upperImg = tex('wall-stone-upper');
    this.roofImg = tex('roof-tile');
    const st = STYLES[this.style];
    const cy = PANE / 2;
    const light = (z: number) => Math.max(st.minLight, 1 - st.fog * z);
    const half = (z: number) => (F * 0.5) / z; // half the wall height on screen at depth z

    // Background: darkest far colour, then floor/ceiling bands from far to near.
    g.fillStyle(shade(st.floor, light(MAX_DEPTH + 1)), 1).fillRect(0, cy, PANE, cy);
    const sky = st.sky ? mix(st.ceiling, NIGHT_SKY, darkness(this.deps.game.time)) : shade(st.ceiling, light(MAX_DEPTH + 1));
    g.fillStyle(sky, 1).fillRect(0, 0, PANE, cy);
    const bounds = [MAX_DEPTH + 0.5];
    for (let z = MAX_DEPTH - 0.5; z >= 0.5; z--) bounds.push(z);
    bounds.push(Z_NEAR);
    for (let i = 0; i < bounds.length - 1; i++) {
      const far = bounds[i];
      const near = bounds[i + 1];
      const lit = light((far + near) / 2);
      const y0 = half(far);
      const y1 = Math.min(cy, half(near));
      g.fillStyle(shade(st.floor, lit), 1).fillRect(0, cy + y0, PANE, y1 - y0);
      if (!st.sky) g.fillStyle(shade(st.ceiling, lit), 1).fillRect(0, cy - y1, PANE, y1 - y0);
    }

    this.paintFloorAndCeiling(light);

    // far → near: the walls at each depth, then the props standing at that depth
    const faces = viewFaces(this.map, this.pose, MAX_DEPTH, this.lockedAt, this.style === 'town');
    const props = viewProps(this.map, this.pose, MAX_DEPTH);
    let pi = 0;
    for (const face of faces) {
      while (pi < props.length && props[pi].depth > face.depth) this.drawProp(g, props[pi++], light);
      this.drawFace(g, face, light);
    }
    while (pi < props.length) this.drawProp(g, props[pi++], light);
    this.viewTex.refresh();
  }


  /** Decoded pixels of an assets.json image (cached), or null when it isn't loaded. */
  private pixelsOf(id: string): Uint8ClampedArray | null {
    if (this.texPixels.has(id)) return this.texPixels.get(id)!;
    let data: Uint8ClampedArray | null = null;
    if (this.textures.exists(imageKey(id))) {
      const c = document.createElement('canvas');
      c.width = c.height = TEX;
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(this.textures.get(imageKey(id)).getSourceImage() as CanvasImageSource, 0, 0, TEX, TEX);
      data = x.getImageData(0, 0, TEX, TEX).data;
    }
    this.texPixels.set(id, data);
    return data;
  }

  /** Which floor texture covers a map square (and how it is turned): path pieces on roads, matching grass beside them. */
  private floorPick(x: number, y: number): FloorPick | undefined {
    const m = this.map;
    const inside = x >= 0 && y >= 0 && x < m.width && y < m.height;
    if (this.style === 'town' && inside) {
      if (roadAt(m, x, y)) {
        const { piece, turns } = floorPiece(roadAt(m, x, y - 1), roadAt(m, x + 1, y), roadAt(m, x, y + 1), roadAt(m, x - 1, y));
        const data = this.pixelsOf(`floor-path-${piece}`);
        if (data) return { data, turns };
      } else {
        let nearRoad = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside && (dx || dy) && roadAt(m, x + dx, y + dy) && x + dx >= 0 && y + dy >= 0 && x + dx < m.width && y + dy < m.height) nearRoad = true;
        const data = nearRoad ? this.pixelsOf('floor-town-path') : null;
        if (data) return { data, turns: 0 };
      }
    }
    const ids = FLOOR_TEX[this.style];
    const data = this.pixelsOf(ids[squareVariant(x, y) % ids.length]);
    return data ? { data, turns: 0 } : undefined;
  }

  /**
   * Textured floor (and an interior ceiling): for each pixel row below the horizon the depth is z = F·0.5 / (row − horizon);
   * each pixel then maps to a world point and so to a texture pixel of that map square. Lit by the same fog as walls.
   * Rows beyond the draw distance keep the flat far colour painted before. Skipped where no art is loaded.
   */
  private paintFloorAndCeiling(light: (z: number) => number): void {
    const ceilId = CEILING_TEX[this.style];
    const ceil = ceilId ? this.pixelsOf(ceilId) : null;
    if (!FLOOR_TEX[this.style].some((id) => this.pixelsOf(id)) && !ceil) return;
    const cx = PANE / 2;
    const cy = PANE / 2;
    const [fx, fy] = FACING_VECTORS[this.pose.facing];
    const [rx, ry] = FACING_VECTORS[turn(this.pose.facing, 'right')];
    const camX = this.pose.x + 0.5;
    const camY = this.pose.y + 0.5;
    const zMax = MAX_DEPTH + 0.5;
    const buf = (this.floorBuf ??= new ImageData(PANE, PANE));
    const px = new Uint32Array(buf.data.buffer);
    const picks = new Map<number, FloorPick | undefined>();
    const pickAt = (x: number, y: number) => {
      const key = (y + 64) * 256 + (x + 64);
      if (!picks.has(key)) picks.set(key, this.floorPick(x, y));
      return picks.get(key);
    };
    for (const ceiling of [false, true]) {
      if (ceiling && !ceil) continue;
      let first = -1;
      let last = -1;
      for (let y = ceiling ? 0 : cy; y < (ceiling ? cy : PANE); y++) {
        const dy = ceiling ? cy - (y + 0.5) : y + 0.5 - cy;
        const z = (F * 0.5) / dy;
        if (z > zMax) continue;
        if (first < 0) first = y;
        last = y;
        const shade = light(z);
        for (let x = 0; x < PANE; x++) {
          const X = ((x + 0.5 - cx) * z) / F;
          const wx = camX + fx * z + rx * X;
          const wy = camY + fy * z + ry * X;
          const gx = Math.floor(wx);
          const gy = Math.floor(wy);
          let data: Uint8ClampedArray | undefined = ceil ?? undefined;
          let turns = 0;
          if (!ceiling) {
            const pick = pickAt(gx, gy);
            if (!pick) continue;
            data = pick.data;
            turns = pick.turns;
          }
          const [tu, tv] = turnedUV(wx - gx, wy - gy, turns);
          const i = ((Math.min(TEX - 1, Math.floor(tv * TEX)) * TEX + Math.min(TEX - 1, Math.floor(tu * TEX))) << 2) as number;
          px[y * PANE + x] = (255 << 24) | ((data![i + 2] * shade) << 16) | ((data![i + 1] * shade) << 8) | (data![i] * shade);
        }
      }
      if (first >= 0) this.view.ctx.putImageData(buf, 0, 0, 0, first, PANE, last - first + 1);
    }
  }

  private drawFace(g: Pane, f: Face, light: (z: number) => number): void {
    const cx = PANE / 2;
    const cy = PANE / 2;
    const mat = MATERIALS[f.material] ?? MATERIALS.wall;
    const project = (X: number, z: number) => ({ x: cx + (F * X) / z, top: cy - (F * (f.height - 0.5)) / z, bottom: cy + (F * 0.5) / z });
    let pts: Phaser.Math.Vector2[];
    let zMid: number;
    if (f.kind === 'front') {
      const a = project(f.X0, f.z0);
      const b = project(f.X1, f.z0);
      pts = quad(a, b);
      zMid = f.z0;
    } else {
      const z0 = Math.max(f.z0, Z_NEAR);
      if (f.z1 <= z0) return;
      const a = project(f.X0, z0);
      const b = project(f.X0, f.z1);
      pts = quad(a, b);
      zMid = (z0 + f.z1) / 2;
    }
    const lit = light(zMid) * (f.kind === 'front' ? 1 : 0.78);
    const variants = this.wallTex[f.material];
    if (variants) {
      this.wallImg = variants[f.variant % variants.length];
      this.drawTexturedFace(g, f, lit, pts); // brick texture, then the light level as a black wash
    } else g.fillStyle(shade(mat.face, lit), 1).fillPoints(pts, true);
    g.lineStyle(2, shade(mat.edge, Math.max(0.5, lit)), 1).strokePoints(pts, true);
    if (f.roof && !this.roofImg) this.drawRoofPlaceholder(g, f, lit);
    if (f.feature) this.drawFeature(g, f, lit);
    else if (f.door) this.drawDoor(g, f, lit);
  }

  /** A point on a face: u across it (0..1), h up from the floor in wall tiles (can exceed 1 for tall walls and roofs). */
  private facePoint(f: Face, u: number, h: number): Phaser.Math.Vector2 {
    const X = f.kind === 'front' ? f.X0 + (f.X1 - f.X0) * u : f.X0;
    let z = f.kind === 'front' ? f.z0 : f.z0 + (f.z1 - f.z0) * u;
    z = Math.max(z, Z_NEAR);
    return new Phaser.Math.Vector2(PANE / 2 + (F * X) / z, PANE / 2 + (F * (0.5 - h)) / z);
  }


  /** A prop as a billboard: `prop-<id>` art (128 px, transparent, base on the floor, one tile wide) or a code-drawn placeholder. */
  private drawProp(g: Pane, v: ViewProp, light: (z: number) => number): void {
    const z = v.depth;
    const cx = PANE / 2;
    const cy = PANE / 2;
    const lit = light(z);
    const size = F / z; // one tile on screen
    const left = cx + (F * v.lateral) / z - size / 2;
    const bottom = cy + (F * 0.5) / z;
    if (left > PANE || left + size < 0) return;
    const img = this.textures.exists(imageKey(`prop-${v.prop}`)) ? this.propAt(v.prop, lit) : undefined;
    if (img) {
      g.ctx.drawImage(img, left, bottom - size, size, size);
      return;
    }
    // placeholder shapes (u across the tile, h up from the floor, both 0..1) until the art lands
    const at = (u: number, h: number) => new Phaser.Math.Vector2(left + u * size, bottom - h * size);
    const box = (u0: number, u1: number, h0: number, h1: number, colour: number) =>
      g.fillStyle(shade(colour, Math.max(0.3, lit)), 1).fillPoints([at(u0, h0), at(u1, h0), at(u1, h1), at(u0, h1)], true);
    if (v.prop === 'chest') {
      box(0.18, 0.82, 0, 0.3, 0x7a4a1c); // body
      box(0.16, 0.84, 0.3, 0.44, 0x5d3714); // lid
      box(0.46, 0.54, 0.22, 0.38, 0xd8c06a); // clasp
    } else if (v.prop === 'well') {
      box(0.14, 0.86, 0, 0.36, 0x8a8f96); // stone ring
      box(0.2, 0.8, 0.3, 0.38, 0x1d3a5a); // water
      box(0.2, 0.27, 0.36, 0.86, 0x5d3714); // posts
      box(0.73, 0.8, 0.36, 0.86, 0x5d3714);
      g.fillStyle(shade(0x8f3e2a, Math.max(0.3, lit)), 1).fillPoints([at(0.08, 0.84), at(0.92, 0.84), at(0.5, 1)], true); // roof
    } else box(0.25, 0.75, 0, 0.6, 0xb04bd8); // unknown prop: a purple block
  }

  /** A prop image pre-darkened to a light step (cached; keeps its transparency). */
  private propShaded = new Map<string, HTMLCanvasElement>();
  private propAt(id: string, lit: number): CanvasImageSource {
    const step = Math.max(0, Math.min(8, Math.round(lit * 8)));
    const key = `${id}:${step}`;
    let c = this.propShaded.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d')!;
      x.imageSmoothingEnabled = false;
      x.drawImage(this.textures.get(imageKey(`prop-${id}`)).getSourceImage() as CanvasImageSource, 0, 0, 128, 128);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = `rgba(0,0,0,${1 - step / 8})`;
      x.fillRect(0, 0, 128, 128);
      this.propShaded.set(key, c);
    }
    return c;
  }

  /** The roof tile darkened to a light level (cached in 8 steps), so its transparent half stays transparent. */
  private roofAt(lit: number): CanvasImageSource {
    const step = Math.max(0, Math.min(8, Math.round(lit * 8)));
    let c = this.roofShaded.get(step);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d')!;
      x.imageSmoothingEnabled = false;
      x.drawImage(this.roofImg!, 0, 0, 128, 128);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = `rgba(0,0,0,${1 - step / 8})`;
      x.fillRect(0, 0, 128, 128);
      this.roofShaded.set(step, c);
    }
    return c;
  }

  /** Placeholder roof (a flat-coloured cap) until roof-tile art arrives: half a wall tile above the top. */
  private drawRoofPlaceholder(g: Pane, f: Face, lit: number): void {
    const H = f.height;
    const band = [this.facePoint(f, 0, H), this.facePoint(f, 1, H), this.facePoint(f, 1, H + 0.45), this.facePoint(f, 0, H + 0.45)];
    g.fillStyle(shade(0x8f3e2a, Math.max(0.4, lit)), 1).fillPoints(band, true);
    g.lineStyle(2, shade(0x3b1a10, Math.max(0.5, lit)), 1).strokePoints(band, true);
  }

  /**
   * A face with the wall image: one 1-px column of the texture per screen column, stretched to the wall's height there,
   * one tile per storey, then the roof tile on top. Front faces map the texture across the square; side faces map it by
   * world depth (perspective-correct).
   */
  private drawTexturedFace(g: Pane, f: Face, lit: number, pts: Phaser.Math.Vector2[]): void {
    const cx = PANE / 2;
    const cy = PANE / 2;
    const T = 128; // texture size (px)
    const H = f.height;
    const roof = f.roof && this.roofImg ? this.roofAt(lit) : undefined;
    const cols = (xa: number, xb: number, at: (x: number) => { u: number; z: number }) => {
      const lo = Math.max(0, Math.ceil(Math.min(xa, xb)));
      const hi = Math.min(PANE - 1, Math.floor(Math.max(xa, xb)));
      for (let x = lo; x <= hi; x++) {
        const { u, z } = at(x + 0.5);
        const sx = Math.min(T - 1, Math.max(0, Math.floor(u * T)));
        const unit = F / z;
        for (let i = 0; i < H; i++) {
          const frac = Math.min(1, H - i); // the last storey of a low wall is only partly tall: draw the bottom of the tile
          g.ctx.drawImage(i === 0 || f.material !== 'stone' ? this.wallImg! : (this.upperImg ?? this.wallImg!), sx, T * (1 - frac), 1, T * frac, x, cy + (F * (0.5 - (i + frac))) / z, 1, unit * frac + 0.5);
        }
        if (roof) g.ctx.drawImage(roof, sx, 0, 1, T, x, cy + (F * (0.5 - (H + 1))) / z, 1, unit + 0.5);
      }
    };
    if (f.kind === 'front') {
      const xa = cx + (F * f.X0) / f.z0;
      const xb = cx + (F * f.X1) / f.z0;
      cols(xa, xb, (x) => ({ u: (x - xa) / (xb - xa), z: f.z0 }));
    } else {
      const z0 = Math.max(f.z0, Z_NEAR);
      if (f.z1 <= z0) return;
      const xa = cx + (F * f.X0) / z0;
      const xb = cx + (F * f.X0) / f.z1;
      cols(xa, xb, (x) => {
        const z = (F * f.X0) / (x - cx); // depth at this screen column
        return { u: (z - f.z0) / (f.z1 - f.z0), z };
      });
    }
    // light level: black wash over the wall with the same factor as the flat colours use
    const wash = Math.min(1, Math.max(0, 1 - lit));
    if (wash > 0.001) g.fillStyle(0x000000, wash).fillPoints(pts, true);
  }

  /**
   * A gate or a staircase set into a wall face (placeholder shapes until the gate-exit / stairs-up /
   * stairs-down art arrives). Same frame as a door: u across the face, h up from the floor.
   */
  private drawFeature(g: Pane, f: Face, lit: number): void {
    const cx = PANE / 2;
    const cy = PANE / 2;
    const at = (u: number, h: number): Phaser.Math.Vector2 => {
      const X = f.kind === 'front' ? f.X0 + (f.X1 - f.X0) * u : f.X0;
      let z = f.kind === 'front' ? f.z0 : f.z0 + (f.z1 - f.z0) * u;
      z = Math.max(z, Z_NEAR);
      return new Phaser.Math.Vector2(cx + (F * X) / z, cy + (F * (0.5 - h)) / z);
    };
    const rect = (u0: number, u1: number, h0: number, h1: number) => [at(u0, h0), at(u1, h0), at(u1, h1), at(u0, h1)];
    const dark = Math.max(0.45, lit);
    if (f.feature === 'gate') {
      // an arch: stone posts, the road and the open country beyond
      g.fillStyle(shade(0x6fb1ec, lit), 1).fillPoints(rect(0.2, 0.8, 0.3, 0.86), true); // sky beyond
      g.fillStyle(shade(0x5d9440, lit), 1).fillPoints(rect(0.2, 0.8, 0, 0.3), true); // grass beyond
      g.fillStyle(shade(0xc99a63, lit), 1).fillPoints(rect(0.4, 0.6, 0, 0.3), true); // the road
      g.fillStyle(shade(0x9a9a9a, dark), 1);
      g.fillPoints(rect(0.12, 0.2, 0, 0.9), true).fillPoints(rect(0.8, 0.88, 0, 0.9), true).fillPoints(rect(0.12, 0.88, 0.86, 0.94), true);
      return;
    }
    const up = f.feature === 'stairs-up';
    g.fillStyle(shade(0x16110d, dark), 1).fillPoints(rect(0.15, 0.85, 0, 0.8), true); // the opening
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      // up: steps rise toward the top of the opening; down: they sink into the dark
      const h0 = up ? 0.04 + i * 0.13 : 0.4 - i * 0.07;
      const h1 = up ? h0 + 0.1 : h0 + 0.05;
      const tone = up ? 0xb9a789 : 0x6b5c47;
      g.fillStyle(shade(tone, Math.max(0.3, dark * (up ? 1 - i * 0.08 : 1 - i * 0.18))), 1).fillPoints(rect(0.2 + i * 0.02, 0.8 - i * 0.02, h0, h1), true);
    }
  }

  /** A wooden door set into a wall face (in perspective); a locked one is barred with iron. */
  private drawDoor(g: Pane, f: Face, lit: number): void {
    const cx = PANE / 2;
    const cy = PANE / 2;
    // a point on the face: u across it (0..1), h up from the floor (0..1)
    const at = (u: number, h: number): Phaser.Math.Vector2 => {
      const X = f.kind === 'front' ? f.X0 + (f.X1 - f.X0) * u : f.X0;
      let z = f.kind === 'front' ? f.z0 : f.z0 + (f.z1 - f.z0) * u;
      z = Math.max(z, Z_NEAR);
      return new Phaser.Math.Vector2(cx + (F * X) / z, cy + (F * (0.5 - h)) / z);
    };
    const rect = (u0: number, u1: number, h0: number, h1: number) => [at(u0, h0), at(u1, h0), at(u1, h1), at(u0, h1)];
    const wood = shade(DOOR_WOOD, lit);
    const dark = shade(DOOR_FRAME, Math.max(0.5, lit));
    g.fillStyle(dark, 1).fillPoints(rect(0.24, 0.76, 0, 0.78), true); // frame
    g.fillStyle(wood, 1).fillPoints(rect(0.28, 0.72, 0, 0.74), true); // door leaf
    g.lineStyle(1, dark, 1);
    for (const u of [0.39, 0.5, 0.61]) g.strokePoints([at(u, 0), at(u, 0.74)], false); // planks
    g.fillStyle(shade(0xd8c06a, Math.max(0.6, lit)), 1).fillPoints(rect(0.62, 0.66, 0.34, 0.39), true); // handle
    if (f.door === 'locked') {
      const iron = shade(0x2b2b2b, Math.max(0.6, lit));
      g.fillStyle(iron, 1);
      for (const h of [0.18, 0.55]) g.fillPoints(rect(0.28, 0.72, h, h + 0.05), true); // iron bands
    }
  }
}

/** The 3D view's drawing surface: the few Graphics calls drawView uses, on a 2D canvas (so walls can carry a texture). */
class Pane {
  private fill = '#000';
  constructor(readonly ctx: CanvasRenderingContext2D) {
    ctx.imageSmoothingEnabled = false;
  }
  private css = (rgb: number, a: number) => `rgba(${(rgb >> 16) & 0xff},${(rgb >> 8) & 0xff},${rgb & 0xff},${a})`;
  clear(): this {
    this.ctx.clearRect(0, 0, PANE, PANE);
    return this;
  }
  fillStyle(rgb: number, a = 1): this {
    this.fill = this.css(rgb, a);
    return this;
  }
  lineStyle(w: number, rgb: number, a = 1): this {
    this.ctx.lineWidth = w;
    this.ctx.strokeStyle = this.css(rgb, a);
    return this;
  }
  fillRect(x: number, y: number, w: number, h: number): this {
    this.ctx.fillStyle = this.fill;
    this.ctx.fillRect(x, y, w, h);
    return this;
  }
  private path(pts: { x: number; y: number }[], close: boolean): void {
    this.ctx.beginPath();
    pts.forEach((p, i) => (i ? this.ctx.lineTo(p.x, p.y) : this.ctx.moveTo(p.x, p.y)));
    if (close) this.ctx.closePath();
  }
  fillPoints(pts: { x: number; y: number }[], close = true): this {
    this.path(pts, close);
    this.ctx.fillStyle = this.fill;
    this.ctx.fill();
    return this;
  }
  strokePoints(pts: { x: number; y: number }[], close = false): this {
    this.path(pts, close);
    this.ctx.stroke();
    return this;
  }
}

const quad = (a: { x: number; top: number; bottom: number }, b: { x: number; top: number; bottom: number }) => [
  new Phaser.Math.Vector2(a.x, a.top),
  new Phaser.Math.Vector2(b.x, b.top),
  new Phaser.Math.Vector2(b.x, b.bottom),
  new Phaser.Math.Vector2(a.x, a.bottom),
];

/** Multiply an RGB colour by a brightness factor. */
/** Blend two colours: t = 0 → a, 1 → b. */
function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function shade(rgb: number, k: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((rgb >> 16) & 0xff) << 16) | (c((rgb >> 8) & 0xff) << 8) | c(rgb & 0xff);
}
