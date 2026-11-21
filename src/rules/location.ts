/**
 * Inside a location (town, cave, ruins): Gold Box-style grid movement with a
 * facing, plus the geometry for the first-person view.
 * Pure TypeScript — the scene renders what these functions return.
 *
 * Walls are whole solid squares (painted in Tiled), so the same map drives
 * the overhead view, movement and the 3D view.
 */

export type Facing = 'n' | 'e' | 's' | 'w';
export type Turn = 'left' | 'right' | 'around';
export type StepDir = 'forward' | 'back' | 'left' | 'right';
export type SpotKind = 'fight' | 'building' | 'text';

export interface Spot {
  id: string; // unique within the location, used in cleared flags
  kind: SpotKind;
  name: string;
  x: number;
  y: number;
  description: string;
  encounter?: string; // fight spots
  building?: string; // building spots: inn | shop | temple | hall | house
  picture?: string; // building spots: picture id (assets.json `pictures`) shown in the place panel; absent = placeholder
  locked?: boolean; // building spots: the door won't open…
  unlockFlag?: string; // …until this flag is set (a quest unlocks it)
}

/** A building's door: the square of a building spot. Drawn as a door in the 3D view. */
export const isDoor = (m: LocationMap, x: number, y: number): boolean => spotAt(m, x, y)?.kind === 'building';

/** Is this door locked right now? */
export function doorLocked(spot: Spot | undefined, flags: Readonly<Record<string, unknown>>): boolean {
  if (spot?.kind !== 'building' || !spot.locked) return false;
  return !(spot.unlockFlag && flags[spot.unlockFlag]);
}

export interface LocationMap {
  id: string;
  width: number;
  height: number;
  solid: boolean[]; // row-major
  material: string[]; // row-major; what a solid square looks like in the 3D view (stone, rock, tree, wood…)
  entrance: Pose;
  exits: { x: number; y: number }[];
  spots: Spot[];
}

export interface Pose {
  x: number;
  y: number;
  facing: Facing;
}

export const FACINGS: readonly Facing[] = ['n', 'e', 's', 'w'];
export const FACING_VECTORS: Readonly<Record<Facing, readonly [number, number]>> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};

export function turn(f: Facing, t: Turn): Facing {
  const i = FACINGS.indexOf(f);
  const by = t === 'left' ? 3 : t === 'right' ? 1 : 2;
  return FACINGS[(i + by) % 4];
}

/** Absolute direction of a step relative to the facing. */
export function stepFacing(f: Facing, d: StepDir): Facing {
  return d === 'forward' ? f : d === 'back' ? turn(f, 'around') : turn(f, d);
}

export function isSolid(m: LocationMap, x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= m.width || y >= m.height || m.solid[y * m.width + x];
}

export function materialAt(m: LocationMap, x: number, y: number): string {
  return x < 0 || y < 0 || x >= m.width || y >= m.height ? 'wall' : m.material[y * m.width + x] || 'wall';
}

/** One step keeping the facing (back / strafe don't turn you). Null if a wall is in the way. */
export function tryStep(m: LocationMap, p: Pose, d: StepDir, closed: (x: number, y: number) => boolean = () => false): Pose | null {
  const [dx, dy] = FACING_VECTORS[stepFacing(p.facing, d)];
  const x = p.x + dx;
  const y = p.y + dy;
  return isSolid(m, x, y) || closed(x, y) ? null : { x, y, facing: p.facing };
}

export const spotAt = (m: LocationMap, x: number, y: number): Spot | undefined =>
  m.spots.find((s) => s.x === x && s.y === y);

export const isExit = (m: LocationMap, x: number, y: number): boolean => m.exits.some((e) => e.x === x && e.y === y);

/**
 * Shortest 4-way route (BFS) for click-to-walk on the overhead map, as the
 * absolute direction of each step. Ties prefer keeping the current heading, so
 * routes turn as rarely as possible. Null if unreachable.
 */
