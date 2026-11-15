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
export function tryStep(m: LocationMap, p: Pose, d: StepDir): Pose | null {
  const [dx, dy] = FACING_VECTORS[stepFacing(p.facing, d)];
  const x = p.x + dx;
  const y = p.y + dy;
  return isSolid(m, x, y) ? null : { x, y, facing: p.facing };
}

export const spotAt = (m: LocationMap, x: number, y: number): Spot | undefined =>
  m.spots.find((s) => s.x === x && s.y === y);

export const isExit = (m: LocationMap, x: number, y: number): boolean => m.exits.some((e) => e.x === x && e.y === y);

/**
 * Shortest 4-way route (BFS) for click-to-walk on the overhead map, as the
 * absolute direction of each step. Ties prefer keeping the current heading, so
 * routes turn as rarely as possible. Null if unreachable.
 */
export function findPath4(m: LocationMap, from: Pose, to: { x: number; y: number }): Facing[] | null {
  if (isSolid(m, to.x, to.y)) return null;
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
        if (isSolid(m, x, y) || seen.has(k)) continue;
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
export function viewFaces(m: LocationMap, p: Pose, maxDepth = 4): Face[] {
  const faces: Face[] = [];
  const solidAt = (d: number, l: number) => {
    const c = cellFor(p, d, l);
    return isSolid(m, c.x, c.y);
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
      const material = materialAt(m, c.x, c.y);
      if (d >= 1 && !solidAt(d - 1, l)) {
        faces.push({ kind: 'front', depth: d, lateral: l, X0: l - 0.5, X1: l + 0.5, z0: d - 0.5, z1: d - 0.5, material });
      }
      if (l !== 0) {
        const inward = l < 0 ? l + 1 : l - 1;
        if (!solidAt(d, inward)) {
          const X = l < 0 ? l + 0.5 : l - 0.5;
          faces.push({ kind: 'side', depth: d, lateral: l, X0: X, X1: X, z0: d - 0.5, z1: d + 0.5, material });
        }
      }
    }
  }
  return faces;
}
