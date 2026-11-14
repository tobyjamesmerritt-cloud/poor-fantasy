/**
 * Seeded pseudo-random number generator (mulberry32).
 * Every random outcome in the game must come from an Rng so any fight
 * can be replayed exactly from its seed.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** Current internal state; pass to createRng to resume the sequence. */
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`Invalid range [${min}, ${max}]`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    get state() {
      return s;
    },
  };
}

/** A fresh random seed for new games; replay uses a stored seed instead. */
export function randomSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
