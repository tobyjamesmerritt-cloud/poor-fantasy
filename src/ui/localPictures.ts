/**
 * Local-only NPC / encounter pictures (DND-63/69). Images live in the git-ignored
 * `local/pictures/` folder on the developer's PC (licences forbid redistributing
 * them), named `<picture id>.<png|jpg|webp>`. On the public build the folder is
 * absent, so every lookup returns undefined and dialogs show no picture.
 */
const files = import.meta.glob('/local/pictures/*.{png,jpg,jpeg,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const byId = new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.[a-z]+$/g, ''), url]));

export function pictureUrl(id: string | undefined): string | undefined {
  return id ? byId.get(id) : undefined;
}
