/**
 * Quest journal, drawn in the shared popup frame. The list: quests in progress,
 * then finished ones — name and a one-line summary each (paged, never scrolled).
 * Click a name for the details: where things stand, the steps so far (ticked)
 * and what to do next. Everything comes from quests.json. Read-only.
 */
import type { GameState } from '../engine/state';
import { type QuestData, questStage, questSteps } from '../rules/quests';
import type { PopupFrame, PopupView } from './popupFrame';

/** Quests per page: the frame is a fixed size. */
const ROWS = 5;

export class JournalDialog {
  private mine: PopupView | null = null;
  private game!: GameState;
  private page = 0;

  constructor(
    private data: QuestData,
    private frame: PopupFrame,
  ) {}

  get open(): boolean {
    return this.frame.isTop(this.mine);
  }

  show(game: GameState): void {
    this.game = game;
    this.page = 0;
    this.list();
  }

  private close(): void {
    if (!this.open) return;
    this.mine = null;
    this.frame.pop();
  }

  private put(view: Omit<PopupView, 'modal' | 'onCancel'>): void {
    this.mine = { ...view, modal: true, onCancel: () => this.close() };
    this.frame.push(this.mine);
  }

  private list(): void {
    const g = this.game;
    const started = Object.entries(this.data.quests).filter(([id]) => questStage(g, id) !== 'none');
    const rank = (id: string) => (questStage(g, id) === 'done' ? 1 : 0); // in progress first
    const all = [...started].sort((a, b) => rank(a[0]) - rank(b[0]));
    const pages = Math.max(1, Math.ceil(all.length / ROWS));
    this.page = Math.min(this.page, pages - 1);
    const rows = all.slice(this.page * ROWS, (this.page + 1) * ROWS).map(([id, q]) => {
      const done = questStage(g, id) === 'done';
      return el('li', done ? 'jr-row done' : 'jr-row', btn(q.name, () => this.details(id), 'name-link jr-name'), el('span', 'jr-tag muted small', done ? ' · done' : ''), el('span', 'jr-summary', q.summary));
    });
    this.put({
      title: 'Quest journal',
      hint: all.length ? 'Click a quest for its steps.' : undefined,
      content: [all.length ? el('ul', 'jr-list', ...rows) : el('p', 'muted', 'No quests yet. Talk to people in Millbrook — the reeve has troubles.')],
      row: true,
      choices: [
        ...(pages > 1
          ? [
              { label: '◀', disabled: this.page === 0, onClick: () => { this.page--; this.list(); } },
              { label: `Page ${this.page + 1} / ${pages}`, muted: true, disabled: true, onClick: () => undefined },
              { label: '▶', disabled: this.page >= pages - 1, onClick: () => { this.page++; this.list(); } },
            ]
          : []),
        { label: 'Close', onClick: () => this.close() },
      ],
    });
  }

  private details(id: string): void {
    const g = this.game;
    const q = this.data.quests[id];
    const finished = questStage(g, id) === 'done';
    const { steps, now } = questSteps(g, q, id);
    this.put({
      title: q.name,
      subtitle: `${finished ? 'Done' : 'In progress'} · level ${q.level} · ${q.difficulty}`,
      text: now,
      content: steps.length ? [el('ul', 'jr-steps', ...steps.map((s) => el('li', s.done ? 'done' : 'now', s.done ? `✓ ${s.text}` : `▸ Next: ${s.text}`)))] : [],
      row: true,
      choices: [
        { label: '◀ All quests', onClick: () => this.list() },
        { label: 'Close', onClick: () => this.close() },
      ],
    });
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
