/**
 * HTML overlay UI (message log, status, buttons). Menus and text live in the
 * DOM rather than Phaser: easier layout, accessibility and mobile scaling.
 */
import type { Command, CommandBus } from '../engine/commands';

export class Hud {
  private logEl = must('log');
  private statusEl = must('status');

  constructor(bus: CommandBus) {
    document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => bus.dispatch(JSON.parse(btn.dataset.command!) as Command));
    });
  }

  setLog(lines: readonly string[]): void {
    this.logEl.replaceChildren(
      ...lines.slice(-40).map((l) => {
        const p = document.createElement('p');
        p.textContent = l;
        return p;
      }),
    );
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }
}

function must(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}
