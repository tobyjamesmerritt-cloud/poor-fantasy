/**
 * About and Controls (menu bar), drawn in the shared popup frame. Controls is
 * split into sections (chips) so it never scrolls. About holds the credits and
 * the debug tools (buttons + typed console, DND-20).
 */
import type { CommandBus } from '../engine/commands';
import type { PopupFrame, PopupView } from './popupFrame';

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'World map',
    items: ['Click a square to travel there, or step with WASD / arrows / numpad (Q E Z C diagonals).', 'Walk onto a town, cave or ruins to visit it.'],
  },
  {
    title: 'Towns & dungeons',
    items: [
      'W / ↑ forward, S / ↓ back, A / ← turn left, D / → turn right, Q / E step sideways.',
      'Or click a square on the map to walk there. The buttons on the right do the same on touch screens.',
      'Walk onto a door to visit a building; walk onto the exit to leave.',
      'Underlined letters are hotkeys: P party, K pack, J journal, N encamp, L leave. ` (backtick) opens the debug console.',
    ],
  },
  {
    title: 'Resting',
    items: [
      'Encamp (side panel) to rest outside: off the road, not on bridges, not at towns. Free, but camps can be ambushed at night.',
      'In town, rest at the inn: 5 sp per person per night, and nobody attacks you.',
      'Short rest: 1 hour, spend Hit Dice to heal. Long rest: 8 hours, full HP and Hit Dice, then 16 hours before the next.',
      'Hit points, Hit Dice and deaths carry over between fights. Unconscious characters come round with 1 HP after 1–4 hours.',
    ],
  },
  {
    title: 'Combat',
    items: [
      'The marching ants show where the active character can still move. Click inside to walk there.',
      'Click an enemy (sword cursor) to walk up and attack. Click a fallen ally (open hand) to try to stabilise them.',
      'Space ends the turn early. Backspace or U rewinds the last action. H = Dash, O = Dodge, G = Disengage.',
      'Flee: from a square on the map edge, step off the edge (or press F / the Flee button).',
      'Walk into a stable fallen ally to pick them up and carry them out (moving costs double). Preferences → Difficulty decides who must be carried.',
    ],
  },
];

export class HelpDialogs {
  private mine: PopupView | null = null;
  private section = 0;

  constructor(
    private frame: PopupFrame,
    private bus: CommandBus,
  ) {}

  get open(): boolean {
    return this.frame.isTop(this.mine);
  }

  close(): void {
    if (!this.open) return;
    this.mine = null;
    this.frame.pop();
  }

  private put(view: Omit<PopupView, 'modal' | 'onCancel' | 'row'>): void {
    this.mine = { ...view, row: true, modal: true, onCancel: () => this.close() };
    this.frame.push(this.mine);
  }

  controls(section = this.section): void {
    this.section = section;
    const tabs = el('div', 'pk-tabs');
    SECTIONS.forEach((s, i) => tabs.append(btn(s.title, () => this.controls(i), i === section ? 'pk-tab on' : 'pk-tab')));
    this.put({
      title: 'Controls',
      content: [tabs, el('ul', 'help-list', ...SECTIONS[section].items.map((t) => el('li', '', t)))],
      choices: [{ label: 'Close', onClick: () => this.close() }],
    });
  }

  about(focusDebug = false): void {
    const debugButtons = el(
      'div',
      'debug-buttons',
      ...(
        [
          ['+100 gp', 'gold'],
          ['+300 XP each', 'xp'],
          ['Reset fog of war', 'fog'],
        ] as const
      ).map(([label, text]) => btn(label, () => this.bus.dispatch({ type: 'debug', text }))),
    );
    const input = document.createElement('input');
    input.id = 'debug-input';
    input.type = 'text';
    input.placeholder = 'debug command — type help';
    input.setAttribute('aria-label', 'Debug command');
    input.spellcheck = false;
    const form = el('form', 'debug-console', input, btn('Run', () => undefined));
    form.setAttribute('autocomplete', 'off');
    (form.lastChild as HTMLButtonElement).type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      input.value = '';
      this.bus.dispatch({ type: 'debug', text: text || 'help' });
    });
    const note = el('p', 'hint', '');
    note.id = 'about-debug-note';
    note.setAttribute('aria-live', 'polite');
    this.put({
      title: 'Poor Fantasy',
      text: 'A personal homage to the late-1980s Gold Box games, on the current D&D rules. Version 0.2.',
      content: [
        el('h3', '', 'Credits'),
        el(
          'ul',
          'help-list small',
          el('li', '', 'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, licensed under the Creative Commons Attribution 4.0 International License.'),
          el('li', '', 'Art: Kenney (www.kenney.nl) — Tiny Dungeon, Tiny Battle, Cursor Pack — CC0.'),
          el('li', '', 'Engine: Phaser (MIT licence).'),
        ),
        el('h3', '', 'Debug (for testing)'),
        debugButtons,
        form,
        note,
      ],
      choices: [{ label: 'Close', onClick: () => this.close() }],
    });
    if (focusDebug) input.focus();
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
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
