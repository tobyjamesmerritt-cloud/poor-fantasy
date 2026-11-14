#!/usr/bin/env node
/**
 * Generates the starter world map as a Tiled JSON file:
 *   public/assets/maps/world.json
 *
 * Forest with a river (autotiled shores), a lake, dirt roads, a bridge,
 * two towns, a cave in rocky hills and ruins. Deterministic (fixed seed).
 *
 * After you start editing world.json in Tiled, DO NOT rerun this script —
 * it would overwrite your edits. Usage: node tools/gen-world.mjs
 */
import { writeFileSync } from 'node:fs';

const W = 40;
const H = 30;
const SEED = 1987;

// --- tilesets (local tile ids) -------------------------------------------
const BATTLE = 1; // firstgid
const DUNGEON = 199; // firstgid (tiny-battle has 198 tiles)
const b = (id) => BATTLE + id;
const d = (id) => DUNGEON + id;

const GRASS = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2];
const TREES = [94, 94, 112];
const ROCK = 5;
const BRIDGE = 130;
const WATER = {
  tl: 18, t: 19, tr: 20,
  l: 36, c: 37, r: 38,
  bl: 54, bm: 55, br: 56,
  inTL: 90, inTR: 91, inBL: 92, inBR: 93, // water with a grass corner
};
const DIRT = 48;

// --- rng + value noise ------------------------------------------------------
let s = SEED >>> 0;
const rand = () => {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const lattice = Array.from({ length: 12 }, () => Array.from({ length: 12 }, rand));
const noise = (x, y) => {
  const fx = x / 5, fy = y / 5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const sx = fx - x0, sy = fy - y0;
  const v = (i, j) => lattice[(y0 + j) % 12][(x0 + i) % 12];
  const lerp = (a, c, t) => a + (c - a) * (t * t * (3 - 2 * t));
  return lerp(lerp(v(0, 0), v(1, 0), sx), lerp(v(0, 1), v(1, 1), sx), sy);
};

// --- layers ----------------------------------------------------------------
const grid = () => new Array(W * H).fill(0);
const ground = grid();
const decor = grid();
const structures = grid();
const at = (x, y) => y * W + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

// --- river + lake mask -----------------------------------------------------
const water = new Array(W * H).fill(false);
const riverX = (y) => Math.round(20 + 3 * Math.sin(y / 5) + 1.5 * Math.sin(y / 2.3));
for (let y = 0; y < H; y++) {
  const cx = riverX(y);
  for (let x = cx - 1; x <= cx + 1; x++) water[at(x, y)] = true;
}
// a lake in the north-west of the river
for (let y = 6; y <= 10; y++) for (let x = 13; x <= 19; x++) {
  const dx = (x - 16) / 3.6, dy = (y - 8) / 2.4;
  if (dx * dx + dy * dy <= 1) water[at(x, y)] = true;
}
// fill single-cell gaps so every water body is at least 2 thick (needed by the 9-slice tiles)
for (let pass = 0; pass < 2; pass++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const w = (xx, yy) => (yy < 0 || yy >= H ? water[at(x, Math.max(0, Math.min(H - 1, yy)))] : inMap(xx, yy) && water[at(xx, yy)]);
  if (!water[at(x, y)] && ((w(x - 1, y) && w(x + 1, y)) || (w(x, y - 1) && w(x, y + 1)))) water[at(x, y)] = true;
}

// water continues past the top/bottom edges (river enters and leaves the map)
const isWater = (x, y) => {
  if (y < 0) return water[at(x, 0)] ?? false;
  if (y >= H) return water[at(x, H - 1)] ?? false;
  return inMap(x, y) && water[at(x, y)];
};
const waterTile = (x, y) => {
  const N = isWater(x, y - 1), S = isWater(x, y + 1), E = isWater(x + 1, y), Wt = isWater(x - 1, y);
  if (!N && !Wt) return WATER.tl;
  if (!N && !E) return WATER.tr;
  if (!S && !Wt) return WATER.bl;
  if (!S && !E) return WATER.br;
  if (!N) return WATER.t;
  if (!S) return WATER.bm;
  if (!Wt) return WATER.l;
  if (!E) return WATER.r;
  if (!isWater(x - 1, y - 1)) return WATER.inTL;
  if (!isWater(x + 1, y - 1)) return WATER.inTR;
  if (!isWater(x - 1, y + 1)) return WATER.inBL;
  if (!isWater(x + 1, y + 1)) return WATER.inBR;
  return WATER.c;
};

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  ground[at(x, y)] = water[at(x, y)] ? b(waterTile(x, y)) : b(pick(GRASS));
}

// --- locations ---------------------------------------------------------------
const locations = [
  { id: 'millbrook', name: 'Millbrook', type: 'town', x: 7, y: 16, description: 'A walled market town on the western road. (To be designed.)' },
  { id: 'fenwick', name: 'Fenwick', type: 'town', x: 32, y: 12, description: 'A river-trade town east of the bridge. (To be designed.)' },
  { id: 'hollow-cave', name: 'Hollow Cave', type: 'cave', x: 33, y: 4, description: 'Rats and worse have been seen in the hills. (Test fight available.)' },
  { id: 'old-keep', name: 'Old Keep Ruins', type: 'ruins', x: 27, y: 25, description: 'Crumbling walls of a keep nobody remembers building. (To be designed.)' },
];
const start = { x: 11, y: 17 };

