/** CSS background info for showing one sprite-sheet frame in the HTML UI. */
import type * as Phaser from 'phaser';
import { assets } from '../content/assets';
import type { SpriteCss } from '../ui/hud';

export function spriteCss(textures: Phaser.Textures.TextureManager, spriteKey: string): SpriteCss {
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
}
