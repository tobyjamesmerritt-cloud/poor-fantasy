import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadLocationMap } from '../src/content/locationMap';
import { encounters } from '../src/content/encounters';
import type { TiledMap } from '../src/content/world';
import { propAt, viewFaces, viewProps, type LocationMap } from '../src/rules/location';

const millbrook = (): LocationMap =>
  loadLocationMap('millbrook', JSON.parse(readFileSync('public/assets/maps/millbrook.json', 'utf8')) as TiledMap, Object.keys(encounters));

describe('props (billboards) and low walls', () => {
  it('a prop on a blocked square draws as a billboard, not a wall', () => {
    // 9×3 room, open row in the middle, a prop (blocked) at x=6
    const rows = ['#########', '#.....P.#', '#########'];
    const cells = rows.join('').split('');
    const m: LocationMap = {
      id: 't',
      width: 9,
      height: 3,
      solid: cells.map((c) => c === '#' || c === 'P'),
      material: cells.map((c) => (c === '#' ? 'stone' : '')),
      prop: cells.map((c) => (c === 'P' ? 'well' : undefined)),
      entrance: { x: 1, y: 1, facing: 'e' },
      exits: [{ x: 1, y: 1 }],
      spots: [],
    };
    expect(propAt(m, 6, 1)).toBe('well');
    const pose = { x: 3, y: 1, facing: 'e' as const };
    expect(viewProps(m, pose).some((p) => p.prop === 'well' && p.depth === 3 && p.lateral === 0)).toBe(true);
    expect(viewFaces(m, pose, 4).some((f) => f.depth === 3 && f.lateral === 0)).toBe(false);
  });
  it('props come far → near', () => {
    const m = millbrook();
    const depths = viewProps(m, { x: 1, y: 6, facing: 'e' }).map((p) => p.depth);
    expect(depths.length).toBeGreaterThanOrEqual(0);
    expect(depths).toEqual([...depths].sort((a, b) => b - a));
  });
  it('accepts heights in quarter steps and rejects others', () => {
    const t = JSON.parse(readFileSync('public/assets/maps/millbrook.json', 'utf8')) as TiledMap & { tilesets: { tiles?: { properties?: { name: string; value: unknown }[] }[] }[] };
    const setHeight = (h: number) => t.tilesets.forEach((ts) => ts.tiles?.forEach((tl) => tl.properties?.forEach((p) => p.name === 'height' && (p.value = h))));
    setHeight(0.5);
    expect(loadLocationMap('m', t, Object.keys(encounters)).storeys!.some((h) => h === 0.5)).toBe(true);
    setHeight(0.3);
    expect(() => loadLocationMap('m', t, Object.keys(encounters))).toThrow(/quarter steps/);
  });
});
