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
