import { describe, expect, it } from 'vitest';
import {
  doorLocked,
  findPath4,
  isSeen,
  markSeen,
  SIGHT,
  visibleSquares,
  type LocationMap,
  type Pose,
  stepFacing,
  tryStep,
  turn,
  viewFaces,
  spotPicture,
} from '../src/rules/location';

/** '#' = wall, '.' = floor. */
function grid(rows: string[]): LocationMap {
  const cells = rows.join('').split('');
  return {
    id: 'test',
    width: rows[0].length,
    height: rows.length,
    solid: cells.map((c) => c === '#'),
    material: cells.map((c) => (c === '#' ? 'stone' : '')),
    entrance: { x: 1, y: 1, facing: 'n' },
    exits: [],
    spots: [],
  };
}

describe('location movement', () => {
  it('turns and resolves relative steps', () => {
    expect(turn('n', 'left')).toBe('w');
    expect(turn('n', 'right')).toBe('e');
    expect(turn('w', 'around')).toBe('e');
    expect(stepFacing('e', 'back')).toBe('w');
    expect(stepFacing('s', 'left')).toBe('e'); // facing south, your left is east
  });

  it('steps forward, back and sideways without turning; walls block', () => {
    const m = grid(['#####', '#...#', '#...#', '#####']);
    const p: Pose = { x: 2, y: 2, facing: 'n' };
    expect(tryStep(m, p, 'forward')).toEqual({ x: 2, y: 1, facing: 'n' });
    expect(tryStep(m, p, 'left')).toEqual({ x: 1, y: 2, facing: 'n' });
    expect(tryStep(m, p, 'back')).toBeNull(); // wall behind
    expect(tryStep(m, { x: 1, y: 1, facing: 'w' }, 'forward')).toBeNull();
  });

  it('click-to-walk finds a 4-way route that prefers going straight', () => {
    const m = grid(['#######', '#.....#', '#.###.#', '#.....#', '#######']);
    const path = findPath4(m, { x: 1, y: 1, facing: 'e' }, { x: 5, y: 3 })!;
    expect(path).toHaveLength(6);
    expect(path.slice(0, 4)).toEqual(['e', 'e', 'e', 'e']); // keeps heading east first
    expect(findPath4(m, { x: 1, y: 1, facing: 'e' }, { x: 3, y: 2 })).toBeNull(); // wall
  });
});

describe('first-person view', () => {
  // A corridor running north, viewer at the south end facing north.
  const corridor = grid(['###', '#.#', '#.#', '#.#', '#.#', '###']);
  const viewer: Pose = { x: 1, y: 4, facing: 'n' };

  it('sees both corridor walls at every depth and the dead end ahead', () => {
    const faces = viewFaces(corridor, viewer, 4);
    const sides = faces.filter((f) => f.kind === 'side');
    for (let d = 0; d <= 3; d++) {
      expect(sides.some((f) => f.depth === d && f.lateral === -1 && f.X0 === -0.5), `left wall d${d}`).toBe(true);
      expect(sides.some((f) => f.depth === d && f.lateral === 1 && f.X0 === 0.5), `right wall d${d}`).toBe(true);
    }
    expect(faces.some((f) => f.kind === 'front' && f.depth === 4 && f.lateral === 0)).toBe(true); // end wall
    expect(faces.every((f) => f.material === 'stone')).toBe(true);
  });

  it('returns faces far → near and hides faces behind other walls', () => {
    const faces = viewFaces(corridor, viewer, 4);
    for (let i = 1; i < faces.length; i++) expect(faces[i].depth).toBeLessThanOrEqual(faces[i - 1].depth);
    // walls two squares to the side are behind the corridor walls: no visible faces
    expect(faces.some((f) => Math.abs(f.lateral) >= 2 && f.kind === 'side')).toBe(false);
  });

  it('rotates with the facing: turning east in the corridor shows a wall right in front', () => {
    const faces = viewFaces(corridor, { ...viewer, facing: 'e' }, 4);
    expect(faces.some((f) => f.kind === 'front' && f.depth === 1 && f.lateral === 0)).toBe(true);
  });
});

describe('game clock', () => {
  it('formats days and times', async () => {
    const { formatClock } = await import('../src/rules/time');
    expect(formatClock(8 * 60)).toBe('Day 1 · 08:00');
    expect(formatClock(1440 + 13 * 60 + 7)).toBe('Day 2 · 13:07');
  });
});

