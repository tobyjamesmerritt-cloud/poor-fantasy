/**
 * HTML overlay UI (character card, party roster, message log, status, board
 * overlays). Menus and text live in the DOM rather than Phaser: easier layout,
 * accessibility and mobile scaling. Text is always set via textContent.
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
  attackName: string;
  attackBonus: number;
  damage: string;
  movesLeft: number;
  speed: number;
  actionUsed: boolean;
  sprite: SpriteCss;
}

export interface RosterEntry {
  name: string;
  hp: number;
  maxHp: number;
  sprite: SpriteCss;
}

export interface ExplorePanel {
  title: string; // location name
  party: readonly { name: string; ac: number; hp: number; maxHp: number }[];
  where: string; // "13,7 · facing W"
  clock: string; // "Day 1 · 16:07"
}

export interface PlaceAction {
  label: string;
  command?: Command; // omitted = disabled ("coming soon")
}

export class Hud {
  private logEl = must('log');
  private statusEl = must('status');
  private cardEl = must('card');
  private namePattern: RegExp | null = null;
  private sideByName = new Map<string, Side>();

  constructor(private bus: CommandBus) {
    document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => bus.dispatch(JSON.parse(btn.dataset.command!) as Command));
    });
  }

  /** Show or hide controls that only make sense in combat. */
  setCombatControls(on: boolean): void {
    must('turn-buttons').hidden = !on;
  }

  /** Register unit names so the log can colour them by side. */
  setNames(units: readonly { name: string; side: Side }[]): void {
    this.sideByName = new Map(units.map((u) => [u.name, u.side]));
    const names = [...this.sideByName.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
    this.namePattern = names.length ? new RegExp(`(${names.join('|')})`, 'g') : null;
  }

  setLog(lines: readonly string[]): void {
    this.logEl.replaceChildren(...lines.slice(-80).map((l) => this.renderLine(l)));
    this.logEl.scrollTop = this.logEl.scrollHeight;
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

  /** Full-board victory/defeat banner; hidden while combat is ongoing. */
  setOutcome(outcome: 'ongoing' | 'victory' | 'defeat' | 'none', detail = ''): void {
    const banner = must('banner');
    if (outcome === 'ongoing' || outcome === 'none') {
      banner.hidden = true;
      banner.className = 'overlay';
      return;
    }
    if (!banner.hidden && banner.classList.contains(outcome)) return; // don't replay the animation
    banner.className = `overlay ${outcome}`;
    must('banner-title').textContent = outcome === 'victory' ? 'Victory!' : 'The party has fallen';
    must('banner-sub').textContent = detail;
    banner.hidden = false;
  }

  /** Location panel on the world map; null hides it. */
  setPlace(place: { name: string; kind: string; description: string; actions: PlaceAction[] } | null): void {
    const panel = must('place');
    if (!place) {
      panel.hidden = true;
      return;
    }
    must('place-name').textContent = place.name;
    must('place-kind').textContent = place.kind;
    must('place-desc').textContent = place.description;
    must('place-actions').replaceChildren(
      ...place.actions.map((a) => {
        const btn = el('button', '', a.label) as HTMLButtonElement;
        if (a.command) btn.addEventListener('click', () => this.bus.dispatch(a.command!));
        else btn.disabled = true;
        return btn;
      }),
    );
    panel.hidden = false;
  }

  /** Compact active-character card: name over the portrait, stats beside it. */
  setActive(card: ActiveCard | null): void {
    if (!card) {
      this.cardEl.replaceChildren(el('p', 'muted', 'Combat over.'));
      return;
    }
    const hpPct = Math.round((card.hp / card.maxHp) * 100);
    const hpFill = el('div', hpPct > 50 ? 'fill ok' : hpPct > 25 ? 'fill warn' : 'fill bad');
    hpFill.style.width = `${hpPct}%`;
    const stats = el(
      'dl',
      'stats',
      el('dt', '', 'HP'),
      el('dd', '', `${card.hp}/${card.maxHp}`),
      el('div', 'bar', hpFill),
      el('dt', '', 'AC'),
      el('dd', '', String(card.ac)),
      el('dt', '', 'Moves'),
      el('dd', '', `${card.movesLeft}/${card.speed}`),
    );
    this.cardEl.replaceChildren(
      el('div', 'card-top', el('div', `name ${card.side}`, card.name), portrait(card.sprite, 64), stats),
      el(
        'div',
        'actions',
        el(
          'div',
          card.actionUsed ? 'action used' : 'action',
          `⚔ ${card.attackName} +${card.attackBonus} · ${card.damage}`,
          el('small', '', card.actionUsed ? 'used this turn' : 'click an enemy · or a fallen ally'),
        ),
        el('div', 'action disabled', '✦ Spells', el('small', '', 'coming — DND-23')),
        el('div', 'action disabled', '⚗ Items', el('small', '', 'coming — DND-24')),
      ),
    );
  }

  /**
   * Gold Box-style side panel inside a location: party (name, AC, HP),
   * position and clock, and on-screen movement buttons (touch).
   */
  setExplore(panel: ExplorePanel): void {
    const btn = (label: string, title: string, command?: Command) => {
      const b = el('button', '', label) as HTMLButtonElement;
      b.title = title;
      if (command) b.addEventListener('click', () => this.bus.dispatch(command));
      else b.disabled = true;
      return b;
    };
    const rows = panel.party.map((p) => {
      const pct = Math.round((p.hp / p.maxHp) * 100);
      return el(
        'tr',
        '',
        el('td', 'name party', p.name),
        el('td', 'num', String(p.ac)),
        el('td', `num ${pct > 50 ? 'ok' : pct > 25 ? 'warn' : 'bad'}`, String(p.hp)),
      );
    });
    this.cardEl.replaceChildren(
      el('div', 'explore-title', panel.title),
      el('table', 'party-table', el('tr', '', el('th', '', 'Name'), el('th', 'num', 'AC'), el('th', 'num', 'HP')), ...rows),
      el('div', 'explore-where', el('span', '', panel.where), el('span', '', panel.clock)),
      el(
        'div',
        'move-pad',
        btn('↶', 'Turn left (A / ←)', { type: 'turn', dir: 'left' }),
        btn('↑', 'Forward (W / ↑)', { type: 'step', dir: 'forward' }),
        btn('↷', 'Turn right (D / →)', { type: 'turn', dir: 'right' }),
        btn('⇠', 'Step left (Q)', { type: 'step', dir: 'left' }),
        btn('↓', 'Back (S / ↓)', { type: 'step', dir: 'back' }),
        btn('⇢', 'Step right (E)', { type: 'step', dir: 'right' }),
      ),
      el(
        'div',
        'explore-actions',
        btn('Search', 'coming later'),
        btn('Encamp', 'coming — M4 (rest, save)'),
        btn('Leave', 'Back to the world map', { type: 'leaveLocation' }),
      ),
    );
  }

  /** Party list for the world map. */
  setRoster(entries: readonly RosterEntry[]): void {
    this.cardEl.replaceChildren(
      el('div', 'name party', 'The party'),
      el(
        'div',
        'roster',
        ...entries.map((e) => {
          const pct = Math.round((e.hp / e.maxHp) * 100);
          const fill = el('div', pct > 50 ? 'fill ok' : pct > 25 ? 'fill warn' : 'fill bad');
          fill.style.width = `${pct}%`;
          return el(
            'div',
            'roster-row',
            portrait(e.sprite, 32),
            el('div', '', `${e.name}  ${e.hp}/${e.maxHp}`, el('div', 'bar', fill)),
          );
        }),
      ),
    );
  }

  private renderLine(text: string): HTMLElement {
    const cls = text.startsWith('▶')
      ? 'turn'
      : text.startsWith('⟲')
        ? 'rewind'
        : text.startsWith('—')
          ? 'round'
          : /Victory!/.test(text)
            ? 'win'
            : /fallen…|dies\.|slain|killed outright/.test(text)
              ? 'lose'
              : /unconscious|death save/.test(text)
                ? 'down'
                : /CRITS/.test(text)
                  ? 'crit'
                  : /stable|regains consciousness/.test(text)
                    ? 'saved'
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

function portrait(s: SpriteCss, px: number): HTMLElement {
  const p = el('div', 'portrait');
  const scale = px / s.frameWidth;
  Object.assign(p.style, {
    backgroundImage: `url(${s.url})`,
    backgroundSize: `${s.sheetCols * px}px ${s.sheetRows * px}px`,
    backgroundPosition: `-${s.col * s.frameWidth * scale}px -${s.row * s.frameWidth * scale}px`,
  });
  return p;
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
