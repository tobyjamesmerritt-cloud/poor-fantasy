/**
 * Save files: a versioned envelope around the GameState, and the character
 * library (every character ever created, kept across games). Pure — the
 * browser storage lives in ui/saveStore.ts.
 *
 * Format changes: bump SAVE_VERSION in state.ts and add a step to MIGRATIONS
 * that upgrades a save from the previous version, so old saves keep loading.
 */
import { type CharacterSheet, type GameState, SAVE_VERSION } from './state';

export interface SaveEnvelope {
  format: 'poor-fantasy-save';
  version: number; // = state.version
  savedAt: string; // ISO time
  label: string; // "Millbrook · Day 2 08:15 · Aldric, Brenna, …"
  exploreRng: number; // exploration Rng state, so rests and ambushes continue the same sequence
  state: GameState;
}

/** version n → n+1. Saves shipped at v6. */
const MIGRATIONS: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {
  // v7: party pack + experience points
  6: (s) => ({
    ...s,
    inventory: {},
    party: (s.party as Record<string, unknown>[]).map((p) => ({ xp: 0, ...p })),
    bench: (s.bench as { sheet: unknown; state: Record<string, unknown> | null }[]).map((b) => ({
      ...b,
      state: b.state ? { xp: 0, ...b.state } : null,
    })),
  }),
  // v8: XP moves from the party condition onto the character sheet
  7: (s) => {
    const party = s.party as { id: string; xp?: number }[];
    const xpOf = (id: string) => party.find((p) => p.id === id)?.xp ?? 0;
    const strip = <T extends { xp?: number }>(o: T | null) => {
      if (!o) return o;
      const { xp: _xp, ...rest } = o;
      return rest;
    };
    return {
      ...s,
      roster: (s.roster as { id: string }[]).map((r) => ({ ...r, xp: xpOf(r.id) })),
      party: party.map((p) => strip(p)),
      bench: (s.bench as { sheet: { id: string }; state: { xp?: number } | null }[]).map((b) => ({
        sheet: { ...b.sheet, xp: b.state?.xp ?? 0 },
        state: strip(b.state),
      })),
    };
  },
};

const REQUIRED: (keyof GameState)[] = ['version', 'seed', 'flags', 'time', 'roster', 'party', 'bench', 'coins', 'inventory'];

export function makeSave(state: GameState, exploreRng: number, savedAt: string, label: string): SaveEnvelope {
  return { format: 'poor-fantasy-save', version: state.version, savedAt, label, exploreRng, state: structuredClone(state) };
}

/** Read a save (from storage or a file). Throws an Error with a readable message. */
export function parseSave(json: string): SaveEnvelope {
  let data: Partial<SaveEnvelope>;
  try {
    data = JSON.parse(json) as Partial<SaveEnvelope>;
  } catch {
    throw new Error('This is not a Poor Fantasy save file (not JSON).');
  }
  if (data?.format !== 'poor-fantasy-save' || typeof data.state !== 'object' || data.state === null) {
    throw new Error('This is not a Poor Fantasy save file.');
  }
  let state = data.state as unknown as Record<string, unknown>;
  let v = Number(state.version);
  if (v > SAVE_VERSION) throw new Error(`This save is from a newer version of the game (format ${v}). Update the game first.`);
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`This save is too old to load (format ${v}).`);
    state = { ...step(state), version: v + 1 };
    v += 1;
  }
  const missing = REQUIRED.filter((k) => !(k in state));
  if (missing.length) throw new Error(`The save is damaged (missing ${missing.join(', ')}).`);
  return {
    format: 'poor-fantasy-save',
    version: SAVE_VERSION,
    savedAt: String(data.savedAt ?? ''),
    label: String(data.label ?? 'Saved game'),
    exploreRng: Number(data.exploreRng ?? 1) >>> 0,
    state: state as unknown as GameState,
  };
}

// ---------------------------------------------------------------------------
// Character library
// ---------------------------------------------------------------------------

export interface CharacterLibrary {
  format: 'poor-fantasy-characters';
  version: 1;
  sheets: CharacterSheet[];
  deleted: string[]; // ids said good-bye to: never brought back from old saves
}

export const emptyLibrary = (): CharacterLibrary => ({ format: 'poor-fantasy-characters', version: 1, sheets: [], deleted: [] });

export function parseLibrary(json: string | null): CharacterLibrary {
  if (!json) return emptyLibrary();
  try {
    const data = JSON.parse(json) as Partial<CharacterLibrary>;
    if (data.format !== 'poor-fantasy-characters' || !Array.isArray(data.sheets)) return emptyLibrary();
    return { ...emptyLibrary(), sheets: data.sheets, deleted: Array.isArray(data.deleted) ? data.deleted : [] };
  } catch {
    return emptyLibrary();
  }
}

/** Add or update characters (by id); characters that were deleted stay deleted. */
export function remember(lib: CharacterLibrary, sheets: readonly CharacterSheet[]): void {
  for (const s of sheets) {
    if (lib.deleted.includes(s.id)) continue;
    const i = lib.sheets.findIndex((x) => x.id === s.id);
    if (i >= 0) lib.sheets[i] = structuredClone(s);
    else lib.sheets.push(structuredClone(s));
  }
}

/** Say good-bye: remove for good. */
export function forget(lib: CharacterLibrary, id: string): void {
  lib.sheets = lib.sheets.filter((s) => s.id !== id);
  if (!lib.deleted.includes(id)) lib.deleted.push(id);
}
