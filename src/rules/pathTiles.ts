/**
 * Auto-tiling for roads on the overhead maps (art: map-path-16 sheet, 16 frames of 16 px).
 * Frame 0 is plain grass; frames 1–15 are path pieces chosen by which of the four neighbours are also road.
 * Pure: the scene supplies `isRoad` for the neighbours.
 */
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** connection bits → frame in the sheet (as the art department laid it out). */
const FRAME_BY_MASK: Record<number, number> = {
  [N | S]: 1,
  [E | W]: 2,
  [N | E]: 3,
  [E | S]: 4,
  [S | W]: 5,
  [N | W]: 6,
  [N | E | W]: 7, // T, open to the south side closed
  [N | E | S]: 8,
  [E | S | W]: 9,
  [N | S | W]: 10,
  [N | E | S | W]: 11, // crossing
  [N]: 12, // dead ends
  [E]: 13,
  [S]: 14,
  [W]: 15,
};

/** Sheet frame for a road square, given whether its N/E/S/W neighbours are road. A lone square reads as a short horizontal piece. */
export function pathFrame(n: boolean, e: boolean, s: boolean, w: boolean): number {
  const mask = (n ? N : 0) | (e ? E : 0) | (s ? S : 0) | (w ? W : 0);
  return FRAME_BY_MASK[mask] ?? FRAME_BY_MASK[E | W];
}

// --- 3D floor pieces (art: floor-path-straight / corner / t / cross / end) -------------------------------------------

export type FloorPiece = 'straight' | 'corner' | 't' | 'cross' | 'end';
/** The art's base orientation of each piece, as connection bits. */
const BASE: Record<FloorPiece, number> = { straight: N | S, corner: N | E, t: N | E | S, cross: N | E | S | W, end: N };
const turnMask = (m: number, k: number): number => {
  for (let i = 0; i < k; i++) m = ((m << 1) | (m >> 3)) & 15;
  return m;
};

/** Which floor piece, turned how many quarter-turns clockwise, joins a road square to its road neighbours. */
export function floorPiece(n: boolean, e: boolean, s: boolean, w: boolean): { piece: FloorPiece; turns: number } {
  const mask = (n ? N : 0) | (e ? E : 0) | (s ? S : 0) | (w ? W : 0);
  for (const piece of Object.keys(BASE) as FloorPiece[]) {
    for (let k = 0; k < 4; k++) if (turnMask(BASE[piece], k) === mask) return { piece, turns: k };
  }
  return { piece: 'end', turns: 0 }; // a lone square (no neighbours)
}

/** Texture coordinates (0..1, v down) for a point on a floor tile turned `turns` quarter-turns clockwise. */
export function turnedUV(u: number, v: number, turns: number): [number, number] {
  for (let i = 0; i < turns; i++) [u, v] = [v, 1 - u];
  return [u, v];
}
