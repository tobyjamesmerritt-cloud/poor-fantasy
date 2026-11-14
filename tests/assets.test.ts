import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assets, cellSize, validateManifest } from '../src/content/assets';
import { encounters, party } from '../src/content/encounters';

/** Width/height from a PNG's IHDR chunk. */
function pngSize(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('art manifest', () => {
  it('every frame number exists in its sheet image', () => {
    const frameCount = Object.fromEntries(
      Object.entries(assets.sheets).map(([k, s]) => {
        const { w, h } = pngSize(`public/${s.url}`);
        expect(w % s.frameWidth, `${k} width`).toBe(0);
        expect(h % s.frameHeight, `${k} height`).toBe(0);
        return [k, (w / s.frameWidth) * (h / s.frameHeight)];
      }),
    );
    for (const [k, s] of Object.entries(assets.sprites)) expect(s.frame, k).toBeLessThan(frameCount[s.sheet]);
    for (const [k, f] of Object.entries(assets.floors)) for (const fr of f.frames) expect(fr, k).toBeLessThan(frameCount[f.sheet]);
  });

  it('cursor files exist', () => {
    for (const c of Object.values(assets.cursors)) expect(() => readFileSync(`public/${c.url}`)).not.toThrow();
  });

  it('every party member has a known sprite, and every encounter floor exists', () => {
    for (const u of party) expect(assets.sprites[u.sprite], u.id).toBeDefined();
    for (const e of Object.values(encounters)) expect(assets.floors[e.floor], e.id).toBeDefined();
  });

  it('grid cell is a whole-number multiple of the art size', () => {
    expect(cellSize()).toBe(48);
  });

  it('rejects broken manifests', () => {
    expect(() => validateManifest({ ...assets, scale: 1.5 })).toThrow(/scale/);
    expect(() => validateManifest({ ...assets, sprites: { x: { sheet: 'nope', frame: 1 } } })).toThrow(/unknown sheet/);
  });
});
