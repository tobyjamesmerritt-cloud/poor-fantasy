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

/** Sheet image sizes without Phaser (for HTML screens shown before any scene has loaded art). */
export async function loadSheetSizes(): Promise<Record<string, { width: number; height: number }>> {
  const entries = await Promise.all(
    Object.entries(assets.sheets).map(
      ([key, s]) =>
        new Promise<[string, { width: number; height: number }]>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve([key, { width: img.naturalWidth, height: img.naturalHeight }]);
          img.onerror = () => reject(new Error(`Could not load ${s.url}`));
          img.src = s.url;
        }),
    ),
  );
  return Object.fromEntries(entries);
}

/** spriteCss from known sheet sizes (see loadSheetSizes). */
export function spriteCssFromSizes(sizes: Record<string, { width: number; height: number }>, spriteKey: string): SpriteCss | null {
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