// --- roads (4-connected dirt paths) -----------------------------------------
const road = new Array(W * H).fill(false);
const bridgeCells = [];
function path(ax, ay, bx, by, horizontalFirst = true) {
  let x = ax, y = ay;
  const mark = () => {
    if (water[at(x, y)]) bridgeCells.push(at(x, y));
    else road[at(x, y)] = true;
  };
  mark();
  const stepX = () => { x += Math.sign(bx - x); mark(); };
  const stepY = () => { y += Math.sign(by - y); mark(); };
  if (horizontalFirst) { while (x !== bx) stepX(); while (y !== by) stepY(); }
  else { while (y !== by) stepY(); while (x !== bx) stepX(); }
}
path(8, 17, 26, 17); // west road to the junction, crossing the river (bridge)
path(26, 17, 32, 13, false); // junction to Fenwick gate
path(32, 13, 33, 5, false); // north to the cave
path(26, 17, 27, 24, false); // south to the ruins
for (let i = 0; i < W * H; i++) if (road[i]) ground[i] = d(DIRT);
for (const i of new Set(bridgeCells)) ground[i] = b(BRIDGE);

// --- structures -------------------------------------------------------------
const put = (layer, x, y, gid) => { if (inMap(x, y)) layer[at(x, y)] = gid; };
const clear = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inMap(x, y)) decor[at(x, y)] = 0; };
for (const L of locations) {
  if (L.type === 'town') {
    // dirt square with a stone wall and a gate (gate = the location's tile)
    for (let y = L.y - 2; y <= L.y; y++) for (let x = L.x - 2; x <= L.x + 2; x++) ground[at(x, y)] = d(DIRT);
    put(structures, L.x - 1, L.y, d(45));
    put(structures, L.x, L.y, d(46));
    put(structures, L.x + 1, L.y, d(47));
    put(structures, L.x - 1, L.y - 1, d(57));
    put(structures, L.x, L.y - 1, d(58));
    put(structures, L.x + 1, L.y - 1, d(59));
    clear(L.x, L.y - 1, 3);
  } else if (L.type === 'cave') {
    put(structures, L.x, L.y, d(9)); // dark arch
    for (const [dx, dy] of [[-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1], [-2, 0], [2, 0], [-2, -1], [2, -1], [0, -2], [-1, -2], [1, -2]]) put(decor, L.x + dx, L.y + dy, b(ROCK));
  } else if (L.type === 'ruins') {
    for (let y = L.y - 1; y <= L.y + 1; y++) for (let x = L.x - 2; x <= L.x + 2; x++) ground[at(x, y)] = d(DIRT);
    put(structures, L.x, L.y, d(28)); // gate with portcullis
    put(structures, L.x - 2, L.y, d(58));
    put(structures, L.x + 2, L.y - 1, d(57));
    put(structures, L.x - 1, L.y - 1, d(64)); // gravestone
    put(structures, L.x + 1, L.y + 1, d(41));
    clear(L.x, L.y, 3);
  }
}

// --- forest + hills ---------------------------------------------------------
const nearAny = (x, y, pts, r) => pts.some((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= r);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = at(x, y);
  if (water[i] || road[i] || ground[i] === d(DIRT) || structures[i] || decor[i]) continue;
  if (nearAny(x, y, [start], 1)) continue;
  const n = noise(x + 3, y + 7);
  if (n > 0.27 && rand() < 0.9) decor[i] = b(pick(TREES));
  else if (x > 28 && y < 9 && rand() < 0.25) decor[i] = b(ROCK); // hills near the cave
}
// keep a 1-tile clearing along roads so they read clearly
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (road[at(x, y)]) {
  for (const [dx, dy] of [[0, 0]]) if (inMap(x + dx, y + dy)) decor[at(x + dx, y + dy)] = 0;
}

// --- Tiled JSON ---------------------------------------------------------------
const blocked = (ids) => ids.map((id) => ({ id, properties: [{ name: 'blocked', type: 'bool', value: true }] }));
const layer = (id, name, data) => ({ id, name, type: 'tilelayer', width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data });
let objId = 1;
const objects = [
  ...locations.map((L) => ({
    id: objId++, name: L.name, type: L.type, x: L.x * 16, y: L.y * 16, width: 16, height: 16, rotation: 0, visible: true,
    properties: [
      { name: 'locationId', type: 'string', value: L.id },
      { name: 'description', type: 'string', value: L.description },
    ],
  })),
  { id: objId++, name: 'Party start', type: 'start', x: start.x * 16, y: start.y * 16, width: 16, height: 16, rotation: 0, visible: true },
];

const map = {
  compressionlevel: -1, infinite: false, orientation: 'orthogonal', renderorder: 'right-down',
  tiledversion: '1.11.0', type: 'map', version: '1.10',
  width: W, height: H, tilewidth: 16, tileheight: 16,
  nextlayerid: 5, nextobjectid: objId,
  layers: [
    layer(1, 'ground', ground),
    layer(2, 'decor', decor),
    layer(3, 'structures', structures),
    { id: 4, name: 'locations', type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0, objects },
  ],
  tilesets: [
    {
      firstgid: BATTLE, name: 'tiny-battle', image: '../tiles/tiny-battle.png', imagewidth: 288, imageheight: 176,
      tilewidth: 16, tileheight: 16, columns: 18, tilecount: 198, margin: 0, spacing: 0,
      tiles: blocked([18, 19, 20, 36, 37, 38, 54, 55, 56, 90, 91, 92, 93, ROCK]),
    },
    {
      firstgid: DUNGEON, name: 'tiny-dungeon', image: '../tiles/tiny-dungeon.png', imagewidth: 192, imageheight: 176,
      tilewidth: 16, tileheight: 16, columns: 12, tilecount: 132, margin: 0, spacing: 0,
      tiles: blocked([45, 47, 57, 58, 59, 64, 41]),
    },
  ],
};

writeFileSync(new URL('../public/assets/maps/world.json', import.meta.url), JSON.stringify(map));
console.log(`Wrote public/assets/maps/world.json (${W}x${H}, ${locations.length} locations)`);
