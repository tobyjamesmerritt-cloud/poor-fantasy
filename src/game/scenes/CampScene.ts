/**
 * Camp (or a room at the inn). Draws a background for the kind of site, the
 * party around the fire, and runs rests through rules/rest.ts. The side panel
 * (party, purse, rest buttons) is HTML via the Hud.
 */
import * as Phaser from 'phaser';
import type { Command, CommandBus } from '../../engine/commands';
import type { Rng } from '../../engine/rng';
import type { GameState } from '../../engine/state';
import { assets } from '../../content/assets';
import { characterData, membersOf, statsOf } from '../../content/characters';
import { partyRows } from '../partyView';
import { formatCoins } from '../../rules/party';
import { type CampSite, canRest, innCost, isInn, rest, type RestKind } from '../../rules/rest';
import { formatClock } from '../../rules/time';
import type { Hud } from '../../ui/hud';
import { preloadSheets } from '../spriteCss';

const W = 576;
const H = 432;
const HORIZON = 250;

const SITE_TITLE: Record<CampSite['kind'], string> = {
  forest: 'Camp in the forest',
  meadow: 'Camp in the open',
  rocks: 'Camp among the rocks',
  riverside: 'Camp by the river',
  cave: 'Camp in the cave',
  ruins: 'Camp in the ruins',
  inn: 'Rooms at the inn',
};

export interface CampSceneDeps {
  bus: CommandBus;
  hud: Hud;
  game: GameState;
  site: CampSite;
  rng: Rng; // exploration Rng (rests, ambush rolls); main.ts keeps its state
  notices: string[]; // messages to show on arrival (e.g. after an ambush fight)
}

export class CampScene extends Phaser.Scene {
  private deps!: CampSceneDeps;
  private bg!: Phaser.GameObjects.Graphics;
  private fire!: Phaser.GameObjects.Graphics;
  private sprites: Phaser.GameObjects.Image[] = [];
  private log: string[] = [];
  private busy = false;

  constructor() {
    super('camp');
  }

  init(deps: CampSceneDeps): void {
    this.deps = deps;
    this.busy = false;
    this.sprites = [];
    this.log = [];
  }

  preload(): void {
    preloadSheets(this.load);
  }

  create(): void {
    const { site, hud } = this.deps;
    hud.setCombatControls(false);
    hud.setOutcome('none');
    hud.setPlace(null);
    hud.setNames(this.deps.game.roster.map((p) => ({ name: p.name, side: 'party' as const })));
    this.bg = this.add.graphics().setDepth(0);
    this.fire = this.add.graphics().setDepth(2);
    this.drawBackground();
    this.placeParty();
    this.log.push(
      isInn(site)
        ? `You take a table at ${site.name}. Rooms cost ${formatCoins(innCost(this.deps.game.party))} a night for the party.`
        : `${SITE_TITLE[site.kind]}. You make camp${site.risk > 0 ? ' — keep your weapons close' : ''}.`,
      ...this.deps.notices,
    );
    this.refresh();

    const unsubscribe = this.deps.bus.subscribe((cmd) => this.handle(cmd));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
  }

  /** Flickering fire. Cosmetic only — a sine of the clock, not the game Rng. */
  update(time: number): void {
    const g = this.fire.clear();
    const inn = isInn(this.deps.site);
    const cx = inn ? 470 : W / 2;
    const cy = inn ? 300 : 330;
    const f = (k: number) => 1 + 0.12 * Math.sin(time / (90 + k * 37) + k);
    if (!inn) {
      g.fillStyle(0x5b3a1e, 1).fillRect(cx - 26, cy + 4, 52, 8).fillRect(cx - 6, cy - 2, 12, 16);
    }
    g.fillStyle(0xe25822, 0.9).fillTriangle(cx - 20, cy + 6, cx + 20, cy + 6, cx, cy - 34 * f(1));
    g.fillStyle(0xf6a623, 0.95).fillTriangle(cx - 13, cy + 6, cx + 13, cy + 6, cx + 3, cy - 24 * f(2));
    g.fillStyle(0xfff3b0, 1).fillTriangle(cx - 6, cy + 6, cx + 6, cy + 6, cx - 1, cy - 12 * f(3));
    g.fillStyle(0xffb347, 0.08 * f(4)).fillCircle(cx, cy - 6, 90);
  }