export function findPath4(
  m: LocationMap,
  from: Pose,
  to: { x: number; y: number },
  closed: (x: number, y: number) => boolean = () => false,
): Facing[] | null {
  if (isSolid(m, to.x, to.y) || closed(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const key = (x: number, y: number) => y * m.width + x;
  const prev = new Map<number, { k: number; dir: Facing }>();
  const seen = new Set([key(from.x, from.y)]);
  let frontier = [{ x: from.x, y: from.y, dir: from.facing }];
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const p of frontier) {
      const dirs = [p.dir, ...FACINGS.filter((f) => f !== p.dir)];
      for (const dir of dirs) {
        const [dx, dy] = FACING_VECTORS[dir];
        const x = p.x + dx;
        const y = p.y + dy;
        const k = key(x, y);
        if (isSolid(m, x, y) || closed(x, y) || seen.has(k)) continue;
        seen.add(k);
        prev.set(k, { k: key(p.x, p.y), dir });
        if (x === to.x && y === to.y) {
          const path: Facing[] = [];
          for (let c = k; c !== key(from.x, from.y); c = prev.get(c)!.k) path.unshift(prev.get(c)!.dir);
          return path;
        }
        next.push({ x, y, dir });
      }
    }
    frontier = next;
  }
  return null;
}

// ---------------------------------------------------------------------------
// First-person view geometry
// ---------------------------------------------------------------------------

/**
 * A visible wall face in view space. The viewer stands at the centre of its
 * square looking down +z; +X is to the right. A square at `depth` d and
 * `lateral` L spans X ∈ [L−½, L+½], z ∈ [d−½, d+½]; walls run from floor
 * (Y = −½) to ceiling (Y = +½).
 *
 * front: the face toward the viewer, at z = z0 (= z1), from X0 to X1.
 * side:  a face along the view direction, at X = X0 (= X1), from z0 to z1.
 */
export interface Face {
  kind: 'front' | 'side';
  depth: number;
  lateral: number;
  X0: number;
  X1: number;
  z0: number;
  z1: number;
  material: string;
  door?: 'open' | 'locked'; // the face is a building's door (drawn in the building's own material)
}

/** View-space square → map square. */
function cellFor(p: Pose, depth: number, lateral: number): { x: number; y: number } {
  const [fx, fy] = FACING_VECTORS[p.facing];
  const [rx, ry] = FACING_VECTORS[turn(p.facing, 'right')];
  return { x: p.x + fx * depth + rx * lateral, y: p.y + fy * depth + ry * lateral };
}

/**
 * Wall faces visible from a pose, sorted far → near (painter's order: draw in
 * this order and nearer walls cover farther ones). Faces hidden behind a
 * neighbouring solid square are skipped.
 */
export function viewFaces(m: LocationMap, p: Pose, maxDepth = 4, locked: (x: number, y: number) => boolean = () => false): Face[] {
  const faces: Face[] = [];
  // doors look solid from outside (you see the door, not the inside); never the square you stand on
  const doorAt = (d: number, l: number) => {
    if (d === 0 && l === 0) return false;
    const c = cellFor(p, d, l);
    return isDoor(m, c.x, c.y);
  };
  const solidAt = (d: number, l: number) => {
    const c = cellFor(p, d, l);
    return isSolid(m, c.x, c.y) || doorAt(d, l);
  };
  // a door is set into its building's wall: use the material of a solid neighbour
  const doorMaterial = (x: number, y: number) => {
    for (const [dx, dy] of Object.values(FACING_VECTORS)) if (isSolid(m, x + dx, y + dy)) return materialAt(m, x + dx, y + dy);
    return 'wall';
  };
  for (let d = maxDepth; d >= 0; d--) {
    const reach = 2 * d + 2; // the view spans about 127° (tan of half-angle = 2)
    // outer squares first, then inward, so the centre is drawn last at each depth
    const laterals: number[] = [];
    for (let l = reach; l >= 1; l--) laterals.push(-l, l);
    laterals.push(0);
    for (const l of laterals) {
      if (!solidAt(d, l)) continue;
      const c = cellFor(p, d, l);
      const isDoorHere = doorAt(d, l);
      const material = isDoorHere ? doorMaterial(c.x, c.y) : materialAt(m, c.x, c.y);
      const door = isDoorHere ? (locked(c.x, c.y) ? ('locked' as const) : ('open' as const)) : undefined;
      if (d >= 1 && !solidAt(d - 1, l)) {
        faces.push({ kind: 'front', depth: d, lateral: l, X0: l - 0.5, X1: l + 0.5, z0: d - 0.5, z1: d - 0.5, material, door });
      }
      if (l !== 0) {
        const inward = l < 0 ? l + 1 : l - 1;
        if (!solidAt(d, inward)) {
          const X = l < 0 ? l + 0.5 : l - 0.5;
          faces.push({ kind: 'side', depth: d, lateral: l, X0: X, X1: X, z0: d - 0.5, z1: d + 0.5, material, door });
        }
      }
    }
  }
  return faces;
}

