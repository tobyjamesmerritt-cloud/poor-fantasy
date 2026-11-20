/**
 * The party pack (HTML dialog), anywhere outside a fight. Items are shared by
 * the whole party; only equipped gear belongs to a character.
 *
 * Layout: purse + category tabs, then one card per item (icon, name, count,
 * one-line detail, one button). "Drink…" / "Equip…" open a row of name chips
 * on the card — tap who. Below, a compact "who wears what" list; a name opens
 * that character's sheet (gear swaps live there too). Sends Commands only.
 */
import type { CommandBus } from '../engine/commands';
import type { GameState } from '../engine/state';
import type { SpriteCss } from './hud';
import type { PopupFrame, PopupView } from './popupFrame';
import { characterData, statsOf } from '../content/characters';
import { weaponDef } from '../rules/character';
import { canSell, equipProblem, itemInfo } from '../rules/items';
import { formatCoins } from '../rules/party';
import { MISC_ICON, VALUABLE_ICON, WEAPON_ICON } from '../content/itemIcons';

export interface PackDialogDeps {
  bus: CommandBus;
  frame: PopupFrame;
  spriteCss: (key: string) => SpriteCss | null;
}

type Tab = 'all' | 'potions' | 'scrolls' | 'weapons' | 'armour' | 'valuables' | 'quest';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'potions', label: 'Potions' },
  { id: 'scrolls', label: 'Scrolls' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'armour', label: 'Armour' },
  { id: 'valuables', label: 'Valuables' },
  { id: 'quest', label: 'Quest' },
];



interface Item {
  ref: string;
  tab: Exclude<Tab, 'all'>;
  icon: string;
  name: string;
  count: number;
  detail: string;
}

/** Cards per page: the pack never scrolls, it pages (DND-89 no-scroll rule). */
const PAGE = 6;

export class PackDialog {
  private mine: PopupView | null = null;
  private game!: GameState;
  private message = '';
  private focus: string | undefined; // character opened from their name: listed first in the choices
  private tab: Tab = 'all';
  private page = 0;
  private choosing: string | null = null; // item whose "who?" chips are open

  constructor(private deps: PackDialogDeps) {}

  get open(): boolean {
    return this.deps.frame.isTop(this.mine);
  }

  show(game: GameState, characterId?: string): void {
    this.game = game;
    this.focus = characterId;
    this.message = '';
    this.choosing = null;
    this.page = 0;
    this.render();
  }

  refresh(message = ''): void {
    if (!this.open) return;
    this.message = message;
    this.choosing = null;
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.mine = null;
    this.deps.frame.pop();
  }

  private get bus(): CommandBus {
    return this.deps.bus;
  }

  // --- Data -------------------------------------------------------------------

  private items(): Item[] {
    const g = this.game;
    const d = characterData;
    const order: Item['tab'][] = ['potions', 'scrolls', 'weapons', 'armour', 'valuables', 'quest'];
    return Object.keys(g.inventory)
      .filter((r) => g.inventory[r] > 0)
      .map((ref): Item => {
        const [kind, id] = ref.split(':');
        const name = itemInfo(ref, d)?.name ?? ref;
        const count = g.inventory[ref];
        if (kind === 'consumable') {
          const c = d.consumables[id];
          return { ref, tab: 'potions', icon: id === 'potion-of-healing-greater' ? 'item-potion-greater' : c?.heal ? 'item-potion' : 'item-drink', name, count, detail: c?.heal ? `Heals ${c.heal}` : 'A drink' };
        }
        if (kind === 'scroll') {
          const s = d.spells[id];
          const classes = s ? s.classes.map((c) => d.classes[c]?.name ?? c).join(', ') : '';
          // the card shows the spell's name; "scroll" moves into the detail line so it isn't cut off
          return { ref, tab: 'scrolls', icon: 'item-scroll', name: s?.name ?? name, count, detail: s ? `Scroll · level ${s.level} · ${classes}` : '' };
        }
        if (kind === 'weapon') {
          const w = weaponDef(d, id);
          const base = id.replace(/\+\d+$/, '');
          const detail = w ? `${w.damage}${w.bonus ? ` · +${w.bonus} magic` : ''} · ${w.category}` : '';
          return { ref, tab: 'weapons', icon: WEAPON_ICON[base] ?? 'item-sword', name, count, detail };
        }
        if (kind === 'armor') {
          const a = d.armor[id];
          const dex = a ? (a.dexMax === null ? ' + Dex' : a.dexMax ? ` + Dex (max ${a.dexMax})` : '') : '';
          return { ref, tab: 'armour', icon: 'item-armor', name, count, detail: a ? `AC ${a.base}${dex} · ${a.category}` : '' };
        }
        if (ref === 'shield') return { ref, tab: 'armour', icon: 'item-shield', name, count, detail: '+2 AC' };
        if (kind === 'valuable') {
          // gems and art objects: sell at a shop for their full value (SRD 5.2)
          const v = d.valuables[id];
          return { ref, tab: 'valuables', icon: VALUABLE_ICON[id] ?? 'item-gem', name, count, detail: `Worth ${formatCoins(v?.cost ?? 0)} · ${v?.description ?? ''}` };
        }
        const desc = kind === 'misc' ? (d.misc[id]?.description ?? '') : '';
        return { ref, tab: 'quest', icon: MISC_ICON[id] ?? 'item-key', name, count, detail: desc || 'Quest item' };
      })
      .sort((a, b) => order.indexOf(a.tab) - order.indexOf(b.tab) || +!a.icon.startsWith('item-potion') - +!b.icon.startsWith('item-potion') || a.name.localeCompare(b.name));
  }

