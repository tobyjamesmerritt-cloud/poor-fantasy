/**
 * Tactical combat view. Renders rules/combat.ts state and forwards Commands;
 * contains no rules logic of its own.
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
} from '../../rules/combat';
import skirmish from '../../content/skirmish.json';
import type { Hud } from '../../ui/hud';
import { commandForKey } from '../input/keyboard';

export const TILE = 56;

export interface CombatSceneDeps {
  bus: CommandBus;
  hud: Hud;
  seed: number;
}

export class CombatScene extends Phaser.Scene {
  private deps!: CombatSceneDeps;
  private rng!: Rng;
  private state!: CombatState;
  private gfx!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];

  constructor() {
    super('combat');
  }

  init(deps: CombatSceneDeps): void {
    this.deps = deps;
  }

  create(): void {
    this.rng = createRng(this.deps.seed);
    const units: Unit[] = skirmish.units.map((u) => ({ ...u, side: u.side as Unit['side'], maxHp: u.hp }));
    this.state = startCombat(this.rng, skirmish.width, skirmish.height, units);
    this.gfx = this.add.graphics();

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

    this.redraw();
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
    const { gfx, state } = this;
    gfx.clear();
    this.labels.forEach((l) => l.destroy());
    this.labels = [];

    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        gfx.fillStyle((x + y) % 2 === 0 ? 0x2b3a2b : 0x324532, 1);
        gfx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

    const active = state.outcome === 'ongoing' ? activeUnit(state) : undefined;
    for (const u of state.units) {
      const cx = u.x * TILE + TILE / 2;
      const cy = u.y * TILE + TILE / 2;
      const dead = u.hp <= 0;
      gfx.fillStyle(dead ? 0x444444 : u.side === 'party' ? 0x3a7bd5 : 0xc0392b, dead ? 0.5 : 1);
      gfx.fillCircle(cx, cy, TILE * 0.38);
      if (u === active) {
        gfx.lineStyle(3, 0xf1c40f, 1);
        gfx.strokeRect(u.x * TILE + 2, u.y * TILE + 2, TILE - 4, TILE - 4);
      }
      if (!dead) {
        const hpFrac = u.hp / u.maxHp;
        gfx.fillStyle(0x000000, 0.6);
        gfx.fillRect(u.x * TILE + 6, u.y * TILE + TILE - 8, TILE - 12, 4);
        gfx.fillStyle(hpFrac > 0.5 ? 0x2ecc71 : hpFrac > 0.25 ? 0xf39c12 : 0xe74c3c, 1);
        gfx.fillRect(u.x * TILE + 6, u.y * TILE + TILE - 8, (TILE - 12) * hpFrac, 4);
      }
      this.labels.push(
        this.add
          .text(cx, cy - 2, shortLabel(u.name), { fontFamily: 'monospace', fontSize: '14px', color: '#ffffff' })
          .setOrigin(0.5),
      );
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

/** "Fighter" → "Fig", "Kobold C" → "KoC": unique-ish 3-char token labels. */
function shortLabel(name: string): string {
  const parts = name.split(' ');
  return parts.length > 1 ? parts[0].slice(0, 2) + parts[parts.length - 1].slice(0, 1) : name.slice(0, 3);
}
