/**
 * Tactical combat view. Renders rules/combat.ts state and forwards Commands;
 * contains no rules logic of its own. All art comes from content/assets.json.
 */
import * as Phaser from 'phaser';
import type { PartyMemberState } from '../../engine/state';
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
  pathProvokes,
  unitById,
  planMoveTo,
  reachableSquares,
  startCombat,
  step,
  turnExhausted,
  potionTargets,
  takeAction,
  usePotion,
  canFlee,
  flee,
  onField,
  unitAt,
  acOf,
  type EffectKind,
} from '../../rules/combat';
import { areaSquares, castOptions, castSpell, spellOf, targetingOf, validTargets } from '../../rules/spells';
import { spells } from '../../content/characters';
import { assets, cellSize, cursorCss } from '../../content/assets';
import { buildUnits, encounters, type EncounterDef, type PartyMemberDef, resolveEncounter } from '../../content/encounters';
import type { FightTweaks } from '../../rules/quests';
import type { ActiveCard, Hud } from '../../ui/hud';
import type { PrefsStore } from '../../ui/prefs';
import { commandForKey } from '../input/keyboard';
import { preloadSheets, spriteCss } from '../spriteCss';

export const TILE = cellSize();

/** Cosmetic per-square scatter for floor variants (not game logic, so not Rng). */
function tileHash(x: number, y: number): number {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1); // murmur3 finalizer
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export interface CombatSceneDeps {
  bus: CommandBus;
  hud: Hud;
  prefs: PrefsStore;
  seed: number;
  encounter: string; // id in content/encounters
  encounterDef?: EncounterDef; // the encounter already scaled to the party (main.ts); else the default party size
  tweaks?: FightTweaks; // quest changes to monsters (e.g. a drunk troll)
  onVictory?: () => void; // e.g. mark the map location cleared
  members?: PartyMemberDef[]; // who fights (default: the quick-start party)
  party?: PartyMemberState[]; // persistent party: current HP, who is dead (omit = everyone fresh)
  onEnd?: (state: CombatState) => void; // once, when the fight is won, lost or fled
  potions?: number; // Potions of Healing in the party pack
  scrolls?: Record<string, number>; // Spell Scrolls in the pack, by spell id
  now?: number; // game time (Mage Armor still running?)
}

/** A spell being aimed: picks so far (creature spells may pick several). */
interface Aim {
  spellId: string;
  slot: number;
  picks: { x: number; y: number }[];
  hover: { x: number; y: number } | null;
}

const EFFECT_NAMES: Record<EffectKind, string> = {
  bless: 'Blessed',
  'shield-of-faith': 'Shield of Faith',
  guided: 'Guided',
  slowed: 'Slowed',
  dodging: 'Dodging',
  poisoned: 'Poisoned',
  blinded: 'Blinded',
  'no-heal': "Can't heal",
};

