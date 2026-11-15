/**
 * Checklist of spells with a limit ("Choose 3 cantrips"). Shared by the
 * character editor, the level-up panel and the camp's prepare-spells dialog.
 * Text is set via textContent only.
 */
import type { Spells } from '../rules/spells';

export interface SpellPickerOptions {
  title: string;
  hint?: string;
  pool: readonly string[]; // spell ids to choose from
  chosen: readonly string[];
  max: number;
  locked?: boolean; // show the choice but don't allow changes
  onChange: (next: string[]) => void;
}

export function spellPicker(spells: Spells, o: SpellPickerOptions): HTMLElement {
  const box = document.createElement('fieldset');
  box.className = 'spell-picker';
  const legend = document.createElement('legend');
  legend.textContent = `${o.title} — ${o.chosen.filter((id) => o.pool.includes(id)).length}/${o.max}`;
  box.append(legend);
  if (o.hint) {
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = o.hint;
    box.append(p);
  }
  const full = o.chosen.length >= o.max;
  for (const id of o.pool) {
    const s = spells[id];
    if (!s) continue;
    const label = document.createElement('label');
    label.className = 'spell-option';
    label.title = s.summary;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = o.chosen.includes(id);
    cb.disabled = !!o.locked || (!cb.checked && full);
    cb.addEventListener('change', () => {
      o.onChange(cb.checked ? [...o.chosen, id] : o.chosen.filter((x) => x !== id));
    });
    const name = document.createElement('span');
    name.className = 'spell-option-name';
    name.textContent = `${s.name} `;
    const lvl = document.createElement('small');
    lvl.textContent = s.level ? `L${s.level}${s.concentration ? ' · C' : ''}` : 'cantrip';
    name.append(lvl);
    const sum = document.createElement('small');
    sum.className = 'spell-option-summary';
    sum.textContent = s.summary;
    label.append(cb, name, sum);
    box.append(label);
  }
  if (o.pool.length < o.max) {
    const p = document.createElement('p');
    p.className = 'small muted';
    p.textContent = `Only ${o.pool.length} of these are in the game so far — more spells are coming.`;
    box.append(p);
  }
  return box;
}