  /** Characters first-in-line for a choice: the one the pack was opened from, then roster order. */
  private roster() {
    const g = this.game;
    return [...g.roster].sort((a, b) => (b.id === this.focus ? 1 : 0) - (a.id === this.focus ? 1 : 0));
  }

  // --- Render -----------------------------------------------------------------

  private render(): void {
    const g = this.game;
    const items = this.items();
    const counts = new Map<Tab, number>([['all', items.length]]);
    for (const i of items) counts.set(i.tab, (counts.get(i.tab) ?? 0) + 1);
    if (this.tab !== 'all' && !counts.get(this.tab)) this.tab = 'all';

    const tabs = el('div', 'pk-tabs');
    tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const n = counts.get(t.id) ?? 0;
      if (t.id !== 'all' && !n) continue;
      const b = btn(`${t.label} ${n}`, () => {
        this.tab = t.id;
        this.page = 0;
        this.choosing = null;
        this.render();
      }, this.tab === t.id ? 'pk-tab on' : 'pk-tab');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(this.tab === t.id));
      tabs.append(b);
    }

    const shown = items.filter((i) => this.tab === 'all' || i.tab === this.tab);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    this.page = Math.min(this.page, pages - 1);
    const grid = el('div', 'pk-grid');
    for (const i of shown.slice(this.page * PAGE, (this.page + 1) * PAGE)) grid.append(this.card(i));

    const content: HTMLElement[] = [el('div', 'pk-purse', el('span', 'pk-coin', '●'), formatCoins(g.coins))];
    if (items.length) content.push(tabs);
    content.push(items.length ? grid : el('p', 'pk-empty muted', 'The pack is empty. Shops sell weapons, armour and potions.'));
    content.push(el('div', 'ps-message pd-msg', this.message));

    const go = (to: number) => () => {
      this.page = to;
      this.choosing = null;
      this.render();
    };
    const lead = shown[this.page * PAGE];
    this.mine = {
      sprite: lead ? (this.deps.spriteCss(lead.icon) ?? undefined) : undefined,
      title: g.partyName ? `${g.partyName} — pack` : 'The party’s pack',
      hint: 'Shared by the whole party. Equipped gear belongs to a character: open their sheet to change it.',
      content,
      row: true,
      modal: true,
      choices: [
        ...(pages > 1
          ? [
              { label: '◀', disabled: this.page === 0, onClick: go(this.page - 1) },
              { label: `Page ${this.page + 1} / ${pages}`, muted: true, disabled: true, onClick: () => undefined },
              { label: '▶', disabled: this.page >= pages - 1, onClick: go(this.page + 1) },
            ]
          : []),
        { label: 'Party', onClick: () => this.swapTo({ type: 'openParty' }) },
        { label: 'Close', onClick: () => this.close() },
      ],
      onCancel: () => this.close(),
    };
    this.deps.frame.push(this.mine);
  }

  /** Hand the frame to another popup (it swaps the content; this one is no longer showing). */
  private swapTo(cmd: Parameters<CommandBus['dispatch']>[0]): void {
    this.mine = null;
    this.bus.dispatch(cmd);
  }

  private card(i: Item): HTMLElement {
    const open = this.choosing === i.ref;
    const title = el('div', 'pk-name', i.name, i.count > 1 ? el('span', 'pk-count', `×${i.count}`) : '');
    const detail = el('div', 'pk-detail', i.detail + (canSell(i.ref) || i.tab === 'quest' ? '' : ' · quest item'));
    detail.title = i.detail;
    const body = el('div', 'pk-body', title, detail);
    const card = el('div', open ? 'pk-card open' : 'pk-card', this.icon(i.icon), body);
    const action = this.action(i);
    if (action) card.append(action);
    if (open) card.append(this.chooser(i));
    return card;
  }

  /** The card's one button (or a short note why there is none). */
  private action(i: Item): HTMLElement | null {
    const d = characterData;
    const [kind, id] = i.ref.split(':');
    const toggle = (label: string) =>
      btn(this.choosing === i.ref ? 'Cancel' : label, () => {
        this.choosing = this.choosing === i.ref ? null : i.ref;
        this.render();
      }, 'pk-act');
    if (kind === 'consumable' && d.consumables[id]?.heal) return this.hurt().length ? toggle('Drink…') : el('small', 'pk-note', 'Nobody hurt');
    if (kind === 'consumable') return btn('Drink', () => this.bus.dispatch({ type: 'useItem', ref: i.ref }), 'pk-act');
    if (kind === 'scroll')
      return btn('Read…', () => {
        this.swapTo({ type: 'openSpells' }); // scrolls are read from the spells dialog
      }, 'pk-act');
    if (i.tab === 'weapons' || i.tab === 'armour') return toggle('Equip…');
    return null;
  }

  /** Alive and below full HP (unconscious included), most hurt first. */
  private hurt() {
    const g = this.game;
    const stats = statsOf(g.roster);
    return this.roster()
      .map((r) => ({ r, p: g.party.find((x) => x.id === r.id), max: stats.find((s) => s.id === r.id)?.hp ?? 0 }))
      .filter((x) => x.p && !x.p.dead && x.p.hp < x.max)
      .sort((a, b) => (b.r.id === this.focus ? 1 : 0) - (a.r.id === this.focus ? 1 : 0) || a.p!.hp / a.max - b.p!.hp / b.max);
  }

  /** Name chips: who drinks it / who puts it on. */
  private chooser(i: Item): HTMLElement {
    const d = characterData;
    const row = el('div', 'pk-who');
    if (i.tab === 'potions') {
      for (const { r, p, max } of this.hurt()) {
        const b = btn('', () => this.bus.dispatch({ type: 'useItem', ref: i.ref, targetId: r.id }), 'pk-chip');
        b.append(this.portrait(r.sprite), `${r.name} `, el('span', p!.hp <= 0 ? 'pk-hp bad' : 'pk-hp', `${Math.max(0, p!.hp)}/${max}`));
        row.append(b);
      }
    } else {
      for (const r of this.roster()) {
        const why = equipProblem(r, i.ref, d);
        const b = btn('', () => this.bus.dispatch({ type: 'equipItem', characterId: r.id, ref: i.ref }), 'pk-chip');
        b.append(this.portrait(r.sprite), r.name);
        if (why) {
          b.disabled = true;
          b.title = why;
        }
        row.append(b);
      }
    }
    return row;
  }

  private icon(key: string): HTMLElement {
    const wrap = el('div', 'pk-icon');
    wrap.append(this.sprite(key, 32));
    return wrap;
  }

  private portrait(key: string): HTMLElement {
    return this.sprite(key, 20);
  }

  private sprite(key: string, px: number): HTMLElement {
    const p = el('span', 'portrait');
    p.style.width = p.style.height = `${px}px`;
    const s = this.deps.spriteCss(key);
    if (!s) return p;
    const scale = px / s.frameWidth;
    Object.assign(p.style, {
      backgroundImage: `url(${s.url})`,
      backgroundSize: `${s.sheetCols * px}px ${s.sheetRows * px}px`,
      backgroundPosition: `-${s.col * s.frameWidth * scale}px -${s.row * s.frameWidth * scale}px`,
    });
    return p;
  }
}

function el(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}
