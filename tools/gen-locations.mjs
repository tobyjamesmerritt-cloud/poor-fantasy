#!/usr/bin/env node
/**
 * Generates the four starter location maps as Tiled JSON files:
 *   public/assets/maps/<locationId>.json
 *
 * Each map is 16×16 squares (the Gold Box area size). Layers:
 *   ground      floor everywhere
 *   structures  walls, trees, doors (tileset properties blocked/material)
 *   spots       entrance, exits, fights, buildings, text messages
 *
 * Once you edit a map in Tiled, DO NOT rerun this script for that map — it
 * would overwrite your edits. Usage:
 *   node tools/gen-locations.mjs                 (refuses to overwrite)
 *   node tools/gen-locations.mjs --force <id>    (regenerate one map)
 */
import { existsSync, writeFileSync } from 'node:fs';

const BATTLE = 1;
const DUNGEON = 199;
const b = (id) => BATTLE + id;
const d = (id) => DUNGEON + id;

// Tile properties used by location maps (blocked + what the 3D view draws).
const DUNGEON_PROPS = {
  0: { blocked: true, material: 'rock' },
  12: { blocked: true, material: 'rock' },
  24: { blocked: true, material: 'rock' },
  31: { blocked: true, material: 'stone' },
  40: { blocked: true, material: 'stone' },
  57: { blocked: true, material: 'stone' },
  58: { blocked: true, material: 'stone' },
  59: { blocked: true, material: 'stone' },
};
const BATTLE_PROPS = {
  94: { blocked: true, material: 'tree' },
  112: { blocked: true, material: 'tree' },
};

const tileset = (firstgid, name, image, w, cols, count, props) => ({
  firstgid,
  name,
  image,
  imagewidth: w,
  imageheight: 176,
  tilewidth: 16,
  tileheight: 16,
  columns: cols,
  tilecount: count,
  margin: 0,
  spacing: 0,
  tiles: Object.entries(props).map(([id, p]) => ({
    id: Number(id),
    properties: Object.entries(p).map(([name, value]) => ({ name, type: typeof value === 'boolean' ? 'bool' : 'string', value })),
  })),
});
const TILESETS = [
  tileset(BATTLE, 'tiny-battle', '../tiles/tiny-battle.png', 288, 18, 198, BATTLE_PROPS),
  tileset(DUNGEON, 'tiny-dungeon', '../tiles/tiny-dungeon.png', 192, 12, 132, DUNGEON_PROPS),
];

let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 4294967296;
};
const pick = (a) => a[Math.floor(rand() * a.length)];

/**
 * Legend: '#' wall  '.' floor  '=' road  'T' tree  'W' well  '@' entrance
 * 'X' exit  lower-case letter = a spot (defined in `spots`).
 */
const LOCATIONS = {
  'hollow-cave': {
    style: 'cave',
    facing: 'n',
    rows: [
      '################',
      '###.....########',
      '###.###..#######',
      '##..###.a.######',
      '##.####...######',
      '##.#####.#######',
      '##...t...#....##',
      '####.###.#.##.##',
      '####.###...##.##',
      '###..#######..##',
      '###.##...####.##',
      '###.##.#.####.##',
      '###....#......##',
      '#####.##########',
      '#####@##########',
      '#####X##########',
    ],
    spots: {
      a: { type: 'fight', name: 'Rat Nest', encounter: 'cave-rats', description: 'Red eyes glint in the dark. Rats — big ones!' },
      t: { type: 'text', name: 'Old Campfire', description: 'A cold campfire ringed with gnawed bones. Something has been feeding here.' },
    },
  },
  'old-keep': {
    style: 'ruins',
    facing: 'n',
    rows: [
      '################',
      '#....#....#....#',
      '#.##.#.##.#.##.#',
      '#.#....#.....#.#',
      '#.#.######.#.#.#',
      '#...#....#.#...#',
      '###.#.a..#.###.#',
      '#...#....#...#.#',
      '#.####.###.#.#.#',
      '#......#...#...#',
      '#.####.#.#####.#',
      '#.#t.....#.....#',
      '#.#.####.#.###.#',
      '#...#......#...#',
      '#######@########',
      '#######X########',
    ],
    spots: {
      a: { type: 'fight', name: 'Great Hall', encounter: 'ruins-crawlers', description: 'Thick webs hang between the broken pillars. Something skitters closer…' },
      t: { type: 'text', name: 'Collapsed Chapel', description: 'Rubble buries an old altar. A faded sun is carved above it.' },
    },
  },
  millbrook: {
    style: 'town',
    facing: 'e',
    rows: [
      'TTTTTTTTTTTTTTTT',
      'T..............T',
      'T.####...####..T',
      'T.####...####..T',
      'T.#i##...##s#..T',
      'T..............T',
      'T.......W.u....T',
      'X@=============X',
      'T..............T',
      'T.#h##...##o#..T',
      'T.####...####..T',
      'T.####...####..T',
      'T..............T',
      'T..TT......TT..T',
      'T..............T',
      'TTTTTTTTTTTTTTTT',
    ],
    spots: {
      i: { type: 'building', building: 'inn', name: 'The Leaky Bucket', description: 'A low, smoky common room. The innkeeper polishes the same mug over and over.' },
      s: { type: 'building', building: 'shop', name: 'Millbrook Provisions', description: 'Rope, lamp oil, dried meat and a dusty rack of spears.' },
      h: { type: 'building', building: 'temple', name: 'Shrine of the Dawn', description: 'Candles burn before a carved sun. A priest nods as you enter.' },
      o: { type: 'building', building: 'hall', name: "Reeve's Hall", description: 'The town reeve looks up from a pile of complaints about rats.' },
      u: { type: 'text', name: 'Market Square', description: 'Farmers haggle over turnips and mutter about rats in the hills.' },
    },
  },
  fenwick: {
    style: 'town',
    facing: 's',
    rows: [
      'TTTTTTTXTTTTTTTT',
      'T......@.......T',
      'T.####.=.####..T',
      'T.####.=.####..T',
      'T.###i.=.s###..T',
      'T......=.......T',
      'TT.....=.....TTT',
      'T......=..u....T',
      'T.####.=.####..T',
      'T.###h.=.o###..T',
      'T.####.=.####..T',
      'T......=.......T',
      'T..TT..=..TT...T',
      'T......=.......T',
      'T......=.......T',
      'TTTTTTTXTTTTTTTT',
    ],
    spots: {
      i: { type: 'building', building: 'inn', name: 'The Drowned Rat', description: 'Fishermen drink in silence. A bard tunes a lute with one string missing.' },
      s: { type: 'building', building: 'shop', name: 'Fenwick Smithy', description: 'The smith hammers a horseshoe and ignores you for now.' },
      h: { type: 'building', building: 'temple', name: 'Chapel of Tides', description: 'Shells and driftwood decorate a simple altar.' },
      o: { type: 'building', building: 'house', name: "Old Mira's House", description: 'An old woman peers through the door. "The keep was cursed long before the spiders came."' },
      u: { type: 'text', name: 'Village Green', description: 'Children dare each other to visit the old keep.' },
    },
  },
};

