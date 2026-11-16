/**
 * The party (HTML dialog), anywhere outside a fight. Two views:
 * - group: everyone in marching order (HP, AC, XP), Level up! beside whoever can,
 *   and the things the whole party shares (pack, spells, roster management);
 * - character: one member's sheet, the way the classic games showed it —
 *   portrait, ability scores, combat numbers, gear and spells.
 * Opened from "Party" above any party list, or from a character's name. Sends Commands only.
 */
import type { CommandBus } from '../engine/commands';
import type { CharacterSheet, GameState } from '../engine/state';
import { ABILITIES, ABILITY_NAMES, abilityMod, equipped, signed } from '../rules/character';
import { casterOf, characterData, className, derive, statsOf } from '../content/characters';
import { canLevelUp, xpForNext } from '../rules/levelling';
import { equipProblem, itemInfo } from '../rules/items';
import { formatCoins } from '../rules/party';
import type { SpriteCss } from './hud';

export interface PartyDialogDeps {
  bus: CommandBus;
  spriteCss: (key: string) => SpriteCss | null;
}

export class PartyDialog {
  private dlg: HTMLDialogElement;
  private game!: GameState;
  private view: { kind: 'group' } | { kind: 'character'; id: string } = { kind: 'group' };
  private picking: 'weapon' | 'armor' | 'shield' | null = null; // equipment slot whose choices are open
  private message = '';

  constructor(private deps: PartyDialogDeps) {
    const d = document.getElementById('party-dialog');
    if (!(d instanceof HTMLDialogElement)) throw new Error('Missing #party-dialog in index.html');
    this.dlg = d;
  }

  get open(): boolean {
    return this.dlg.open;
  }

  showGroup(game: GameState): void {
    this.game = game;
    this.view = { kind: 'group' };
    this.render();
  }

  showCharacter(game: GameState, id: string): void {
    this.game = game;
    this.view = game.roster.some((r) => r.id === id) ? { kind: 'character', id } : { kind: 'group' };
    this.picking = null;
    this.message = '';
    this.render();
  }

  /** Redraw after something changed (levelled up, equipped…), if open. */
  refresh(message = ''): void {
    if (!this.dlg.open) return;
    this.picking = null;
    this.message = message;
    this.render();
  }

  close(): void {
    if (this.dlg.open) this.dlg.close();
  }

  private send(cmd: Parameters<CommandBus['dispatch']>[0]): void {
    this.deps.bus.dispatch(cmd);
  }

  private render(): void {
    const v = this.view;
    this.dlg.replaceChildren(...(v.kind === 'character' ? this.character(v.id) : this.group()));
    if (!this.dlg.open) this.dlg.showModal();
    this.dlg.scrollTop = 0;
  }

  // --- Group view -------------------------------------------------------------

  private group(): HTMLElement[] {
    const g = this.game;
    const stats = statsOf(g.roster);
    const rows = g.roster.map((s, i) => {
      const p = g.party.find((x) => x.id === s.id);
      const max = stats[i].hp;
      const hp = p?.dead ? 'dead' : `${Math.max(0, p?.hp ?? max)}/${max}${p && p.hp <= 0 ? ' (unconscious)' : ''}`;
      const name = link(s.name, () => this.showCharacter(g, s.id));
      return el(
        'tr',
        p?.dead ? 'muted' : '',
        el('td', '', this.portrait(s.sprite, 32)),
        el('td', 'pd-who', name, ` (${className(s)})`),
        el('td', 'num', String(s.level)),
        el('td', 'num', hp),
        el('td', 'num', String(derive(s).ac)),
        el('td', 'num small muted', xpText(s)),
        el('td', '', canLevelUp(s) ? btn('Level up!', () => this.levelUp(s), 'primary') : ''),
      );
    });
    const anyCaster = g.roster.some((s) => characterData.classes[s.classId]?.spellcasting);
    return [
      el('h2', '', g.partyName || 'The party'),
      el('div', 'sh-purse', `Purse: ${formatCoins(g.coins)}`),
      el(
        'table',
        'pd-table',
        el('tr', '', el('th', '', ''), el('th', '', 'Name'), el('th', 'num', 'Lvl'), el('th', 'num', 'HP'), el('th', 'num', 'AC'), el('th', 'num', 'XP'), el('th', '', '')),
        ...rows,
      ),
      el('p', 'small muted', 'Click a name for the character sheet.'),
      el(
        'div',
        'ps-buttons',
        btn('Pack…', () => this.send({ type: 'openPack' })),
        anyCaster ? btn('✦ Spells…', () => this.send({ type: 'openSpells' })) : null,
        btn('Roster…', () => {
          this.close();
          this.send({ type: 'partyScreen' });
        }),
        btn('Close', () => this.close(), 'close'),
      ),
    ];
  }

