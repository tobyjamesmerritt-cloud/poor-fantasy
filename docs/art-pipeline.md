# Art pipeline

How art gets from a file on your PC into the game.

## Decisions (DND-19, DND-78)
- **Combat square = 64 canvas px** (`cell` in `src/content/assets.json`; the canvas is scaled to fit the screen, so on-screen size is unchanged).
- **Sheets may differ in frame size** (DND-78): each sheet's square frame size must divide the cell — 16 px art draws at 4×, 32 px art at 2× (`spriteScale(sheet)`). `npm test` fails otherwise.
- Party/tiles are still 16 px (Kenney); monsters are moving to 32 px. Mixed pixel density on one screen is accepted for placeholders until the 32 px party art exists.
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
3. Add it under `sheets` with `frameWidth`/`frameHeight` (16, 32 or 64 — must divide `cell`).
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
| Pixel-Deck 64x Tiny Monsters (32 px) | rat, spiders, bat, goblin, ankheg stand-in | **In use** (`monsters-32.png`, frames repacked; DND-59) |
| Pixel-Deck Tiny Animals (32 px) | wolf (+ dire wolf, worg recolours) | **In use** (`monsters-32.png`) |
| Pixel-Deck Tiny Dungeon Items (16 px) | valuables, quest items, Greater Healing icons | **In use** (`items-16.png`; map in `src/content/itemIcons.ts`; DND-64) |
| Pixel-Deck 32 Animated Magic Items (48 px, GIF) | magic items, spell/action icons (HTML only) | Later: DND-85 |
| Corax Digital Art realistic heroes (512–1024 px, painted) | NPC / encounter pictures | **Local only** — never commit (licence forbids redistribution). See "Local-only art" |

Pixel-Deck licences forbid redistributing the packs, so commit **only the frames the game uses, repacked into our own sheets**, never the zips or whole folders.

## Where to look for more assets
- **itch.io game assets** — https://itch.io/game-assets (huge mix of free and paid packs; check each licence and record it in `NOTICE.md`; prefer CC0 or licences that allow use in any project).
- **Kenney** — https://kenney.nl/assets (all CC0; "Tiny Town" matches our current style and fills the missing-houses gap).
- **OpenGameArt** — https://opengameart.org (filter by licence).

## Rules of thumb
- One art size per set; don't mix 16 px and 32 px sprites on screen.
- Scale by whole numbers only (crisp pixels).
- PNG with transparency; no JPEG.
- No assets from the original SSI games. Avoid "personal use only" licences.

## Local-only art (DND-63)
- Some placeholder art may be used for testing on Toby's PC but not published (licence forbids redistribution). It lives in the git-ignored `local/` folder at the repo root and is never committed or deployed.
- NPC / encounter pictures: `local/pictures/<id>.<png|jpg|webp>` (256 px square works well). A quests.json dialog names its picture with `"picture": "<id>"` (a node may override, or set `null`). Missing files just show no picture, so the public site is unaffected.
- Current ids: `reeve`, `ilse`, `bertram`, `odo`, `bandit-captain` (Corax Digital Art realistic heroes; picks recorded in `local/pictures/README.txt`). Restart `npm run dev` after adding files.