describe('doors', () => {
  // a building wall (row 1) with a door at (2,1); the party in the street below
  const withDoor = (locked?: boolean, unlockFlag?: string): LocationMap => {
    const m = grid(['#####', '##.##', '#...#', '#...#', '#####']);
    m.spots = [{ id: 'hall', kind: 'building', name: 'Hall', x: 2, y: 1, description: '', building: 'hall', locked, unlockFlag }];
    return m;
  };
  const front = (m: LocationMap, locked: (x: number, y: number) => boolean = () => false) =>
    viewFaces(m, { x: 2, y: 3, facing: 'n' }, 4, locked).find((f) => f.kind === 'front' && f.lateral === 0 && f.depth === 2);

  it('a door square shows as a door in the building wall, not an opening', () => {
    const f = front(withDoor());
    expect(f?.door).toBe('open');
    expect(f?.material).toBe('stone');
  });

  it('a locked door blocks the way and shows barred, until its flag unlocks it', () => {
    const m = withDoor(true, 'key:hall');
    const flags: Record<string, unknown> = {};
    const locked = (x: number, y: number) => doorLocked(m.spots.find((s) => s.x === x && s.y === y), flags);
    expect(front(m, locked)?.door).toBe('locked');
    expect(tryStep(m, { x: 2, y: 2, facing: 'n' }, 'forward', locked)).toBeNull();
    expect(findPath4(m, { x: 2, y: 3, facing: 'n' }, { x: 2, y: 1 }, locked)).toBeNull();
    flags['key:hall'] = true;
    expect(tryStep(m, { x: 2, y: 2, facing: 'n' }, 'forward', locked)).toEqual({ x: 2, y: 1, facing: 'n' });
  });

  it('standing in the doorway, the door square itself is not drawn around you', () => {
    const faces = viewFaces(withDoor(), { x: 2, y: 1, facing: 's' }, 4);
    expect(faces.some((f) => f.door)).toBe(false);
  });
});

describe('fog of war', () => {
  const idx = (m: LocationMap, x: number, y: number) => y * m.width + x;

  it('dungeons: only the next square, and never round a corner', () => {
    // party at (1,1) in a corridor bending at a corner: (2,2) is diagonal past two walls
    const m = grid(['#####', '#..##', '##..#', '#####']);
    const seen = visibleSquares(m, 1, 1, SIGHT.dungeon, true);
    expect(seen).toContain(idx(m, 2, 1)); // straight ahead
    expect(seen).toContain(idx(m, 1, 0)); // the wall itself is seen
    expect(seen).not.toContain(idx(m, 3, 1)); // two squares away
    const m2 = grid(['#####', '#.#.#', '##..#', '#####']);
    expect(visibleSquares(m2, 1, 1, 1, true)).not.toContain(idx(m2, 2, 2)); // round the corner: hidden
  });

  it('towns: far in the open, but buildings block the view', () => {
    const m = grid(['...........', '...........', '.....#.....', '...........', '...........']);
    const seen = visibleSquares(m, 2, 2, SIGHT.town, false);
    expect(seen).toContain(idx(m, 7, 0)); // far across open ground
    expect(seen).toContain(idx(m, 5, 2)); // the wall
    expect(seen).not.toContain(idx(m, 6, 2)); // right behind it
  });

  it('explored squares are remembered (never fog again)', () => {
    let mask = markSeen(undefined, 256, [0, 9, 255]);
    mask = markSeen(mask, 256, [17]);
    for (const s of [0, 9, 17, 255]) expect(isSeen(mask, s)).toBe(true);
    expect(isSeen(mask, 1)).toBe(false);
    expect(isSeen(undefined, 0)).toBe(false);
  });
});

describe('building pictures (DND-63)', () => {
  const inn = { id: 'inn', kind: 'building', name: 'Inn', x: 0, y: 0, description: '', picture: 'marta', altPicture: 'marta-grateful', altFlag: 'ale:flowing' } as const;
  it('shows the alternative picture once its flag is set', () => {
    expect(spotPicture(inn, {})).toBe('marta');
    expect(spotPicture(inn, { 'ale:flowing': true })).toBe('marta-grateful');
    expect(spotPicture({ ...inn, altPicture: undefined, altFlag: undefined }, { 'ale:flowing': true })).toBe('marta');
  });
});