  private levelUp(s: CharacterSheet): void {
    this.close();
    this.send({ type: 'partyScreen', levelUp: s.id });
  }

  // --- Character view ---------------------------------------------------------

  private character(id: string): HTMLElement[] {
    const g = this.game;
    const d = characterData;
    const i = g.roster.findIndex((r) => r.id === id);
    const s = g.roster[i];
    const p = g.party.find((x) => x.id === id);
    const dv = derive(s);
    const max = statsOf([s])[0].hp;
    const status = p?.dead ? 'Dead' : p && p.hp <= 0 ? 'Unconscious' : 'Okay';
    const gear = equipped(s, d);

    const nav = el(
      'div',
      'pd-nav',
      btn('◀', () => this.showCharacter(g, g.roster[(i - 1 + g.roster.length) % g.roster.length].id)),
      el('span', 'small muted', `${i + 1} of ${g.roster.length}`),
      btn('▶', () => this.showCharacter(g, g.roster[(i + 1) % g.roster.length].id)),
    );

    const head = el(
      'div',
      'pd-head',
      this.portrait(s.sprite, 96),
      el(
        'div',
        '',
        el('div', 'pd-name name party', s.name),
        el('div', '', `${d.species[s.speciesId].name} ${className(s)} · ${d.backgrounds[s.backgroundId].name}`),
        el('div', '', `Level ${s.level} · ${xpText(s)}`),
        el('div', p?.dead ? 'bad' : p && p.hp <= 0 ? 'warn' : 'ok', `Status: ${status}`),
      ),
    );

    const abilities = el(
      'table',
      'pd-stats',
      el('tr', '', el('th', '', ''), el('th', 'num', 'Score'), el('th', 'num', 'Mod'), el('th', 'num', 'Save')),
      ...ABILITIES.map((a) =>
        el(
          'tr',
          '',
          el('td', '', ABILITY_NAMES[a]),
          el('td', 'num', String(dv.scores[a])),
          el('td', 'num', signed(abilityMod(dv.scores[a]))),
          el('td', 'num', signed(dv.saves[a])),
        ),
      ),
    );

    const combat = el(
      'table',
      'pd-stats',
      row('Hit Points', p?.dead ? `dead (max ${max})` : `${Math.max(0, p?.hp ?? max)} / ${max}${p?.tempHp ? ` (+${p.tempHp} temp)` : ''}`),
      row('Armor Class', String(dv.ac)),
      row('Speed', `${dv.speed * 5} ft`),
      row('Initiative', signed(dv.initBonus)),
      row('Attack', `${dv.attackName} ${signed(dv.attackBonus)}`),
      row('Damage', dv.damage.join(' + ')),
      row('Hit Dice', `${p?.hitDice ?? s.level} of ${s.level} (d${dv.hitDie})`),
    );

    const name = (ref: string) => itemInfo(ref, d)?.name ?? ref;
    const items = el(
      'table',
      'pd-stats',
      this.gearRow(s, 'weapon', 'Weapon', gear.weapon ? name(`weapon:${gear.weapon}`) : 'none'),
      this.gearRow(s, 'armor', 'Armour', gear.armor ? name(`armor:${gear.armor}`) : 'none'),
      this.gearRow(s, 'shield', 'Shield', gear.shield ? name('shield') : 'none'),
    );

    const parts: HTMLElement[] = [
      nav,
      head,
      el('div', 'pd-cols', el('div', '', el('h3', '', 'Abilities'), abilities), el('div', '', el('h3', '', 'Combat'), combat)),
      el('h3', '', 'Equipment'),
      ...(this.message ? [el('div', 'ps-message', this.message)] : []),
      items,
      el('p', 'small muted', 'Click an item to swap it for something in the pack.'),
    ];

    const caster = casterOf(s);
    if (caster) {
      const left = p?.spells ? caster.maxSlots.map((m, k) => Math.max(0, m - (p.spells!.used[k] ?? 0))) : caster.maxSlots;
      const slots = caster.maxSlots.map((m, k) => `L${k + 1}: ${left[k]}/${m}`).join(' · ');
      const names = (ids: readonly string[]) => ids.map((x) => d.spells[x]?.name ?? x).join(', ') || 'none';
      parts.push(
        el('h3', '', 'Spells'),
        el(
          'table',
          'pd-stats',
          row('Casting', `${ABILITY_NAMES[caster.ability]} · attack ${signed(caster.attack)} · save DC ${caster.dc}`),
          row('Slots left', slots),
          row('Cantrips', names(caster.cantrips)),
          row('Prepared', names(caster.prepared)),
        ),
      );
    }
    if (dv.notes.length) parts.push(el('p', 'small warn', dv.notes.join(' · ')));

    parts.push(
      el(
        'div',
        'ps-buttons',
        btn('◀ Party', () => this.showGroup(g)),
        btn('Gear & pack…', () => this.send({ type: 'openPack', characterId: s.id })),
        caster ? btn('✦ Spells…', () => this.send({ type: 'openSpells', characterId: s.id })) : null,
        canLevelUp(s) ? btn('Level up!', () => this.levelUp(s), 'primary') : null,
        btn('Close', () => this.close(), 'close'),
      ),
    );
    return parts;
  }

