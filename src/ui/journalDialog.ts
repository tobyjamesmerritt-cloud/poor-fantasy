/**
 * Quest journal (HTML dialog). The list: quests in progress, then finished ones —
 * name and a one-line summary each. Click a name for the details: where things
 * stand, the steps so far (ticked) and what to do next. Everything comes from
 * quests.json (summary, stages, tips). Read-only.
 */
import type { GameState } from '../engine/state';
import { type QuestData, questStage, questSteps } from '../rules/quests';

export class JournalDialog {
  private dlg: HTMLDialogElement;
  private game!: GameState;

  constructor(private data: QuestData) {
    const d = document.getElementById('journal-dialog');
    if (!(d instanceof HTMLDialogElement)) throw new Error('Missing #journal-dialog in index.html');
    this.dlg = d;
  }

  show(game: GameState): void {
    this.game = game;
    this.list();
    if (!this.dlg.open) this.dlg.showModal();
  }

  private list(): void {
    const g = this.game;
    const started = Object.entries(this.data.quests).filter(([id]) => questStage(g, id) !== 'none');
    const active = started.filter(([id]) => questStage(g, id) !== 'done');
    const done = started.filter(([id]) => questStage(g, id) === 'done');
    const row = ([id, q]: (typeof started)[number]) =>
      el('li', questStage(g, id) === 'done' ? 'jr-row done' : 'jr-row', btn(q.name, () => this.details(id), 'name-link jr-name'), el('span', 'jr-summary', q.summary));
    const section = (title: string, items: typeof started, empty: string) => [
      el('h3', '', title),
      items.length ? el('ul', 'jr-list', ...items.map(row)) : el('p', 'small muted', empty),
    ];
    this.dlg.replaceChildren(
      el('h2', '', 'Quest journal'),
      ...section('In progress', active, 'No quests yet. Talk to people in Millbrook — the reeve has troubles.'),
      ...(done.length ? section('Done', done, '') : []),
      el('div', 'ps-buttons', btn('Close', () => this.dlg.close(), 'close')),
    );
  }

  private details(id: string): void {
    const g = this.game;
    const q = this.data.quests[id];
    const finished = questStage(g, id) === 'done';
    const { steps, now } = questSteps(g, q, id);
    this.dlg.replaceChildren(
      el('h2', '', q.name),
      el('div', 'small muted', `${finished ? 'Done' : 'In progress'} · level ${q.level} · ${q.difficulty}`),
      el('p', '', now),
      steps.length
        ? el('ul', 'jr-steps', ...steps.map((s) => el('li', s.done ? 'done' : 'now', s.done ? `✓ ${s.text}` : `▸ Next: ${s.text}`)))
        : el('span', ''),
      el('div', 'ps-buttons', btn('◀ All quests', () => this.list()), btn('Close', () => this.dlg.close(), 'close')),
    );
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
