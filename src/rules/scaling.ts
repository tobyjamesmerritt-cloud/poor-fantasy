/**
 * Encounter scaling (SRD 5.2 Gameplay Toolbox, "Combat Encounters": XP
 * Budget per Character). House rule: the budget is for one character fewer
 * than the party (party size − 1, at least 1), so a fight is doable but not a
 * walkover. A fight keeps its fixed monsters (a boss) and adds "filler"
 * monsters until the budget is used, within the min–max the designer set.
 */
import type { Difficulty } from './quests';

/** XP Budget per Character (SRD 5.2), levels 1–7. */
export const XP_BUDGET: Record<number, Record<Difficulty, number>> = {
  1: { low: 50, moderate: 75, high: 100 },
  2: { low: 100, moderate: 150, high: 200 },
  3: { low: 150, moderate: 225, high: 400 },
  4: { low: 250, moderate: 375, high: 500 },
  5: { low: 500, moderate: 750, high: 1100 },
  6: { low: 600, moderate: 1000, high: 1400 },
  7: { low: 750, moderate: 1300, high: 1700 },
};

/** The XP budget for a fight: (party size − 1) characters at the party's level. */
export function fightBudget(partySize: number, level: number, difficulty: Difficulty): number {
  const per = XP_BUDGET[Math.min(7, Math.max(1, Math.round(level)))][difficulty];
  return Math.max(1, partySize - 1) * per;
}

/** How many filler monsters fit what's left of the budget after the fixed ones (clamped to min–max). */
export function fillerCount(budget: number, fixedXp: number, fillerXp: number, min: number, max: number): number {
  const fit = fillerXp > 0 ? Math.floor(Math.max(0, budget - fixedXp) / fillerXp) : max;
  return Math.min(max, Math.max(min, fit));
}

/**
 * Squares for filler monsters on the enemy side of the board: the rightmost
 * columns first, each column from the middle row outwards, skipping taken ones.
 */
export function fillerSquares(width: number, height: number, taken: readonly { x: number; y: number }[], n: number): { x: number; y: number }[] {
  const mid = Math.floor(height / 2);
  const rows = Array.from({ length: height }, (_, i) => i).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  const out: { x: number; y: number }[] = [];
  const used = new Set(taken.map((p) => `${p.x},${p.y}`));
  // every other row first so monsters don't stand shoulder to shoulder, then the gaps
  for (const parity of [0, 1]) {
    for (let x = width - 1; x >= Math.floor(width / 2) && out.length < n; x--) {
      for (const y of rows) {
        if (out.length >= n) break;
        if ((y + x) % 2 !== parity || used.has(`${x},${y}`)) continue;
        used.add(`${x},${y}`);
        out.push({ x, y });
      }
    }
  }
  return out;
}
