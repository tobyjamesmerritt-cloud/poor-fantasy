import Phaser from 'phaser';
import { pathFrame } from '../rules/pathTiles';

/** Tiled tileset name + local tile id that mean "road" (the same tile src/content/terrain.json calls road). */
const ROAD_TILESET = 'tiny-dungeon';
const ROAD_TILE = 48;
export const PATH_SHEET = 'map-path';

/**
 * Redraws every road square of the `ground` layer with the auto-tiled path art, in the same place and scale as the
 * tilemap layers. Squares off the map edge count as road (a road runs off the edge instead of ending in a cap).
 * Call right after creating the ground layer so structures and decor draw on top.
 */
export function drawRoads(scene: Phaser.Scene, tm: Phaser.Tilemaps.Tilemap, layer: string, scale: number, ox: number, oy: number, depth?: number): void {
  const set = tm.tilesets.find((t) => t.name === ROAD_TILESET);
  const l = tm.getLayer(layer);
  if (!set || !l || !scene.textures.exists(PATH_SHEET)) return;
  const road = set.firstgid + ROAD_TILE;
  const at = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= tm.width || y >= tm.height) return true;
    return tm.getTileAt(x, y, true, layer)?.index === road;
  };
  const size = tm.tileWidth * scale;
  for (let y = 0; y < tm.height; y++) {
    for (let x = 0; x < tm.width; x++) {
      if (!at(x, y)) continue;
      const img = scene.add.image(ox + x * size, oy + y * size, PATH_SHEET, pathFrame(at(x, y - 1), at(x + 1, y), at(x, y + 1), at(x - 1, y)));
      img.setOrigin(0, 0).setScale(scale);
      if (depth !== undefined) img.setDepth(depth);
    }
  }
}
