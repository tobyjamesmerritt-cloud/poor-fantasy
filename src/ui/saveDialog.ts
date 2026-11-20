/**
 * Save / load dialog: autosave (load only), three manual slots, export to a
 * file and import from one. The actual saving and loading is done by main.ts
 * through the callbacks.
 */
import { SLOTS, type SlotId, type SlotSummary } from './saveStore';
import type { PopupFrame, PopupView } from './popupFrame';

export interface SaveDialogDeps {
  summaries: () => (SlotSummary | null)[]; // in SLOTS order
  canSave: () => string | null; // null = may save; otherwise why not
  save: (slot: SlotId) => string | null; // error message or null
  load: (slot: SlotId) => string | null;
  remove: (slot: SlotId) => void;
  exportCurrent: () => { name: string; json: string } | string; // file, or why not
  importJson: (json: string) => string | null;
  confirm: (opts: { title: string; text: string; ok: string; cancel: string; danger?: boolean }) => Promise<boolean>;
}

export class SaveDialog {
  private mine: PopupView | null = null;
  private message = '';
  private error = false;

  constructor(
    private deps: SaveDialogDeps,
    private frame: PopupFrame,
  ) {}

  get showing(): boolean {
    return this.frame.isTop(this.mine);
  }

  open(): void {
    this.say(this.deps.canSave() ?? 'Save into a slot, or load any saved game.');
    this.render();
  }

  private close(): void {
    if (!this.showing) return;
    this.mine = null;
    this.frame.pop();
  }

  private say(text: string, error = false): void {
    this.message = text;
    this.error = error;
    if (this.showing) this.render();
  }

  private importFile(): void {
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const err = this.deps.importJson(await f.text());
      if (err) this.say(err, true);
      else this.close();
    });
    file.click();
  }

  private render(): void {
    const sums = this.deps.summaries();
    const blocked = this.deps.canSave();
    const rows = SLOTS.map((slot, i) => {
      const s = sums[i];
      const row = el('div', 'slot');
      const when = el('div', 'when', s?.error ?? (s?.savedAt ? new Date(s.savedAt).toLocaleString() : ''));
      const buttons = el('div', 'buttons');
      if (slot !== 'auto') {
        buttons.append(
          this.button('Save here', blocked ?? undefined, async () => {
            if (s && !(await this.deps.confirm({ title: 'Overwrite?', text: `Replace “${s.label}” with the current game?`, ok: 'Overwrite', cancel: 'Cancel' }))) return;
            const err = this.deps.save(slot);
            this.say(err ?? `Saved to slot ${slot}.`, !!err);
          }),
        );
      }
      buttons.append(
        this.button('Load', s && !s.error ? undefined : 'Nothing to load', async () => {
          const ok = await this.deps.confirm({
            title: 'Load this game?',
            text: 'Anything since your last save of the current game will be lost.',
            ok: 'Load',
            cancel: 'Cancel',
          });
          if (!ok) return;
          const err = this.deps.load(slot);
          if (err) this.say(err, true);
          else this.close();
        }),
      );
      if (slot !== 'auto') {
        buttons.append(
          this.button('Delete', s ? undefined : 'Empty', async () => {
            if (!(await this.deps.confirm({ title: 'Delete save?', text: `Delete “${s!.label}”?`, ok: 'Delete', cancel: 'Keep', danger: true }))) return;
            this.deps.remove(slot);
            this.render();
          }),
        );
      }
      row.append(el('strong', '', slot === 'auto' ? 'Autosave' : `Slot ${slot}`), el('div', '', el('div', '', s ? s.label : 'Empty'), when), buttons);
      return row;
    });
    const note = el('div', this.error ? 'pd-msg bad' : 'pd-msg', this.message);
    this.mine = {
      title: 'Saved games',
      hint: 'Saves live in this browser. Export a file to keep a backup or to play on another PC.',
      content: [...rows, note],
      row: true,
      modal: true,
      choices: [
        { label: 'Export to file…', onClick: () => this.exportFile() },
        { label: 'Import from file…', onClick: () => this.importFile() },
        { label: 'Close', onClick: () => this.close() },
      ],
      onCancel: () => this.close(),
    };
    this.frame.push(this.mine);
  }

  private exportFile(): void {
    const out = this.deps.exportCurrent();
    if (typeof out === 'string') return this.say(out, true);
    const url = URL.createObjectURL(new Blob([out.json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = out.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.say(`Exported ${out.name}.`);
  }

  private button(label: string, disabledReason: string | undefined, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    if (disabledReason) {
      b.disabled = true;
      b.title = disabledReason;
    } else b.addEventListener('click', onClick);
    return b;
  }
}

function el(tag: string, cls: string, ...children: (Node | string)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}
