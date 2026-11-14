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
  isDown,
  isUp,
  chebyshev,
  endTurn,
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

const skirmish = skirmishJson as EncounterDef;
import type { ActiveCard, Hud } from '../../ui/hud';
import { commandForKey } from '../input/keyboard';

export const TILE = cellSize();

export interface CombatSceneDeps {
  bus: CommandBus;
  hud: Hud;
  seed: number;
}

export class CombatScene extends Phaser.Scene {
  private deps!: CombatSceneDeps;
  private rng!: Rng;
  private state!: CombatState;
  private overlay!: Phaser.GameObjects.Graphics;
  private reach!: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private tags = new Map<string, Phaser.GameObjects.Text>();
  private cursor = '';
  private busy = false;
  private history = new History<{ state: CombatState; rng: number }>();

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
    for (const [key, s] of Object.entries(assets.sheets)) {
      this.load.spritesheet(key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    }
  }

  create(): void {
    this.rng = createRng(this.deps.seed);
    const units: Unit[] = buildUnits(skirmish);
    this.state = startCombat(this.rng, skirmish.width, skirmish.height, units);

    this.deps.hud.setNames(this.state.units);
    this.drawFloor();
    this.reach = this.add.graphics().setDepth(0.4); // under grid lines and units
    this.drawGrid();
    this.overlay = this.add.graphics().setDepth(4); // above sprites so HP bars stay visible
    for (const u of this.state.units) this.createUnitSprite(u);
    this.setCursor('default');

    const unsubscribe = this.deps.bus.subscribe((cmd) => this.handle(cmd));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const cmd = commandForKey(e.code);
      if (cmd) {
        e.preventDefault();
        this.deps.bus.dispatch(cmd);
      }
    });
    // Tap/click on an adjacent square = step or attack there.
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.deps.bus.dispatch({ type: 'moveTo', x: Math.floor(p.worldX / TILE), y: Math.floor(p.worldY / TILE) });
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.updateCursor(p));

    this.redraw();
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

  /** Faint square outlines between floor and units, so the grid reads without clutter. */
  private drawGrid(): void {
    const g = this.add.graphics().setDepth(0.5);
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
    // Enemies sharing a sprite get a letter tag so the log ("Rat B") is readable.
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
      const x = u.x * TILE + 6 + i * 7;
      this.overlay.fillStyle(i < u.deathSaves.successes ? 0x2ecc71 : 0x333333, 1);
      this.overlay.fillRect(x, y, 5, 5);
      this.overlay.fillStyle(i < u.deathSaves.failures ? 0xe74c3c : 0x333333, 1);
      this.overlay.fillRect(u.x * TILE + TILE - 11 - i * 7, y, 5, 5);
    }
  }

  private card(u: Unit): ActiveCard {
    const ref = assets.sprites[u.sprite]!;
    const sheet = assets.sheets[ref.sheet];
    const img = this.textures.get(ref.sheet).getSourceImage() as HTMLImageElement;
    const sheetCols = img.width / sheet.frameWidth;
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
      sprite: {
        url: sheet.url,
        frameWidth: sheet.frameWidth,
        col: ref.frame % sheetCols,
        row: Math.floor(ref.frame / sheetCols),
        sheetCols,
        sheetRows: img.height / sheet.frameHeight,
      },
    };
  }

  private updateCursor(p: Phaser.Input.Pointer): void {
    if (this.state.outcome !== 'ongoing') return this.setCursor('default');
    const x = Math.floor(p.worldX / TILE);
    const y = Math.floor(p.worldY / TILE);
    const u = activeUnit(this.state);
    const target = unitAt(this.state, x, y);
    const adjacent = chebyshev(u, { x, y }) === 1;
    if (target && target.side !== u.side && adjacent && !this.state.actionUsed) this.setCursor('attack');
    else if (target && isDown(target) && !target.stable && adjacent && !this.state.actionUsed) this.setCursor('help');
    else if (!target && adjacent && this.state.movesLeft > 0) this.setCursor('move');
    else this.setCursor('default');
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
      case 'confirm':
        if (this.state.outcome !== 'ongoing') this.scene.restart(this.deps); // quick replay for playtesting
        break;
      default:
        break;
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
    if (turnExhausted(this.state)) {
      // Nothing left to do: pause so the player can read the result, then hand over.
      this.busy = true;
      this.time.delayedCall(600, () => {
        this.busy = false;
        endTurn(this.state, this.rng);
        this.redraw();
      });
    }
  }

  private redraw(): void {
    const { overlay, state } = this;
    overlay.clear();
    const active = state.outcome === 'ongoing' ? activeUnit(state) : undefined;

    // Remaining movement: tint reachable squares, stronger for nearer ones.
    this.reach.clear();
    for (const sq of reachableSquares(state)) {
      this.reach.fillStyle(0x3a7bd5, 0.32 - (0.14 * (sq.cost - 1)) / Math.max(1, state.movesLeft));
      this.reach.fillRect(sq.x * TILE, sq.y * TILE, TILE, TILE);
    }

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

    this.deps.hud.setLog(state.log);
    const party = state.units.filter((u) => u.side === 'party');
    const standing = party.filter(isUp).length;
    const downed = party.filter(isDown).length;
    const slain = party.length - standing - downed;
    const tally = [`${standing} standing`, downed && `${downed} down`, slain && `${slain} dead`].filter(Boolean).join(', ');
    this.deps.hud.setOutcome(
      state.outcome,
      state.outcome === 'victory'
        ? `${tally} after ${state.round} rounds · seed ${this.deps.seed}`
        : `Fell in round ${state.round} (${tally}) · seed ${this.deps.seed}`,
    );
    this.deps.hud.setActive(active && active.side === 'party' ? this.card(active) : null);
    this.deps.hud.setEndTurnHint(!!active && active.side === 'party' && (state.actionUsed || state.movesLeft <= 0));
    this.deps.hud.setStatus(
      state.outcome !== 'ongoing'
        ? `${state.outcome.toUpperCase()} — press Enter to replay (seed ${this.deps.seed})`
        : `Round ${state.round} · ${active!.name} · HP ${active!.hp}/${active!.maxHp} · moves ${state.movesLeft} · ` +
            (state.actionUsed ? 'action used' : 'action ready'),
    );
  }
}
