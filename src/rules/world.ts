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

export interface TravelMap {
  width: number;
  height: number;
  blocked: boolean[]; // row-major, true = impassable (water, walls, rocks)
  locations: MapLocation[];
  start: { x: number; y: number };
}

export const isBlocked = (m: TravelMap, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= m.width || y >= m.height || m.blocked[y * m.width + x];

export function locationAt(m: TravelMap, x: number, y: number): MapLocation | undefined {
  return m.locations.find((l) => l.x === x && l.y === y);
}

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
export function findPath(m: TravelMap, from: { x: number; y: number }, to: { x: number; y: number }): Direction[] | null {
  if (isBlocked(m, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x: number, y: number) => y * m.width + x;
  const prev = new Map<number, { k: number; dir: Direction }>();
  const seen = new Set([key(from.x, from.y)]);
  let frontier = [{ x: from.x, y: from.y }];
  const dirs = Object.keys(DIRECTION_VECTORS) as Direction[];
  while (frontier.length) {
    const next: { x: number; y: number }[] = [];
    for (const p of frontier) {
      for (const dir of dirs) {
        if (!canStep(m, p, dir)) continue;
        const [dx, dy] = DIRECTION_VECTORS[dir];
        const n = { x: p.x + dx, y: p.y + dy };
        const nk = key(n.x, n.y);
        if (seen.has(nk)) continue;
        seen.add(nk);
        prev.set(nk, { k: key(p.x, p.y), dir });
        if (n.x === to.x && n.y === to.y) {
          const path: Direction[] = [];
          for (let k = nk; k !== key(from.x, from.y); ) {
            const step = prev.get(k)!;
            path.unshift(step.dir);
            k = step.k;
          }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}
