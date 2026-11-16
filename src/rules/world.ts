/**
 * Overhead map travel (world map now; town/dungeon maps later — DND-30).
 * Pure TypeScript: the party moves as one token over a grid of passable /
 * blocked squares, and stepping onto a location triggers it.
 */
import type { Direction } from '../engine/commands';
import { DIRECTION_VECTORS } from '../engine/commands';

export type LocationKind = 'town' | 'cave' | 'ruins';

export interface MapLocation {
  id: string;
  name: string;
  kind: LocationKind;
  x: number;
  y: number;
  description: string;
}

/**
 * A quest site on the world map (Tiled object type "site": properties siteId,
 * description, hidden). What it does is quest data (rules/quests.ts).
 */
export interface MapSite {
  id: string;
  name: string;
  x: number;
  y: number;
  description: string;
  hidden: boolean; // not drawn until found (flag found:<id>)
}

export interface TravelMap {
  width: number;
  height: number;
  blocked: boolean[]; // row-major, true = impassable (water, walls, rocks)
  locations: MapLocation[];
  sites: MapSite[];
  start: { x: number; y: number };
  terrain?: string[]; // row-major: grass | forest | rocks | road | bridge | water ('' = unknown)
}

export const isBlocked = (m: TravelMap, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= m.width || y >= m.height || m.blocked[y * m.width + x];

export function locationAt(m: TravelMap, x: number, y: number): MapLocation | undefined {
  return m.locations.find((l) => l.x === x && l.y === y);
}

export const siteAt = (m: TravelMap, x: number, y: number): MapSite | undefined => m.sites.find((s) => s.x === x && s.y === y);

/**
 * One step. Diagonal steps may not cut a corner past a blocked square
 * (no slipping between two trees of riverbank).
 */
export function canStep(m: TravelMap, from: { x: number; y: number }, dir: Direction): boolean {
  const [dx, dy] = DIRECTION_VECTORS[dir];
  const nx = from.x + dx;
  const ny = from.y + dy;
  if (isBlocked(m, nx, ny)) return false;
  if (dx !== 0 && dy !== 0 && (isBlocked(m, from.x + dx, from.y) || isBlocked(m, from.x, from.y + dy))) return false;
  return true;
}

/** Shortest 8-way path (BFS) to a passable square; null if unreachable. */
export function findPath(
  m: TravelMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  avoid: (x: number, y: number) => boolean = () => false, // e.g. land still under the fog
): Direction[] | null {
  if (isBlocked(m, to.x, to.y) || avoid(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  // Dijkstra. Every step costs the same (diagonals included), so many routes
  // tie; a small tie-breaker for distance from the straight from→to line picks
  // the one that looks straight instead of bowing out.
  const STEP = 1_000_000; // far larger than any summed deviation on a map
  const lx = to.x - from.x;
  const ly = to.y - from.y;
  const deviation = (x: number, y: number) => Math.abs(lx * (y - from.y) - ly * (x - from.x));
  const key = (x: number, y: number) => y * m.width + x;
  const best = new Map<number, number>([[key(from.x, from.y), 0]]);
  const prev = new Map<number, { k: number; dir: Direction }>();
  const done = new Set<number>();
  const open: { x: number; y: number; cost: number }[] = [{ x: from.x, y: from.y, cost: 0 }];
  const dirs = Object.keys(DIRECTION_VECTORS) as Direction[];
  while (open.length) {
    let i = 0;
    for (let j = 1; j < open.length; j++) if (open[j].cost < open[i].cost) i = j;
    const p = open.splice(i, 1)[0];
    const pk = key(p.x, p.y);
    if (done.has(pk)) continue;
    done.add(pk);
    if (p.x === to.x && p.y === to.y) {
      const path: Direction[] = [];
      for (let k = pk; k !== key(from.x, from.y); ) {
        const step = prev.get(k)!;
        path.unshift(step.dir);
        k = step.k;
      }
      return path;
    }
    for (const dir of dirs) {
      if (!canStep(m, p, dir)) continue;
      const [dx, dy] = DIRECTION_VECTORS[dir];
      if (avoid(p.x + dx, p.y + dy)) continue;
      const n = { x: p.x + dx, y: p.y + dy };
      const nk = key(n.x, n.y);
      const cost = p.cost + STEP + deviation(n.x, n.y);
      if (done.has(nk) || cost >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, cost);
      prev.set(nk, { k: pk, dir });
      open.push({ ...n, cost });
    }
  }
  return null;
}

/** Where the party may camp on the world map: off the road, not on a bridge or at a town or ruin. */
export function worldCampSite(
  m: TravelMap,
  x: number,
  y: number,
): { ok: true; kind: 'forest' | 'meadow' | 'rocks' | 'riverside' } | { ok: false; reason: string } {
  const loc = locationAt(m, x, y);
  if (loc) {
    return {
      ok: false,
      reason: loc.kind === 'town' ? `Find an inn inside ${loc.name} to rest.` : `You can't camp at the entrance of ${loc.name}.`,
    };
  }
  const t = (xx: number, yy: number) => m.terrain?.[yy * m.width + xx] ?? '';
  const here = t(x, y);
  if (here === 'road') return { ok: false, reason: 'Not on the road — step off it to make camp.' };
  if (here === 'bridge') return { ok: false, reason: 'You cannot camp on a bridge.' };
  if (here === 'water' || isBlocked(m, x, y)) return { ok: false, reason: 'There is nowhere to camp here.' };
  if (here === 'forest') return { ok: true, kind: 'forest' };
  // Open ground takes its character from what is next to it: boulders (rocks), then water (riverside).
  const near = (kind: string) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < m.width && yy < m.height && t(xx, yy) === kind) return true;
      }
    }
    return false;
  };
  if (near('rocks')) return { ok: true, kind: 'rocks' };
  if (near('water')) return { ok: true, kind: 'riverside' };
  return { ok: true, kind: 'meadow' };
}

/**
 * How far the party sees on the world map (fog of war), by the clock (`darkness`
 * 0 = day … 1 = night): 3 squares by day, 2 at dusk and dawn, 1 at night. No line
 * of sight: a world square is a long stretch of country.
 */
export function worldSight(dark: number): number {
  return dark < 0.25 ? 3 : dark < 0.75 ? 2 : 1;
}

/** World squares within `radius` (round) of (x, y). */
export function squaresAround(m: TravelMap, x: number, y: number, radius: number): number[] {
  const out: number[] = [];
  const r2 = (radius + 0.5) ** 2;
  for (let ty = y - radius; ty <= y + radius; ty++)
    for (let tx = x - radius; tx <= x + radius; tx++)
      if (tx >= 0 && ty >= 0 && tx < m.width && ty < m.height && (tx - x) ** 2 + (ty - y) ** 2 <= r2) out.push(ty * m.width + tx);
  return out;
}
