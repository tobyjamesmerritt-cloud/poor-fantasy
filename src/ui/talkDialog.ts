/**
 * Conversations (HTML dialog): who speaks, what they say, what just happened
 * (dice rolls, items), and the choices. A choice with a skill check first asks
 * which character tries, showing each one's bonus. Sends Commands only.
 */
import type { CommandBus } from '../engine/commands';
import { pictureUrl } from './localPictures';

export interface TalkView {
  speaker?: string;
  picture?: string; // local-only image id (localPictures.ts)
  text: string;
  results: string[]; // what the last choice did
  choices: { index: number; text: string; check?: { label: string; rollers: { id: string; name: string; bonus: number; note: string }[] } }[];
}

export class TalkDialog {
  private dlg: HTMLDialogElement;
  private picking: number | null = null; // choice index waiting for "who tries?"
  private view: TalkView | null = null;

  constructor(private bus: CommandBus) {
    const d = document.getElementById('talk-dialog');
    if (!(d instanceof HTMLDialogElement)) throw new Error('Missing #talk-dialog in index.html');
    this.dlg = d;
    // Esc ends the conversation the normal way
    this.dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.bus.dispatch({ type: 'talkClose' });
    });
    // Keys: 1–9 pick a choice, ↑/↓ move the highlight, Enter picks the highlighted one
    this.dlg.addEventListener('keydown', (e) => {
      const buttons = [...this.dlg.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
      if (!buttons.length) return;
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (digit) {
        const b = buttons[Number(digit[1]) - 1];
        if (b) {
          e.preventDefault();
          b.click();
        }
        return;
      }
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.code === 'ArrowDown' ? 1 : -1;
        buttons[(i + step + buttons.length) % buttons.length].focus();
      }
    });
  }

  get open(): boolean {
    return this.dlg.open;
  }

  show(view: TalkView): void {
    this.view = view;
    this.picking = null;
    this.render();
    if (!this.dlg.open) this.dlg.showModal();
  }

  close(): void {
    this.view = null;
    if (this.dlg.open) this.dlg.close();
  }

  private render(): void {
    const v = this.view!;
    const parts: HTMLElement[] = [];
    if (v.results.length) parts.push(el('div', 'talk-results', ...v.results.map((r) => el('p', '', r))));
    const url = pictureUrl(v.picture);
    if (url) {
      const img = document.createElement('img');
      img.className = 'talk-picture';
      img.src = url;
      img.alt = v.speaker ?? '';
      parts.push(img);
    }
    if (v.speaker) parts.push(el('h2', '', v.speaker));
    parts.push(el('p', 'talk-text', v.text));
    const list = el('div', 'talk-choices');
    if (this.picking !== null) {
      const c = v.choices.find((x) => x.index === this.picking)!;
      list.append(el('p', 'small muted', `${c.check!.label} — who tries?`));
      for (const r of c.check!.rollers) {
        list.append(
          btn(`${r.name} (${r.bonus >= 0 ? '+' : '−'}${Math.abs(r.bonus)}${r.note ? `, ${r.note}` : ''})`, () =>
            this.bus.dispatch({ type: 'talkChoice', index: c.index, characterId: r.id }),
          ),
        );
      }
      list.append(
        btn('← Back', () => {
          this.picking = null;
          this.render();
        }, 'muted-btn'),
      );
    } else if (v.choices.length) {
      v.choices.forEach((c, i) => {
        list.append(
          btn(`${i + 1}. ${c.text}${c.check ? ` [${c.check.label}]` : ''}`, () => {
            if (c.check) {
              this.picking = c.index;
              this.render();
            } else this.bus.dispatch({ type: 'talkChoice', index: c.index });
          }),
        );
      });
    } else list.append(btn('Farewell.', () => this.bus.dispatch({ type: 'talkClose' })));
    parts.push(list);
    this.dlg.replaceChildren(...parts);
    (list.querySelector('button') as HTMLButtonElement | null)?.focus();
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
