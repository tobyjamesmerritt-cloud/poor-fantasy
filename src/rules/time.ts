/**
 * The game clock: minutes since midnight of day 1. Gold Box style — time only
 * passes when the party acts (a step, later resting and spells).
 */
export const MINUTES = {
  locationStep: 1, // one 10-ft square inside a town or dungeon (Gold Box: 1 minute per step)
  worldStep: 20, // one square of the overland map
};

/** "Day 1 · 08:05" */
export function formatClock(minutes: number): string {
  const day = Math.floor(minutes / 1440) + 1;
  const m = minutes % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `Day ${day} · ${hh}:${mm}`;
}
