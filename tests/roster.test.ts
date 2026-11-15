import { describe, expect, it } from 'vitest';
import { pregens } from '../src/content/characters';
import type { CharacterSheet, PartyMemberState } from '../src/engine/state';
import {
  addCharacter,
  benchMember,
  deleteCharacter,
  joinParty,
  MAX_PARTY,
  nextId,
  restoreAll,
  type Roster,
  useReadyMade,
} from '../src/rules/roster';

const fresh = (s: CharacterSheet): PartyMemberState => ({ id: s.id, hp: 10, hitDice: 1, dead: false, wakesAt: null });
const sheet = (id: string): CharacterSheet => ({ ...pregens[0], id, name: id });
const empty = (): Roster => ({ roster: [], party: [], bench: [] });

describe('party roster and character pool', () => {
  it('fills the party to 6, then new characters wait on the bench', () => {
    const r = empty();
    for (let i = 1; i <= 8; i++) addCharacter(r, sheet(nextId(r)), fresh);
    expect(r.roster).toHaveLength(MAX_PARTY);
    expect(r.bench.map((b) => b.sheet.id)).toEqual(['c7', 'c8']);
    expect(r.party.map((p) => p.id)).toEqual(r.roster.map((s) => s.id));
  });

  it('benching keeps a character’s condition; joining restores it', () => {
    const r = empty();
    addCharacter(r, sheet('a'), fresh);
    r.party[0].hp = 3;
    expect(benchMember(r, 'a')).toBe(true);
    expect(r.roster).toHaveLength(0);
    expect(r.bench[0].state?.hp).toBe(3);
    expect(joinParty(r, 'a', fresh)).toBe(true);
    expect(r.party[0].hp).toBe(3);
  });

  it('cannot join a full party; delete only removes benched characters', () => {
    const r = empty();
    for (let i = 0; i < 7; i++) addCharacter(r, sheet(nextId(r)), fresh);
    expect(joinParty(r, 'c7', fresh)).toBe(false);
    expect(deleteCharacter(r, 'c1')).toBe(false); // in the party: bench first
    expect(deleteCharacter(r, 'c7')).toBe(true);
    expect(r.bench).toHaveLength(0);
  });

  it('ready-made party: copies with new ids; the old party moves to the bench', () => {
    const r = empty();
    addCharacter(r, sheet('mine'), fresh);
    useReadyMade(r, pregens, fresh);
    expect(r.roster.map((s) => s.name)).toEqual(pregens.map((p) => p.name));
    expect(new Set(r.roster.map((s) => s.id)).size).toBe(6);
    expect(r.bench.map((b) => b.sheet.id)).toEqual(['mine']);
    useReadyMade(r, pregens, fresh); // again: still unique ids, previous six benched
    expect(r.bench).toHaveLength(7);
    const ids = [...r.roster.map((s) => s.id), ...r.bench.map((b) => b.sheet.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('new game restores everyone', () => {
    const r = empty();
    addCharacter(r, sheet('a'), fresh);
    r.party[0].dead = true;
    r.bench.push({ sheet: sheet('b'), state: { ...fresh(sheet('b')), hp: 0 } });
    restoreAll(r, fresh);
    expect(r.party[0].dead).toBe(false);
    expect(r.bench[0].state).toBeNull();
  });
});
