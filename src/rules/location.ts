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
export type SpotKind = 'fight' | 'building' | 'text' | 'stairs';

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
  altDescription?: string; // building spots: shown instead of `description` under the same `altFlag` condition
  altPicture?: string; // building spots: shown instead of `picture` once `altFlag` is set (e.g. the grateful innkeeper)
  altFlag?: string;
  locked?: boolean; // building spots: the door won't open…
  unlockFlag?: string; // …until this flag is set (a quest unlocks it)
  to?: string; // stairs spots: the location (locations.json id) on the other floor
  link?: string; // stairs spots: id (slug of the name) of the matching stairs spot over there
  facing?: Facing; // stairs spots: the way you face to walk onto them; you arrive on the square in front, facing away
  dir?: 'up' | 'down'; // stairs spots: which way they go (decides the picture)
}

const OPPOSITE: Record<Facing, Facing> = { n: 's', e: 'w', s: 'n', w: 'e' };

/** Where you stand after arriving by these stairs: the square in front of them, facing away. */
export function stairsArrival(spot: Spot): Pose {
  const f = spot.facing ?? 'n';
  const [dx, dy] = FACING_VECTORS[f];
  return { x: spot.x - dx, y: spot.y - dy, facing: OPPOSITE[f] };
}

export const isStairs = (m: LocationMap, x: number, y: number): boolean => spotAt(m, x, y)?.kind === 'stairs';

/** What an exit / stairs square is drawn as in the 3D view (placeholder shapes until the art lands). */
export type Feature = 'gate' | 'stairs-up' | 'stairs-down';

/** The picture id a building shows right now. */
export function spotPicture(spot: Spot, flags: Readonly<Record<string, unknown>>): string | undefined {
  return altActive(spot, flags) && spot.altPicture ? spot.altPicture : spot.picture;
}

/** The text a building shows right now (same condition as the picture). */
export function spotDescription(spot: Spot, flags: Readonly<Record<string, unknown>>): string {
  return altActive(spot, flags) && spot.altDescription ? spot.altDescription : spot.description;
}

