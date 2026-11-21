/**
 * Shop (DND-93): buy SRD weapons, armour, shields and Potions of Healing into
 * the party pack, sell from the pack at half price. Draws into the shared popup
 * frame over the town view — categories and pages, never a scrollbar. Equipping
 * happens on the character sheet / pack. Changes go out as Commands; main.ts
 * applies the rules.
 */
import type { Command, CommandBus } from '../engine/commands';
import type { GameState } from '../engine/state';
import { characterData } from '../content/characters';
import { canSell, itemInfo, sellPrice } from '../rules/items';
import { formatCoins } from '../rules/party';
import type { SpriteCss } from './hud';
import { pictureUrl } from './localPictures';
import type { PopupFrame, PopupView } from './popupFrame';

const gp = (cp: number) => formatCoins(cp);

/** Rows per page: the frame is a fixed size, so long lists page. */
const ROWS = 7;

type Tab = 'weapons' | 'armor' | 'other' | 'sell';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'weapons', label: 'Weapons', icon: 'item-sword' },
  { id: 'armor', label: 'Armour', icon: 'item-armor' },
  { id: 'other', label: 'Shields & potions', icon: 'item-potion' },
  { id: 'sell', label: 'Sell', icon: 'item-gem' },
];

export class ShopScreen {
  private mine: PopupView | null = null;
  private game!: GameState;
  private name = '';
  private picture: string | undefined;
  private message = '';
  private tab: Tab = 'weapons';
  private page = 0;

  constructor(
    private bus: CommandBus,
    private frame: PopupFrame,
    private spriteCss: (key: string) => SpriteCss | null,
  ) {}

  get open(): boolean {
    return this.frame.isTop(this.mine);
  }

  show(game: GameState, shopName: string, picture?: string): void {
    this.game = game;
    this.picture = picture;
    this.name = shopName;
    this.message = '';
    this.tab = 'weapons';
    this.page = 0;
    this.render();
  }

  refresh(message = ''): void {
    if (!this.open) return;
    this.message = message;
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.mine = null;
    this.frame.pop();
  }

  private send(cmd: Command): void {
    this.bus.dispatch(cmd);
  }

  private refsFor(tab: Tab): string[] {
    const d = characterData;
    if (tab === 'weapons') return Object.keys(d.weapons).map((id) => `weapon:${id}`);
    if (tab === 'armor') return Object.keys(d.armor).map((id) => `armor:${id}`);
    if (tab === 'other') return ['shield', ...Object.keys(d.consumables).filter((id) => d.consumables[id].shop !== false).map((id) => `consumable:${id}`)];
    return Object.keys(this.game.inventory).filter((r) => this.game.inventory[r] > 0);
  }

  private render(): void {
    const refs = this.refsFor(this.tab);
    const pages = Math.max(1, Math.ceil(refs.length / ROWS));
    this.page = Math.min(this.page, pages - 1);
    const rows = refs.slice(this.page * ROWS, (this.page + 1) * ROWS);

    const tabs = el('div', 'pk-tabs');
    for (const t of TABS) {
      tabs.append(
        btn(t.label, () => {
          this.tab = t.id;
          this.page = 0;
          this.message = '';
          this.render();
        }, this.tab === t.id ? 'pk-tab on' : 'pk-tab'),
      );
    }
    const table = el('table', 'sh-table', ...rows.map((ref) => (this.tab === 'sell' ? this.sellRow(ref) : this.stockRow(ref))));
    const content: HTMLElement[] = [
      el('div', 'sh-purse', `Purse: ${gp(this.game.coins)}`),
      tabs,
      refs.length ? table : el('p', 'muted', 'Nothing in the pack to sell.'),
      el('div', 'ps-message pd-msg', this.message),
    ];
    const go = (to: number) => () => {
      this.page = to;
      this.render();
    };
    this.mine = {
      // the shopkeeper's picture when the shop has one, else the tab's item icon
      ...(pictureUrl(this.picture) ? { picture: pictureUrl(this.picture) } : { sprite: this.spriteCss(TABS.find((t) => t.id === this.tab)!.icon) ?? undefined }),
      title: this.name,
      hint: 'SRD prices; the shop buys back at half. Purchases go into the party pack: equip them from a character sheet.',
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
        { label: 'Leave', onClick: () => this.send({ type: 'closeShop' }) },
      ],
      onCancel: () => this.send({ type: 'closeShop' }),
    };
    this.frame.push(this.mine);
  }

  private stockRow(ref: string): HTMLElement {
    const info = itemInfo(ref, characterData)!;
    const [kind, id] = ref.split(':');
    let detail = '';
    if (kind === 'weapon') {
      const w = characterData.weapons[id];
      detail = `${w.damage}${w.finesse ? ' · finesse' : ''}${w.light ? ' · light' : ''} · ${w.category}`;
    } else if (kind === 'armor') {
      const a = characterData.armor[id];
      detail = `AC ${a.base}${a.dexMax === null ? ' + Dex' : a.dexMax ? ` + Dex (max ${a.dexMax})` : ''} · ${a.category}${a.strength ? ` · Str ${a.strength}` : ''}`;
    } else if (ref === 'shield') detail = '+2 AC';
    else detail = `heals ${characterData.consumables[id].heal} · Bonus Action`;
    const owned = this.game.inventory[ref] ?? 0;
    return el(
      'tr',
      '',
      el('td', '', info.name, owned ? el('span', 'muted small', ` (${owned})`) : ''),
      el('td', 'muted small', detail),
      el('td', 'num', gp(info.cost)),
      el('td', '', this.button('Buy', () => this.send({ type: 'shopBuy', ref }), this.game.coins < info.cost ? 'Not enough coin' : undefined)),
    );
  }

  private sellRow(ref: string): HTMLElement {
    return el(
      'tr',
      '',
      el('td', '', `${this.game.inventory[ref]}× ${itemInfo(ref, characterData)?.name ?? ref}`),
      el('td', 'muted small num', canSell(ref) ? `sells for ${gp(sellPrice(ref, characterData))}` : 'quest item'),
      el('td', '', canSell(ref) ? this.button('Sell one', () => this.send({ type: 'shopSell', ref })) : ''),
    );
  }

  private button(label: string, onClick: () => void, disabledReason?: string): HTMLButtonElement {
    const b = btn(label, onClick, '');
    if (disabledReason) {
      b.disabled = true;
      b.title = disabledReason;
    }
    return b;
  }
}

function el(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function btn(label: string, onClick: () => void, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}
