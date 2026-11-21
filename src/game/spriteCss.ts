/** CSS background info for showing one sprite-sheet frame in the HTML UI. */
import * as Phaser from 'phaser';
import { assets, imageKey, spriteTexture } from '../content/assets';
import type { SpriteCss } from '../ui/hud';

/** Whole-number scale that draws sprite `id` (single image or sheet frame) at `px` pixels. */
export function spriteScaleOf(textures: Phaser.Textures.TextureManager, id: string, px: number): number {
  const tex = spriteTexture(id);
  if (!tex) throw new Error(`Unknown sprite "${id}"`);
  if (tex.frame === undefined) return px / (textures.get(tex.key).getSourceImage() as HTMLImageElement).width;
  return px / assets.sheets[tex.key].frameWidth;
}

export function spriteCss(textures: Phaser.Textures.TextureManager, spriteKey: string): SpriteCss {
  const single = assets.images[spriteKey];
  if (single) {
    const img = textures.get(imageKey(spriteKey)).getSourceImage() as HTMLImageElement;
    return { url: single.url, frameWidth: img.width, col: 0, row: 0, sheetCols: 1, sheetRows: 1 };
  }
  const ref = assets.sprites[spriteKey];
  if (!ref) throw new Error(`Unknown sprite "${spriteKey}"`);
  const sheet = assets.sheets[ref.sheet];
  const img = textures.get(ref.sheet).getSourceImage() as HTMLImageElement;
  const sheetCols = img.width / sheet.frameWidth;
  return {
    url: sheet.url,
    frameWidth: sheet.frameWidth,
    col: ref.frame % sheetCols,
    row: Math.floor(ref.frame / sheetCols),
    sheetCols,
    sheetRows: img.height / sheet.frameHeight,
  };
}

/** Load every sprite sheet in the art manifest (call from a scene's preload). */
export function preloadSheets(load: Phaser.Loader.LoaderPlugin): void {
  for (const [key, s] of Object.entries(assets.sheets)) {
    load.spritesheet(key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
  }
  for (const [id, i] of Object.entries(assets.images)) {
    load.image(imageKey(id), i.url);
    if (i.attack) load.image(imageKey(id, 'attack'), i.attack);
  }
}

/** Sheet image sizes without Phaser (for HTML screens shown before any scene has loaded art). */
export async function loadSheetSizes(): Promise<Record<string, { width: number; height: number }>> {
  const entries = await Promise.all(
    [
      ...Object.entries(assets.sheets).map(([key, s]) => [key, s.url] as const),
      ...Object.entries(assets.images).map(([id, i]) => [imageKey(id), i.url] as const),
    ].map(
      ([key, url]) =>
        new Promise<[string, { width: number; height: number }]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([key, { width: img.naturalWidth, height: img.naturalHeight }]);
          img.onerror = () => reject(new Error(`Could not load ${url}`));
          img.src = url;
        }),
    ),
  );
  return Object.fromEntries(entries);
}

/** spriteCss from known sheet sizes (see loadSheetSizes). */
export function spriteCssFromSizes(sizes: Record<string, { width: number; height: number }>, spriteKey: string): SpriteCss | null {
  const single = assets.images[spriteKey];
  if (single) {
    const size = sizes[imageKey(spriteKey)];
    return size ? { url: single.url, frameWidth: size.width, col: 0, row: 0, sheetCols: 1, sheetRows: 1 } : null;
  }
  const ref = assets.sprites[spriteKey];
  const size = ref && sizes[ref.sheet];
  if (!ref || !size) return null;
  const sheet = assets.sheets[ref.sheet];
  const sheetCols = size.width / sheet.frameWidth;
  return {
    url: sheet.url,
    frameWidth: sheet.frameWidth,
    col: ref.frame % sheetCols,
    row: Math.floor(ref.frame / sheetCols),
    sheetCols,
    sheetRows: size.height / sheet.frameHeight,
  };
}

/**
 * Fog of war with soft, rounded edges. Drawn into a small canvas texture (RES pixels per
 * square), softened in code, then shown scaled up with smooth filtering. Fogged squares
 * stay fully dark; only the edges of what you've seen fade. No screen-space filter, so
 * nothing leaks at the map or screen edges.
 */
export class SoftFog {
  private static readonly RES = 8; // texture pixels per square
  private static readonly SOFT = 3; // blur radius in texture pixels (~ half a square after two passes)
  private readonly tex: Phaser.Textures.CanvasTexture;
  private readonly img: Phaser.GameObjects.Image;

  constructor(
    scene: Phaser.Scene,
    key: string,
    x: number,
    y: number,
    private readonly cols: number,
    private readonly rows: number,
    cell: number,
    depth: number,
  ) {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    this.tex = scene.textures.createCanvas(key, cols * SoftFog.RES, rows * SoftFog.RES)!;
    this.tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.img = scene.add.image(x, y, key).setOrigin(0, 0).setScale(cell / SoftFog.RES).setDepth(depth);
  }

  /** Redraw: `fogged(x, y)` = that square is still unexplored. */
  update(fogged: (x: number, y: number) => boolean, colour = 0x000000): void {
    const R = SoftFog.RES;
    const P = SoftFog.SOFT * 2; // padding outside the map counts as fog
    const w = this.cols * R + 2 * P;
    const h = this.rows * R + 2 * P;
    const base = new Float32Array(w * h);
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const cx = Math.floor((px - P) / R);
        const cy = Math.floor((py - P) / R);
        const out = cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows;
        base[py * w + px] = out || fogged(cx, cy) ? 1 : 0;
      }
    // two passes of a box blur ≈ a soft round falloff
    let a: Float32Array = base;
    for (let pass = 0; pass < 2; pass++) a = boxBlur(boxBlur(a, w, h, SoftFog.SOFT, true), w, h, SoftFog.SOFT, false);
    const ctx = this.tex.context;
    const img = ctx.createImageData(this.cols * R, this.rows * R);
    const [r, g, b] = [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];
    for (let py = 0; py < this.rows * R; py++)
      for (let px = 0; px < this.cols * R; px++) {
        const k = (py + P) * w + (px + P);
        const o = (py * this.cols * R + px) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = Math.round(255 * Math.max(base[k], a[k])); // unexplored stays solid; only the seen side fades
      }
    ctx.putImageData(img, 0, 0);
    this.tex.refresh();
    this.tex.setFilter(Phaser.Textures.FilterMode.LINEAR); // smooth when scaled up (after upload: pixel-art games default to nearest)
  }

  destroy(): void {
    this.img.destroy();
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const xx = horizontal ? x + d : x;
        const yy = horizontal ? y : y + d;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) {
          sum += 1; // beyond the edge: fog
        } else sum += src[yy * w + xx];
        n++;
      }
      out[y * w + x] = sum / n;
    }
  return out;
}