function altActive(spot: Spot, flags: Readonly<Record<string, unknown>>): boolean {
  if (!spot.altFlag) return false;
  // altFlag = "flag" (set / truthy) or "flag=value" (e.g. "quest:rats=done", a quest stage)
  const [key, want] = spot.altFlag.split('=');
  const v = flags[key];
  return want === undefined ? !!v : v === want;
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
  storeys?: number[]; // row-major; storeys a solid square rises in the 3D view (tile property `height`, default 1)
  roof?: boolean[]; // row-major; a roof cap on top (tile property `roof`)
  prop?: (string | undefined)[]; // row-major; a billboard prop standing in the square (tile property `prop`: well, chest…) — draws no wall
  road?: boolean[]; // row-major; ground square is a road/path (drawn with path floor pieces in the 3D view)
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

/** Storeys a square rises in the 3D view (1 = one wall tile; off the map = 1). */
export function heightAt(m: LocationMap, x: number, y: number): number {
  return x < 0 || y < 0 || x >= m.width || y >= m.height ? 1 : (m.storeys?.[y * m.width + x] ?? 1);
}

export const roofAt = (m: LocationMap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < m.width && y < m.height && !!m.roof?.[y * m.width + x];

/** The prop standing on a square, if any (the square keeps its `blocked` setting; the 3D view draws the prop, not a wall). */
export const propAt = (m: LocationMap, x: number, y: number): string | undefined =>
  x < 0 || y < 0 || x >= m.width || y >= m.height ? undefined : m.prop?.[y * m.width + x];

/** Is this square a road? Off the map counts as road, so a road runs off the edge. */
export const roadAt = (m: LocationMap, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= m.width || y >= m.height ? true : !!m.road?.[y * m.width + x];

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
  height: number; // storeys (wall tiles) from floor to top
  roof?: boolean; // a roof cap above the top
  door?: 'open' | 'locked'; // the face is a building's door (drawn in the building's own material)
  feature?: Feature; // the face is a gate or a staircase
  variant: number; // stable per map square (same square = same texture variant from every angle)
}

/** A stable pseudo-random number for a map square (texture variety that never changes as you move). */
export function squareVariant(x: number, y: number): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
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
export function viewFaces(
  m: LocationMap,
  p: Pose,
  maxDepth = 4,
  locked: (x: number, y: number) => boolean = () => false,
  gates = false, // town exits are drawn as gates in the wall
): Face[] {
  const faces: Face[] = [];
  // doors look solid from outside (you see the door, not the inside); never the square you stand on
  const doorAt = (d: number, l: number) => {
    if (d === 0 && l === 0) return false;
    const c = cellFor(p, d, l);
    return isDoor(m, c.x, c.y) || !!featureAt(c.x, c.y);
  };
  // gates and staircases look solid from outside, like doors, but you can walk onto them
  const featureAt = (x: number, y: number): Feature | undefined => {
    const spot = spotAt(m, x, y);
    if (spot?.kind === 'stairs') return spot.dir === 'down' ? 'stairs-down' : 'stairs-up';
    return gates && isExit(m, x, y) ? 'gate' : undefined;
  };
  const solidAt = (d: number, l: number) => {
    const c = cellFor(p, d, l);
    return (isSolid(m, c.x, c.y) && !propAt(m, c.x, c.y)) || doorAt(d, l);
  };
  // a door is set into its building's wall: use the material of a solid neighbour
  const doorMaterial = (x: number, y: number) => {
    for (const [dx, dy] of Object.values(FACING_VECTORS)) if (isSolid(m, x + dx, y + dy)) return materialAt(m, x + dx, y + dy);
    return 'wall';
  };
  // …and rises as high as that neighbour (a door in a two-storey house)
  const doorNeighbour = (x: number, y: number): { x: number; y: number } | undefined => {
    for (const [dx, dy] of Object.values(FACING_VECTORS)) if (isSolid(m, x + dx, y + dy)) return { x: x + dx, y: y + dy };
    return undefined;
  };
  const heightHere = (d: number, l: number) => {
    const c = cellFor(p, d, l);
    if (isSolid(m, c.x, c.y)) return heightAt(m, c.x, c.y);
    const n = doorAt(d, l) ? doorNeighbour(c.x, c.y) : undefined;
    return n ? heightAt(m, n.x, n.y) : 1;
  };
  const roofHere = (d: number, l: number) => {
    const c = cellFor(p, d, l);
    if (isSolid(m, c.x, c.y)) return roofAt(m, c.x, c.y);
    const n = doorAt(d, l) ? doorNeighbour(c.x, c.y) : undefined;
    return n ? roofAt(m, n.x, n.y) : false;
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
      const feature = featureAt(c.x, c.y);
      const door = isDoorHere && !feature ? (locked(c.x, c.y) ? ('locked' as const) : ('open' as const)) : undefined;
      const variant = squareVariant(c.x, c.y);
      const height = heightHere(d, l);
      const roof = roofHere(d, l) || undefined;
      // a wall is hidden by a solid square in front of it only if that is at least as tall
      if (d >= 1 && (!solidAt(d - 1, l) || heightHere(d - 1, l) < height)) {
        faces.push({ kind: 'front', depth: d, lateral: l, X0: l - 0.5, X1: l + 0.5, z0: d - 0.5, z1: d - 0.5, material, height, roof, door, feature, variant });
      }
      if (l !== 0) {
        const inward = l < 0 ? l + 1 : l - 1;
        if (!solidAt(d, inward) || heightHere(d, inward) < height) {
          const X = l < 0 ? l + 0.5 : l - 0.5;
          faces.push({ kind: 'side', depth: d, lateral: l, X0: X, X1: X, z0: d - 0.5, z1: d + 0.5, material, height, roof, door, feature, variant });
        }
      }
    }
  }
  return faces;
}

export interface ViewProp {
  depth: number;
  lateral: number;
  prop: string;
}

/** Props in view, far → near (drawn as billboards after the walls of the same depth). */
export function viewProps(m: LocationMap, p: Pose, maxDepth = 4): ViewProp[] {
  const out: ViewProp[] = [];
  if (!m.prop) return out;
  for (let d = maxDepth; d >= 1; d--) {
    const reach = 2 * d + 2;
    for (let l = -reach; l <= reach; l++) {
      const c = cellFor(p, d, l);
      const prop = propAt(m, c.x, c.y);
      if (prop) out.push({ depth: d, lateral: l, prop });
    }
  }
  return out;
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
export const SIGHT = { town: 5, dungeon: 1, interior: 3 } as const;

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
