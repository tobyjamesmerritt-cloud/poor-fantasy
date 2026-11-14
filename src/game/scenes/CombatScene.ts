/**
 * Tactical combat view. Renders rules/combat.ts state and forwards Commands;
 * contains no rules logic of its own. All art comes from content/assets.json.
 */
import * as Phaser from 'phaser';
import { type Command, type CommandBus, directionFromDelta } from '../../engine/commands';
import { createRng, type Rng } from '../../engine/rng';
import {
  type CombatState,
  type Unit,
  activeUnit,
  chebyshev,
  endTurn,
  startCombat,
  step,
  unitAt,
} from '../../rules/combat';
import { assets, cellSize, cursorCss } from '../../content/assets';
import skirmish from '../../content/skirmish.json';
import type { Hud } from '../../ui/hud';
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
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private tags = new Map<string, Phaser.GameObjects.Text>();
  private spriteKeyByUnit = new Map<string, string>();
  private cursor = '';

  constructor() {
    super('combat');
  }

  init(deps: CombatSceneDeps): void {
    this.deps = deps;
    this.sprites.clear();
    this.tags.clear();
    this.cursor = '';
  }

  preload(): void {
    for (const [key, s] of Object.entries(assets.sheets)) {
      this.load.spritesheet(key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    }
  }

  create(): void {
    this.rng = createRng(this.deps.seed);
    const units: Unit[] = skirmish.units.map((u) => {
      this.spriteKeyByUnit.set(u.id, u.sprite);
      return { ...u, side: u.side as Unit['side'], maxHp: u.hp };
    });
    this.state = startCombat(this.rng, skirmish.width, skirmish.height, units);

    this.drawFloor();
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
    const ref = assets.sprites[this.spriteKeyByUnit.get(u.id) ?? ''];
    if (!ref) throw new Error(`Unit ${u.id} has no sprite in assets.json`);
    this.sprites.set(u.id, this.add.image(0, 0, ref.sheet, ref.frame).setScale(assets.scale).setDepth(2));
    // Enemies sharing a sprite get a letter tag so the log ("Rat B") is readable.
    const suffix = u.name.split(' ')[1];
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

  private updateCursor(p: Phaser.Input.Pointer): void {
    if (this.state.outcome !== 'ongoing') return this.setCursor('default');
    const x = Math.floor(p.worldX / TILE);
    const y = Math.floor(p.worldY / TILE);
    const u = activeUnit(this.state);
    const target = unitAt(this.state, x, y);
    const adjacent = chebyshev(u, { x, y }) === 1;
    if (target && target.side !== u.side && adjacent && !this.state.actionUsed) this.setCursor('attack');
    else if (!target && adjacent && this.state.movesLeft > 0) this.setCursor('move');
    else this.setCursor('default');
  }

  private setCursor(name: string): void {
    if (name === this.cursor) return;
    this.cursor = name;
    this.input.setDefaultCursor(cursorCss(assets.cursors[name] ?? assets.cursors.default));
  }

  private handle(cmd: Command): void {
    switch (cmd.type) {
      case 'move':
        step(this.state, this.rng, cmd.dir);
        break;
      case 'moveTo': {
        const u = activeUnit(this.state);
        if (chebyshev(u, cmd) !== 1) break;
        const dir = directionFromDelta(Math.sign(cmd.x - u.x), Math.sign(cmd.y - u.y));
        if (dir) step(this.state, this.rng, dir);
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
    this.redraw();
  }

  private redraw(): void {
    const { overlay, state } = this;
    overlay.clear();
    const active = state.outcome === 'ongoing' ? activeUnit(state) : undefined;

    for (const u of state.units) {
      const dead = u.hp <= 0;
      this.sprites
        .get(u.id)!
        .setPosition(u.x * TILE + TILE / 2, u.y * TILE + TILE / 2)
        .setAlpha(dead ? 0.3 : 1)
        .setDepth(dead ? 1.5 : 2);
      this.tags
        .get(u.id)
        ?.setPosition(u.x * TILE + TILE - 2, u.y * TILE + 1)
        .setVisible(!dead);

      if (u === active) {
        overlay.lineStyle(3, 0xf1c40f, 1);
        overlay.strokeRect(u.x * TILE + 1, u.y * TILE + 1, TILE - 2, TILE - 2);
      }
      if (!dead) {
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
    this.deps.hud.setStatus(
      state.outcome !== 'ongoing'
        ? `${state.outcome.toUpperCase()} — press Enter to replay (seed ${this.deps.seed})`
        : `Round ${state.round} · ${active!.name} · HP ${active!.hp}/${active!.maxHp} · moves ${state.movesLeft} · ` +
            (state.actionUsed ? 'action used' : 'action ready'),
    );
  }
}
