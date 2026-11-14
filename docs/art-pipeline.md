# Art pipeline

How art gets from a file on your PC into the game. Claude will walk you through each step the first time.

## Tools
| Tool | Use | Cost |
|---|---|---|
| [Tiled](https://www.mapeditor.org/) | Draw maps (wilderness, towns, combat arenas) | Free |
| [LibreSprite](https://libresprite.github.io/) or Aseprite | Edit sprites and sprite sheets | Free / ~US$20 |
| [Kenney.nl](https://kenney.nl/assets) | Starter tiles and sprites | Free, CC0 |

## Folder layout
```
public/assets/
  tiles/       tilesets (PNG) + Tiled maps (JSON)
  sprites/     character/monster sprite sheets (PNG) + frame data
  portraits/   character and NPC portraits
  ui/          icons, buttons, frames
  audio/       music and sound effects (OGG + MP3)
```

## Rules of thumb
- **One tile size for the whole game.** Decide once (e.g. 16×16 or 32×32 pixel art, scaled up in-game). Mixing sizes is the most common source of rework.
- **One palette / style per game.** Prefer one artist or pack family for consistency.
- **PNG only** for images, with transparency. No JPEG for sprites.
- **Sprite sheets:** frames in a regular grid, same frame size, no padding unless the loader is told about it.
- **Tiled maps:** export as JSON, embed tilesets (Map → Embed Tilesets) so the map file is self-contained.
- **File names:** lowercase-kebab-case, e.g. `kobold-idle.png`.
- **Licences:** add every pack to `NOTICE.md` before committing. CC0 is simplest. Avoid "personal use only" packs if you may ever share the game.
- **No assets from the original SSI games.**

## Adding a sprite (outline — expanded when the first real asset lands)
1. Put the PNG in `public/assets/sprites/`.
2. Tell Claude the frame width/height and which frames are which animation.
3. Claude adds the loader entry and animation definitions; you playtest.
