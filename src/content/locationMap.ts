/**
 * Converts a location's Tiled JSON map (public/assets/maps/<id>.json) into a
 * LocationMap for the rules.
 * - Solid squares: any tile with the tileset property `blocked: true`.
 * - What a solid square looks like in the first-person view: tileset property
 *   `material` (stone, rock, tree, wood, …); topmost layer wins.
 * - `spots` object layer:
 *     entrance  (one; property `facing` n|e|s|w)
 *     exit      (one or more; stepping on it leaves to the world map)
 *     fight     (property `encounter` = id in content/encounters; cleared once won)
 *     building  (property `building` = inn|shop|temple|hall|house; it's the door square:
 *                drawn as a door in the 3D view; bool `locked` keeps it shut until the
 *                flag in `unlockFlag` is set)
 *     text      (a message shown when you step there)
 *     stairs    (to the other floor: `to` = location id, `link` = name of the matching stairs spot there,
 *                `facing` n|e|s|w = the way you face to walk onto them, `dir` up|down; drawn as a
 *                staircase in the 3D view; you arrive on the square in front of the linked stairs)
 *   Object name = display name; `description` property = text shown.
 */
import { FACING_VECTORS, type Facing, type LocationMap, type Spot, type SpotKind } from '../rules/location';
import { objectLayer, objProp, objTile, squareProps, type TiledMap } from './world';

const SPOT_KINDS: readonly string[] = ['fight', 'building', 'text', 'stairs'];
const FACINGS: readonly string[] = ['n', 'e', 's', 'w'];
const BUILDINGS: readonly string[] = ['inn', 'shop', 'temple', 'hall', 'house'];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function loadLocationMap(id: string, t: TiledMap, knownEncounters: readonly string[]): LocationMap {
  const errors: string[] = [];
  const { blocked, props } = squareProps(t, errors);
  const material = props.map((p) => (typeof p.material === 'string' ? p.material : ''));
  // taller buildings: tile property `height` (storeys 0.25-4; 0.5 = a low wall) and `roof` (bool) — visual only
  const storeys = props.map((p, i) => {
    if (p.height === undefined) return 1;
    const h = Number(p.height);
    const ok = Number.isFinite(h) && h >= 0.25 && h <= 4 && Number.isInteger(h * 4); // quarter steps: 0.5 = a low wall
    if (!ok) errors.push(`square ${i % t.width},${Math.floor(i / t.width)}: height must be from 0.25 to 4 in quarter steps`);
    return ok ? h : 1;
  });
  // props: tile property `prop` (an id like well or chest) — a billboard in the square instead of a wall
  const prop = props.map((p, i) => {
    if (p.prop === undefined) return undefined;
    if (typeof p.prop !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.prop)) errors.push(`square ${i % t.width},${Math.floor(i / t.width)}: prop must be a lowercase id`);
    return typeof p.prop === 'string' ? p.prop : undefined;
  });
  const roof = props.map((p) => p.roof === true);
  // roads: ground squares showing the road tile (tiny-dungeon local id 48 — the one terrain.json calls road)
  const roadGid = (t.tilesets.find((ts) => ts.name === 'tiny-dungeon')?.firstgid ?? -1) + 48;
  const ground = t.layers.find((l) => l.name === 'ground' && l.type === 'tilelayer');
  const road = Array.from({ length: t.width * t.height }, (_, i) => ((ground?.data?.[i] ?? 0) & 0x1fffffff) === roadGid);

  let entrance: LocationMap['entrance'] | undefined;
  const exits: LocationMap['exits'] = [];
  const spots: Spot[] = [];
  for (const o of objectLayer(t, 'spots')) {
    const kind = o.type ?? o.class ?? '';
    const at = objTile(t, o);
    const where = `object "${o.name}" at (${at.x},${at.y})`;
    if (at.x < 0 || at.y < 0 || at.x >= t.width || at.y >= t.height) errors.push(`${where} is off the map`);
    else if (blocked[at.y * t.width + at.x]) errors.push(`${where} is on a blocked square`);
    if (kind === 'entrance') {
      const facing = String(objProp(o, 'facing') ?? 'n');
      if (!FACINGS.includes(facing)) errors.push(`${where}: facing must be n, e, s or w`);
      if (entrance) errors.push('more than one entrance');
      entrance = { ...at, facing: facing as Facing };
    } else if (kind === 'exit') {
      exits.push(at);
    } else if (SPOT_KINDS.includes(kind)) {
      const spot: Spot = {
        id: slug(o.name),
        kind: kind as SpotKind,
        name: o.name,
        ...at,
        description: String(objProp(o, 'description') ?? ''),
      };
      if (kind === 'fight') {
        spot.encounter = String(objProp(o, 'encounter') ?? '');
        if (!knownEncounters.includes(spot.encounter)) errors.push(`${where}: unknown encounter "${spot.encounter}"`);
      }
      if (kind === 'building') {
        spot.building = String(objProp(o, 'building') ?? '');
        if (!BUILDINGS.includes(spot.building)) errors.push(`${where}: building must be one of ${BUILDINGS.join(', ')}`);
        const picture = objProp(o, 'picture');
        if (picture !== undefined) {
          spot.picture = String(picture);
          if (!/^[a-z0-9-]+$/.test(spot.picture)) errors.push(`${where}: picture id must be lower-case letters, digits and dashes`);
        }
        const alt = objProp(o, 'altPicture');
        const altFlag = objProp(o, 'altFlag');
        if ((alt === undefined) !== (altFlag === undefined)) errors.push(`${where}: altPicture and altFlag go together`);
        if (alt !== undefined && altFlag !== undefined) (spot.altPicture = String(alt)), (spot.altFlag = String(altFlag));
        if (objProp(o, 'locked') === true) spot.locked = true;
        const unlock = objProp(o, 'unlockFlag');
        if (unlock !== undefined) spot.unlockFlag = String(unlock);
      }
      if (kind === 'stairs') {
        spot.to = String(objProp(o, 'to') ?? '');
        spot.link = slug(String(objProp(o, 'link') ?? ''));
        const facing = String(objProp(o, 'facing') ?? '');
        const dir = String(objProp(o, 'dir') ?? 'up');
        if (!spot.to) errors.push(`${where}: stairs need a "to" location`);
        if (!spot.link) errors.push(`${where}: stairs need a "link" (name of the stairs spot on the other floor)`);
        if (!FACINGS.includes(facing)) errors.push(`${where}: stairs need a facing n, e, s or w`);
        if (dir !== 'up' && dir !== 'down') errors.push(`${where}: dir must be up or down`);
        spot.facing = facing as Facing;
        spot.dir = dir === 'down' ? 'down' : 'up';
        const [fx, fy] = FACING_VECTORS[spot.facing];
        const front = { x: at.x - fx, y: at.y - fy };
        if (front.x < 0 || front.y < 0 || front.x >= t.width || front.y >= t.height || blocked[front.y * t.width + front.x])
          errors.push(`${where}: the square in front of the stairs (where you arrive) must be open`);
      }
      if (!spot.id) errors.push(`${where}: needs a name`);
      if (spots.some((s) => s.id === spot.id)) errors.push(`${where}: duplicate spot name`);
      spots.push(spot);
    } else {
      errors.push(`${where} has unknown type "${kind}"`);
    }
  }
  if (!entrance) errors.push('no "entrance" object in the spots layer');
  if (!exits.length && !spots.some((s) => s.kind === 'stairs')) errors.push('no "exit" (or stairs) object in the spots layer');

  if (errors.length) throw new Error(`Invalid location map "${id}":\n- ` + errors.join('\n- '));
  return { id, width: t.width, height: t.height, solid: blocked, material, storeys, roof, prop: prop.some(Boolean) ? prop : undefined, road, entrance: entrance!, exits, spots };
}