  /** One equipment slot: click the item to see what in the pack could replace it (or take it off). */
  private gearRow(s: CharacterSheet, slot: 'weapon' | 'armor' | 'shield', label: string, current: string): HTMLElement {
    const d = characterData;
    const g = this.game;
    const item = btn(`${current} ▾`, () => {
      this.picking = this.picking === slot ? null : slot;
      this.message = '';
      this.render();
    }, 'name-link pd-item');
    const cell = el('td', '', item);
    if (this.picking === slot) {
      const list = el('div', 'pd-choices');
      const refs = Object.keys(g.inventory).filter(
        (r) => g.inventory[r] > 0 && (slot === 'shield' ? r === 'shield' : r.startsWith(`${slot}:`)),
      );
      for (const ref of refs) {
        const why = equipProblem(s, ref, d);
        const b = btn(`${itemInfo(ref, d)?.name ?? ref}${g.inventory[ref] > 1 ? ` (${g.inventory[ref]})` : ''}`, () =>
          this.send({ type: 'equipItem', characterId: s.id, ref }),
        );
        if (why) {
          b.disabled = true;
          b.title = why;
        }
        list.append(b);
      }
      if (slot !== 'weapon' && current !== 'none') {
        list.append(btn('Take off', () => this.send({ type: 'unequipItem', characterId: s.id, slot })));
      }
      if (!list.childElementCount) list.append(el('span', 'small muted', slot === 'weapon' ? 'No other weapons in the pack.' : `No ${label.toLowerCase()} in the pack.`));
      cell.append(list);
    }
    return el('tr', '', el('td', 'muted', label), cell);
  }

  private portrait(key: string, px: number): HTMLElement {
    const p = el('div', 'portrait');
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

function xpText(s: CharacterSheet): string {
  const need = xpForNext(s);
  return `XP ${s.xp ?? 0}${need ? ` / ${need}` : ' (max level)'}`;
}

function row(label: string, value: string): HTMLElement {
  return el('tr', '', el('td', 'muted', label), el('td', '', value));
}

function link(text: string, onClick: () => void): HTMLElement {
  const b = btn(text, onClick, 'name-link name party');
  return b;
}

function el(tag: string, cls: string, ...children: (Node | string | null)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) if (c !== null) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}
