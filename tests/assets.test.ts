import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assets, cellSize, spriteScale, validateManifest } from '../src/content/assets';
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

  it('combat cell is 64 px and every sheet scales to it by a whole number (DND-78)', () => {
    expect(cellSize()).toBe(64);
    for (const k of Object.keys(assets.sheets)) expect(Number.isInteger(spriteScale(k)), k).toBe(true);
    // 16 px art draws at 4x, 32 px art at 2x
    expect(spriteScale('dungeon')).toBe(4);
  });

  it('rejects broken manifests', () => {
    expect(() => validateManifest({ ...assets, cell: 1.5 })).toThrow(/cell/);
    expect(() => validateManifest({ ...assets, sheets: { ...assets.sheets, odd: { url: 'x.png', frameWidth: 24, frameHeight: 24 } } })).toThrow(/does not divide/);
    expect(() => validateManifest({ ...assets, sprites: { x: { sheet: 'nope', frame: 1 } } })).toThrow(/unknown sheet/);
  });
});
