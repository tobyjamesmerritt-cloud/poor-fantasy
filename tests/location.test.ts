import { describe, expect, it } from 'vitest';
import {
  doorLocked,
  findPath4,
  type LocationMap,
  type Pose,
  stepFacing,
  tryStep,
  turn,
  viewFaces,
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
  const front = (m: LocationMap, locked = () => false) =>
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
