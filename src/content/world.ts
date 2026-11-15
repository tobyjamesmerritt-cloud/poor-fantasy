/**
 * Converts a Tiled JSON map into a TravelMap for the rules.
 * - A square is blocked if any tile on it has the Tiled tile property `blocked: true`
 *   (set per tile in the tileset, so painting water in Tiled stays impassable).
 * - Locations come from the `locations` object layer (type = town | cave | ruins,
 *   custom properties `locationId` and `description`); `start` marks the party start.
 */
import type { LocationKind, MapLocation, TravelMap } from '../rules/world';
import terrainRaw from './terrain.json';

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
export interface TiledObject {
  name: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  properties?: TiledProperty[];
}
interface TiledLayer {
  name: string;
  type: 'tilelayer' | 'objectgroup' | string;
  data?: number[];
  objects?: TiledObject[];
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

/**
 * Per-square tile properties merged over all tile layers (bottom → top, so an
 * upper layer's value wins). `blocked` is true if any layer's tile is blocked.
 */
export function squareProps(t: TiledMap, errors: string[]): { blocked: boolean[]; props: Record<string, unknown>[] } {
  const byGid = new Map<number, Record<string, unknown>>();
  for (const ts of t.tilesets) {
    for (const tile of ts.tiles ?? []) {
      byGid.set(ts.firstgid + tile.id, Object.fromEntries((tile.properties ?? []).map((p) => [p.name, p.value])));
    }
  }
  const n = t.width * t.height;
  const blocked = new Array<boolean>(n).fill(false);
  const props = Array.from({ length: n }, () => ({}) as Record<string, unknown>);
  for (const layer of t.layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;
    if (layer.data.length !== n) errors.push(`layer "${layer.name}" has ${layer.data.length} tiles, expected ${n}`);
    layer.data.forEach((raw, i) => {
      const p = byGid.get(raw & GID_MASK);
      if (!p) return;
      if (p.blocked === true) blocked[i] = true;
      Object.assign(props[i], p);
    });
  }
  return { blocked, props };
}

export const objectLayer = (t: TiledMap, name: string): TiledObject[] =>
  t.layers.find((l) => l.type === 'objectgroup' && l.name === name)?.objects ?? [];
export const objProp = (o: TiledObject, name: string): unknown => o.properties?.find((p) => p.name === name)?.value;
export const objTile = (t: TiledMap, o: { x: number; y: number }) => ({
  x: Math.floor(o.x / t.tilewidth),
  y: Math.floor(o.y / t.tileheight),
});

/** Per-square terrain kind from terrain.json (topmost layer that has one wins). */
function terrainOf(t: TiledMap): string[] {
  const table = terrainRaw as unknown as Record<string, Record<string, string>>;
  const byGid = new Map<number, string>();
  for (const ts of t.tilesets) {
    for (const [id, kind] of Object.entries(table[ts.name] ?? {})) byGid.set(ts.firstgid + Number(id), kind);
  }
  const terrain = new Array<string>(t.width * t.height).fill('');
  for (const layer of t.layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;
    layer.data.forEach((raw, i) => {
      const k = byGid.get(raw & GID_MASK);
      if (k) terrain[i] = k;
    });
  }
  return terrain;
}

export function loadTravelMap(t: TiledMap): TravelMap {
  const errors: string[] = [];
  const { blocked } = squareProps(t, errors);
  const terrain = terrainOf(t);
  const objects = objectLayer(t, 'locations');
  const prop = objProp;
  const toTile = (o: TiledObject) => objTile(t, o);

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
  return { width: t.width, height: t.height, blocked, locations, start: start!, terrain };
}
