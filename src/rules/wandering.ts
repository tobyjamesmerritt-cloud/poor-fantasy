/**
 * Random encounters while travelling the world map (house rules; the SRD
 * leaves random encounters to the GM). Each step may bring an encounter:
 * less likely on roads, never within a few steps of the last one, and how
 * dangerous it is depends on how far the party is from any town or site
 * (hidden ones included) — gentle near settlements, harsh in the deep wilds.
 */
import type { Rng } from '../engine/rng';
import type { GameState } from '../engine/state';
import type { Difficulty } from './quests';
import type { TravelMap } from './world';

export interface WanderZone {
  name: string;
  within?: number; // squares from the nearest town/site; absent = everything further out
  difficulty: Difficulty;
  chance?: number; // per step off the road in this zone (default: the global chance)
  share?: number; // most monsters as a share of the party size (default 1 = one per character)
  dialogs: string[]; // quests.json dialogs that open the encounter
}

export interface WanderingConfig {
  chance: number; // per step off the road (0–1)
  roadChance: number; // per step on a road or bridge
  grace: number; // steps after an encounter before the next can happen
  zones: WanderZone[];
}

const STEPS_FLAG = 'wander:steps'; // steps since the last encounter

/** Distance (squares, diagonals count 1) to the nearest town, cave, ruin or quest site. */
export function distanceToSettlement(map: TravelMap, x: number, y: number): number {
  const places = [...map.locations, ...map.sites];
  return places.reduce((best, p) => Math.min(best, Math.max(Math.abs(p.x - x), Math.abs(p.y - y))), Infinity);
}

export function zoneAt(map: TravelMap, x: number, y: number, cfg: WanderingConfig): WanderZone {
  const d = distanceToSettlement(map, x, y);
  return cfg.zones.find((z) => z.within === undefined || d <= z.within) ?? cfg.zones[cfg.zones.length - 1];
}

/**
 * After a step to (x, y): does something find the party? Counts steps in the
 * game's flags (so the grace period survives saving). Never on a town or site square.
 */
export function wanderingCheck(
  g: GameState,
  map: TravelMap,
  x: number,
  y: number,
  cfg: WanderingConfig,
  rng: Rng,
): { dialog: string; difficulty: Difficulty; share: number; zone: string } | null {
  const steps = (typeof g.flags[STEPS_FLAG] === 'number' ? (g.flags[STEPS_FLAG] as number) : cfg.grace) + 1;
  g.flags[STEPS_FLAG] = steps;
  if (steps <= cfg.grace) return null;
  if ([...map.locations, ...map.sites].some((p) => p.x === x && p.y === y)) return null;
  const t = map.terrain?.[y * map.width + x] ?? '';
  const zone = zoneAt(map, x, y, cfg);
  const chance = t === 'road' || t === 'bridge' ? cfg.roadChance : (zone.chance ?? cfg.chance);
  if (chance <= 0) return null;
  if (rng.int(1, 1000) > Math.round(chance * 1000)) return null;
  g.flags[STEPS_FLAG] = 0;
  return { dialog: zone.dialogs[rng.int(0, zone.dialogs.length - 1)], difficulty: zone.difficulty, share: zone.share ?? 1, zone: zone.name };
}
