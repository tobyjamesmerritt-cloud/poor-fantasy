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
  within?: number; // squares from the nearest town/site (or from `near`); absent = everything further out
  near?: string; // measure `within` from this one location or site id only (a lair's surroundings)
  area?: { x?: [number, number]; y?: [number, number] }; // only inside these squares (inclusive)
  onlyRoads?: boolean; // only on road and bridge squares (bandits); otherwise roads are skipped
  roadChance?: number; // per step on a road or bridge in this zone (default: the global roadChance)
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

export interface WanderMeeting {
  dialog: string;
  difficulty: Difficulty;
  share: number;
  zone: string;
}

const STEPS_FLAG = 'wander:steps'; // steps since the last encounter

/** Distance (squares, diagonals count 1) to the nearest town, cave, ruin or quest site. */
export function distanceToSettlement(map: TravelMap, x: number, y: number): number {
  const places = [...map.locations, ...map.sites];
  return places.reduce((best, p) => Math.min(best, Math.max(Math.abs(p.x - x), Math.abs(p.y - y))), Infinity);
}

const onRoad = (map: TravelMap, x: number, y: number): boolean => {
  const t = map.terrain?.[y * map.width + x] ?? '';
  return t === 'road' || t === 'bridge';
};

const inRange = (v: number, r?: [number, number]): boolean => !r || (v >= r[0] && v <= r[1]);

/** Does this zone cover (x, y)? Checks the road filter, the area and the distance. */
function zoneFits(map: TravelMap, x: number, y: number, z: WanderZone): boolean {
  if (z.onlyRoads && !onRoad(map, x, y)) return false;
  if (z.area && !(inRange(x, z.area.x) && inRange(y, z.area.y))) return false;
  if (z.within === undefined) return true;
  if (z.near) {
    const p = [...map.locations, ...map.sites].find((q) => q.id === z.near);
    return !!p && Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= z.within;
  }
  return distanceToSettlement(map, x, y) <= z.within;
}

/** The first zone in wandering.json that covers (x, y) — specific zones come first. */
export function zoneAt(map: TravelMap, x: number, y: number, cfg: WanderingConfig): WanderZone {
  return cfg.zones.find((z) => zoneFits(map, x, y, z)) ?? cfg.zones[cfg.zones.length - 1];
}

/** Mistakes in wandering.json that need the world map to spot (unknown `near` ids). */
export function checkZones(map: TravelMap, cfg: WanderingConfig): string[] {
  const ids = new Set([...map.locations, ...map.sites].map((p) => p.id));
  return cfg.zones.flatMap((z) => {
    const bad: string[] = [];
    if (z.near && !ids.has(z.near)) bad.push(`zone "${z.name}": unknown place "${z.near}" (near)`);
    if (z.near && z.within === undefined) bad.push(`zone "${z.name}": "near" needs "within"`);
    return bad;
  });
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
): WanderMeeting | null {
  const steps = (typeof g.flags[STEPS_FLAG] === 'number' ? (g.flags[STEPS_FLAG] as number) : cfg.grace) + 1;
  g.flags[STEPS_FLAG] = steps;
  if (steps <= cfg.grace) return null;
  if ([...map.locations, ...map.sites].some((p) => p.x === x && p.y === y)) return null;
  const zone = zoneAt(map, x, y, cfg);
  const chance = onRoad(map, x, y) ? (zone.roadChance ?? cfg.roadChance) : (zone.chance ?? cfg.chance);
  return roll(g, zone, chance, rng);
}

function roll(g: GameState, zone: WanderZone, chance: number, rng: Rng): WanderMeeting | null {
  if (chance <= 0) return null;
  if (rng.int(1, 1000) > Math.round(chance * 1000)) return null;
  g.flags[STEPS_FLAG] = 0;
  return { dialog: zone.dialogs[rng.int(0, zone.dialogs.length - 1)], difficulty: zone.difficulty, share: zone.share ?? 1, zone: zone.name };
}

/** Random encounters inside a location (locations.json `wander`): same shape as a zone, its own chance per step. */
export interface LocationWander {
  chance: number;
  difficulty: Difficulty;
  share?: number;
  dialogs: string[];
}

/**
 * After a step inside a location: does something wander into the party? Shares
 * the world map's quiet spell (grace steps). `busySquare` = an exit, fight spot,
 * building or text spot — nothing jumps the party there.
 */
export function locationWanderCheck(
  g: GameState,
  where: string,
  w: LocationWander,
  grace: number,
  busySquare: boolean,
  rng: Rng,
): WanderMeeting | null {
  const steps = (typeof g.flags[STEPS_FLAG] === 'number' ? (g.flags[STEPS_FLAG] as number) : grace) + 1;
  g.flags[STEPS_FLAG] = steps;
  if (steps <= grace || busySquare) return null;
  return roll(g, { name: where, ...w }, w.chance, rng);
}
