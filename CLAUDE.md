# Poor Fantasy — instructions for Claude

A personal, nostalgic party-based fantasy RPG in the style of the late-1980s "Gold Box" games, built on the current D&D rules (SRD 5.2). Personal project; optimise for **fast playtest iteration**.

## Stack (decided — do not change without asking)
- **Phaser 4** (pinned exact version) for map, combat and dungeon rendering. WebGL renderer (`Phaser.AUTO`); Canvas renderer is deprecated in v4.
- **TypeScript** (strict), **Vite** (dev server + build), **Vitest** (tests).
- **HTML/CSS overlays** for menus, character sheets, shops, the message log. Do not build text-heavy UI in Phaser.
- Content as **JSON** in `src/content/`. Maps will be authored in **Tiled** (JSON export).

## Architecture rules (enforced by `tests/architecture.test.ts`)
1. `src/engine/` and `src/rules/` are pure TypeScript: **no Phaser, no DOM, no imports from `game/` or `ui/`**. All rules logic lives here and is unit-tested.
2. `src/game/` (Phaser scenes) only renders state and forwards Commands. No rules logic in scenes.
3. **All randomness goes through `Rng`** (`src/engine/rng.ts`). Never call `Math.random()` in game logic. `?seed=N` in the URL replays a run exactly.
4. **Input is Commands, not keys** (`src/engine/commands.ts`). Key codes appear only in `src/game/input/keyboard.ts`. Every action must be reachable by touch.
5. Game state (`src/engine/state.ts`) is plain JSON-serializable data. Bump `SAVE_VERSION` when its shape changes.
6. Mode changes must be allowed by `TRANSITIONS` in `src/engine/modes.ts`.

## The seven modes (each becomes a Phaser scene)
party (roster/creation) · explore (first-person dungeon + overhead wilderness) · encounter (fight/parley/flee/wait/advance) · combat (tactical grid) · postCombat (XP/loot) · camp (short/long rest, spells, save) · town (shop/temple/training/inn).

## Rules source
SRD 5.2 (2024 rules), CC-BY-4.0. Implement from the SRD, cite the section in code comments for non-obvious rules. Never copy code, text, maps, art or data from the original SSI games or from reverse-engineered sources (e.g. talonius/pool-of-radiance) — architecture reference only. Do not use the original game's name in the project.

## Phaser skills
Official Phaser 4 skills are in `.claude/skills/` (copied from the pinned `phaser` npm package). **Read `v3-to-v4-migration` before writing Phaser code** — avoid v3 idioms (pipelines, FX/masks → filters, tint changes).

## Workflow
- `npm run dev` — play at http://localhost:5173 (hot reload). `npm test` — rules tests. `npm run build` — typecheck + production build.
- Before committing: `npm run build && npm test` must pass.
- Work items live in Jira project **DND** (tobyjamesmerritt.atlassian.net). Reference the key in commit messages, e.g. `DND-12: add opportunity attacks`.
- Keep changes small and playable. Prefer a rough playable feature over a polished unplayable one.

## Conventions
- New rule → pure function in `src/rules/` + tests with a scripted or seeded `Rng`.
- New content type → JSON file in `src/content/` + a TypeScript type; validate at load.
- Art goes in `public/assets/<tiles|sprites|portraits|ui|audio>/`; see `docs/art-pipeline.md`.
