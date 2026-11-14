/**
 * HTML overlay UI (character panel, message log, status, buttons). Menus and
 * text live in the DOM rather than Phaser: easier layout, accessibility and
 * mobile scaling. Text is always set via textContent (never innerHTML).
 */
import type { Command, CommandBus } from '../engine/commands';

export type Side = 'party' | 'enemy';

export interface SpriteCss {
  url: string;
  frameWidth: number;
  col: number;
  row: number;
  sheetCols: number;
  sheetRows: number;
}

export interface ActiveCard {
  name: string;
  side: Side;
  hp: number;
  maxHp: number;
  ac: number;
  attackBonus: number;
  damage: string;
  movesLeft: number;
  speed: number;
  actionUsed: boolean;
  sprite: SpriteCss;
}

const CARD_PX = 64; // portrait box size

export class Hud {
  private logEl = must('log');
  private statusEl = must('status');
  private cardEl = must('card');
  private namePattern: RegExp | null = null;
  private sideByName = new Map<string, Side>();

  constructor(bus: CommandBus) {
    document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => bus.dispatch(JSON.parse(btn.dataset.command!) as Command));
    });
  }

  /** Register unit names so the log can colour them by side. */
  setNames(units: readonly { name: string; side: Side }[]): void {
    this.sideByName = new Map(units.map((u) => [u.name, u.side]));
    const names = [...this.sideByName.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
    this.namePattern = names.length ? new RegExp(`(${names.join('|')})`, 'g') : null;
  }

  setLog(lines: readonly string[]): void {
    this.logEl.replaceChildren(...lines.slice(-60).map((l) => this.renderLine(l)));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Full-board victory/defeat banner; hidden while combat is ongoing. */
  setOutcome(outcome: 'ongoing' | 'victory' | 'defeat', detail: string): void {
    const banner = must('banner');
    if (outcome === 'ongoing') {
      banner.hidden = true;
      return;
    }
    if (!banner.hidden && banner.className === outcome) return; // keep the animation from replaying
    banner.className = outcome;
    must('banner-title').textContent = outcome === 'victory' ? 'Victory!' : 'The party has fallen';
    must('banner-sub').textContent = detail;
    banner.hidden = false;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  /** Highlight the End turn button when the active unit has used its action or movement. */
  setEndTurnHint(on: boolean): void {
    document
      .querySelectorAll('[data-command=\'{"type":"endTurn"}\']')
      .forEach((b) => b.classList.toggle('suggest', on));
  }

  setActive(card: ActiveCard | null): void {
    if (!card) {
      this.cardEl.replaceChildren(el('p', 'muted', 'Combat over — Enter or Replay for another fight.'));
      return;
    }
    const s = card.sprite;
    const portrait = el('div', 'portrait');
    const scale = CARD_PX / s.frameWidth;
    Object.assign(portrait.style, {
      backgroundImage: `url(${s.url})`,
      backgroundSize: `${s.sheetCols * CARD_PX}px ${s.sheetRows * CARD_PX}px`,
      backgroundPosition: `-${s.col * s.frameWidth * scale}px -${s.row * s.frameWidth * scale}px`,
    });

    const hpPct = Math.round((card.hp / card.maxHp) * 100);
    const hpFill = el('div', hpPct > 50 ? 'fill ok' : hpPct > 25 ? 'fill warn' : 'fill bad');
    hpFill.style.width = `${hpPct}%`;

    this.cardEl.replaceChildren(
      el('div', 'card-head', portrait, el('h2', `name ${card.side}`, card.name)),
      el('div', 'stat', el('span', '', 'HP'), el('span', '', `${card.hp} / ${card.maxHp}`)),
      el('div', 'bar', hpFill),
      el('div', 'stat', el('span', '', 'AC'), el('span', '', String(card.ac))),
      el('div', 'stat', el('span', '', 'Moves'), el('span', '', `${card.movesLeft} / ${card.speed}`)),
      el('h3', '', 'Actions'),
      el(
        'div',
        card.actionUsed ? 'action used' : 'action',
        el('span', '', `⚔ Attack  +${card.attackBonus}  ${card.damage}`),
        el('small', '', card.actionUsed ? 'used this turn' : 'walk into an adjacent enemy'),
      ),
      el('div', 'action disabled', el('span', '', '✦ Spells'), el('small', '', 'coming — DND-23')),
      el('div', 'action disabled', el('span', '', '⚗ Items'), el('small', '', 'coming — DND-24')),
    );
  }

  private renderLine(text: string): HTMLElement {
    const cls = text.startsWith('▶')
      ? 'turn'
      : text.startsWith('—')
        ? 'round'
        : /Victory!/.test(text)
          ? 'win'
          : /fallen/.test(text)
            ? 'lose'
            : /CRITS/.test(text)
              ? 'crit'
              : '';
    const p = el('p', cls);
    if (!this.namePattern) {
      p.textContent = text;
      return p;
    }
    for (const part of text.split(this.namePattern)) {
      const side = this.sideByName.get(part);
      p.append(side ? el('span', `name ${side}`, part) : document.createTextNode(part));
    }
    return p;
  }
}

function el(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function must(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing #${id} in index.html`);
  return e;
}