  private handle(cmd: Command): void {
    if (this.busy) return;
    if (cmd.type === 'rest') this.rest(cmd.kind);
  }

  private input0() {
    const g = this.deps.game;
    return { party: g.party, stats: statsOf(g.roster), now: g.time, lastLongRest: g.lastLongRest, coins: g.coins, site: this.deps.site };
  }

  private rest(kind: RestKind): void {
    const check = canRest(kind, this.input0());
    if (!check.ok) {
      this.say(check.reason);
      return;
    }
    const g = this.deps.game;
    const r = rest(kind, this.input0(), this.deps.rng);
    g.time += r.minutes;
    g.coins -= r.coinsSpent;
    if (r.lastLongRest !== g.lastLongRest) g.flags['spells:prepare'] = true; // a finished Long Rest: casters may re-prepare
    g.lastLongRest = r.lastLongRest;
    this.busy = true;
    this.say(kind === 'long' ? 'The party settles down for the night…' : 'The party rests for an hour…');
    // Time passes: fade out and back in, then report what happened.
    this.cameras.main.fadeOut(450, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.drawBackground();
      this.placeParty();
      this.cameras.main.fadeIn(450, 0, 0, 0);
      for (const line of r.log) this.say(line);
      this.refresh();
      if (r.ambushAt !== null && this.deps.site.ambush) {
        const fight: Command = { type: 'fight', encounter: this.deps.site.ambush };
        this.time.delayedCall(1200, () => this.deps.bus.dispatch(fight));
      } else this.busy = false;
    });
  }

  private say(line: string): void {
    this.log.push(line);
    this.deps.hud.setLog(this.log);
  }

  private refresh(): void {
    const g = this.deps.game;
    const site = this.deps.site;
    const why = (kind: RestKind) => {
      const c = canRest(kind, this.input0());
      return c.ok ? undefined : c.reason;
    };
    const cost = isInn(site) ? ` · ${formatCoins(innCost(g.party))}` : '';
    this.deps.hud.setLog(this.log);
    this.deps.hud.setStatus(`${site.name} · ${formatClock(g.time)} · ${formatCoins(g.coins)}`);
    this.deps.hud.setCamp({
      title: isInn(site) ? site.name : SITE_TITLE[site.kind],
      subtitle: isInn(site) ? 'Safe — no ambushes in town' : `Free, but risky (${Math.round(site.risk * 100)}% ambush chance overnight)`,
      party: partyRows(g),
      purse: formatCoins(g.coins),
      clock: formatClock(g.time),
      actions: [
        { label: 'Short rest (1 hour)', command: { type: 'rest', kind: 'short' }, disabledReason: why('short') },
        { label: `Long rest (8 hours${cost})`, command: { type: 'rest', kind: 'long' }, disabledReason: why('long') },
        ...(g.roster.some((r) => characterData.classes[r.classId]?.spellcasting)
          ? [{ label: g.flags['spells:prepare'] ? 'Spells — prepare & cast…' : 'Spells — cast…', command: { type: 'openSpells' } as Command }]
          : []),
        { label: 'Pack…', command: { type: 'openPack' } },
        { label: isInn(site) ? 'Leave the inn' : 'Break camp', command: { type: 'breakCamp' } },
      ],
    });
  }

  // -------------------------------------------------------------------------
  // Pictures
  // -------------------------------------------------------------------------

  private placeParty(): void {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
    const inn = isInn(this.deps.site);
    const members = membersOf(this.deps.game.roster).map((p) => ({ def: p, now: this.deps.game.party.find((s) => s.id === p.id)! }));
    const alive = members.filter((m) => !m.now.dead);
    alive.forEach((m, i) => {
      const ref = assets.sprites[m.def.sprite];
      // a half circle around the fire (or along the inn's tables)
      const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, alive.length - 1));
      const x = inn ? 90 + i * 62 : W / 2 - Math.cos(a) * 150;
      const y = inn ? 360 : 345 + Math.sin(a) * 40;
      const down = m.now.hp <= 0;
      this.sprites.push(
        this.add
          .image(x, y, ref.sheet, ref.frame)
          .setScale(assets.scale)
          .setAngle(down ? 90 : 0)
          .setAlpha(down ? 0.7 : 1)
          .setDepth(3),
      );
    });
  }

  private drawBackground(): void {
    const g = this.bg.clear();
    const kind = this.deps.site.kind;
    const hour = (this.deps.game.time % 1440) / 60;
    const sky = skyColours(hour);
    if (kind === 'inn') return this.drawInn(g, sky);
    if (kind === 'cave') return this.drawCave(g);

    bands(g, 0, HORIZON, sky.top, sky.bottom);
    if (sky.night) {
      for (let i = 0; i < 70; i++) {
        const x = hash(i, 1) % W;
        const y = hash(i, 2) % (HORIZON - 30);
        g.fillStyle(0xffffff, 0.35 + (hash(i, 3) % 60) / 100).fillRect(x, y, 2, 2);
      }
      g.fillStyle(0xf4f1d0, 1).fillCircle(470, 60, 22);
      g.fillStyle(sky.top, 1).fillCircle(480, 54, 19); // crescent
    } else {
      g.fillStyle(0xfff4c2, 1).fillCircle(90, 70, 24);
    }

    const ground = { forest: 0x24401f, meadow: 0x3f6b2a, rocks: 0x4a4a3c, riverside: 0x355f2b, ruins: 0x4b4a3f }[kind];
    const dim = sky.night ? 0.45 : 1;
    // distant hills
    g.fillStyle(shade(0x2d4a3a, dim * 0.8), 1);
    for (let i = 0; i < 6; i++) g.fillEllipse(i * 120 + (hash(i, 9) % 40), HORIZON + 10, 260, 90);
    g.fillStyle(shade(ground, dim), 1).fillRect(0, HORIZON, W, H - HORIZON);

    if (kind === 'forest') {
      for (let i = 0; i < 16; i++) {
        const x = (i * 41 + (hash(i, 4) % 30)) % (W + 40) - 20;
        if (x > 170 && x < 400) continue; // a clearing around the fire
        const h = 120 + (hash(i, 5) % 90);
        pine(g, x, HORIZON + 40 + (hash(i, 6) % 40), h, shade(0x173a1e, dim));
      }
    } else if (kind === 'rocks') {
      g.fillStyle(shade(0x6e6a5e, dim), 1);
      g.fillEllipse(80, HORIZON + 20, 200, 120).fillEllipse(500, HORIZON + 30, 180, 140).fillEllipse(420, HORIZON - 5, 120, 80);
      g.fillStyle(shade(0x57534a, dim), 1).fillEllipse(130, HORIZON + 60, 90, 60).fillEllipse(470, HORIZON + 80, 70, 50);
    } else if (kind === 'riverside') {
      g.fillStyle(shade(0x2f6f9f, dim), 1).fillRect(0, HORIZON + 20, W, 46);
      g.fillStyle(shade(0x9cc9ea, dim), 0.6);
      for (let i = 0; i < 12; i++) g.fillRect((hash(i, 7) % W) | 0, HORIZON + 26 + (hash(i, 8) % 34), 30, 2);
      g.fillStyle(shade(0x2c5a22, dim), 1);
      for (let i = 0; i < 14; i++) g.fillRect(i * 44 + 8, HORIZON + 6 + (i % 3) * 3, 3, 18);
    } else if (kind === 'ruins') {
      g.fillStyle(shade(0x8a8678, dim), 1);
      for (const [x, h] of [[60, 140], [130, 90], [430, 160], [510, 70]] as const) {
        g.fillRect(x, HORIZON + 40 - h, 34, h);
        g.fillTriangle(x, HORIZON + 40 - h, x + 34, HORIZON + 40 - h, x + 12, HORIZON + 22 - h);
      }
      g.fillRect(410, HORIZON - 150, 140, 18); // fallen lintel
      g.fillStyle(shade(0x6b675b, dim), 1).fillRect(200, HORIZON + 60, 60, 18).fillRect(340, HORIZON + 66, 46, 14);
    } else {
      // meadow: a few flowers
      for (let i = 0; i < 40; i++) {
        g.fillStyle(shade([0xf1c40f, 0xe74c3c, 0xffffff][i % 3], dim), 1);
        g.fillRect(hash(i, 10) % W, HORIZON + 20 + (hash(i, 11) % (H - HORIZON - 30)), 3, 3);
      }
    }
  }

  private drawCave(g: Phaser.GameObjects.Graphics): void {
    g.fillStyle(0x1a120c, 1).fillRect(0, 0, W, H);
    g.fillStyle(0x3b2a1d, 1).fillEllipse(W / 2, 140, 560, 330); // the chamber
    g.fillStyle(0x2a1d14, 1);
    for (let i = 0; i < 9; i++) {
      const x = 40 + i * 62 + (hash(i, 12) % 20);
      g.fillTriangle(x - 14, 0, x + 14, 0, x, 40 + (hash(i, 13) % 60)); // stalactites
    }
    g.fillStyle(0x6b4a2e, 1).fillRect(0, HORIZON + 30, W, H - HORIZON - 30);
    g.fillStyle(0x5a3d25, 1).fillEllipse(60, HORIZON + 40, 160, 90).fillEllipse(520, HORIZON + 30, 150, 110);
  }

  private drawInn(g: Phaser.GameObjects.Graphics, sky: { top: number; bottom: number }): void {
    // plank wall
    for (let x = 0; x < W; x += 24) g.fillStyle(x % 48 ? 0x6b4423 : 0x5e3b1e, 1).fillRect(x, 0, 24, 300);
    g.fillStyle(0x3d2512, 1).fillRect(0, 290, W, 10);
    // window with the sky outside
    g.fillStyle(0x3d2512, 1).fillRect(56, 60, 120, 96);
    bands(g, 66, 150, sky.top, sky.bottom, 66, 100);
    g.fillStyle(0x3d2512, 1).fillRect(114, 66, 4, 84).fillRect(66, 106, 100, 4);
    // floor boards
    for (let y = 300; y < H; y += 18) g.fillStyle(y % 36 ? 0x8a5a2b : 0x7a4f25, 1).fillRect(0, y, W, 18);
    // beds
    for (const x of [230, 330]) {
      g.fillStyle(0x4a2c14, 1).fillRect(x, 200, 80, 100);
      g.fillStyle(0xe9e4d4, 1).fillRect(x + 6, 206, 68, 22);
      g.fillStyle(0x8e2f2f, 1).fillRect(x + 6, 232, 68, 62);
    }
    // hearth
    g.fillStyle(0x6e6a5e, 1).fillRect(420, 190, 100, 120);
    g.fillStyle(0x1b1410, 1).fillRect(440, 250, 60, 60);
  }
}

