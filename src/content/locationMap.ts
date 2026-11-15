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
 *     building  (property `building` = inn|shop|temple|hall|house)
 *     text      (a message shown when you step there)
 *   Object name = display name; `description` property = text shown.
 */
import type { Facing, LocationMap, Spot, SpotKind } from '../rules/location';
import { objectLayer, objProp, objTile, squareProps, type TiledMap } from './world';

const SPOT_KINDS: readonly string[] = ['fight', 'building', 'text'];
const FACINGS: readonly string[] = ['n', 'e', 's', 'w'];
const BUILDINGS: readonly string[] = ['inn', 'shop', 'temple', 'hall', 'house'];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function loadLocationMap(id: string, t: TiledMap, knownEncounters: readonly string[]): LocationMap {
  const errors: string[] = [];
  const { blocked, props } = squareProps(t, errors);
  const material = props.map((p) => (typeof p.material === 'string' ? p.material : ''));

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
      }
      if (!spot.id) errors.push(`${where}: needs a name`);
      if (spots.some((s) => s.id === spot.id)) errors.push(`${where}: duplicate spot name`);
      spots.push(spot);
    } else {
      errors.push(`${where} has unknown type "${kind}"`);
    }
  }
  if (!entrance) errors.push('no "entrance" object in the spots layer');
  if (!exits.length) errors.push('no "exit" object in the spots layer');

  if (errors.length) throw new Error(`Invalid location map "${id}":\n- ` + errors.join('\n- '));
  return { id, width: t.width, height: t.height, solid: blocked, material, entrance: entrance!, exits, spots };
}
