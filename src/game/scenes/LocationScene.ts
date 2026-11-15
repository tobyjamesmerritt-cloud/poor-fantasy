/**
 * Inside a town or dungeon. Left half of the canvas: Gold Box-style
 * first-person view; right half: the overhead map with the party arrow.
 * The HTML side panel (party, position, clock, buttons) and the message log
 * are set through the Hud.
 *
 * All movement and view geometry comes from rules/location.ts; this scene
 * only renders and forwards commands.
 */
import { questData } from '../../content/quests';
import { hooksAt } from '../../rules/quests';
import * as Phaser from 'phaser';
import type { Command, CommandBus } from '../../engine/commands';
import type { GameState } from '../../engine/state';
import { encounters, locationContent } from '../../content/encounters';
import { statsOf } from '../../content/characters';
import { assets } from '../../content/assets';
import { loadLocationMap } from '../../content/locationMap';
import { loadTravelMap, type TiledMap } from '../../content/world';
import {
  type Face,
  FACING_VECTORS,
  findPath4,
  isExit,
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
} from '../../rules/location';
import { formatClock, MINUTES } from '../../rules/time';
import { formatCoins, passTime } from '../../rules/party';
import { healCost, templeHeal, templeRaise, type TemplePrices } from '../../rules/services';
import servicesRaw from '../../content/services.json';

const templePrices = servicesRaw as unknown as TemplePrices;
import { SITE_RISK } from '../../rules/rest';
import { rosterEntries } from '../partyView';
import type { Hud } from '../../ui/hud';
import { commandForKey } from '../input/keyboard';
import { preloadSheets } from '../spriteCss';

export const LOCATION_VIEW = { width: 1024, height: 512 }; // two 512-px panes
const PANE = 512;
const MAP_SCALE = 2; // 16-px tiles at 32 px: a 16×16 map fills its pane
const CELL = 16 * MAP_SCALE;
const MAX_DEPTH = 4;
const F = PANE / 4; // focal length: the near edge of your own square fills the pane
const Z_NEAR = 0.25;

type Style = 'cave' | 'ruins' | 'town';
const STYLES: Record<Style, { ceiling: number; floor: number; fog: number; minLight: number; sky?: boolean }> = {
  cave: { ceiling: 0x000000, floor: 0x8a5a2b, fog: 0.2, minLight: 0.15 },
  ruins: { ceiling: 0x0b0b16, floor: 0x7a6a55, fog: 0.13, minLight: 0.25 },
  town: { ceiling: 0x6fb1ec, floor: 0x5d9440, fog: 0.07, minLight: 0.5, sky: true },
};
const MATERIALS: Record<string, { face: number; edge: number }> = {
  stone: { face: 0xa3a3a3, edge: 0x1f9e9e }, // grey with teal edges, after the originals
  rock: { face: 0x7d5f42, edge: 0x2e2014 },
  tree: { face: 0x2f7d32, edge: 0x143d16 },
  wood: { face: 0x8b5a2b, edge: 0x3b230c },
  wall: { face: 0x8a8a8a, edge: 0x333333 },
};
const BUILDING_LABEL: Record<string, string> = { inn: 'Inn', shop: 'Shop', temple: 'Temple', hall: 'Hall', house: 'House' };
const FACING_NAME = { n: 'N', e: 'E', s: 'S', w: 'W' } as const;

export interface LocationSceneDeps {
  bus: CommandBus;
  hud: Hud;
  game: GameState;
  locationId: string; // key in content/locations.json
  notices: string[]; // messages to show on arrival (fight results, rescues)
}

