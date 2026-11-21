/**
 * NPC / encounter pictures (DND-63/69/95). Resolution order for a dialog `picture` id:
 *  1. a committed picture in the art manifest (`pictures` in assets.json, files under
 *     public/assets/portraits/npc/<area>/), so new art overrides everything below;
 *  2. a local-only image in the git-ignored `local/pictures/` folder on the developer's PC
 *     (licences forbid redistributing them), named `<picture id>.<png|jpg|webp>`;
 *  3. nothing (the dialog shows its placeholder or no picture).
 * On the public build `local/` is absent, so step 2 never finds anything.
 */
import { pictureFile } from '../content/assets';

const files = import.meta.glob('/local/pictures/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byId = new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.[a-z]+$/g, ''), url]));

/** `framing`: a missing half / full body falls back to the headshot. */
export function pictureUrl(id: string | undefined, framing: 'head' | 'half' | 'full' = 'head'): string | undefined {
  const art = pictureFile(id, framing);
  if (art) return `${import.meta.env.BASE_URL}${art}`;
  return id ? byId.get(id) : undefined;
}