/** Camping inside a dungeon: anywhere quiet — not on an entrance, exit or special square. */
export function locationCampCheck(m: LocationMap, p: Pose): { ok: true } | { ok: false; reason: string } {
  const atEntrance = m.entrance.x === p.x && m.entrance.y === p.y;
  if (atEntrance || isExit(m, p.x, p.y)) return { ok: false, reason: 'Too exposed here — move further in to make camp.' };
  if (spotAt(m, p.x, p.y)) return { ok: false, reason: 'Not here — find a quieter corner to camp.' };
  return { ok: true };
}

// --- Fog of war (overhead map) ---------------------------------------------

/** How far the party sees on the overhead map: open towns far, dungeons only the next square. */
export const SIGHT = { town: 5, dungeon: 1 } as const;

/**
 * Squares the party can see from (x, y) within `radius` (round, in squares). Walls,
 * rock and buildings (doors included) block the view but are seen themselves. Diagonal
 * gaps: `strict` (dungeons) needs both sides of a corner open — you never see round a
 * corner; otherwise one open side will do.
 */
export function visibleSquares(m: LocationMap, x: number, y: number, radius: number, strict: boolean): number[] {
  const opaque = (cx: number, cy: number) => isSolid(m, cx, cy) || isDoor(m, cx, cy);
  const seen: number[] = [];
  const r2 = (radius + 0.5) ** 2;
  for (let ty = y - radius; ty <= y + radius; ty++) {
    for (let tx = x - radius; tx <= x + radius; tx++) {
      if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) continue;
      if ((tx - x) ** 2 + (ty - y) ** 2 > r2) continue;
      if (lineOfSight(x, y, tx, ty, opaque, strict)) seen.push(ty * m.width + tx);
    }
  }
  return seen;
}

/** Walk the line between square centres; every square before the target must be see-through. */
function lineOfSight(x0: number, y0: number, x1: number, y1: number, opaque: (x: number, y: number) => boolean, strict: boolean): boolean {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= steps; i++) {
    const cx = Math.round(x0 + ((x1 - x0) * i) / steps);
    const cy = Math.round(y0 + ((y1 - y0) * i) / steps);
    if (cx === px && cy === py) continue;
    if (cx !== px && cy !== py) {
      // squeezing past a corner
      const a = opaque(cx, py);
      const b = opaque(px, cy);
      if (strict ? a || b : a && b) return false;
    }
    if (cx === x1 && cy === y1) return true;
    if (opaque(cx, cy)) return false;
    px = cx;
    py = cy;
  }
  return true;
}

/** Explored squares are kept as a hex bitmask string per location (saved in GameState.explored). */
export function markSeen(mask: string | undefined, size: number, squares: readonly number[]): string {
  const bytes = new Uint8Array(Math.ceil(size / 8));
  if (mask) for (let i = 0; i < bytes.length && i * 2 < mask.length; i++) bytes[i] = parseInt(mask.slice(i * 2, i * 2 + 2), 16) || 0;
  for (const s of squares) if (s >= 0 && s < size) bytes[s >> 3] |= 1 << (s & 7);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isSeen(mask: string | undefined, square: number): boolean {
  if (!mask) return false;
  const byte = parseInt(mask.slice((square >> 3) * 2, (square >> 3) * 2 + 2), 16) || 0;
  return (byte & (1 << (square & 7))) !== 0;
}
