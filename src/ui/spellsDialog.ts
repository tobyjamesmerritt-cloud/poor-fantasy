/**
 * Spells between fights (HTML dialog): slots left, prepared spells (changed
 * at camp after a Long Rest — SRD 5.2), and healing / warding spells cast
 * outside combat. Sends Commands; main.ts applies them through rules/spells.ts.
 */
import type { CommandBus } from '../engine/commands';
import type { GameState } from '../engine/state';
import { characterData, choicesOf, className, spells, statsOf } from '../content/characters';
import { outsideOptions, outsideTargets, preparedCount, preparePool, slotsLeft } from '../rules/spells';
import { spellPicker } from './spellPicker';
import type { PopupFrame, PopupView } from './popupFrame';
import type { SpriteCss } from './hud';

export class SpellsDialog {
  private mine: PopupView | null = null;
  private game!: GameState;
  private canPrepare = false;
  private only?: string; // show just this caster (from a character sheet)
  private current?: string; // the caster shown (one per frame view: no scrolling)
  private sub: 'cast' | 'prepare' = 'cast';
  private message = '';
  private drafts = new Map<string, string[]>(); // prepared lists being edited
  private picks = new Map<string, { slot: number; targets: string[] }>(); // per caster+spell
  private aiming: string | null = null; // caster+spell whose Cast panel is open

  constructor(
    private bus: CommandBus,
    private frame: PopupFrame,
    private spriteCss: (key: string) => SpriteCss | null,
  ) {}

  show(game: GameState, canPrepare: boolean, characterId?: string): void {
    this.game = game;
    this.canPrepare = canPrepare;
    this.only = characterId;
    this.current = characterId;
    this.sub = 'cast';
    this.message = '';
    this.aiming = null;
    this.drafts.clear();
    this.picks.clear();
    this.render();
  }

  get open(): boolean {
    return this.frame.isTop(this.mine);
  }

  close(): void {
    if (!this.open) return;
    this.mine = null;
    this.frame.pop();
  }

  refresh(message = '', saved?: string): void {
    if (!this.open) return;
    this.message = message;
    this.aiming = null;
    if (saved) this.drafts.delete(saved);
    this.render();
  }

