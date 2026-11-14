# Poor Fantasy

A personal party-based fantasy RPG in the Gold Box tradition, on modern D&D rules (SRD 5.2). Phaser 4 + TypeScript + Vite.

## Play
**Windows:** double-click `play.bat` — it updates (git pull), installs packages, starts the game and opens your browser. Close the window to stop.

Or manually:
```bash
npm install
npm run dev        # http://localhost:5173
```
- The game opens on the world map: click to travel; walk onto the cave for the test fight. About → Controls lists everything.
- Move: WASD, arrows or numpad; Q E Z C for diagonals — or tap an adjacent square / the on-screen buttons.
- Click a shaded square to walk there; click an enemy to walk up and attack. **Space** ends the turn early. **Enter** replays after victory/defeat.
- Reproduce a fight exactly: add `?seed=1234` to the URL (the seed is shown when a fight ends).
- Console debug handle: `pf` (game, command bus, seed).

## Develop
```bash
npm test           # rules + architecture tests
npm run build      # typecheck + production build into dist/
```
See [`CLAUDE.md`](CLAUDE.md) for architecture rules and [`docs/art-pipeline.md`](docs/art-pipeline.md) for adding art.

## Layout
```
src/engine/   pure TS: RNG, dice, commands, modes, save state
src/rules/    pure TS: SRD 5.2 rules (abilities, attacks, combat)
src/game/     Phaser scenes and input mapping (render only)
src/ui/       HTML/CSS overlays (log, menus)
src/content/  JSON game data
public/assets art, audio
tests/        Vitest
.claude/skills official Phaser 4 agent skills
```

## Licence notes
See [`NOTICE.md`](NOTICE.md).
