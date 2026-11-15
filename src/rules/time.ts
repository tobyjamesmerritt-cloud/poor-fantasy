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

/**
 * How dark it is outdoors, 0 (day) to 1 (night), for drawing only: full dark
 * 21:00–05:00, dawn 05:00–07:00 and dusk 18:00–21:00 fade in between.
 */
export function darkness(minutes: number): number {
  const h = (((minutes % 1440) + 1440) % 1440) / 60;
  if (h >= 21 || h < 5) return 1;
  if (h < 7) return (7 - h) / 2; // dawn
  if (h >= 18) return (h - 18) / 3; // dusk
  return 0;
}