export class LocationScene extends Phaser.Scene {
  private deps!: LocationSceneDeps;
  private map!: LocationMap;
  private name = '';
  private style: Style = 'cave';
  private pose!: Pose;
  private view!: Phaser.GameObjects.Graphics;
  private arrow!: Phaser.GameObjects.Graphics;
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
    }
    this.add.rectangle(PANE, 0, 3, PANE, 0x000000).setOrigin(0.5, 0).setDepth(3); // pane divider
    this.view = this.add.graphics().setDepth(0);
    this.arrow = this.add.graphics().setDepth(4);
    this.leader = undefined;

    // Resume where the party stood (back from a fight), or walk in at the entrance.
    const saved = this.deps.game.location;
    const resuming = saved?.id === id;
    this.pose = resuming ? { x: saved.x, y: saved.y, facing: saved.facing } : { ...this.map.entrance };
    const hud = this.deps.hud;
    hud.setCombatControls(false);
    hud.setOutcome('none');
    hud.setEndTurnHint(false);
    hud.setNames(this.deps.game.roster.map((p) => ({ name: p.name, side: 'party' as const })));
    hud.setPlace(null);
    if (!resuming) this.say(locationContent[id]?.intro ?? `You enter ${this.name}.`);
    else {
      const here = spotAt(this.map, this.pose.x, this.pose.y);
      if (here?.kind === 'fight' && this.cleared(here)) this.say(`The ${here.name} falls silent. The way is clear.`);
      else this.deps.hud.setLog(this.log);
    }
    for (const n of this.deps.notices) this.say(n);
    this.render();
    if (resuming) this.showSpotPanel(spotAt(this.map, this.pose.x, this.pose.y));

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
        const path = findPath4(this.map, this.pose, cmd);
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

  private step(d: StepDir): void {
    const next = tryStep(this.map, this.pose, d);
    if (!next) {
      this.deps.hud.setStatus(`${this.name} · Something blocks the way.`);
      this.cameras.main.shake(80, 0.004);
      return;
    }
    this.moveTo(next);
    this.arrive();
  }

  private walk(path: readonly Pose['facing'][]): void {
    this.busy = true;
    const next = (i: number) => {
      const dir = path[i];
      const [dx, dy] = FACING_VECTORS[dir];
      this.moveTo({ x: this.pose.x + dx, y: this.pose.y + dy, facing: dir });
      // Stop early for anything that needs the player: exits, buildings, uncleared fights.
      // Messages (text spots) are shown in passing.
      const spot = spotAt(this.map, this.pose.x, this.pose.y);
      const stopsHere =
        isExit(this.map, this.pose.x, this.pose.y) ||
        spot?.kind === 'building' ||
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
    if (spot.building === 'shop') return [{ label: 'Browse the wares', command: { type: 'openShop', name: spot.name } }];
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
    this.drawView();
    this.drawArrow();
    const where = `${this.pose.x},${this.pose.y} ${FACING_NAME[this.pose.facing]}`;
    const clock = formatClock(game.time);
    this.deps.hud.setStatus(`${this.name} · ${where} · ${clock}`);
    this.deps.hud.setExplore({
      title: this.name,
      party: rosterEntries(this.textures, game),
      where,
      clock,
      purse: formatCoins(game.coins),
    });
  }

  /** The party on the overhead map: the leader's icon, with a small arrow on top showing which way they face. */
  private drawArrow(): void {
    const g = this.arrow.clear();
    const cx = PANE + this.pose.x * CELL + CELL / 2;
    const cy = this.pose.y * CELL + CELL / 2;
    const game = this.deps.game;
    const first = game.roster.find((r) => !game.party.find((p) => p.id === r.id)?.dead) ?? game.roster[0];
    const ref = first ? assets.sprites[first.sprite] : undefined;
    if (ref) {
      if (!this.leader) this.leader = this.add.image(cx, cy, ref.sheet, ref.frame).setScale(MAP_SCALE).setDepth(3.5);
      this.leader.setTexture(ref.sheet, ref.frame).setPosition(cx, cy);
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
    const st = STYLES[this.style];
    const cy = PANE / 2;
    const light = (z: number) => Math.max(st.minLight, 1 - st.fog * z);
    const half = (z: number) => (F * 0.5) / z; // half the wall height on screen at depth z

    // Background: darkest far colour, then floor/ceiling bands from far to near.
    g.fillStyle(shade(st.floor, light(MAX_DEPTH + 1)), 1).fillRect(0, cy, PANE, cy);
    g.fillStyle(st.sky ? st.ceiling : shade(st.ceiling, light(MAX_DEPTH + 1)), 1).fillRect(0, 0, PANE, cy);
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

    for (const face of viewFaces(this.map, this.pose, MAX_DEPTH)) this.drawFace(g, face, light);
  }

  private drawFace(g: Phaser.GameObjects.Graphics, f: Face, light: (z: number) => number): void {
    const cx = PANE / 2;
    const cy = PANE / 2;
    const mat = MATERIALS[f.material] ?? MATERIALS.wall;
    const project = (X: number, z: number) => ({ x: cx + (F * X) / z, top: cy - (F * 0.5) / z, bottom: cy + (F * 0.5) / z });
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
    g.fillStyle(shade(mat.face, lit), 1).fillPoints(pts, true);
    g.lineStyle(2, shade(mat.edge, Math.max(0.5, lit)), 1).strokePoints(pts, true);
  }
}

const quad = (a: { x: number; top: number; bottom: number }, b: { x: number; top: number; bottom: number }) => [
  new Phaser.Math.Vector2(a.x, a.top),
  new Phaser.Math.Vector2(b.x, b.top),
  new Phaser.Math.Vector2(b.x, b.bottom),
  new Phaser.Math.Vector2(a.x, a.bottom),
];

/** Multiply an RGB colour by a brightness factor. */
function shade(rgb: number, k: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((rgb >> 16) & 0xff) << 16) | (c((rgb >> 8) & 0xff) << 8) | c(rgb & 0xff);
}
