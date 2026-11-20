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
import type { PopupChoice, PopupFrame, PopupView } from './popupFrame';

export interface PartyDialogDeps {
  bus: CommandBus;
  frame: PopupFrame;
  spriteCss: (key: string) => SpriteCss | null;
}

export class PartyDialog {
  private game!: GameState;
  private view: { kind: 'group' } | { kind: 'character'; id: string } | { kind: 'gear'; id: string; slot: 'weapon' | 'armor' | 'shield' } = { kind: 'group' };
  private mine: PopupView | null = null;
  private message = '';

  constructor(private deps: PartyDialogDeps) {}

  get open(): boolean {
    return this.deps.frame.isTop(this.mine);
  }

  showGroup(game: GameState): void {
    this.game = game;
    this.view = { kind: 'group' };
    this.render();
  }

  showCharacter(game: GameState, id: string): void {
    this.game = game;
    this.view = game.roster.some((r) => r.id === id) ? { kind: 'character', id } : { kind: 'group' };
    this.message = '';
    this.render();
  }

  /** Redraw after something changed (levelled up, equipped…), if open. */
  refresh(message = ''): void {
    if (!this.open) return;
    this.message = message;
    if (this.view.kind === 'gear') this.view = { kind: 'character', id: this.view.id };
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.mine = null;
    this.deps.frame.pop();
  }

  private send(cmd: Parameters<CommandBus['dispatch']>[0]): void {
    this.deps.bus.dispatch(cmd);
  }

  /** Everything draws into the one popup frame (popupFrame.ts); the gear chooser is a state of the sheet, not a second pop-up. */
  private render(): void {
    const v = this.view;
    const part = v.kind === 'character' ? this.character(v.id) : v.kind === 'gear' ? this.gear(v.id, v.slot) : this.group();
    this.mine = { ...part, modal: true, onCancel: () => this.close() };
    this.deps.frame.push(this.mine);
  }

  private sprite(key: string): SpriteCss | undefined {
    return this.deps.spriteCss(key) ?? undefined;
  }

  // --- Group view -------------------------------------------------------------

  private group(): Omit<PopupView, 'modal'> {
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
    const choices: PopupChoice[] = [
      { label: 'Pack…', onClick: () => this.send({ type: 'openPack' }) },
      ...(anyCaster ? [{ label: '✦ Spells…', onClick: () => this.send({ type: 'openSpells' }) }] : []),
      {
        label: 'Roster…',
        onClick: () => {
          this.close();
          this.send({ type: 'partyScreen' });
        },
      },
      { label: 'Close', onClick: () => this.close() },
    ];
    return {
      title: g.partyName || 'The party',
      sprite: g.roster[0] ? this.sprite(g.roster[0].sprite) : undefined,
      content: [
        el('div', 'sh-purse', `Purse: ${formatCoins(g.coins)}`),
        el(
          'table',
          'pd-table',
          el('tr', '', el('th', '', ''), el('th', '', 'Name'), el('th', 'num', 'Lvl'), el('th', 'num', 'HP'), el('th', 'num', 'AC'), el('th', 'num', 'XP'), el('th', '', '')),
          ...rows,
        ),
        el('p', 'small muted', 'Click a name for the character sheet.'),
      ],
      choices,
      row: true,
    };
  }

  private levelUp(s: CharacterSheet): void {
    this.close();
    this.send({ type: 'partyScreen', levelUp: s.id });
  }

  // --- Character view ---------------------------------------------------------

