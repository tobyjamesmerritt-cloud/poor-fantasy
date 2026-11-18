/**
 * Player preferences (per browser). Stored in localStorage; failures (private
 * mode, storage disabled) fall back to defaults silently.
 */
export type TextSize = 'small' | 'normal' | 'large';
export type Difficulty = 'hard' | 'normal' | 'casual'; // retreat rules, see rules/combat.ts RetreatRule
export type PanelSide = 'left' | 'right';

export interface Prefs {
  grid: boolean; // faint grid lines on the combat map
  autoEndTurn: boolean; // hand over the turn automatically when nothing is left to do
  textSize: TextSize;
  difficulty: Difficulty; // applies from the next fight
  panelSide: PanelSide; // side panel (party, combat card) left or right of the game, on every screen
}

const KEY = 'poor-fantasy.prefs';
const DEFAULTS: Prefs = { grid: true, autoEndTurn: true, textSize: 'normal', difficulty: 'normal', panelSide: 'right' };
const TEXT_PX: Record<TextSize, string> = { small: '15px', normal: '17px', large: '20px' };

type Listener = (p: Prefs) => void;

export class PrefsStore {
  private value: Prefs;
  private listeners = new Set<Listener>();

  constructor() {
    let stored: Partial<Prefs> = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    } catch {
      /* use defaults */
    }
    this.value = { ...DEFAULTS, ...stored };
    this.apply();
  }

  get(): Readonly<Prefs> {
    return this.value;
  }

  set<K extends keyof Prefs>(key: K, v: Prefs[K]): void {
    this.value = { ...this.value, [key]: v };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* not persisted this session */
    }
    this.apply();
    this.listeners.forEach((l) => l(this.value));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private apply(): void {
    document.documentElement.style.fontSize = TEXT_PX[this.value.textSize];
    document.body.dataset.panel = this.value.panelSide;
  }
}
