/**
 * Keyboard → Command mapping. The only place key codes appear; gameplay code
 * reacts to Commands so touch/on-screen buttons can reuse it unchanged.
 */
import type { Command } from '../../engine/commands';

const KEY_MAP: Record<string, Command> = {
  ArrowUp: { type: 'move', dir: 'n' },
  ArrowDown: { type: 'move', dir: 's' },
  ArrowLeft: { type: 'move', dir: 'w' },
  ArrowRight: { type: 'move', dir: 'e' },
  // numpad / QWEASDZXC style diagonals
  Numpad8: { type: 'move', dir: 'n' },
  Numpad2: { type: 'move', dir: 's' },
  Numpad4: { type: 'move', dir: 'w' },
  Numpad6: { type: 'move', dir: 'e' },
  Numpad7: { type: 'move', dir: 'nw' },
  Numpad9: { type: 'move', dir: 'ne' },
  Numpad1: { type: 'move', dir: 'sw' },
  Numpad3: { type: 'move', dir: 'se' },
  KeyW: { type: 'move', dir: 'n' },
  KeyS: { type: 'move', dir: 's' },
  KeyX: { type: 'move', dir: 's' }, // alternate, numpad-shaped layout
  KeyA: { type: 'move', dir: 'w' },
  KeyD: { type: 'move', dir: 'e' },
  KeyQ: { type: 'move', dir: 'nw' },
  KeyE: { type: 'move', dir: 'ne' },
  KeyZ: { type: 'move', dir: 'sw' },
  KeyC: { type: 'move', dir: 'se' },
  Space: { type: 'endTurn' },
  KeyF: { type: 'flee' },
  Backquote: { type: 'openDebug' },
  // combat actions — the underlined letter on the card buttons
  KeyH: { type: 'combatAction', action: 'dash' },
  KeyO: { type: 'combatAction', action: 'dodge' },
  KeyG: { type: 'combatAction', action: 'disengage' },
  Backspace: { type: 'undo' },
  KeyU: { type: 'undo' },
  Enter: { type: 'confirm' },
  Escape: { type: 'cancel' },
};

/**
 * Keys that only mean something on some screens (body[data-mode]) — the
 * underlined letter on that screen's buttons, Gold Box style (DND-82).
 */
const SCREEN_KEYS: Record<string, { modes: readonly string[]; command: Command }> = {
  KeyN: { modes: ['location', 'world'], command: { type: 'encamp' } }, // e[N]camp
  KeyL: { modes: ['location'], command: { type: 'leaveLocation' } }, // [L]eave
  KeyP: { modes: ['location', 'world', 'camp'], command: { type: 'openParty' } }, // [P]arty
  KeyK: { modes: ['location', 'world', 'camp'], command: { type: 'openPack' } }, // pac[K]
  KeyJ: { modes: ['location', 'world', 'camp'], command: { type: 'openJournal' } }, // [J]ournal
};

export function commandForKey(code: string): Command | undefined {
  // A dialog (conversation, pack, journal, menu…) has the player's attention: the game behind it ignores keys.
  if (typeof document !== 'undefined' && document.querySelector('dialog[open]')) return undefined;
  const screen = SCREEN_KEYS[code];
  if (screen) {
    const mode = typeof document !== 'undefined' ? document.body.dataset.mode ?? '' : '';
    return screen.modes.includes(mode) ? screen.command : undefined;
  }
  return KEY_MAP[code];
}
