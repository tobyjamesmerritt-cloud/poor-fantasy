/**
 * Tactical combat view. Renders rules/combat.ts state and forwards Commands;
 * contains no rules logic of its own. All art comes from content/assets.json.
 */
import * as Phaser from 'phaser';
import type { Command, CommandBus, Direction } from '../../engine/commands';
import { History } from '../../engine/history';
import { createRng, type Rng } from '../../engine/rng';
import {
  type CombatState,
  type Unit,
  activeUnit,
  endTurn,
  isDown,
  isUp,
  planMoveTo,
  reachableSquares,
  startCombat,
  step,
  turnExhausted,
  unitAt,
} from '../../rules/combat';
import { assets, cellSize, cursorCss } from '../../content/assets';
import { buildUnits, type EncounterDef } from '../../content/encounters';
import skirmishJson from '../../content/skirmish.json';
import type { ActiveCard, Hud } from '../../ui/hud';
import type { PrefsStore } from '../../ui/prefs';
import { commandForKey } from '../input/keyboard';
import { preloadSheets, spriteCss } from '../spriteCss';

const skirmish = skirmishJson as EncounterDef;
export const TILE = cellSize();

export interface CombatSceneDeps {
  bus: CommandBus;
  hud: Hud;
  prefs: PrefsStore;
  seed: number;
}

