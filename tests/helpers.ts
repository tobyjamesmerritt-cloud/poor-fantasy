import { buildUnits, DEFAULT_ENCOUNTER, encounters, resolveEncounter } from '../src/content/encounters';
import type { Rng } from '../src/engine/rng';
import type { Unit } from '../src/rules/combat';

export const skirmishUnits = (id = DEFAULT_ENCOUNTER): Unit[] => buildUnits(resolveEncounter(encounters[id]));

/** A unit with sensible defaults; override what the test cares about. */
export function makeUnit(p: Partial<Unit> & Pick<Unit, 'id' | 'side' | 'x' | 'y'>): Unit {
  return {
    name: p.id.toUpperCase(),
    sprite: 'fighter',
    hp: 10,
    maxHp: p.maxHp ?? p.hp ?? 10,
    ac: 10,
    speed: 6,
    initBonus: 0,
    attackName: 'Hit',
    attackBonus: 5,
    damage: ['1d4'],
    traits: [],
    medicine: 0,
    deathSaves: { successes: 0, failures: 0 },
    stable: false,
    dead: false,
    ...p,
  };
}

/** Rng returning a scripted sequence of integers (throws when exhausted). */
export function scripted(values: number[]): Rng {
  let i = 0;
  return {
    next: () => 0,
    int: () => {
      if (i >= values.length) throw new Error('script exhausted');
      return values[i++];
    },
    get state() {
      return i;
    },
  };
}
