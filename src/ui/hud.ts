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
  state?: 'ok' | 'out' | 'dead';
}

export interface PartyRow {
  name: string;
  ac?: number;
  hp: number;
  maxHp: number;
  hitDice?: string; // "1d10"
  state: 'ok' | 'out' | 'dead';
}

export interface ExplorePanel {
  title: string; // location name
  party: readonly PartyRow[];
  where: string; // "13,7 W"
  clock: string; // "Day 1 · 16:07"
  purse: string; // "60 gp"
}

export interface CampPanel {
  title: string;
  subtitle: string;
  party: readonly PartyRow[];
  purse: string;
  clock: string;
  actions: { label: string; command: Command; disabledReason?: string }[];
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

  /** Enable the Flee button only when the active character may flee; the tooltip says why not. */
  setFlee(state: { ok: boolean; reason?: string } | null): void {
    const btn = must('flee-btn') as HTMLButtonElement;
    btn.disabled = !state?.ok;
    btn.title = state?.ok ? 'Flee over the map edge (F)' : (state?.reason ?? 'Flee: stand on the map edge');
  }

  /** Highlight the End turn button when the active unit has used its action or movement. */
  setEndTurnHint(on: boolean): void {
    document
      .querySelectorAll('[data-command=\'{"type":"endTurn"}\']')
      .forEach((b) => b.classList.toggle('suggest', on));
  }

  /** Full-board victory/defeat banner; hidden while combat is ongoing. */
  setOutcome(outcome: 'ongoing' | 'victory' | 'defeat' | 'fled' | 'none', detail = ''): void {
    const banner = must('banner');
    if (outcome === 'ongoing' || outcome === 'none') {
      banner.hidden = true;
      banner.className = 'overlay';
      return;
    }
    if (!banner.hidden && banner.classList.contains(outcome)) return; // don't replay the animation
    banner.className = `overlay ${outcome}`;
    must('banner-title').textContent =
      outcome === 'victory' ? 'Victory!' : outcome === 'fled' ? 'Retreat!' : 'The party has fallen';
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
    this.cardEl.replaceChildren(
      el('div', 'explore-title', panel.title),
      partyTable(panel.party, 'ac'),
      el('div', 'explore-where', el('span', '', panel.where), el('span', '', panel.clock), el('span', 'purse', panel.purse)),
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
        btn('Encamp', 'Make camp here (not in towns — use the inn)', { type: 'encamp' }),
        btn('Leave', 'Back to the world map', { type: 'leaveLocation' }),
      ),
    );
  }

  /** Camp / inn panel: party with HP and Hit Dice, purse, clock and the rest buttons. */
  setCamp(panel: CampPanel): void {
    this.cardEl.replaceChildren(
      el('div', 'explore-title', panel.title),
      el('div', 'muted small', panel.subtitle),
      partyTable(panel.party, 'hd'),
      el('div', 'explore-where', el('span', '', panel.clock), el('span', 'purse', panel.purse)),
      el(
        'div',
        'camp-actions',
        ...panel.actions.map((a) => {
          const b = el('button', '', a.label) as HTMLButtonElement;
          if (a.disabledReason) {
            b.disabled = true;
            b.title = a.disabledReason;
            return el('div', 'camp-action', b, el('small', 'muted', a.disabledReason));
          }
          b.addEventListener('click', () => this.bus.dispatch(a.command));
          return b;
        }),
      ),
    );
  }

  /** Party list for the world map. */
  setRoster(entries: readonly RosterEntry[], footer?: { purse: string; clock: string; encamp: Command }): void {
    const extra: HTMLElement[] = [];
    if (footer) {
      const camp = el('button', '', 'Encamp') as HTMLButtonElement;
      camp.title = 'Make camp here — off the road, not on bridges or at towns';
      camp.addEventListener('click', () => this.bus.dispatch(footer.encamp));
      extra.push(el('div', 'explore-where', el('span', '', footer.clock), el('span', 'purse', footer.purse)), el('div', 'explore-actions', camp));
    }
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
            el(
              'div',
              e.state === 'dead' ? 'muted' : '',
              `${e.name}  ${e.state === 'dead' ? 'dead' : e.state === 'out' ? `${e.hp}/${e.maxHp} · unconscious` : `${e.hp}/${e.maxHp}`}`,
              el('div', 'bar', fill),
            ),
          );
        }),
      ),
      ...extra,
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

function partyTable(rows: readonly PartyRow[], extra: 'ac' | 'hd'): HTMLElement {
  return el(
    'table',
    'party-table',
    el('tr', '', el('th', '', 'Name'), el('th', 'num', extra === 'ac' ? 'AC' : 'HD'), el('th', 'num', 'HP')),
    ...rows.map((p) => {
      const pct = Math.round((p.hp / p.maxHp) * 100);
      const hpText = p.state === 'dead' ? 'dead' : p.state === 'out' ? `${p.hp} ✚` : String(p.hp);
      return el(
        'tr',
        p.state === 'dead' ? 'muted' : '',
        el('td', 'name party', p.name),
        el('td', 'num', extra === 'ac' ? String(p.ac ?? '') : (p.hitDice ?? '')),
        el('td', `num ${p.state !== 'ok' ? 'bad' : pct > 50 ? 'ok' : pct > 25 ? 'warn' : 'bad'}`, hpText),
      );
    }),
  );
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