  /** One caster per view; several casters get a chip row to switch (an in-frame section, never a scrollbar). */
  private render(): void {
    const g = this.game;
    const stats = statsOf(g.roster);
    const casters = g.roster.filter((s) => characterData.classes[s.classId]?.spellcasting && (!this.only || s.id === this.only));
    const sheet = casters.find((c) => c.id === this.current) ?? casters[0];
    this.current = sheet?.id;
    const content: HTMLElement[] = [];
    const choices: PopupView['choices'] = [];
    if (casters.length > 1) {
      const tabs = el('div', 'pk-tabs');
      for (const c of casters) {
        tabs.append(btn(c.name, () => {
          this.current = c.id;
          this.sub = 'cast';
          this.aiming = null;
          this.message = '';
          this.render();
        }, c.id === sheet.id ? 'pk-tab on' : 'pk-tab'));
      }
      content.push(tabs);
    }
    if (!sheet) content.push(el('p', 'muted', 'Nobody in the party casts spells. (Clerics and Wizards do.)'));
    if (sheet) {
      const p = g.party.find((x) => x.id === sheet.id);
      const s = stats.find((x) => x.id === sheet.id)!;
      const c = s.caster!;
      const sc = characterData.classes[sheet.classId].spellcasting!;
      const left = slotsLeft(c.maxSlots, p?.spells);
      const status = p?.dead ? ' — dead' : p && p.hp <= 0 ? ' — unconscious' : '';
      content.push(
        el('div', 'sd-label', `${sheet.name} (${className(sheet)})${status}`),
        el(
          'div',
          'sd-slots',
          'Spell slots: ',
          ...c.maxSlots.map((max, i) => el('span', left[i] ? 'sd-slot' : 'sd-slot empty', `Level ${i + 1}: ${left[i]} of ${max}`)),
        ),
      );
      const choicesOfSheet = choicesOf(sheet)!;
      const canEdit = this.canPrepare && !!p && !p.dead;
      if (canEdit && this.sub === 'prepare') {
        const draft = this.drafts.get(sheet.id) ?? choicesOfSheet.prepared;
        content.push(
          spellPicker(spells, {
            title: 'Prepared spells',
            pool: preparePool(sheet, sc, spells, choicesOfSheet),
            chosen: draft,
            max: preparedCount(sc, sheet.level),
            onChange: (v) => {
              this.drafts.set(sheet.id, v);
              this.render();
            },
          }),
        );
        if (this.drafts.has(sheet.id)) {
          choices.push({ label: 'Keep these prepared', onClick: () => this.bus.dispatch({ type: 'prepareSpells', characterId: sheet.id, prepared: draft }) });
        }
        choices.push({ label: 'Back to casting', onClick: () => { this.sub = 'cast'; this.render(); } });
      } else {
        const chips = el('div', 'sd-chips');
        for (const id of choicesOfSheet.prepared) {
          const chip = el('span', 'sd-chip', spells[id]?.name ?? id);
          chip.title = spells[id]?.summary ?? '';
          chips.append(chip);
        }
        if (!choicesOfSheet.prepared.length) chips.append(el('span', 'muted small', 'none'));
        content.push(el('div', 'sd-label', 'Prepared'), chips);
        if (p) {
          const options = outsideOptions(spells, s, p, g.inventory);
          const own = options.filter((o) => !o.scroll);
          const scrolls = options.filter((o) => o.scroll);
          if (own.length) content.push(el('div', 'sd-label', 'Cast between fights'), this.castList(own, sheet.id, p, stats));
          if (scrolls.length) content.push(el('div', 'sd-label', 'Scrolls'), this.castList(scrolls, sheet.id, p, stats));
          if (!options.length) content.push(el('p', 'small muted', 'No spells to cast between fights.'));
        }
        if (canEdit) choices.push({ label: 'Change prepared spells', onClick: () => { this.sub = 'prepare'; this.render(); } });
      }
    }
    content.push(el('div', 'ps-message pd-msg', this.message));
    choices.push({ label: 'Close', onClick: () => this.close() });
    this.mine = {
      sprite: sheet ? (this.spriteCss(sheet.sprite) ?? undefined) : undefined,
      title: 'Spells',
      hint: this.canPrepare ? 'After a Long Rest you may change your prepared spells.' : 'Prepared spells change at camp after a Long Rest.',
      content,
      choices,
      row: true,
      modal: true,
      onCancel: () => this.close(),
    };
    this.frame.push(this.mine);
  }

  private castList(options: OutsideOption[], casterId: string, p: PartyMember, stats: Stats[]): HTMLElement {
    const g = this.game;
    const list = el('div', 'sd-list');
    for (const o of options) {
      const key = `${casterId}:${o.id}`;
      const e = o.spell.effect;
      const max = e.kind === 'heal' ? e.targets : 1;
      const allowed = outsideTargets(o.spell, casterId, g.party, stats, g.time);
      const pick = this.picks.get(key) ?? { slot: o.levels[0] ?? o.spell.level, targets: [] };
      pick.targets = pick.targets.filter((id) => allowed.includes(id));
      if (!pick.targets.length && allowed.length && (e.kind === 'temp-hp' || max === 1)) {
        // self-only spells target the caster; one-target spells start on the most hurt
        const frac = (id: string) => Math.max(0, g.party.find((x) => x.id === id)!.hp) / stats.find((x) => x.id === id)!.hp;
        pick.targets = e.kind === 'temp-hp' ? allowed.slice(0, max) : [[...allowed].sort((a, b) => frac(a) - frac(b))[0]];
      }
      if (!o.levels.includes(pick.slot)) pick.slot = o.levels[0] ?? o.spell.level;
      this.picks.set(key, pick);

      const cost = o.scroll
        ? `scroll ×${g.inventory[o.id] ?? 0}`
        : o.spell.level === 0
          ? 'cantrip'
          : `level ${o.spell.level} slot`;
      const why = !o.levels.length
        ? 'no slots left'
        : p.dead || p.hp <= 0
          ? 'caster is down'
          : e.kind !== 'temp-hp' && !allowed.length
            ? e.kind === 'heal'
              ? 'nobody needs it'
              : 'nobody can use it now'
            : '';
      const open = this.aiming === key;
      const name = el('span', 'sd-name', o.spell.name);
      name.title = o.spell.summary;
      const go = btn(open ? 'Cancel' : 'Cast…', () => {
        this.aiming = open ? null : key;
        this.message = '';
        this.render();
      }, open ? '' : 'primary');
      go.disabled = !!why;
      const row = el('div', open ? 'sd-row open' : 'sd-row', name, el('span', 'sd-cost', why || cost), go);
      list.append(row);
      if (open) list.append(this.castPanel(o, pick, max, allowed, casterId, stats));
    }
    return list;
  }

