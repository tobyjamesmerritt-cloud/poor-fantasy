/**
 * Quest journal (HTML dialog): every quest the party has started, its current
 * stage text, recommended level and difficulty. Read-only.
 */
import type { GameState } from '../engine/state';
import { type QuestData, questStage } from '../rules/quests';

export class JournalDialog {
  private dlg: HTMLDialogElement;

  constructor(private data: QuestData) {
    const d = document.getElementById('journal-dialog');
    if (!(d instanceof HTMLDialogElement)) throw new Error('Missing #journal-dialog in index.html');
    this.dlg = d;
  }

  show(game: GameState): void {
    const started = Object.entries(this.data.quests).filter(([id]) => questStage(game, id) !== 'none');
    const active = started.filter(([id]) => questStage(game, id) !== 'done');
    const done = started.filter(([id]) => questStage(game, id) === 'done');
    const entry = ([id, q]: (typeof started)[number]) => {
      const stage = questStage(game, id);
      const li = document.createElement('li');
      li.className = `journal-quest ${stage === 'done' ? 'done' : ''}`;
      const head = document.createElement('div');
      head.className = 'journal-head';
      head.textContent = `${q.name}`;
      const meta = document.createElement('small');
      meta.textContent = ` · ${q.difficulty} · level ${q.level}`;
      head.append(meta);
      const text = document.createElement('p');
      text.textContent = q.stages[stage] ?? '';
      li.append(head, text);
      return li;
    };
    const section = (title: string, items: typeof started, empty: string) => {
      const h = document.createElement('h3');
      h.textContent = title;
      if (!items.length) {
        const p = document.createElement('p');
        p.className = 'small muted';
        p.textContent = empty;
        return [h, p];
      }
      const ul = document.createElement('ul');
      ul.className = 'journal-list';
      ul.append(...items.map(entry));
      return [h, ul];
    };
    const title = document.createElement('h2');
    title.textContent = 'Quest journal';
    const close = document.createElement('button');
    close.textContent = 'Close';
    close.className = 'close';
    close.addEventListener('click', () => this.dlg.close());
    const buttons = document.createElement('div');
    buttons.className = 'ps-buttons';
    buttons.append(close);
    this.dlg.replaceChildren(
      title,
      ...section('Current', active, 'No quests yet. Talk to people in Millbrook — the reeve has troubles.'),
      ...section('Finished', done, 'None yet.'),
      buttons,
    );
    this.dlg.showModal();
  }
}
