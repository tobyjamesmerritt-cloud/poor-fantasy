/**
 * Converts a Tiled JSON map into a TravelMap for the rules.
 * - A square is blocked if any tile on it has the Tiled tile property `blocked: true`
 *   (set per tile in the tileset, so painting water in Tiled stays impassable).
 * - Locations come from the `locations` object layer (type = town | cave | ruins,
 *   custom properties `locationId` and `description`); `start` marks the party start.
 */
import type { LocationKind, MapLocation, TravelMap } from '../rules/world';

interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}
interface TiledTileset {
  firstgid: number;
  name: string;
  tilecount: number;
  tiles?: { id: number; properties?: TiledProperty[] }[];
}
interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup' | string;
  data?: number[];
  objects?: { name: string; type?: string; class?: string; x: number; y: number; properties?: TiledProperty[] }[];
}
export interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

const KINDS: readonly string[] = ['town', 'cave', 'ruins'];
const GID_MASK = 0x1fffffff; // strip Tiled's flip/rotate flag bits

export function loadTravelMap(t: TiledMap): TravelMap {
  const errors: string[] = [];
  const blockedGids = new Set<number>();
  for (const ts of t.tilesets) {
    for (const tile of ts.tiles ?? []) {
      if (tile.properties?.some((p) => p.name === 'blocked' && p.value === true)) blockedGids.add(ts.firstgid + tile.id);
    }
  }

  const n = t.width * t.height;
  const blocked = new Array<boolean>(n).fill(false);
  for (const layer of t.layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;
    if (layer.data.length !== n) errors.push(`layer "${layer.name}" has ${layer.data.length} tiles, expected ${n}`);
    layer.data.forEach((raw, i) => {
      if (blockedGids.has(raw & GID_MASK)) blocked[i] = true;
    });
  }

  const objects = t.layers.find((l) => l.type === 'objectgroup' && l.name === 'locations')?.objects ?? [];
  const prop = (o: (typeof objects)[number], name: string) => o.properties?.find((p) => p.name === name)?.value;
  const toTile = (o: { x: number; y: number }) => ({ x: Math.floor(o.x / t.tilewidth), y: Math.floor(o.y / t.tileheight) });

  const locations: MapLocation[] = [];
  let start: { x: number; y: number } | undefined;
  for (const o of objects) {
    const kind = o.type ?? o.class ?? '';
    if (kind === 'start') {
      start = toTile(o);
      continue;
    }
    if (!KINDS.includes(kind)) {
      errors.push(`object "${o.name}" has unknown type "${kind}"`);
      continue;
    }
    const id = String(prop(o, 'locationId') ?? '');
    if (!id) errors.push(`location "${o.name}" is missing the locationId property`);
    locations.push({ id, name: o.name, kind: kind as LocationKind, description: String(prop(o, 'description') ?? ''), ...toTile(o) });
  }
  if (!start) errors.push('no "start" object in the locations layer');
  const ids = locations.map((l) => l.id);
  if (new Set(ids).size !== ids.length) errors.push('duplicate locationId');

  if (errors.length) throw new Error('Invalid map:\n- ' + errors.join('\n- '));
  return { width: t.width, height: t.height, blocked, locations, start: start! };
}