/** Sky colours by hour: day, dusk/dawn, night. */
function skyColours(hour: number): { top: number; bottom: number; night: boolean } {
  if (hour >= 7 && hour < 18) return { top: 0x4f8fd6, bottom: 0xa8d4f5, night: false };
  if ((hour >= 18 && hour < 20) || (hour >= 5 && hour < 7)) return { top: 0x3b3a6e, bottom: 0xe0875a, night: false };
  return { top: 0x070b1f, bottom: 0x1d2a4f, night: true };
}

/** Vertical gradient in horizontal bands. */
function bands(g: Phaser.GameObjects.Graphics, y0: number, y1: number, top: number, bottom: number, x = 0, w = W): void {
  const n = 24;
  for (let i = 0; i < n; i++) {
    g.fillStyle(mix(top, bottom, i / (n - 1)), 1).fillRect(x, y0 + ((y1 - y0) * i) / n, w, (y1 - y0) / n + 1);
  }
}

function pine(g: Phaser.GameObjects.Graphics, x: number, base: number, h: number, colour: number): void {
  g.fillStyle(colour, 1);
  for (let k = 0; k < 3; k++) {
    const top = base - h + k * (h / 4);
    const half = 18 + k * 10;
    g.fillTriangle(x - half, top + h / 2.2, x + half, top + h / 2.2, x, top);
  }
  g.fillRect(x - 3, base - 8, 6, 12);
}

const hash = (i: number, salt: number): number => {
  let h = Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(salt + 7, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
};

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function shade(rgb: number, k: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (c((rgb >> 16) & 0xff) << 16) | (c((rgb >> 8) & 0xff) << 8) | c(rgb & 0xff);
}