  /** The open Cast panel: what it does, which slot, who. */
  private castPanel(
    o: OutsideOption,
    pick: { slot: number; targets: string[] },
    max: number,
    allowed: string[],
    casterId: string,
    stats: Stats[],
  ): HTMLElement {
    const g = this.game;
    const e = o.spell.effect;
    const panel = el('div', 'sd-panel', el('p', 'small', o.spell.summary));
    if (o.levels.length > 1) {
      const levels = el('div', 'sd-levels', el('span', 'small muted', 'Slot: '));
      for (const lv of o.levels) {
        const b = btn(`Level ${lv}`, () => {
          pick.slot = lv;
          this.render();
        }, lv === pick.slot ? 'on' : '');
        levels.append(b);
      }
      panel.append(levels);
    }
    if (e.kind !== 'temp-hp') {
      const hurt = (id: string) => {
        const now = g.party.find((x) => x.id === id)!;
        const maxHp = stats.find((x) => x.id === id)!.hp;
        return Math.max(0, now.hp) / maxHp;
      };
      const order = e.kind === 'heal' ? [...allowed].sort((a, b) => hurt(a) - hurt(b)) : allowed; // most hurt first
      panel.append(el('div', 'small muted', max > 1 ? `Choose up to ${max} (${pick.targets.length} chosen):` : 'Choose who:'));
      const targets = el('div', 'sd-targets');
      for (const id of order) {
        const who = g.roster.find((r) => r.id === id)!;
        const now = g.party.find((x) => x.id === id)!;
        const maxHp = stats.find((x) => x.id === id)!.hp;
        const on = pick.targets.includes(id);
        const b = btn('', () => {
          if (max === 1) pick.targets = [id];
          else if (on) pick.targets = pick.targets.filter((x) => x !== id);
          else if (pick.targets.length < max) pick.targets = [...pick.targets, id];
          this.render();
        }, on ? 'sd-tgt on' : 'sd-tgt');
        b.append(
          el('span', 'sd-tgt-name', `${on ? '✓ ' : ''}${who.name}`),
          el('span', 'sd-tgt-hp', `${Math.max(0, now.hp)}/${maxHp}`),
        );
        b.disabled = !on && max > 1 && pick.targets.length >= max;
        targets.append(b);
      }
      panel.append(targets);
    }
    const ready = pick.targets.length > 0;
    const cast = btn(
      o.spell.time === '10 minutes' ? 'Cast (10 minutes)' : 'Cast',
      () => this.bus.dispatch({ type: 'castOutside', casterId, spellId: o.id, slot: pick.slot, targetIds: pick.targets }),
      'primary',
    );
    cast.disabled = !ready;
    panel.append(el('div', 'ps-buttons', cast));
    return panel;
  }
}

type OutsideOption = ReturnType<typeof outsideOptions>[number];
type Stats = ReturnType<typeof statsOf>[number];
type PartyMember = GameState['party'][number];

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
