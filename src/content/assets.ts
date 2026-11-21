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
/** A single-PNG sprite (art library, DND-95): wins over a sheet frame of the same id. */
export interface ImageDef {
  url: string;
  /** Optional attack pose (`<id>_attack.png`). */
  attack?: string;
}
/** An NPC / encounter picture (DND-95): `url` = headshot; `half` / `full` = other framings (fall back to the headshot). */
export interface PictureDef {
  url: string;
  half?: string;
  full?: string;
}
export interface AssetManifest {
  /** On-screen size of one combat grid square, in canvas pixels. Every sheet's frame size must divide it. */
  cell: number;
  sheets: Record<string, SheetDef>;
  sprites: Record<string, SpriteRef>;
  /** Single-image sprites, by sprite id. Resolution order: `images`, then `sprites` (sheet frame). */
  images: Record<string, ImageDef>;
  /** Pictures by dialog `picture` id; resolved before the git-ignored `local/pictures/`. */
  pictures: Record<string, PictureDef>;
  floors: Record<string, FloorDef>;
  cursors: Record<string, CursorDef>;
}

export function validateManifest(m: AssetManifest): AssetManifest {
  const errors: string[] = [];
  if (!Number.isInteger(m.cell) || m.cell < 1) errors.push(`cell must be a positive integer`);
  // DND-78: sheets may differ in frame size, but each must scale by a whole number (crisp pixels)
  for (const [k, s] of Object.entries(m.sheets)) {
    if (s.frameWidth !== s.frameHeight) errors.push(`sheet "${k}": frames must be square`);
    if (m.cell % s.frameWidth !== 0) errors.push(`sheet "${k}": frame size ${s.frameWidth} does not divide the ${m.cell} px cell`);
  }
  const checkRef = (where: string, sheet: string, frame: number) => {
    if (!m.sheets[sheet]) errors.push(`${where}: unknown sheet "${sheet}"`);
    if (!Number.isInteger(frame) || frame < 0) errors.push(`${where}: bad frame ${frame}`);
  };
  for (const [k, s] of Object.entries(m.sprites)) checkRef(`sprite "${k}"`, s.sheet, s.frame);
  for (const [k, i] of Object.entries(m.images)) if (!i.url) errors.push(`image "${k}": url is required`);
  for (const [k, p] of Object.entries(m.pictures)) if (!p.url) errors.push(`picture "${k}": url is required`);
  for (const [k, f] of Object.entries(m.floors)) {
    if (f.frames.length === 0) errors.push(`floor "${k}": no frames`);
    f.frames.forEach((fr) => checkRef(`floor "${k}"`, f.sheet, fr));
  }
  if (!m.cursors.default) errors.push('cursors.default is required');
  if (errors.length) throw new Error('Invalid assets.json:\n- ' + errors.join('\n- '));
  return m;
}

const { _note: _ignored, ...data } = raw as unknown as Omit<AssetManifest, 'images' | 'pictures'> & Partial<Pick<AssetManifest, 'images' | 'pictures'>> & { _note?: string };
export const assets: AssetManifest = validateManifest({ ...data, images: data.images ?? {}, pictures: data.pictures ?? {} });

/** Phaser texture key of a single-image sprite (pose = '' or 'attack'). */
export const imageKey = (id: string, pose = ''): string => `img:${id}${pose ? ':' + pose : ''}`;

/** True when `id` names a sprite: a single PNG (`images`) or a sheet frame (`sprites`). */
export function hasSprite(id: string, m: AssetManifest = assets): boolean {
  return id in m.images || id in m.sprites;
}

/** Where a sprite id is drawn from: its single image first, else its sheet frame. `frame` is undefined for single images. */
export function spriteTexture(id: string, m: AssetManifest = assets): { key: string; frame: number | undefined } | undefined {
  if (m.images[id]) return { key: imageKey(id), frame: undefined };
  const ref = m.sprites[id];
  return ref ? { key: ref.sheet, frame: ref.frame } : undefined;
}

/** Picture file for a dialog `picture` id and framing; a missing framing falls back to the headshot. */
export function pictureFile(id: string | undefined, framing: 'head' | 'half' | 'full' = 'head', m: AssetManifest = assets): string | undefined {
  const p = id ? m.pictures[id] : undefined;
  if (!p) return undefined;
  return (framing === 'half' ? p.half : framing === 'full' ? p.full : undefined) ?? p.url;
}

/** On-screen size of one combat grid square, in pixels. */
export function cellSize(m: AssetManifest = assets): number {
  return m.cell;
}

/** Whole-number scale that draws one frame of `sheet` at `px` pixels (default: one combat square). */
export function spriteScale(sheet: string, px: number = cellSize(), m: AssetManifest = assets): number {
  const s = m.sheets[sheet];
  if (!s) throw new Error(`Unknown sheet "${sheet}"`);
  return px / s.frameWidth;
}

export function cursorCss(c: CursorDef): string {
  return `url(${c.url}) ${c.hotX} ${c.hotY}, auto`;
}
