/**
 * The party pack (HTML dialog), anywhere outside a fight: everything carried,
 * drinking potions and ale, reading scrolls (via the spells dialog), and
 * equipping or removing gear on any character. Sends Commands only.
 */
import type { CommandBus } from '../engine/commands';
import type { GameState } from '../engine/state';
import { characterData, derive, statsOf } from '../content/characters';
import { equipped, signed, weaponDef } from '../rules/character';
import { canSell, equipProblem, itemInfo } from '../rules/items';
import { formatCoins } from '../rules/party';

export class PackDialog {
  private dlg: HTMLDialogElement;
  private game!: GameState;
  private message = '';

  constructor(private bus: CommandBus) {
    const d = document.getElementById('pack-dialog');
    if (!(d instanceof HTMLDialogElement)) throw new Error('Missing #pack-dialog in index.html');
    this.dlg = d;
  }

  get open(): boolean {
    return this.dlg.open;
  }

  show(game: GameState): void {
    this.game = game;
    this.message = '';
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  refresh(message = ''): void {
    if (!this.dlg.open) return;
    this.message = message;
    this.render();
  }

  private render(): void {
    const g = this.game;
    const d = characterData;
    const stats = statsOf(g.roster);
    const parts: HTMLElement[] = [el('h2', '', 'Pack'), el('div', 'sh-purse', `Purse: ${formatCoins(g.coins)}`)];
    if (this.message) parts.push(el('div', 'ps-message', this.message));

    // --- Items carried ---
    const refs = Object.keys(g.inventory).filter((r) => g.inventory[r] > 0);
    parts.push(el('h3', '', 'Carried'));
    if (!refs.length) parts.push(el('p', 'small muted', 'Nothing. Shops sell weapons, armour and potions.'));
    const table = el('table', 'sh-table pk-table');
    for (const ref of refs) {
      const info = itemInfo(ref, d);
      const [kind, id] = ref.split(':');
      const row = el('tr', '');
      const name = el('td', '', `${g.inventory[ref]}× ${info?.name ?? ref}`);
      const actions = el('td', 'pk-actions');
      let detail = '';
      if (kind === 'consumable' && d.consumables[id]?.heal) {
        detail = `heals ${d.consumables[id].heal}`;
        // who can drink it: alive and hurt (unconscious included)
        const who = g.roster.filter((r) => {
          const p = g.party.find((x) => x.id === r.id);
          const s = stats.find((x) => x.id === r.id);
          return p && s && !p.dead && p.hp < s.hp;
        });
        if (who.length) {
          const sel = select(
            who.map((r) => {
              const p = g.party.find((x) => x.id === r.id)!;
              const max = stats.find((x) => x.id === r.id)!.hp;
              return { value: r.id, label: `${r.name} ${Math.max(0, p.hp)}/${max}${p.hp <= 0 ? ' (unconscious)' : ''}` };
            }),
          );
          actions.append(sel, btn('Drink', () => this.bus.dispatch({ type: 'useItem', ref, targetId: sel.value })));
        } else actions.append(el('small', 'muted', 'Nobody is hurt'));
      } else if (kind === 'consumable' && d.consumables[id]?.drink) {
        detail = 'a drink';
        actions.append(btn('Drink', () => this.bus.dispatch({ type: 'useItem', ref })));
      } else if (kind === 'scroll') {
        const s = d.spells[id];
        const classes = s.classes.map((c) => d.classes[c]?.name ?? c).join(', ');
        detail = `level ${s.level} spell · ${classes}`;
        actions.append(
          btn('Read…', () => {
            this.dlg.close(); // scrolls are read from the spells dialog
            this.bus.dispatch({ type: 'openSpells' });
          }),
        );
      } else if (kind === 'misc') {
        detail = d.misc[id]?.description ?? 'quest item';
      } else if (info && (kind === 'weapon' || kind === 'armor' || ref === 'shield')) {
        if (kind === 'weapon') {
          const w = weaponDef(d, id)!;
          detail = `${w.damage}${w.bonus ? ` · +${w.bonus} to hit and damage` : ''} · ${w.category}`;
        } else if (kind === 'armor') {
          const a = d.armor[id];
          detail = `AC ${a.base}${a.dexMax === null ? ' + Dex' : a.dexMax ? ` + Dex (max ${a.dexMax})` : ''} · ${a.category}`;
        } else detail = '+2 AC';
        const sel = document.createElement('select');
        sel.append(new Option('Equip on…', ''));
        for (const r of g.roster) {
          const why = equipProblem(r, ref, d);
          const opt = new Option(`${r.name}${why ? ` — ${why}` : ''}`, r.id);
          opt.disabled = !!why;
          sel.append(opt);
        }
        sel.addEventListener('change', () => {
          if (sel.value) this.bus.dispatch({ type: 'equipItem', characterId: sel.value, ref });
        });
        actions.append(sel);
      }
      if (!canSell(ref)) detail = `${detail} · quest item`.replace(/^ · /, '');
      row.append(name, el('td', 'muted small', detail), actions);
      table.append(row);
    }
    if (refs.length) parts.push(table);

    // --- What everyone has on ---
    parts.push(el('h3', '', 'Equipment'));
    for (const r of g.roster) {
      const gear = equipped(r, d);
      const dv = derive(r);
      const p = g.party.find((x) => x.id === r.id);
      const line = el(
        'div',
        'pk-member',
        el('div', 'name party', `${r.name}${p?.dead ? ' (dead)' : ''}`),
        el(
          'div',
          'small',
          `${dv.attackName} ${signed(dv.attackBonus)} (${dv.damage.join(' + ')}) · ${gear.armor ? d.armor[gear.armor].name : 'no armour'}${gear.shield ? ' + shield' : ''} · AC ${dv.ac}`,
        ),
      );
      const buttons = el('div', 'sh-member-buttons');
      if (gear.armor) buttons.append(btn('Remove armour', () => this.bus.dispatch({ type: 'unequipItem', characterId: r.id, slot: 'armor' })));
      if (gear.shield) buttons.append(btn('Remove shield', () => this.bus.dispatch({ type: 'unequipItem', characterId: r.id, slot: 'shield' })));
      if (buttons.childElementCount) line.append(buttons);
      parts.push(line);
    }
    parts.push(el('p', 'small muted', 'Weapons are swapped, not removed: equip another weapon and the old one goes into the pack.'));
    parts.push(el('div', 'ps-buttons', btn('Close', () => this.dlg.close(), 'close')));
    this.dlg.replaceChildren(...parts);
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

function select(options: { value: string; label: string }[]): HTMLSelectElement {
  const s = document.createElement('select');
  for (const o of options) s.append(new Option(o.label, o.value));
  return s;
}
