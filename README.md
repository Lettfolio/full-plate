# Full Plate

A restaurant game for a ten-year-old. Start as the owner of a small café (menu, prices, staff, stock, decor, then
watch service and read the evening's P&L) or as an apprentice chef, bar back, waiter or restaurant manager working up a career
ladder, with hands-on shifts you can cook or serve yourself. After a year the owner chooses an end-game: **Empire**
(a fast-food chain across a world map — franchising, property, a board) or **Stars** (one restaurant chasing
the Golden Plate Guide's three stars). Everything runs in the browser; there is no server and no tracking.

The game is a static site, deployed to GitHub Pages from `master` by `.github/workflows/pages.yml`.

## Requirements

- Node **22** or later (`.nvmrc`; `engines` in package.json)
- pnpm **10** (`packageManager` pins 10.28.0; `corepack enable` picks it up)
- For the probe and the type audit only: Playwright with Chromium (`npm i -g playwright && npx playwright install
  chromium`, or point `PLAYWRIGHT_PATH` at a `node_modules` that has it). It is not a project dependency.

## Commands

From the repo root:

| What | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Play locally (http://localhost:5173, this machine only) | `pnpm dev` |
| … reachable from a tablet on your network | `pnpm --filter @full-plate/game dev:lan` |
| Typecheck everything | `pnpm -r typecheck` |
| All tests (vitest, ~1,100 across the seven packages) | `pnpm -r test` |
| Build the game → `packages/game/dist/` | `pnpm --filter @full-plate/game build` |
| Serve the build (localhost only) | `pnpm --filter @full-plate/game preview` |
| Layout / touch / contrast probe, 3 viewports × 2 text sizes | `pnpm --filter @full-plate/game probe` |
| Type-scale audit (DOM and canvas text ≥ 13 px), 1280 and 1024 | `pnpm --filter @full-plate/game audit` (`audit:large` for Bigger text) |
| Headless balance runs | `pnpm headless` (sim-core); `pnpm --filter @full-plate/sim-{empire,stars,career} headless` |
| Package demos (dev pages for one package) | `pnpm --filter @full-plate/{handson,sim-empire,sim-stars,sim-career} demo` |
| Rebuild the generated save corpus | `cd packages/game && npx vitest run --config scripts/vitest.corpus.config.ts` |

`probe` and `audit` build the game if `dist/` is missing, start their own `vite preview` on a free port bound to
127.0.0.1, walk every screen in Chromium, write screenshots and a JSON report (`scripts/.probe-out/`,
`scripts/.audit-shots/`), and **exit 1 if any count is above the committed baseline** `packages/game/scripts/probe-baseline.json`.
When a change makes the numbers better, lower the baseline with `-- --update-baseline` in the same commit.
What each count means is at the top of `scripts/probe.mjs`; the round-11 numbers are in `docs/PIPELINE.md`.

## Packages

| Package | What it is | Depends on |
| --- | --- | --- |
| `packages/sim-core` | The owner's restaurant simulation: commands, ticks, days, staff, stock, decor, events, goals, save format. Pure, deterministic TypeScript, no runtime deps. | — |
| `packages/content` | All game data (dishes, ingredients, districts, events, decor, advice text) as JSON, validated at import into a typed `ContentPack`. | sim-core (types) |
| `packages/handson` | The hands-on shift: a 60 Hz cook/serve mini-game on a canvas, the sous chef, touch input, sprites, and the hint-following bot. | sim-core |
| `packages/sim-career` | The career ladder: employers, rungs, offers, weekly reviews, opening your own place. | sim-core |
| `packages/sim-empire` | End-game A: the multi-site chain, world and city maps, franchising, the board. | sim-core |
| `packages/sim-stars` | End-game B: inspectors, guide scores, prestige tracks, satellites, the endings. | sim-core, content |
| `packages/game` | The React 18 + Vite app that mounts all of the above: screens, the owner's floor canvas, saves. | everything |

The sims never import React or the game; the game talks to sim-core only through `packages/game/src/sim.ts`.

## Saves, in one paragraph

The game autosaves at every phase or day change (never per tick) into up to six **slots**. Each save is one JSON
envelope `{ kind: "full-plate", v: 1, game, career?, empire?, stars?, meta }` where every sim serialises its own
state (`state/save.ts`). The envelope is gzip-packed and kept in three layers behind one store: the player's private
account storage when the game runs inside claude.ai, a `localStorage` copy on the device, and a **Save to a file**
download (`.fpsave.json`) that also moves a game by hand. Old saves from every round still load; the committed corpus
(`packages/game/src/__tests__/fixtures/corpus/`) holds 29 of them and `corpus.test.ts` decodes, re-encodes and plays a
day on each. Details: `docs/SAVES.md`.

## Play-testing with the autopilot

Add `?autopilot=<skill>[,<pace>]` to the URL and the hands-on bot plays every hands-on shift for you (skill 0–1;
pace 0.5 ≈ a child playing at half speed), paging through the first-shift onboarding by itself — e.g.
`http://localhost:5173/?autopilot=0.55,0.5`. `?perf=1` shows frame timings in the corner. Tests drive the same bot
headlessly through the real reducer (`src/__tests__/handsOnHarness.ts`).

## Docs

| File | What |
| --- | --- |
| `docs/BRIEF.md` | The design brief (what the game is for) |
| `docs/ARCHITECTURE.md` | How the code fits together: packages, chunks, determinism, save layers |
| `docs/PIPELINE.md` | CI, dependencies, the probe and the audit, the save corpus, test honesty (round 11) |
| `docs/SIM-NOTES.md`, `CONTENT-NOTES.md`, `HANDSON-NOTES.md`, `CAREER-NOTES.md`, `EMPIRE-NOTES.md`, `STARS-NOTES.md` | Per-package notes, round by round |
| `docs/UI-NOTES.md` | UI conventions (type scale, tokens, components, per-round changes) |
| `docs/SAVES.md` | Save slots, the account layer, conflicts, save files |
| `docs/REVIEW.md`, `docs/RED-TEAM.md`, `docs/UX-AUDIT-R7.md` | Reviews and what they found |

## Licences

The game's fonts, Fredoka and Nunito, are self-hosted from `@fontsource` under the SIL Open Font License 1.1; the
licence ships at `fonts-licence/OFL.txt` in the build and is credited at the bottom of Settings.
