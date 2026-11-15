/**
 * Party roster bookkeeping: up to 6 characters adventure (roster + their
 * condition in `party`); any number wait on the bench with their condition
 * kept. Pure functions on the relevant part of the game state.
 */
import type { BenchEntry, CharacterSheet, PartyMemberState } from '../engine/state';

export const MAX_PARTY = 6;

export interface Roster {
  roster: CharacterSheet[];
  party: PartyMemberState[];
  bench: BenchEntry[];
}

/** An id not used by anyone in the party or on the bench. */
export function nextId(r: Roster): string {
  const used = new Set([...r.roster.map((s) => s.id), ...r.bench.map((b) => b.sheet.id)]);
  let n = 1;
  while (used.has(`c${n}`)) n++;
  return `c${n}`;
}

/** Add a newly created character: into the party if there is room, otherwise to the bench. */
export function addCharacter(r: Roster, sheet: CharacterSheet, fresh: (s: CharacterSheet) => PartyMemberState): 'party' | 'bench' {
  if (r.roster.length < MAX_PARTY) {
    r.roster.push(sheet);
    r.party.push(fresh(sheet));
    return 'party';
  }
  r.bench.push({ sheet, state: null });
  return 'bench';
}

/** Move a party member to the bench, keeping their condition. */
export function benchMember(r: Roster, id: string): boolean {
  const i = r.roster.findIndex((s) => s.id === id);
  if (i < 0) return false;
  const [sheet] = r.roster.splice(i, 1);
  const state = r.party.find((p) => p.id === id) ?? null;
  r.party = r.party.filter((p) => p.id !== id);
  r.bench.push({ sheet, state });
  return true;
}

/** Bring a benched character into the party (if there is room). */
export function joinParty(r: Roster, id: string, fresh: (s: CharacterSheet) => PartyMemberState): boolean {
  const i = r.bench.findIndex((b) => b.sheet.id === id);
  if (i < 0 || r.roster.length >= MAX_PARTY) return false;
  const [entry] = r.bench.splice(i, 1);
  r.roster.push(entry.sheet);
  r.party.push(entry.state ?? fresh(entry.sheet));
  return true;
}

/** Delete a benched character for good. */
export function deleteCharacter(r: Roster, id: string): boolean {
  const before = r.bench.length;
  r.bench = r.bench.filter((b) => b.sheet.id !== id);
  return r.bench.length < before;
}

/**
 * Fill the party with ready-made characters (copies with fresh ids); whoever
 * was in the party moves to the bench.
 */
export function useReadyMade(
  r: Roster,
  pregens: readonly CharacterSheet[],
  fresh: (s: CharacterSheet) => PartyMemberState,
  makeId: () => string = () => nextId(r),
): void {
  for (const s of [...r.roster]) benchMember(r, s.id);
  for (const p of pregens.slice(0, MAX_PARTY)) {
    const sheet = { ...structuredClone(p), id: makeId() };
    r.roster.push(sheet);
    r.party.push(fresh(sheet));
  }
}

/** New game: everyone (party and bench) is restored; the party line-up stays. */
export function restoreAll(r: Roster, fresh: (s: CharacterSheet) => PartyMemberState): void {
  r.party = r.roster.map(fresh);
  for (const b of r.bench) b.state = null;
}
