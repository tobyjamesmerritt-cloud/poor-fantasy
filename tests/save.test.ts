import { describe, expect, it } from 'vitest';
import { pregens } from '../src/content/characters';
import { emptyLibrary, forget, makeSave, parseLibrary, parseSave, remember } from '../src/engine/save';
import { newGameState, SAVE_VERSION } from '../src/engine/state';

describe('save files', () => {
  it('round-trip a game with its party, pool and exploration dice', () => {
    const state = { ...newGameState(42), roster: [pregens[0]], time: 999, coins: 1234 };
    const env = parseSave(JSON.stringify(makeSave(state, 777, '2026-11-15T10:00:00Z', 'Millbrook · Day 1')));
    expect(env.state).toEqual(state);
    expect(env).toMatchObject({ exploreRng: 777, label: 'Millbrook · Day 1', version: SAVE_VERSION });
  });

  it('rejects junk, damaged and future saves with readable messages', () => {
    expect(() => parseSave('not json')).toThrow(/not a Poor Fantasy save/);
    expect(() => parseSave('{"format":"something-else"}')).toThrow(/not a Poor Fantasy save/);
    const future = makeSave(newGameState(1), 1, '', '');
    future.state.version = SAVE_VERSION + 1;
    expect(() => parseSave(JSON.stringify(future))).toThrow(/newer version/);
    const damaged = makeSave(newGameState(1), 1, '', '') as unknown as { state: Record<string, unknown> };
    delete damaged.state.roster;
    expect(() => parseSave(JSON.stringify(damaged))).toThrow(/missing roster/);
  });
});

describe('character library', () => {
  it('remembers and updates characters by id', () => {
    const lib = emptyLibrary();
    remember(lib, [pregens[0], pregens[1]]);
    remember(lib, [{ ...pregens[0], name: 'Renamed' }]);
    expect(lib.sheets.map((s) => s.name)).toEqual(['Renamed', pregens[1].name]);
  });

  it('good-bye is for ever: deleted characters are not brought back by old saves', () => {
    const lib = emptyLibrary();
    remember(lib, [pregens[0]]);
    forget(lib, pregens[0].id);
    remember(lib, [pregens[0]]); // e.g. loading an old save that still has them
    expect(lib.sheets).toHaveLength(0);
    expect(parseLibrary(JSON.stringify(lib)).deleted).toEqual([pregens[0].id]);
    expect(parseLibrary('garbage').sheets).toEqual([]);
  });
});
