/**
 * Save / load dialog: autosave (load only), three manual slots, export to a
 * file and import from one. The actual saving and loading is done by main.ts
 * through the callbacks.
 */
import { SLOTS, type SlotId, type SlotSummary } from './saveStore';

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
  private dlg = document.getElementById('save-dialog') as HTMLDialogElement;
  private slotsEl = document.getElementById('save-slots')!;
  private note = document.getElementById('save-note')!;

  constructor(private deps: SaveDialogDeps) {
    this.dlg.querySelector('.close')!.addEventListener('click', () => this.dlg.close());
    document.getElementById('save-export')!.addEventListener('click', () => this.exportFile());
    const file = document.getElementById('save-file') as HTMLInputElement;
    document.getElementById('save-import')!.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      const err = this.deps.importJson(await f.text());
      if (err) this.say(err, true);
      else this.dlg.close();
    });
  }

  open(): void {
    this.say(this.deps.canSave() ?? 'Save into a slot, or load any saved game.');
    this.render();
    this.dlg.showModal();
  }

  private say(text: string, error = false): void {
    this.note.textContent = text;
    this.note.style.color = error ? '#ff8a7d' : '';
  }

  private render(): void {
    const sums = this.deps.summaries();
    const blocked = this.deps.canSave();
    this.slotsEl.replaceChildren(
      ...SLOTS.map((slot, i) => {
        const s = sums[i];
        const row = document.createElement('div');
        row.className = 'slot';
        const name = document.createElement('strong');
        name.textContent = slot === 'auto' ? 'Autosave' : `Slot ${slot}`;
        const info = document.createElement('div');
        const label = document.createElement('div');
        label.textContent = s ? s.label : 'Empty';
        const when = document.createElement('div');
        when.className = 'when';
        when.textContent = s?.error ?? (s?.savedAt ? new Date(s.savedAt).toLocaleString() : '');
        info.append(label, when);
        const buttons = document.createElement('div');
        buttons.className = 'buttons';
        if (slot !== 'auto') {
          buttons.append(
            this.button('Save here', blocked ?? undefined, async () => {
              if (s && !(await this.deps.confirm({ title: 'Overwrite?', text: `Replace “${s.label}” with the current game?`, ok: 'Overwrite', cancel: 'Cancel' }))) return;
              const err = this.deps.save(slot);
              this.say(err ?? `Saved to slot ${slot}.`, !!err);
              this.render();
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
            else this.dlg.close();
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
        row.append(name, info, buttons);
        return row;
      }),
    );
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
