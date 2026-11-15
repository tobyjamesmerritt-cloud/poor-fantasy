/**
 * Spells between fights (HTML dialog): slots left, prepared spells (changed
 * at camp after a Long Rest — SRD 5.2), and healing / warding spells cast
 * outside combat. Sends Commands; main.ts applies them through rules/spells.ts.
 */
import type { CommandBus } from '../engine/commands';
import type { GameState } from '../engine/state';
import { characterData, choicesOf, spells, statsOf } from '../content/characters';
import { outsideOptions, outsideTargets, preparedCount, preparePool, slotsLeft } from '../rules/spells';
import { spellPicker } from './spellPicker';

export class SpellsDialog {
  private dlg: HTMLDialogElement;
  private game!: GameState;
  private canPrepare = false;
  private message = '';
  private drafts = new Map<string, string[]>(); // prepared lists being edited
  private picks = new Map<string, { slot: number; targets: string[] }>(); // per caster+spell

  constructor(private bus: CommandBus) {
    const d = document.getElementById('spells-dialog');
    if (!(d instanceof HTMLDialogElement)) throw new Error('Missing #spells-dialog in index.html');
    this.dlg = d;
  }

  show(game: GameState, canPrepare: boolean): void {
    this.game = game;
    this.canPrepare = canPrepare;
    this.message = '';
    this.drafts.clear();
    this.picks.clear();
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  get open(): boolean {
    return this.dlg.open;
  }

  refresh(message = '', saved?: string): void {
    if (!this.dlg.open) return;
    this.message = message;
    if (saved) this.drafts.delete(saved);
    this.render();
  }

  private render(): void {
    const g = this.game;
    const stats = statsOf(g.roster);
    const casters = g.roster.filter((s) => characterData.classes[s.classId]?.spellcasting);
    const body: HTMLElement[] = [
      el('h2', '', 'Spells'),
      el(
        'p',
        'small muted',
        this.canPrepare
          ? 'After a Long Rest you may change your prepared spells. Healing and warding spells can be cast here too.'
          : 'Healing and warding spells can be cast between fights. Prepared spells change at camp after a Long Rest.',
      ),
    ];
    if (this.message) body.push(el('div', 'ps-message', this.message));
    if (!casters.length) body.push(el('p', 'muted', 'Nobody in the party casts spells. (Clerics and Wizards do.)'));

    for (const sheet of casters) {
      const p = g.party.find((x) => x.id === sheet.id);
      const s = stats.find((x) => x.id === sheet.id)!;
      const c = s.caster!;
      const sc = characterData.classes[sheet.classId].spellcasting!;
      const left = slotsLeft(c.maxSlots, p?.spells);
      const pips = c.maxSlots.map((max, i) => `L${i + 1} ${'●'.repeat(left[i])}${'○'.repeat(max - left[i])}`).join('  ');
      const section = el('section', 'sd-caster');
      const status = p?.dead ? ' — dead' : p && p.hp <= 0 ? ' — unconscious' : '';
      section.append(el('h3', '', `${sheet.name}${status}`, el('span', 'slot-pips', pips)));

      // Prepared spells
      const choices = choicesOf(sheet)!;
      if (this.canPrepare && p && !p.dead) {
        const draft = this.drafts.get(sheet.id) ?? choices.prepared;
        section.append(
          spellPicker(spells, {
            title: 'Prepared spells',
            pool: preparePool(sheet, sc, spells, choices),
            chosen: draft,
            max: preparedCount(sc, sheet.level),
            onChange: (v) => {
              this.drafts.set(sheet.id, v);
              this.render();
            },
          }),
        );
        if (this.drafts.has(sheet.id)) {
          section.append(
            btn('Keep these prepared', () => this.bus.dispatch({ type: 'prepareSpells', characterId: sheet.id, prepared: draft }), 'primary'),
          );
        }
      } else {
        section.append(el('p', 'small', `Prepared: ${choices.prepared.map((id) => spells[id]?.name ?? id).join(', ') || 'none'}`));
      }

      // Casting between fights
      if (p) {
        const options = outsideOptions(spells, s, p, g.inventory);
        if (options.length) section.append(el('h4', '', 'Cast now'));
        for (const o of options) {
          const key = `${sheet.id}:${o.id}`;
          const e = o.spell.effect;
          const max = e.kind === 'heal' ? e.targets : 1;
          const allowed = outsideTargets(o.spell, sheet.id, g.party, stats, g.time);
          const pick = this.picks.get(key) ?? { slot: o.levels[0] ?? o.spell.level, targets: allowed.slice(0, max) };
          pick.targets = pick.targets.filter((id) => allowed.includes(id)); // healed up since: drop them
          if (!pick.targets.length && max === 1 && allowed.length) pick.targets = [allowed[0]];
          if (!o.levels.includes(pick.slot)) pick.slot = o.levels[0] ?? o.spell.level;
          this.picks.set(key, pick);
          const row = el('div', 'sd-cast');
          row.title = o.spell.summary;
          row.append(el('div', 'sd-cast-name', o.scroll ? `📜 ${o.spell.name} (scroll ×${g.inventory[o.id] ?? 0})` : o.spell.name, el('small', '', o.spell.summary)));
          if (!o.levels.length) {
            row.append(el('small', 'muted', 'No spell slots left'));
            section.append(row);
            continue;
          }
          const controls = el('div', 'sd-cast-controls');
          if (o.levels.length > 1) {
            const sel = document.createElement('select');
            for (const lv of o.levels) {
              const opt = document.createElement('option');
              opt.value = String(lv);
              opt.textContent = `level ${lv} slot`;
              opt.selected = lv === pick.slot;
              sel.append(opt);
            }
            sel.addEventListener('change', () => {
              pick.slot = Number(sel.value);
            });
            controls.append(sel);
          }
          if (e.kind !== 'temp-hp') {
            if (!allowed.length) controls.append(el('small', 'muted', e.kind === 'heal' ? 'Nobody needs it' : 'Nobody can use it now'));
            for (const id of allowed) {
              const who = g.roster.find((r) => r.id === id)!;
              const now = g.party.find((x) => x.id === id)!;
              const maxHp = stats.find((x) => x.id === id)!.hp;
              const label = document.createElement('label');
              label.className = 'sd-target';
              const cb = document.createElement('input');
              cb.type = max === 1 ? 'radio' : 'checkbox';
              cb.name = key;
              cb.checked = pick.targets.includes(id);
              cb.disabled = max > 1 && !cb.checked && pick.targets.length >= max;
              cb.addEventListener('change', () => {
                if (max === 1) pick.targets = [id];
                else pick.targets = cb.checked ? [...pick.targets, id] : pick.targets.filter((x) => x !== id);
                this.render();
              });
              label.append(cb, document.createTextNode(` ${who.name}${e.kind === 'heal' ? ` ${Math.max(0, now.hp)}/${maxHp}` : ''}`));
              controls.append(label);
            }
          }
          const cast = btn(
            o.spell.time === '10 minutes' ? 'Cast (10 min)' : 'Cast',
            () => this.bus.dispatch({ type: 'castOutside', casterId: sheet.id, spellId: o.id, slot: pick.slot, targetIds: pick.targets }),
            '',
          );
          cast.disabled = !pick.targets.length || (p.hp <= 0 || p.dead);
          controls.append(cast);
          row.append(controls);
          section.append(row);
        }
      }
      body.push(section);
    }
    const close = btn('Close', () => this.dlg.close(), 'close');
    body.push(el('div', 'ps-buttons', close));
    this.dlg.replaceChildren(...body);
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
