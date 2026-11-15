/**
 * Browser storage for saves and the character library (localStorage).
 * Storage can be full or disabled (private browsing): every call fails softly
 * and reports why, so the game keeps running.
 */
import { type CharacterLibrary, parseLibrary, parseSave, type SaveEnvelope } from '../engine/save';

export type SlotId = 'auto' | '1' | '2' | '3';
export const SLOTS: readonly SlotId[] = ['auto', '1', '2', '3'];
const key = (slot: SlotId) => `poor-fantasy.save.${slot}`;
const LIBRARY_KEY = 'poor-fantasy.characters';

export interface SlotSummary {
  slot: SlotId;
  label: string;
  savedAt: string;
  error?: string; // present if the stored save can't be read
}

export class SaveStore {
  lastError = '';

  read(slot: SlotId): SaveEnvelope | null {
    const raw = this.get(key(slot));
    if (!raw) return null;
    try {
      return parseSave(raw);
    } catch (e) {
      this.lastError = (e as Error).message;
      return null;
    }
  }

  summary(slot: SlotId): SlotSummary | null {
    const raw = this.get(key(slot));
    if (!raw) return null;
    try {
      const env = parseSave(raw);
      return { slot, label: env.label, savedAt: env.savedAt };
    } catch (e) {
      return { slot, label: 'Unreadable save', savedAt: '', error: (e as Error).message };
    }
  }

  write(slot: SlotId, env: SaveEnvelope): boolean {
    return this.set(key(slot), JSON.stringify(env));
  }

  remove(slot: SlotId): void {
    try {
      localStorage.removeItem(key(slot));
    } catch {
      /* nothing to do */
    }
  }

  loadLibrary(): CharacterLibrary {
    return parseLibrary(this.get(LIBRARY_KEY));
  }

  saveLibrary(lib: CharacterLibrary): boolean {
    return this.set(LIBRARY_KEY, JSON.stringify(lib));
  }

  private get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      this.lastError = 'This browser is not letting the game use storage (private mode?).';
      return null;
    }
  }

  private set(k: string, v: string): boolean {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      this.lastError = 'Could not save: browser storage is full or disabled.';
      return false;
    }
  }
}