const STYLE = {
  cave: { floor: () => pick([d(48), d(48), d(48), d(49), d(50)]), wall: () => pick([d(0), d(0), d(12), d(24)]), exit: d(21) },
  ruins: { floor: () => pick([d(42), d(48), d(48), d(49)]), wall: () => pick([d(40), d(40), d(57), d(58), d(59)]), exit: d(21) },
  town: { floor: () => pick([b(0), b(0), b(0), b(1), b(2)]), wall: () => d(40), exit: d(48) },
};

function build(id, loc) {
  const H = loc.rows.length;
  const W = loc.rows[0].length;
  const st = STYLE[loc.style];
  const ground = [];
  const structures = [];
  const objects = [];
  let entrance;
  const obj = (name, type, x, y, props = {}) =>
    objects.push({
      id: objects.length + 1,
      name,
      type,
      x: x * 16,
      y: y * 16,
      width: 16,
      height: 16,
      rotation: 0,
      visible: true,
      properties: Object.entries(props).map(([n, v]) => ({ name: n, type: 'string', value: v })),
    });

  loc.rows.forEach((row, y) => {
    if (row.length !== W) throw new Error(`${id} row ${y} has ${row.length} chars, expected ${W}`);
    [...row].forEach((c, x) => {
      let g = st.floor();
      let s = 0;
      if (c === '#') s = st.wall();
      else if (c === 'T') s = pick([b(94), b(112)]);
      else if (c === 'W') s = d(31);
      else if (c === '=') g = d(48);
      else if (c === 'X') {
        g = st.exit;
        obj('Exit', 'exit', x, y);
      } else if (c === '@') {
        if (loc.style === 'town') g = d(48);
        entrance = { x, y };
        obj('Entrance', 'entrance', x, y, { facing: loc.facing });
      } else if (/[a-z]/.test(c)) {
        const sp = loc.spots[c];
        if (!sp) throw new Error(`${id}: no spot defined for "${c}"`);
        const { type, name, ...props } = sp;
        if (type === 'building') s = d(46); // door
        obj(name, type, x, y, props);
      } else if (c !== '.') throw new Error(`${id}: unknown map character "${c}"`);
      ground.push(g);
      structures.push(s);
    });
  });

  // Every open square must be reachable from the entrance.
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !'#TW'.includes(loc.rows[y][x]);
  const seen = new Set([`${entrance.x},${entrance.y}`]);
  const queue = [entrance];
  while (queue.length) {
    const p = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (open(n.x, n.y) && !seen.has(`${n.x},${n.y}`)) {
        seen.add(`${n.x},${n.y}`);
        queue.push(n);
      }
    }
  }
  loc.rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (open(x, y) && !seen.has(`${x},${y}`)) throw new Error(`${id}: (${x},${y}) "${c}" is unreachable from the entrance`);
    }),
  );

  const layer = (lid, name, data) => ({ id: lid, name, type: 'tilelayer', width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, data });
  return {
    compressionlevel: -1,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.0',
    type: 'map',
    version: '1.10',
    width: W,
    height: H,
    tilewidth: 16,
    tileheight: 16,
    nextlayerid: 4,
    nextobjectid: objects.length + 1,
    tilesets: TILESETS,
    layers: [
      layer(1, 'ground', ground),
      layer(2, 'structures', structures),
      { id: 3, name: 'spots', type: 'objectgroup', draworder: 'topdown', opacity: 1, visible: true, x: 0, y: 0, objects },
    ],
  };
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
for (const [id, loc] of Object.entries(LOCATIONS)) {
  if (only.length && !only.includes(id)) continue;
  const file = `public/assets/maps/${id}.json`;
  if (existsSync(file) && !force) {
    console.log(`skip ${file} (exists; use --force ${id} to overwrite)`);
    continue;
  }
  writeFileSync(file, JSON.stringify(build(id, loc)) + '\n');
  console.log(`wrote ${file}`);
}
