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
- `npm run dev` — play at http://localhost:5173 (hot reload). `npm test` — rules tests. `npm run build` — typecheck + production build. `npm run sim` — balance simulator (bot win rate for the test encounter); rerun after changing monsters, encounters or combat rules.
- Before committing: `npm run build && npm test` must pass.
- Work items live in Jira project **DND** (tobyjamesmerritt.atlassian.net). Reference the key in commit messages, e.g. `DND-12: add opportunity attacks`.
- Keep changes small and playable. Prefer a rough playable feature over a polished unplayable one.

## Conventions
- New rule → pure function in `src/rules/` + tests with a scripted or seeded `Rng`.
- New content type → JSON file in `src/content/` + a TypeScript type; validate at load.
- Monsters: SRD 5.2 stat blocks only, in `src/content/monsters.json`; encounters reference them by id. Check difficulty against the SRD XP budget (`encounterBudget`).
- Art goes in `public/assets/<tiles|sprites|portraits|ui|audio>/`; see `docs/art-pipeline.md`.
- Maps are Tiled JSON in `public/assets/maps/`. Impassable tiles carry the tileset tile property `blocked: true`; locations live in the `locations` object layer (type town|cave|ruins, properties `locationId`, `description`; one `start` object). `src/content/world.ts` validates and converts them; `src/rules/world.ts` does travel. `tools/gen-world.mjs` generated the first world map — never rerun it once the map has been edited in Tiled.
- Navigation commands (`worldMap`, `enter`, `leaveLocation`, `fight`, `endFight`, `newFight`, `restart`) are handled in `main.ts`; scenes handle gameplay commands. `main.ts` also sets the canvas size and `body[data-mode]` layout per scene.
- Encounters: one JSON per fight in `src/content/encounters/` (register it in `encounters.ts`). `?encounter=<id>` jumps straight into a fight.
- Characters: `GameState.roster` holds character sheets (class, species, background, base scores, background increases — SRD 5.2). Everything else is derived by `rules/character.ts` (`deriveStats`) from `src/content/{classes,species,backgrounds,gear}.json`; scenes use `membersOf(game.roster)` / `statsOf(...)` from `content/characters.ts`, never static data. `party.json` = quick-start pregens. Unplayable classes/traits/feats are kept as data (`playable: false`, `IMPLEMENTED` list) so they can be switched on later. Party screen = HTML (`ui/partyScreen.ts`, mode `party`); new games allow full edits, during play only name/portrait. Character pool: `GameState.bench` holds any number of extra characters (with their condition); `rules/roster.ts` does add/bench/join/delete/ready-made (max 6 in the party). New game keeps the pool and restores everyone. Debug URLs skip creation and use the pregens.
- Locations (towns, dungeons): `src/content/locations.json` maps a world `locationId` to its map file + intro text. Each location is a 16×16 Tiled map `public/assets/maps/<id>.json` (layers `ground`, `structures`, object layer `spots`: entrance (facing), exit, fight (encounter), building (building), text). Solid squares = tileset property `blocked`; their look in the 3D view = tileset property `material` (stone, rock, tree, wood). Loaded/validated by `src/content/locationMap.ts`; movement + first-person view geometry in `src/rules/location.ts`; `LocationScene` renders the 3D view (left) and overhead map (right). Cleared fights: `flags["cleared:<locationId>:<spotId>"]`. `?location=<id>` jumps straight in. `tools/gen-locations.mjs` generated the starter maps; it refuses to overwrite (use `--force <id>` only for maps nobody has edited in Tiled).
- Game clock: `GameState.time` in minutes; costs per step in `src/rules/time.ts`.
- Saving: `engine/save.ts` (pure) = save envelope (`makeSave`/`parseSave`, `MIGRATIONS` table — add a step whenever `SAVE_VERSION` changes, so old saves keep loading) + character library (`remember`/`forget`; deleted ids are tombstoned and never return). `ui/saveStore.ts` = localStorage (slots auto, 1–3; key `poor-fantasy.characters` for the library). `main.ts` autosaves on scene changes and when the page is hidden/closed, continues from the autosave on startup, and never saves in combat, during party creation, or from debug URLs. Save/load/export/import dialog: `ui/saveDialog.ts`; styled yes/no: `ui/confirmDialog.ts` (use it instead of `confirm()`).
- Persistent party: `GameState.party` (hp, hitDice, dead, wakesAt) + `coins` (copper). Fixed stats are derived from the roster (see Characters). `main.ts` copies fight results back with `rules/party.ts` (`afterCombat`, `afterDefeat`); combat starts from the stored HP. Exploration randomness (rests, ambushes) uses `exploreRng` in `main.ts`, separate from the replayable combat seed.
- Resting: `rules/rest.ts` (SRD 5.2 Short/Long Rest, Modest inn 5 sp/person, house-rule ambush risk per site). Where camping is allowed: `worldCampSite` (rules/world.ts, terrain from `src/content/terrain.json`), `locationCampCheck` (dungeons), inns via the building panel. `CampScene` draws a background per site kind; ambushes use encounters `ambush-wilds` / `ambush-dark`.
- Economy: items in `src/content/gear.json` (SRD 5.2 prices in copper; refs `weapon:<id>`, `armor:<id>`, `shield`, `consumable:<id>`), party pack `GameState.inventory`, equipped gear on `CharacterSheet.gear` (absent = class kit). `rules/items.ts` buy/sell (half price)/equip/unequip with SRD armor & weapon training; `rules/rewards.ts` XP split among surviving fighters + fixed treasure per fight spot (`src/content/treasure.json`, beasts carry none); `rules/services.ts` temple heal/raise (house prices in `services.json`). Shop = HTML (`ui/shopScreen.ts`, mode `shop`). Potion of Healing in combat = Bonus Action (`usePotion`, `CombatState.bonusUsed/potions`). Levelling up is not built yet (XP accrues; level 2 at 300).
- Player preferences (grid, auto-end turn, text size, difficulty = retreat rule hard|normal|casual, read at fight start) live in `src/ui/prefs.ts` (localStorage).