/** One side of a grid square on the edge of the movement range: from (x1,y1) to (x2,y2) in pixels. */
interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class CombatScene extends Phaser.Scene {
  private deps!: CombatSceneDeps;
  private enc!: EncounterDef;
  private victoryReported = false;
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
  private aim: Aim | null = null;
  private aimLayer!: Phaser.GameObjects.Graphics;

  constructor() {
    super('combat');
  }

  init(deps: CombatSceneDeps): void {
    this.deps = deps;
    this.sprites.clear();
    this.tags.clear();
    this.cursor = '';
    this.busy = false;
    this.aim = null;
    this.history = new History();
    this.victoryReported = false;
    const enc = deps.encounterDef ?? (encounters[deps.encounter] && resolveEncounter(encounters[deps.encounter]));
    if (!enc) throw new Error(`Unknown encounter "${deps.encounter}"`);
    this.enc = enc;
  }

  preload(): void {
    preloadSheets(this.load);
  }

  create(): void {
    this.rng = createRng(this.deps.seed);
    this.state = startCombat(this.rng, this.enc.width, this.enc.height, buildUnits(this.enc, this.deps.members, this.deps.party, this.deps.now ?? 0, this.deps.tweaks), this.deps.prefs.get().difficulty, this.deps.potions ?? 0, this.deps.scrolls ?? {});
    this.cameras.main.setZoom(1).setScroll(0, 0);

    this.deps.hud.setNames(this.state.units);
    this.deps.hud.setCombatControls(true);
    this.deps.hud.setPlace(null);
    this.drawFloor();
    this.grid = this.add.graphics().setDepth(0.5);
    this.drawGrid();
    this.ants = this.add.graphics().setDepth(0.6);
    this.overlay = this.add.graphics().setDepth(4); // above sprites so HP bars stay visible
    this.aimLayer = this.add.graphics().setDepth(3.5); // spell targets and areas, over the sprites
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
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.aim) {
        const at = { x: Math.floor(p.worldX / TILE), y: Math.floor(p.worldY / TILE) };
        if (this.aim.hover?.x !== at.x || this.aim.hover?.y !== at.y) {
          this.aim.hover = at;
          this.drawAim();
        }
      }
      this.updateCursor(p);
    });

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
    const floor = assets.floors[this.enc.floor];
    for (let y = 0; y < this.state.height; y++) {
      for (let x = 0; x < this.state.width; x++) {
        // Visual-only variation: deterministic hash, deliberately not the game Rng.
        const frame = floor.frames[tileHash(x, y) % floor.frames.length];
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
    const c = u.caster;
    const options = c ? castOptions(this.state, spells) : [];
    const aiming = this.aim ? this.aimInfo() : undefined;
    return {
      name: u.name,
      side: u.side,
      hp: u.hp,
      maxHp: u.maxHp,
      ac: acOf(u),
      tempHp: u.tempHp,
      effects: (u.effects ?? []).map((e) => EFFECT_NAMES[e.kind]),
      concentration: u.concentration?.name,
      ...(c
        ? {
            slots: c.maxSlots.map((max, i) => ({ level: i + 1, max, left: c.slots[i] })),
            spells: options.map((o) => ({
              id: o.id,
              name: o.scroll ? `📜 ${o.spell.name} (scroll ×${this.state.scrolls?.[o.id.slice(7)] ?? 0})` : o.spell.name,
              level: o.spell.level,
              detail: [
                o.spell.level ? `level ${o.spell.level}` : 'cantrip',
                o.spell.time === 'bonus' ? 'bonus action' : 'action',
                o.spell.range === 0 ? 'self' : o.spell.range === 5 ? 'touch' : `${o.spell.range} ft`,
                o.spell.concentration ? 'concentration' : '',
              ]
                .filter(Boolean)
                .join(' · '),
              summary: o.spell.summary,
              levels: o.levels,
              reason: o.reason,
            })),
            aiming,
          }
        : {}),
      attackName: u.attackName,
      attackBonus: u.attackBonus,
      damage: u.damage.join(' + '),
      movesLeft: this.state.movesLeft,
      speed: u.speed,
      actionUsed: this.state.actionUsed,
      reactionUsed: !!u.reactionUsed,
      disengaged: !!this.state.disengaged,
      sprite: spriteCss(this.textures, u.sprite),
      potions: this.state.potions,
      bonusUsed: this.state.bonusUsed,
      potionTargets: potionTargets(this.state).map((t) => ({ id: t.id, name: t.name, self: t.id === u.id })),
    };
  }

  /** Boot = you can walk there; sword = walk up and attack; open hand = walk up and stabilise. */
  private updateCursor(p: Phaser.Input.Pointer): void {
    if (this.busy || this.state.outcome !== 'ongoing' || activeUnit(this.state).side !== 'party') {
      return this.setCursor('default');
    }
    const x = Math.floor(p.worldX / TILE);
    const y = Math.floor(p.worldY / TILE);
    if (this.aim) {
      const ok = validTargets(this.state, spells, this.aim.spellId, this.aim.slot).some((q) => q.x === x && q.y === y);
      return this.setCursor(ok ? 'attack' : 'default');
    }
    const target = unitAt(this.state, x, y);
    const plan = planMoveTo(this.state, x, y);
    if (!plan) this.setCursor('default');
    else if (target && target.side === 'enemy') this.setCursor('attack');
    else if (target && isDown(target)) this.setCursor('help');
    else this.setCursor('move');
  }

  private warned: string | null = null; // the risky move the player has been warned about once

  private setCursor(name: string): void {
    if (name === this.cursor) return;
    this.cursor = name;
    this.input.setDefaultCursor(cursorCss(assets.cursors[name] ?? assets.cursors.default));
  }

  private handle(cmd: Command): void {
    if (this.busy) return; // walking or handing over the turn
    let before: string | null = null;
    if (this.aim) {
      // Aiming a spell: grid clicks pick targets; Enter casts with the picks so far; Esc cancels.
      if (cmd.type === 'moveTo') return this.pick(cmd.x, cmd.y);
      if (cmd.type === 'confirm') return this.release();
      if (cmd.type === 'move') return;
      this.aim = null; // anything else (Esc, another spell, end turn, rewind…) stops aiming
      this.drawAim();
      if (cmd.type === 'cancel') return this.redraw();
    }
    if (cmd.type === 'aimSpell') return this.startAim(cmd.spellId, cmd.slot);
    if ((cmd.type === 'move' || cmd.type === 'moveTo' || cmd.type === 'endTurn' || cmd.type === 'flee' || cmd.type === 'usePotion' || cmd.type === 'combatAction') && this.state.outcome === 'ongoing') {
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
        if (!plan) break;
        // Walking out of an enemy's reach: warn first; the same click again goes anyway (DND-11)
        const risk = pathProvokes(this.state, plan);
        const key = `${this.state.round}:${this.state.turnIndex}:${cmd.x},${cmd.y}`;
        if (risk.length && this.warned !== key) {
          this.warned = key;
          this.state.log.push(
            `⚠ That move leaves ${risk.map((r) => r.name).join(' and ')}'s reach — ${risk.length > 1 ? 'opportunity attacks' : 'an opportunity attack'}. Click again to go anyway, or Disengage first.`,
          );
          break;
        }
        this.warned = null;
        return this.walk(plan);
      }
      case 'endTurn':
        endTurn(this.state, this.rng);
        break;
      case 'flee':
        if (activeUnit(this.state).side === 'party') flee(this.state, this.rng);
        break;
      case 'usePotion':
        usePotion(this.state, this.rng, cmd.targetId);
        break;
      case 'combatAction':
        if (activeUnit(this.state).side === 'party') takeAction(this.state, cmd.action);
        break;
      default:
        return; // navigation commands are handled in main.ts
    }
    // A blocked step (wall, no moves left) changes nothing: don't leave an empty rewind point.
    if (before !== null && JSON.stringify(this.state) === before) this.history.pop();
    this.afterAction();
  }

  // -------------------------------------------------------------------------
  // Spells: aim, pick targets, cast
  // -------------------------------------------------------------------------

  private startAim(spellId: string, slot: number): void {
    const u = activeUnit(this.state);
    const option = castOptions(this.state, spells).find((o) => o.id === spellId);
    if (u.side !== 'party' || !option || option.reason || !option.levels.includes(slot)) return;
    this.aim = { spellId, slot, picks: [], hover: null };
    const t = targetingOf(option.spell, slot, u.caster!.level);
    // Self-only spells need no aiming.
    if (t.kind === 'self') {
      this.aim.picks.push({ x: u.x, y: u.y });
      return this.release();
    }
    this.drawAim();
    this.redraw();
  }

  private aimTargeting() {
    const a = this.aim!;
    return targetingOf(spellOf(spells, a.spellId)!, a.slot, activeUnit(this.state).caster!.level);
  }

  private aimInfo(): NonNullable<ActiveCard['aiming']> {
    const a = this.aim!;
    const spell = spellOf(spells, a.spellId)!;
    const t = this.aimTargeting();
    const name = `${spell.name}${a.slot > spell.level && spell.level > 0 ? ` (level ${a.slot})` : ''}`;
    const hint =
      t.kind === 'creatures'
        ? t.count > 1
          ? `Click ${t.side === 'enemy' ? 'enemies' : 'allies'}: ${a.picks.length}/${t.count} picked${t.repeat ? ' (the same one again is fine)' : ''}.`
          : `Click ${t.side === 'enemy' ? 'an enemy' : 'an ally'} in range (highlighted).`
        : t.kind === 'point'
          ? 'Click where it should burst — the orange squares are hit, friends included.'
          : t.kind === 'direction'
            ? 'Click a square to aim it — the orange squares are hit, friends included.'
            : 'Click an empty square within range.';
    return { name, picked: a.picks.length, count: t.kind === 'creatures' ? t.count : 1, hint, canCastNow: t.kind === 'creatures' && t.count > 1 && a.picks.length > 0 };
  }

  private pick(x: number, y: number): void {
    const a = this.aim!;
    if (!validTargets(this.state, spells, a.spellId, a.slot).some((q) => q.x === x && q.y === y)) return;
    const t = this.aimTargeting();
    if (t.kind === 'creatures') {
      if (!t.repeat && a.picks.some((p) => p.x === x && p.y === y)) {
        a.picks = a.picks.filter((p) => p.x !== x || p.y !== y); // click again to un-pick
      } else a.picks.push({ x, y });
      if (a.picks.length < t.count) {
        this.drawAim();
        return this.redraw();
      }
    } else a.picks = [{ x, y }];
    this.release();
  }

  /** Cast with the picks so far. */
  private release(): void {
    const a = this.aim;
    if (!a || !a.picks.length) return;
    this.aim = null;
    this.drawAim();
    this.history.push({ state: this.state, rng: this.rng.state });
    if (!castSpell(this.state, this.rng, spells, a.spellId, a.slot, a.picks)) this.history.pop();
    this.afterAction();
  }

  /** Valid targets (blue), area preview under the pointer (orange), picks so far (gold). */
  private drawAim(): void {
    const g = this.aimLayer.clear();
    const a = this.aim;
    if (!a) return;
    const valid = validTargets(this.state, spells, a.spellId, a.slot);
    const t = this.aimTargeting();
    const showValid = t.kind === 'creatures' || t.kind === 'square' || t.kind === 'point';
    if (showValid) {
      // creatures: a bright frame around each target; squares: a light wash over the range
      g.fillStyle(0x4aa3ff, 0.16);
      g.lineStyle(3, 0x6fc3ff, 1);
      for (const p of valid) {
        if (t.kind === 'creatures') g.strokeRect(p.x * TILE + 2, p.y * TILE + 2, TILE - 4, TILE - 4);
        else g.fillRect(p.x * TILE + 1, p.y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
    const h = a.hover;
    if (h && (t.kind === 'point' || t.kind === 'direction') && valid.some((p) => p.x === h.x && p.y === h.y)) {
      g.fillStyle(0xff7a1a, 0.42);
      for (const p of areaSquares(this.state, activeUnit(this.state), spellOf(spells, a.spellId)!, h)) g.fillRect(p.x * TILE + 1, p.y * TILE + 1, TILE - 2, TILE - 2);
    }
    g.lineStyle(3, 0xf1c40f, 1);
    a.picks.forEach((p, i) => {
      g.strokeRect(p.x * TILE + 3 + i * 2, p.y * TILE + 3 + i * 2, TILE - 6 - i * 4, TILE - 6 - i * 4);
    });
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
    this.lastHp.clear(); // no floating numbers for rewound HP
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
    const fell = this.state.outcome === 'ongoing' && !isUp(activeUnit(this.state)); // cut down mid-move: the turn is over
    if (turnExhausted(this.state) && (this.deps.prefs.get().autoEndTurn || fell)) {
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

  private lastHp = new Map<string, number>(); // HP at the previous redraw → floating numbers (DND-66)

  /** Damage (red) or healing (green) rising from a unit's square and fading out. */
  private floatNumber(u: { x: number; y: number }, delta: number): void {
    const t = this.add
      .text(u.x * TILE + TILE / 2, u.y * TILE + TILE / 3, delta < 0 ? `${delta}` : `+${delta}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        fontStyle: 'bold',
        color: delta < 0 ? '#ff5a4a' : '#5dff8a',
        stroke: '#000000',
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(10);
    this.tweens.add({ targets: t, y: t.y - 28, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private redraw(): void {
    const { overlay, state } = this;
    overlay.clear();
    for (const u of state.units) {
      const before = this.lastHp.get(u.id);
      if (before !== undefined && before !== u.hp && !u.fled) this.floatNumber(u, u.hp - before);
      this.lastHp.set(u.id, u.hp);
    }
    this.grid.setVisible(this.deps.prefs.get().grid);
    const active = state.outcome === 'ongoing' ? activeUnit(state) : undefined;
    this.antEdges = active?.side === 'party' && !this.busy && !this.aim ? this.movementEdges() : [];

    for (const u of state.units) {
      const up = isUp(u);
      const down = isDown(u);
      const sprite = this.sprites
        .get(u.id)!
        .setVisible(!u.fled)
        .setPosition(u.x * TILE + TILE / 2, u.y * TILE + TILE / 2)
        .setAngle(up ? 0 : 90) // lying on the ground
        .setAlpha(up ? 1 : down ? 0.8 : 0.3)
        .setDepth(up ? 2 : 1.5)
        .setScale(assets.scale);
      if (u.carriedBy) {
        // shown small, slung over the carrier's shoulder
        sprite.setScale(assets.scale * 0.5).setPosition(u.x * TILE + TILE - 10, u.y * TILE + 10).setDepth(2.5).setAlpha(1);
      }
      this.tags
        .get(u.id)
        ?.setPosition(u.x * TILE + TILE - 2, u.y * TILE + 1)
        .setVisible(up && !u.fled);
      if (u.fled) continue;
      if (down && onField(u)) this.drawDeathSaves(u);

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

    if (state.outcome !== 'ongoing' && !this.victoryReported) {
      this.victoryReported = true; // report the end of the fight once
      if (state.outcome === 'victory') this.deps.onVictory?.();
      this.deps.onEnd?.(state);
    }
    const hud = this.deps.hud;
    hud.setLog(state.log);
    const party = state.units.filter((u) => u.side === 'party');
    const standing = party.filter((u) => isUp(u) && !u.fled).length;
    const downed = party.filter((u) => isDown(u) && !u.fled).length;
    const slain = party.filter((u) => u.dead).length;
    const tally = [`${standing} standing`, downed && `${downed} down`, slain && `${slain} dead`]
      .filter(Boolean)
      .join(', ');
    hud.setOutcome(
      state.outcome,
      state.outcome === 'victory'
        ? `${tally} after ${state.round} rounds · seed ${this.deps.seed}`
        : state.outcome === 'fled'
          ? `${retreatSummary(party)} · round ${state.round} · seed ${this.deps.seed}`
          : `Fell in round ${state.round} (${tally}) · seed ${this.deps.seed}`,
    );
    hud.setFlee(active?.side === 'party' && !this.busy ? canFlee(state) : null);
    hud.setTurnOrder(
      state.outcome !== 'ongoing'
        ? null
        : state.order
            .map((_, i) => unitById(state, state.order[(state.turnIndex + i) % state.order.length]))
            .filter((u) => u && !u.fled && !u.dead && !(u.side === 'enemy' && !isUp(u)))
            .map((u) => ({
              name: u!.name,
              side: u!.side,
              sprite: spriteCss(this.textures, u!.sprite),
              hpPct: Math.max(0, Math.round((u!.hp / u!.maxHp) * 100)),
              active: u === active,
              down: !isUp(u!),
            })),
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

/** "Escaped: Fighter, Rogue · Left behind: Cleric (unconscious), Wizard (dead)" */
function retreatSummary(party: readonly Unit[]): string {
  const escaped = party.filter((u) => u.fled).map((u) => u.name);
  const behind = party.filter((u) => !u.fled).map((u) => `${u.name} (${u.dead ? 'dead' : 'unconscious'})`);
  return [`Escaped: ${escaped.join(', ') || 'nobody'}`, behind.length ? `Left behind: ${behind.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ');
}
