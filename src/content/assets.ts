/**
 * Typed, validated access to the art manifest (assets.json).
 * Validation runs at load so a typo in a frame number or sheet key fails
 * loudly at startup instead of rendering a blank square.
 */
import raw from './assets.json';

export interface SheetDef {
  url: string;
  frameWidth: number;
  frameHeight: number;
}
export interface SpriteRef {
  sheet: string;
  frame: number;
}
export interface FloorDef {
  sheet: string;
  frames: number[];
}
export interface CursorDef {
  url: string;
  hotX: number;
  hotY: number;
}
export interface AssetManifest {
  scale: number;
  sheets: Record<string, SheetDef>;
  sprites: Record<string, SpriteRef>;
  floors: Record<string, FloorDef>;
  cursors: Record<string, CursorDef>;
}

export function validateManifest(m: AssetManifest): AssetManifest {
  const errors: string[] = [];
  if (!Number.isInteger(m.scale) || m.scale < 1) errors.push(`scale must be a positive integer (crisp pixel art)`);
  const sizes = new Set(Object.values(m.sheets).map((s) => `${s.frameWidth}x${s.frameHeight}`));
  if (sizes.size > 1) errors.push(`all sheets must share one frame size, found ${[...sizes].join(', ')}`);
  const checkRef = (where: string, sheet: string, frame: number) => {
    if (!m.sheets[sheet]) errors.push(`${where}: unknown sheet "${sheet}"`);
    if (!Number.isInteger(frame) || frame < 0) errors.push(`${where}: bad frame ${frame}`);
  };
  for (const [k, s] of Object.entries(m.sprites)) checkRef(`sprite "${k}"`, s.sheet, s.frame);
  for (const [k, f] of Object.entries(m.floors)) {
    if (f.frames.length === 0) errors.push(`floor "${k}": no frames`);
    f.frames.forEach((fr) => checkRef(`floor "${k}"`, f.sheet, fr));
  }
  if (!m.cursors.default) errors.push('cursors.default is required');
  if (errors.length) throw new Error('Invalid assets.json:\n- ' + errors.join('\n- '));
  return m;
}

const { _note: _ignored, ...data } = raw as AssetManifest & { _note?: string };
export const assets: AssetManifest = validateManifest(data);

/** On-screen size of one grid square, in pixels. */
export function cellSize(m: AssetManifest = assets): number {
  const first = Object.values(m.sheets)[0];
  return first.frameWidth * m.scale;
}

export function cursorCss(c: CursorDef): string {
  return `url(${c.url}) ${c.hotX} ${c.hotY}, auto`;
}