  private character(id: string): Omit<PopupView, 'modal'> {
    const g = this.game;
    const d = characterData;
    const i = g.roster.findIndex((r) => r.id === id);
    const s = g.roster[i];
    const p = g.party.find((x) => x.id === id);
    const dv = derive(s);
    const max = statsOf([s])[0].hp;
    const status = p?.dead ? 'Dead' : p && p.hp <= 0 ? 'Unconscious' : 'Okay';
    const gear = equipped(s, d);

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

    // Spells: a compact summary; the details live in the Spells… pop-up (same size sheet for every class)
    const caster = casterOf(s);
    let spellBox: HTMLElement;
    if (caster) {
      const left = p?.spells ? caster.maxSlots.map((m, k) => Math.max(0, m - (p.spells!.used[k] ?? 0))) : caster.maxSlots;
      spellBox = el(
        'table',
        'pd-stats',
        row('Casting', `${ABILITY_NAMES[caster.ability]} · DC ${caster.dc} · ${signed(caster.attack)}`),
        row('Slots', caster.maxSlots.map((m, k) => `L${k + 1} ${left[k]}/${m}`).join(' · ') || '—'),
        row('Prepared', `${caster.prepared.length} spells · ${caster.cantrips.length} cantrips`),
      );
    } else spellBox = el('p', 'small muted', `${className(s)}s don't cast spells (yet).`);

    const status$ = el(
      'div',
      'pd-status',
      `Level ${s.level} · ${xpText(s)} · `,
      el('span', p?.dead ? 'bad' : p && p.hp <= 0 ? 'warn' : 'ok', `Status: ${status}`),
    );
    const choices: PopupChoice[] = [
      { label: '◀', onClick: () => this.showCharacter(g, g.roster[(i - 1 + g.roster.length) % g.roster.length].id) },
      { label: '▶', onClick: () => this.showCharacter(g, g.roster[(i + 1) % g.roster.length].id) },
      { label: 'Party', onClick: () => this.showGroup(g) },
      { label: 'Gear & pack…', onClick: () => this.send({ type: 'openPack', characterId: s.id }) },
      ...(caster ? [{ label: '✦ Spells…', onClick: () => this.send({ type: 'openSpells', characterId: s.id }) }] : []),
      ...(canLevelUp(s) ? [{ label: 'Level up!', onClick: () => this.levelUp(s) }] : []),
      { label: 'Close', onClick: () => this.close() },
    ];
    return {
      title: s.name,
      subtitle: `${d.species[s.speciesId].name} ${className(s)} · ${d.backgrounds[s.backgroundId].name}`,
      sprite: this.sprite(s.sprite),
      content: [
        status$,
        el('div', 'pd-cols', el('div', '', el('h3', '', 'Abilities'), abilities), el('div', '', el('h3', '', 'Combat'), combat)),
        el(
          'div',
          'pd-cols',
          el('div', '', el('h3', '', 'Equipment'), items),
          el('div', '', el('h3', '', 'Spells'), spellBox),
        ),
        el('div', 'ps-message pd-msg', this.message || (dv.notes.length ? dv.notes.join(' · ') : '')),
      ],
      choices,
      row: true,
    };
  }

  /** One equipment slot: click the item to choose its replacement (in this same frame). */
  private gearRow(s: CharacterSheet, slot: 'weapon' | 'armor' | 'shield', label: string, current: string): HTMLElement {
    const item = btn(`${current} ▾`, () => this.openGear(s, slot), 'name-link pd-item');
    item.title = `Change the ${label.toLowerCase()}`;
    return el('tr', '', el('td', 'muted', label), el('td', '', item));
  }

  private openGear(s: CharacterSheet, slot: 'weapon' | 'armor' | 'shield'): void {
    this.view = { kind: 'gear', id: s.id, slot };
    this.render();
  }

  /** The gear chooser: what in the pack fits this slot (greyed out, with the reason, if the character can't use it). */
  private gear(id: string, slot: 'weapon' | 'armor' | 'shield'): Omit<PopupView, 'modal'> {
    const d = characterData;
    const g = this.game;
    const s = g.roster.find((r) => r.id === id)!;
    const gear = equipped(s, d);
    const label = slot === 'weapon' ? 'Weapon' : slot === 'armor' ? 'Armour' : 'Shield';
    const nameOf = (ref: string) => itemInfo(ref, d)?.name ?? ref;
    const current = slot === 'weapon' ? (gear.weapon ? nameOf(`weapon:${gear.weapon}`) : 'none') : slot === 'armor' ? (gear.armor ? nameOf(`armor:${gear.armor}`) : 'none') : gear.shield ? nameOf('shield') : 'none';
    const back = () => {
      this.view = { kind: 'character', id };
    };
    const choose = (cmd: Parameters<CommandBus['dispatch']>[0]) => {
      back();
      this.send(cmd);
      this.render(); // main also refreshes after equipping; this covers a rejected command
    };
    const choices: PopupChoice[] = [];
    const refs = Object.keys(g.inventory).filter((r) => g.inventory[r] > 0 && (slot === 'shield' ? r === 'shield' : r.startsWith(`${slot}:`)));
    for (const ref of refs) {
      const why = equipProblem(s, ref, d);
      choices.push({
        label: `${nameOf(ref)}${g.inventory[ref] > 1 ? ` (${g.inventory[ref]})` : ''}${why ? ` — ${why}` : ''}`,
        disabled: Boolean(why),
        onClick: () => choose({ type: 'equipItem', characterId: s.id, ref }),
      });
    }
    if (slot !== 'weapon' && current !== 'none') choices.push({ label: `Take off the ${current}`, onClick: () => choose({ type: 'unequipItem', characterId: s.id, slot }) });
    return {
      title: `${label} for ${s.name}`,
      sprite: this.sprite(s.sprite),
      text: `Now: ${current}. The old item goes back to the pack.`,
      hint: choices.length ? undefined : slot === 'weapon' ? 'No other weapons in the pack.' : `No ${label.toLowerCase()} in the pack.`,
      choices: [...choices, { label: 'Cancel', muted: true, onClick: () => { back(); this.render(); } }],
    };
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
