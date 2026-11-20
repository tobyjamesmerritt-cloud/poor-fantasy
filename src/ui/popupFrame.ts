/**
 * The one popup frame (epic DND-89). Every popup draws into it: larger, centered,
 * portrait left, title / text / numbered choices right. The 3D view, map and log
 * stay visible underneath. Opening something from a popup swaps the content in
 * this same frame (ViewStack) — popups are never stacked.
 *
 * Look: only CSS variables and the `data-frame` attribute (style.css, "Popup
 * frame") decide the border, so another frame (a chain border, say) is a new
 * `[data-frame="…"]` rule, not a change to any screen.
 *
 * Two kinds of view: `modal: false` = a place panel (stays out of the way — game
 * keys still work and walking away dismisses it); modal = a conversation (the
 * game behind it waits).
 */
import { ViewStack } from './viewStack';

export interface PopupChoice {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Not numbered, not a hotkey target (a "Back" link). */
  muted?: boolean;
}

export interface PopupView {
  picture?: string; // image url; the column is left out when absent
  title: string;
  subtitle?: string;
  notes?: string[]; // what just happened (dice, items)
  text?: string;
  hint?: string;
  choices: PopupChoice[];
  modal: boolean;
  /** Esc / the ✕ button. Absent = no close control. */
  onCancel?: () => void;
}

export class PopupFrame {
  private dlg: HTMLDialogElement;
  private stack = new ViewStack<PopupView>();

  constructor() {
    const d = document.getElementById('popup-frame');
    if (!(d instanceof HTMLDialogElement)) throw new Error('Missing #popup-frame in index.html');
    this.dlg = d;
    this.dlg.dataset.frame = 'plain';
    this.dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.stack.top?.onCancel?.();
    });
    window.addEventListener('resize', () => this.centre());
    // 1–9 pick a numbered choice; in a modal view ↑/↓ move the highlight.
    document.addEventListener('keydown', (e) => {
      const v = this.stack.top;
      if (!v || !this.dlg.open || e.defaultPrevented) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        const b = this.dlg.querySelector<HTMLButtonElement>(`button[data-n="${digit[1]}"]:not([disabled])`);
        if (b) {
          e.preventDefault();
          b.click();
        }
        return;
      }
      if (v.modal && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) {
        const buttons = [...this.dlg.querySelectorAll<HTMLButtonElement>('.pf-choices button:not([disabled])')];
        if (!buttons.length) return;
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.code === 'ArrowDown' ? 1 : -1;
        buttons[(i + step + buttons.length) % buttons.length].focus();
      }
    });
  }

  /** Is the frame showing a conversation-style (modal) view? */
  get busy(): boolean {
    return this.dlg.open && this.stack.top?.modal === true;
  }

  /** Show a place panel (null clears it). Does not disturb a view that is over it. */
  setBase(view: PopupView | null): void {
    this.stack.setBase(view);
    this.render();
  }

  /** Swap a view in over the base, in this same frame. */
  push(view: PopupView): void {
    this.stack.push(view);
    this.render();
  }

  /** Back to the base view (or close, if there is none). */
  pop(): void {
    this.stack.pop();
    this.render();
  }

  /**
   * Centre the frame on the stage (3D view + map), not the window, so it never
   * covers the party panel (and its touch buttons) or the log. Where there is no
   * stage on screen, the CSS default (centred in the window) applies.
   */
  private centre(): void {
    const r = document.getElementById('stage')?.getBoundingClientRect();
    const s = this.dlg.style;
    if (!r || r.width < 200 || r.height < 120) {
      s.removeProperty('inset');
      s.removeProperty('margin');
      s.removeProperty('left');
      s.removeProperty('top');
      s.removeProperty('transform');
      s.removeProperty('width');
      return;
    }
    s.inset = 'auto';
    s.margin = '0';
    s.left = `${Math.round(r.left + r.width / 2)}px`;
    s.top = `${Math.round(r.top + r.height / 2)}px`;
    s.transform = 'translate(-50%, -50%)';
    s.width = `${Math.min(736, Math.round(r.width) - 16)}px`;
  }

  private render(): void {
    const v = this.stack.top;
    if (!v) {
      if (this.dlg.open) this.dlg.close();
      return;
    }
    const children: (Node | string)[] = [];
    if (v.picture) {
      const img = document.createElement('img');
      img.className = 'pf-picture';
      img.src = v.picture;
      img.alt = v.title;
      children.push(img);
    }
    const list = el('div', 'pf-choices');
    let n = 0;
    for (const c of v.choices) {
      const b = document.createElement('button');
      if (c.muted) b.className = 'muted-btn';
      else b.dataset.n = String(++n);
      b.textContent = c.muted ? c.label : `${n}. ${c.label}`;
      b.disabled = c.disabled === true;
      b.addEventListener('click', c.onClick);
      list.append(b);
    }
    const main = el(
      'div',
      'pf-main',
      ...(v.notes?.length ? [el('div', 'pf-notes', ...v.notes.map((t) => el('p', '', t)))] : []),
      el('h2', '', v.title),
      ...(v.subtitle ? [el('p', 'pf-kind', v.subtitle)] : []),
      ...(v.text ? [el('p', 'pf-text', v.text)] : []),
      ...(v.hint ? [el('p', 'small muted', v.hint)] : []),
      list,
    );
    children.push(main);
    if (v.onCancel) {
      const x = document.createElement('button');
      x.className = 'pf-close';
      x.textContent = '✕';
      x.title = 'Close (Esc)';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', v.onCancel);
      children.push(x);
    }
    this.dlg.classList.toggle('has-picture', Boolean(v.picture));
    this.dlg.replaceChildren(...children.map((c) => (typeof c === 'string' ? document.createTextNode(c) : c)));
    // A dialog can't change between modal and not while open: reopen it.
    const wasModal = this.dlg.dataset.modal === '1';
    if (this.dlg.open && wasModal !== v.modal) this.dlg.close();
    if (!this.dlg.open) {
      if (v.modal) this.dlg.showModal();
      else this.dlg.show();
    }
    this.dlg.dataset.modal = v.modal ? '1' : '0';
    this.centre();
    if (v.modal) (list.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus();
  }
}

function el(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