/**
 * Cross-map check (run in tests over every map): each stairs spot must point at an existing location
 * whose map has the linked stairs spot, and that spot must point back here, one up and one down.
 * `mapOf` = location id -> its LocationMap.
 */
export function checkStairs(mapOf: Readonly<Record<string, LocationMap>>): string[] {
  const errors: string[] = [];
  for (const [id, m] of Object.entries(mapOf)) {
    for (const s of m.spots.filter((x) => x.kind === 'stairs')) {
      const there = mapOf[s.to!];
      if (!there) {
        errors.push(`${id}: stairs "${s.name}" lead to unknown location "${s.to}"`);
        continue;
      }
      const back = there.spots.find((x) => x.kind === 'stairs' && x.id === s.link);
      if (!back) errors.push(`${id}: stairs "${s.name}" link to "${s.link}" in ${s.to}, which has no such stairs`);
      else {
        if (back.to !== id) errors.push(`${id}: stairs "${s.name}" link to "${back.name}" in ${s.to}, which leads to "${back.to}", not back here`);
        if (back.link !== s.id) errors.push(`${id}: stairs "${s.name}" and "${back.name}" in ${s.to} do not link to each other`);
        if (back.dir === s.dir) errors.push(`${id}: stairs "${s.name}" and "${back.name}" both go ${s.dir}; one must go up and the other down`);
      }
    }
  }
  return errors;
}
