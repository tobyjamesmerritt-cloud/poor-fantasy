# Art pipeline

How art gets from a file on your PC into the game.

## Decisions (DND-19)
- **Art size: 16×16 pixel art**, shown at **3×** (one grid square = 48 px on screen). Set by `scale` in `src/content/assets.json`.
- **Starter style:** Kenney "Tiny" series (CC0). A placeholder — swapping to more detailed art later means new PNGs + manifest edits, no code changes.
- **Editor:** LibreSprite (free). Upgrade to Aseprite only if LibreSprite becomes limiting.

## How art is wired in
`src/content/assets.json` is the only place frame numbers live:
- `sheets` — PNG sprite sheets and their frame size. All sheets in a set share one frame size.
- `sprites` — named sprites (`"fighter"`, `"giant-rat"`) → sheet + frame number.
- `floors` — floor tile frames per terrain type.
- `cursors` — mouse cursors (desktop only; touch ignores them).

Content files refer to sprites by name (e.g. `"sprite": "giant-rat"` in `skirmish.json`). `npm test` fails if a name, sheet or frame number is wrong.

## Change a sprite (2 minutes)
1. Open `docs/sheets/tiny-dungeon-indexed.png` — every tile is numbered.
2. In `src/content/assets.json`, change the `frame` number for that sprite, or add a new named entry.
3. Save — the dev server reloads. Run `npm test` before committing.

## Add a new sprite sheet
1. Put the PNG in `public/assets/tiles/` or `public/assets/sprites/` (lowercase-kebab-case name).
2. Use a **packed** sheet (no spacing between tiles — Kenney's `tilemap_packed.png`).
3. Add it under `sheets` with `frameWidth`/`frameHeight` 16.
4. Record it in `NOTICE.md` (name, source URL, licence) **before committing**.

## Check a sheet in LibreSprite
- Open the PNG → **View → Grid → Grid Settings**: width 16, height 16 → **View → Show Grid**.
- Frames are numbered left-to-right, top-to-bottom, starting at 0.

## Packs on hand (Toby's downloads — only used files are committed)
| Pack | Useful for | Status |
|---|---|---|
| Tiny Dungeon | party, monsters, dungeon floor/walls, items, chests | **In use** (combat) |
| Cursor Pack | gauntlet / sword / boot cursors | **In use** (3 cursors) |
| Tiny Ski | pixel font (digits, A–Z, symbols) | Later: in-canvas numbers, e.g. damage pop-ups |
| RPG Urban Kit | many people sprites (townsfolk/NPCs), buildings | Later: town mode; modern-looking, pick carefully |
| Tiny Battle | grass, water, trees; heart, lock, flag, number icons | Later: wilderness terrain + UI icons; vehicles unusable |

## Where to look for more assets
- **itch.io game assets** — https://itch.io/game-assets (huge mix of free and paid packs; check each licence and record it in `NOTICE.md`; prefer CC0 or licences that allow use in any project).
- **Kenney** — https://kenney.nl/assets (all CC0; "Tiny Town" matches our current style and fills the missing-houses gap).
- **OpenGameArt** — https://opengameart.org (filter by licence).

## Rules of thumb
- One art size per set; don't mix 16 px and 32 px sprites on screen.
- Scale by whole numbers only (crisp pixels).
- PNG with transparency; no JPEG.
- No assets from the original SSI games. Avoid "personal use only" licences.
