# Handoff — Poor Fantasy (as of 2026-11-18)

Read `CLAUDE.md` first: it documents the architecture and every system built so far. This file covers what it doesn't: current state, constraints, open decisions and what to do next.

## Project
- Personal Gold Box-style party RPG on SRD 5.2. Phaser 4, TypeScript (strict), Vite, Vitest.
- Repo: `/home/claude/poor-fantasy` (github.com/tobyjamesmerritt-cloud/poor-fantasy, **public**).
- Pushing to `main` auto-deploys to **https://tobyjamesmerritt-cloud.github.io/poor-fantasy/**. Confirm with `gh run list --limit 1`.
- Owner: Toby. Style: formal, concise, bulleted, direct; flag risks and bad ideas; no sycophancy.

## State
- All requested work is done, pushed and deployed. `npm run build && npm test` pass (200 tests).
- Latest commits: DND-86 (regional random encounters), DND-74 (loot tables), DND-73 (bestiary, 22 SRD monsters), DND-75 (monster abilities).
- Random encounters now (DND-86): ogres within 5 squares of Hollow Cave, bandits on roads east of the bridge (2% per step), the dead within 5 squares of the Old Keep and inside it (6% per step). Config in `src/content/wandering.json` and `locations.json` `wander`; dialogs `wander-ogre|bandits|dead|dead-inside` in `quests.json`.

## Hard rules
- **Secrets:** a PixelLab API key was pasted earlier in a past session. Never commit it (repo is public). Toby should rotate it.
- **IP:** never use art, files, data or code from the original SSI games or reverse-engineered sources (e.g. talonius repos); stats from SRD 5.2 only; don't use the original game's name.
- **Commits:** reference a DND key; `npm run build && npm test` first; end with the attribution lines from the session's system reminder (currently `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session:` URL).
- Stack decisions in `CLAUDE.md` are fixed — ask before changing.

## Jira (project DND)
- Site `tobyjamesmerritt.atlassian.net`, cloudId = the site URL; use the `mcp__Atlassian_Rovo__*` tools. Done transition id: `31`.
- The Rovo connector runs on the deprecated V1 endpoint (ends 2027-03-01). Tell Toby once per session: remove and re-add the connector from Claude's connector directory.
- Create a ticket for new work, close it with a short description when shipped.

## Open decisions (ask Toby)
1. **Difficulty retune (DND-84):** sim bots win ~99–100% on every encounter at levels 1 and 3. Options: use the full party-size XP budget (not party − 1), raise zone/encounter difficulty, or tougher monsters. Not started.
2. **"Crypt area" in the southeast:** DND-86 used the Old Keep ruins (27,25). The keep has no crypt (only a collapsed chapel); the only crypt is the Millbrook shrine. Confirm that is what Toby meant.
3. **Zone overlap:** where the east road passes the Old Keep, bandits take priority over the dead. Swap entries in `wandering.json` to reverse.
4. **Pending offers, no answer yet:**
   - Add item / spell / action icon needs to the art department brief (Project doc `claude/art-department-brief.md`).
   - Add the "no scrolling" design rule (DND-85) to `CLAUDE.md`.
5. Level-1 ogre encounters can one-shot a wizard; the zone is east of the troll bridge, so this is usually level 3+. Watch in playtest.

## Backlog — suggested next (open Jira, by theme)
- **Engine, no art needed:** DND-76 shape-changing bosses (unblocked, uses DND-75 abilities); DND-84 leftovers and retune; DND-85 no-scrolling pass plus icons for spells and actions; DND-81 scrolling battlefield; DND-77 multi-square creatures; DND-56 combat walls/obstacles/cover; DND-49 remaining SRD classes, species traits, feats.
- **Presentation:** DND-42 death marker/active highlight; DND-58 first-person view detail; DND-60/61 missile and spell effects; DND-66 combat feedback (floating numbers done in DND-82/83 work; condition icons remain); DND-69 classic encounter screen; DND-80 minimap.
- **Art-dependent:** DND-39, 55, 57, 59, 62, 63, 64, 65, 67, 68, 78, 79; audio DND-33, 34; dice DND-32.
- **Content:** DND-38 design the four locales (Millbrook, Fenwick, Hollow Cave, Old Keep); DND-27 patron god rewind mechanic.
- Low priority: DND-21 iPhone install, DND-22 side initiative.
- Epics DND-1…7 are still "To Do" containers.

## Useful commands
- `npm run dev` (http://localhost:5173), `npm test`, `npm run build`, `npm run sim`.
- Debug console (backtick): `fight <encounter>` (try `ogre`, `bandit-ambush`, `crypt-dead`), `gold`, `xp`, `heal`, `kill`, `time`, `seed <n>`, `fog`.
- New monster/encounter: follow "How to add a monster / an encounter" in `CLAUDE.md` (JSON only).

## Working tips
- Keep chats short: one ticket or theme per chat. Content-only work (monsters, encounters, zones) suits Sonnet; engine work (DND-76, balance) suits Opus.
- Verify UI changes in the browser; sim loops run faster than enemy animation, so use longer waits.
- SRD 5.2.1 markdown for stat blocks: github.com/downfallx/dnd-5e-srd-markdown (Codeberg is blocked by the proxy).