/** One side of a grid square on the edge of the movement range: from (x1,y1) to (x2,y2) in pixels. */
interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class CombatScene extends Phaser.Scene {
  private deps!: CombatSceneDeps;
  private rng!: Rng;
  private state!: CombatState;
  private overlay!: Phaser.GameObjects.Graphics;
  private ants!: Phaser.GameObjects.Graphics;
  private grid!: Phaser.GameObjects.Graphics;
  private antEdges: Edge[] = [];
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private tags = new Map<string, Phaser.GameObjects.Text>();
  private cursor = '';
  private busy = false;
  private history = new History<{ state: CombatState; rng: number }>();
  private cleanups: (() => void)[] = [];

  constructor() {
    super('combat');
  }

  init(deps: CombatSceneDeps): void {
    this.deps = deps;
    this.sprites.clear();
    this.tags.clear();
    this.cursor = '';
    this.busy = false;
    this.history = new History();
  }

  preload(): void {
    preloadSheets(this.load);
  }

  create(): void {
    this.rng = createRng(this.deps.seed);
    this.state = startCombat(this.rng, skirmish.width, skirmish.height, buildUnits(skirmish));
    this.cameras.main.setZoom(1).setScroll(0, 0);

    this.deps.hud.setNames(this.state.units);
    this.deps.hud.setCombatControls(true);
    this.deps.hud.setPlace(null);
    this.drawFloor();
    this.grid = this.add.graphics().setDepth(0.5);
    this.drawGrid();
    this.ants = this.add.graphics().setDepth(0.6);
    this.overlay = this.add.graphics().setDepth(4); // above sprites so HP bars stay visible
    for (const u of this.state.units) this.createUnitSprite(u);
    this.setCursor('default');

    this.cleanups = [
      this.deps.bus.subscribe((cmd) => this.handle(cmd)),
      this.deps.prefs.subscribe(() => this.redraw()),
    ];
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanups.forEach((c) => c()));

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
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateCursor(p));

    this.redraw();
  }

  /** Marching ants: dashes along the movement-range border, shifted a little every frame. */
  update(time: number): void {
    const g = this.ants;
    g.clear();
    if (!this.antEdges.length) return;
    const dash = 6;
    const period = dash * 2;
    const offset = (time / 60) % period;
    g.lineStyle(2, 0xffffff, 0.9);
    for (const e of this.antEdges) {
      const horizontal = e.y1 === e.y2;
      const len = horizontal ? e.x2 - e.x1 : e.y2 - e.y1;
      for (let s = -period + offset; s < len; s += period) {
        const a = Math.max(0, s);
        const b = Math.min(len, s + dash);
        if (b <= a) continue;
        if (horizontal) g.lineBetween(e.x1 + a, e.y1, e.x1 + b, e.y1);
        else g.lineBetween(e.x1, e.y1 + a, e.x1, e.y1 + b);
      }
    }
  }

  private drawFloor(): void {
    const floor = assets.floors[skirmish.floor];
    if (!floor) throw new Error(`Unknown floor "${skirmish.floor}" in assets.json`);
    for (let y = 0; y < this.state.height; y++) {
      for (let x = 0; x < this.state.width; x++) {
        // Visual-only variation: deterministic hash, deliberately not the game Rng.
        const frame = floor.frames[(x * 7 + y * 13 + x * y) % floor.frames.length];
        this.add.image(x * TILE, y * TILE, floor.sheet, frame).setOrigin(0).setScale(assets.scale);
      }
    }
  }

  /** Faint square outlines between floor and units; toggled in Preferences. */
  private drawGrid(): void {
    const g = this.grid;
    const w = this.state.width * TILE;
    const h = this.state.height * TILE;
    g.lineStyle(1, 0x000000, 0.22);
    for (let x = 0; x <= this.state.width; x++) g.lineBetween(x * TILE + 0.5, 0, x * TILE + 0.5, h);
    for (let y = 0; y <= this.state.height; y++) g.lineBetween(0, y * TILE + 0.5, w, y * TILE + 0.5);
  }

  private createUnitSprite(u: Unit): void {
    const ref = assets.sprites[u.sprite];
    if (!ref) throw new Error(`Unit ${u.id} has no sprite in assets.json`);
    this.sprites.set(u.id, this.add.image(0, 0, ref.sheet, ref.frame).setScale(assets.scale).setDepth(2));
    // Enemies sharing a sprite get a letter tag so the log ("Giant Rat B") is readable.
    const suffix = u.name.split(' ').at(-1);
    if (u.side === 'enemy' && suffix?.length === 1) {
      this.tags.set(
        u.id,
        this.add
          .text(0, 0, suffix, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
          })
          .setOrigin(1, 0)
          .setDepth(3),
      );
    }
  }

  /** Death save tally under an unconscious character: green ✔ pips, red ✖ pips, gold bar if stable. */
  private drawDeathSaves(u: Unit): void {
    const y = u.y * TILE + TILE - 7;
    if (u.stable) {
      this.overlay.fillStyle(0xf1c40f, 1);
      this.overlay.fillRect(u.x * TILE + 6, y, TILE - 12, 4);
      return;
    }
    for (let i = 0; i < 3; i++) {
      this.overlay.fillStyle(i < u.deathSaves.successes ? 0x2ecc71 : 0x333333, 1);
      this.overlay.fillRect(u.x * TILE + 6 + i * 7, y, 5, 5);
      this.overlay.fillStyle(i < u.deathSaves.failures ? 0xe74c3c : 0x333333, 1);
      this.overlay.fillRect(u.x * TILE + TILE - 11 - i * 7, y, 5, 5);
    }
  }

  private card(u: Unit): ActiveCard {
    return {
      name: u.name,
      side: u.side,
      hp: u.hp,
      maxHp: u.maxHp,
      ac: u.ac,
      attackName: u.attackName,
      attackBonus: u.attackBonus,
      damage: u.damage.join(' + '),
      movesLeft: this.state.movesLeft,
      speed: u.speed,
      actionUsed: this.state.actionUsed,
      sprite: spriteCss(this.textures, u.sprite),
    };
  }

  /** Boot = you can walk there; sword = walk up and attack; open hand = walk up and stabilise. */
  private updateCursor(p: Phaser.Input.Pointer): void {
    if (this.busy || this.state.outcome !== 'ongoing' || activeUnit(this.state).side !== 'party') {
      return this.setCursor('default');
    }
    const x = Math.floor(p.worldX / TILE);
    const y = Math.floor(p.worldY / TILE);
    const target = unitAt(this.state, x, y);
    const plan = planMoveTo(this.state, x, y);
    if (!plan) this.setCursor('default');
    else if (target && target.side === 'enemy') this.setCursor('attack');
    else if (target && isDown(target)) this.setCursor('help');
    else this.setCursor('move');
  }

  private setCursor(name: string): void {
    if (name === this.cursor) return;
    this.cursor = name;
    this.input.setDefaultCursor(cursorCss(assets.cursors[name] ?? assets.cursors.default));
  }

  private handle(cmd: Command): void {
    if (this.busy) return; // walking or handing over the turn
    let before: string | null = null;
    if ((cmd.type === 'move' || cmd.type === 'moveTo' || cmd.type === 'endTurn') && this.state.outcome === 'ongoing') {
      before = JSON.stringify(this.state);
      this.history.push({ state: this.state, rng: this.rng.state });
    }
    switch (cmd.type) {
      case 'undo':
        this.rewind();
        break;
      case 'move':
        step(this.state, this.rng, cmd.dir);
        break;
      case 'moveTo': {
        const plan = activeUnit(this.state).side === 'party' ? planMoveTo(this.state, cmd.x, cmd.y) : null;
        if (plan) return this.walk(plan);
        break;
      }
      case 'endTurn':
        endTurn(this.state, this.rng);
        break;
      default:
        return; // navigation commands are handled in main.ts
    }
    // A blocked step (wall, no moves left) changes nothing: don't leave an empty rewind point.
    if (before !== null && JSON.stringify(this.state) === before) this.history.pop();
    this.afterAction();
  }

  /** Restore the moment before the last player action, dice included. */
  private rewind(): void {
    const snap = this.history.pop();
    if (!snap) {
      this.state.log.push('⟲ Nothing to rewind.');
      return;
    }
    this.state = snap.state;
    this.rng = createRng(snap.rng);
    this.state.log.push(`⟲ Time rewinds… (${this.history.size} more)`);
  }

  /** Execute a planned path one square at a time so the movement is visible. */
  private walk(plan: Direction[]): void {
    this.busy = true;
    this.setCursor('default');
    const next = (i: number) => {
      if (i >= plan.length || !step(this.state, this.rng, plan[i])) {
        this.busy = false;
        this.afterAction();
        return;
      }
      this.redraw();
      this.time.delayedCall(110, () => next(i + 1));
    };
    next(0);
  }

  private afterAction(): void {
    this.redraw();
    if (turnExhausted(this.state) && this.deps.prefs.get().autoEndTurn) {
      // Nothing left to do: pause so the player can read the result, then hand over.
      this.busy = true;
      this.time.delayedCall(600, () => {
        this.busy = false;
        endTurn(this.state, this.rng);
        this.redraw();
      });
    }
  }

  /** Border edges of the region the active unit can reach (including its own square). */
  private movementEdges(): Edge[] {
    const squares = reachableSquares(this.state);
    if (!squares.length) return [];
    const a = activeUnit(this.state);
    const inside = new Set([`${a.x},${a.y}`, ...squares.map((s) => `${s.x},${s.y}`)]);
    // Occupied squares count as inside, so the ants trace the open ground and don't box in every character.
    const has = (x: number, y: number) => inside.has(`${x},${y}`) || !!unitAt(this.state, x, y);
    const edges: Edge[] = [];
    for (const key of inside) {
      const [x, y] = key.split(',').map(Number);
      const px = x * TILE;
      const py = y * TILE;
      if (!has(x, y - 1)) edges.push({ x1: px, y1: py + 1, x2: px + TILE, y2: py + 1 });
      if (!has(x, y + 1)) edges.push({ x1: px, y1: py + TILE - 1, x2: px + TILE, y2: py + TILE - 1 });
      if (!has(x - 1, y)) edges.push({ x1: px + 1, y1: py, x2: px + 1, y2: py + TILE });
      if (!has(x + 1, y)) edges.push({ x1: px + TILE - 1, y1: py, x2: px + TILE - 1, y2: py + TILE });
    }
    return edges;
  }

  private redraw(): void {
    const { overlay, state } = this;
    overlay.clear();
    this.grid.setVisible(this.deps.prefs.get().grid);
    const active = state.outcome === 'ongoing' ? activeUnit(state) : undefined;
    this.antEdges = active?.side === 'party' && !this.busy ? this.movementEdges() : [];

    for (const u of state.units) {
      const up = isUp(u);
      const down = isDown(u);
      this.sprites
        .get(u.id)!
        .setPosition(u.x * TILE + TILE / 2, u.y * TILE + TILE / 2)
        .setAngle(up ? 0 : 90) // lying on the ground
        .setAlpha(up ? 1 : down ? 0.8 : 0.3)
        .setDepth(up ? 2 : 1.5);
      this.tags
        .get(u.id)
        ?.setPosition(u.x * TILE + TILE - 2, u.y * TILE + 1)
        .setVisible(up);
      if (down) this.drawDeathSaves(u);

      if (u === active) {
        overlay.lineStyle(3, 0xf1c40f, 1);
        overlay.strokeRect(u.x * TILE + 1, u.y * TILE + 1, TILE - 2, TILE - 2);
      }
      if (up) {
        const frac = u.hp / u.maxHp;
        const barY = u.y * TILE + TILE - 5;
        overlay.fillStyle(u.side === 'party' ? 0x3a7bd5 : 0xc0392b, 0.9); // side marker
        overlay.fillRect(u.x * TILE + 4, barY - 3, TILE - 8, 2);
        overlay.fillStyle(0x000000, 0.7);
        overlay.fillRect(u.x * TILE + 4, barY, TILE - 8, 4);
        overlay.fillStyle(frac > 0.5 ? 0x2ecc71 : frac > 0.25 ? 0xf39c12 : 0xe74c3c, 1);
        overlay.fillRect(u.x * TILE + 4, barY, (TILE - 8) * frac, 4);
      }
    }

    const hud = this.deps.hud;
    hud.setLog(state.log);
    const party = state.units.filter((u) => u.side === 'party');
    const standing = party.filter(isUp).length;
    const downed = party.filter(isDown).length;
    const slain = party.length - standing - downed;
    const tally = [`${standing} standing`, downed && `${downed} down`, slain && `${slain} dead`]
      .filter(Boolean)
      .join(', ');
    hud.setOutcome(
      state.outcome,
      state.outcome === 'victory'
        ? `${tally} after ${state.round} rounds · seed ${this.deps.seed}`
        : `Fell in round ${state.round} (${tally}) · seed ${this.deps.seed}`,
    );
    hud.setActive(active && active.side === 'party' ? this.card(active) : null);
    hud.setEndTurnHint(!!active && active.side === 'party' && (state.actionUsed || state.movesLeft <= 0));
    hud.setStatus(
      state.outcome !== 'ongoing'
        ? `Combat · ${state.outcome} · seed ${this.deps.seed}`
        : `Combat · Round ${state.round} · ${active!.name} · seed ${this.deps.seed}`,
    );
  }
}
