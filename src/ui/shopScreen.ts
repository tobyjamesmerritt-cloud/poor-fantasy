/**
 * Shop (HTML): buy SRD weapons, armor, shields and Potions of Healing into the
 * party pack, sell from the pack at half price, and equip / unequip each
 * character. Changes go out as Commands; main.ts applies the rules.
 */
import type { Command, CommandBus } from '../engine/commands';
import type { GameState } from '../engine/state';
import { characterData, derive } from '../content/characters';
import { equipped, signed, trainedWithArmor, trainedWithWeapon, weaponDef } from '../rules/character';
import { canSell, equipProblem, itemInfo, sellPrice } from '../rules/items';
import { formatCoins } from '../rules/party';

const gp = (cp: number) => formatCoins(cp);

export class ShopScreen {
  private root = document.getElementById('shop-screen')!;
  private game!: GameState;
  private name = '';
  private message = '';

  constructor(private bus: CommandBus) {}

  show(game: GameState, shopName: string): void {
    this.game = game;
    this.name = shopName;
    this.message = '';
    this.render();
  }

  refresh(message = ''): void {
    this.message = message;
    this.render();
  }

  private send(cmd: Command): void {
    this.bus.dispatch(cmd);
  }

  private render(): void {
    const d = characterData;
    const stock: { title: string; refs: string[] }[] = [
      { title: 'Weapons', refs: Object.keys(d.weapons).map((id) => `weapon:${id}`) },
      { title: 'Armor', refs: Object.keys(d.armor).map((id) => `armor:${id}`) },
      { title: 'Shields and potions', refs: ['shield', ...Object.keys(d.consumables).filter((id) => d.consumables[id].shop !== false).map((id) => `consumable:${id}`)] },
    ];
    const forSale = div(
      'sh-col',
      h('h2', '', this.name),
      h('p', 'muted small', 'Prices from the SRD. You sell things back for half. Bought items go into the party pack; equip them from the party list.'),
      ...stock.map((g) =>
        div(
          'sh-group',
          h('h3', '', g.title),
          h('table', 'sh-table', ...g.refs.map((ref) => this.stockRow(ref))),
        ),
      ),
    );
    const party = div(
      'sh-col',
      h('h2', '', 'The party'),
      div('sh-purse', `Purse: ${gp(this.game.coins)}`),
      this.message ? h('div', 'sh-msg', this.message) : null,
      ...this.game.roster.map((s) => this.memberCard(s.id)),
      h('h3', '', 'Pack'),
      this.packTable(),
      div('ps-buttons', button('Leave the shop', () => this.send({ type: 'closeShop' }), undefined, 'primary')),
    );
    this.root.replaceChildren(forSale, party);
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
    return h(
      'tr',
      '',
      h('td', '', info.name, owned ? h('span', 'muted small', ` (${owned} in pack)`) : null),
      h('td', 'muted small', detail),
      h('td', 'num', gp(info.cost)),
      h('td', '', button('Buy', () => this.send({ type: 'shopBuy', ref }), this.game.coins < info.cost ? 'Not enough coin' : undefined)),
    );
  }

  private memberCard(id: string): HTMLElement {
    const sheet = this.game.roster.find((s) => s.id === id)!;
    const cls = characterData.classes[sheet.classId];
    const g = equipped(sheet, characterData);
    const dv = derive(sheet);
    const state = this.game.party.find((p) => p.id === id);
    // what in the pack this character could put on
    const options = Object.keys(this.game.inventory)
      .filter((ref) => ref === 'shield' || ref.startsWith('weapon:') || ref.startsWith('armor:'))
      .map((ref) => ({ ref, why: equipProblem(sheet, ref, characterData) }));
    const select = h('select', '') as HTMLSelectElement;
    select.append(new Option('Equip from pack…', ''));
    for (const o of options) {
      const info = itemInfo(o.ref, characterData)!;
      const kind = o.ref.split(':')[0];
      const untrained = kind === 'weapon' && !trainedWithWeapon(cls, weaponDef(characterData, o.ref.split(':')[1])!);
      const opt = new Option(`${info.name}${o.why ? ` — ${o.why}` : untrained ? ' — not trained (no proficiency bonus)' : ''}`, o.ref);
      opt.disabled = !!o.why;
      select.append(opt);
    }
    select.disabled = !options.length;
    select.addEventListener('change', () => {
      if (select.value) this.send({ type: 'equipItem', characterId: id, ref: select.value });
    });
    const armorName = g.armor ? characterData.armor[g.armor].name : 'no armor';
    return div(
      'sh-member',
      h('div', 'name party', `${sheet.name}${state?.dead ? ' (dead)' : ''}`),
      h('div', 'small', `${cls.name} · AC ${dv.ac} · ${dv.attackName} ${signed(dv.attackBonus)} (${dv.damage.join(' + ')})`),
      h(
        'div',
        'small muted',
        `Wearing ${armorName}${g.shield ? ' and a shield' : ''}${g.shield && !trainedWithArmor(cls, 'shield') ? ' (untrained: no AC)' : ''}.`,
      ),
      ...dv.notes.map((n) => h('div', 'warn small', n)),
      div(
        'sh-member-buttons',
        select,
        button('Remove armor', () => this.send({ type: 'unequipItem', characterId: id, slot: 'armor' }), g.armor ? undefined : 'No armor'),
        button('Remove shield', () => this.send({ type: 'unequipItem', characterId: id, slot: 'shield' }), g.shield ? undefined : 'No shield'),
      ),
    );
  }

  private packTable(): HTMLElement {
    const refs = Object.keys(this.game.inventory);
    if (!refs.length) return h('p', 'muted small', 'Empty.');
    return h(
      'table',
      'sh-table',
      ...refs.map((ref) =>
        h(
          'tr',
          '',
          h('td', '', `${this.game.inventory[ref]}× ${itemInfo(ref, characterData)?.name ?? ref}`),
          h('td', 'num', canSell(ref) ? `sells for ${gp(sellPrice(ref, characterData))}` : 'quest item'),
          h('td', '', canSell(ref) ? button('Sell one', () => this.send({ type: 'shopSell', ref })) : null),
        ),
      ),
    );
  }
}

function h(tag: string, cls: string, ...children: (Node | string | null)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c !== null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
const div = (cls: string, ...children: (Node | string | null)[]) => h('div', cls, ...children);

function button(label: string, onClick: () => void, disabledReason?: string, cls = ''): HTMLButtonElement {
  const b = h('button', cls, label) as HTMLButtonElement;
  if (disabledReason) {
    b.disabled = true;
    b.title = disabledReason;
  } else b.addEventListener('click', onClick);
  return b;
}
