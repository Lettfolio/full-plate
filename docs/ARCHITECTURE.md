# Full Plate — Architecture (as of round 11)

What the code is and how it fits together. The design intent is `docs/BRIEF.md`; per-package detail and history are
in the `*-NOTES.md` files; saves in depth are `docs/SAVES.md`. This file replaced the milestone-1 build contract in
round 11 (the old version is in git history, `git show 9c9061e:docs/ARCHITECTURE.md`).

## The shape of it

```
game  (React 18 + Vite: screens, floor canvas, saves, path wiring)
 ├── handson ─────────┐
 ├── sim-career ──────┤
 ├── sim-empire ──────┼──▶ sim-core  (no workspace imports, no runtime deps)
 ├── sim-stars ───────┤        ▲
 │      └── content ──┘        │ types only
 └── content ──────────────────┘
```

Seven pnpm workspace packages under `packages/`. Every package is TypeScript source consumed directly (`main` points
at `src/index.ts`); only `game` ships (the others build small dev demos). Rules:

- **sim-core imports nothing** from the workspace and has no runtime dependencies. It receives a `ContentPack` as an
  argument and never imports `content`.
- **content** imports sim-core *types* only. Importing it validates every collection with hand-written guards and
  throws a list of problems if the shipped data is wrong.
- **sim-career, sim-empire, sim-stars** depend on sim-core (sim-stars also on content for its own data). They never
  import each other, React or the game.
- **handson** depends on sim-core; it owns the hands-on canvas, sprites, the cached-layer helper and the bot.
- **game** imports everything, but talks to sim-core only through `src/sim.ts` (the "sim door": the API, `content`,
  and the constants screens show, such as `hireCheck`).

| Package | Entry points | Notes |
| --- | --- | --- |
| sim-core | `newGame`, `applyCommand`, `tick`, `runDay`, `serialize`/`deserialize`, advice, forecasts, decor, strategies, `headless.ts` | `src/types.ts` is the contract; systems in `src/systems/` |
| content | `content` (ContentPack), `extras`, `fill` | `data/*.json`; balance knobs in `balance.json` |
| handson | `createSession`, `updateSession`, `render`, `botInput`, `summarise`; subpaths `./sprites`, `./palette`, `./layers` | 60 Hz session over a sim-core service; HANDSON-NOTES |
| sim-career | `newCareer`, `beginCareerDay`, `stepCareerDay`, `finishCareerDay`, `applyCareerCommand`, `handoverToOwner` | ladders in `constants.ts`; CAREER-NOTES |
| sim-empire | `forkFromGameState`, `stepEmpireDay`, `applyEmpireCommand`, `serialize`/`deserialize`, world + board | EMPIRE-NOTES |
| sim-stars | `newStarsState`, `prepareService`, `stepStarsDay`, `applyStarsCommand`, `applyStarsEffects` | STARS-NOTES |
| game | `src/main.tsx` → `App.tsx` | below |

## Determinism (all four sims)

- All randomness goes through the package's own seeded `rng.ts`; its state lives in the serialised state
  (`GameState.rngState`, and the equivalents in career/empire/stars). No `Math.random`, no `Date`, no wall clock.
- Money is integer pence; every calculation rounds at the end and state never accumulates floats.
- `tick` / `applyCommand` / `step*Day` return a new state; inputs are never mutated (structural sharing is fine).
- Same seed + same command sequence ⇒ byte-identical serialised state. Each sim has a determinism test, and the game
  checks that save → load mid-run replays identically (`round9`/`round10` tests, the save corpus).
- The UI's only extra memory is cosmetic (where a sprite is drawn, a toast) or wall-clock metadata the sim never
  sees (a save's `updatedAt`).
- `content` is data, so a balance change is a JSON change; tests that pin balance numbers say which file to tune.

## A day, end to end (game/src)

```
Title → Continue / New game (StartPicker: owner or career, difficulty, district)
  planning ── Open for service ──▶ service (Service.tsx: rAF drives `ticks`, floor canvas; or HandsOnShift)
     ▲                                 │ last tick
     └──── Next day ◀── evening (Evening.tsx / CareerEvening) ◀─ event card (EventModal) ─┘
```

- `state/gameReducer.ts` holds `AppState = { game: GameState, meta: PathMeta, …UI memory derived from SimEvents }`.
  Every change is an `AppAction`; sim changes go through `applyCommand`/`tick` (via `ownerApply` in pathEngine).
- `state/paths.ts` defines `PathMeta`: the mode (owner/career), the fork, and the path states `career`, `empire`,
  `stars`. `state/pathEngine.ts` wires the path sims into the day as pure functions: career begin/step/finish around
  the employer's service; `stepEmpireDay` each evening; Stars' `prepareService` in the morning and `stepStarsDay` in
  the evening. The fork is offered from day 365.
- Service pacing: `requestAnimationFrame` runs 2 × speed ticks a real second, at most 8 a frame, remainders carried.
  A hands-on shift runs the handson session at 60 Hz and one sim tick every `secondsPerTick`.
- `canvas/` is the owner's floor: `RestaurantView.ts` (the class: frame order, people movement, per-frame drawing)
  with `layout.ts` (geometry), `frame.ts` (the per-frame palette/decor/motion), `people.ts`, `paint.ts` (helpers),
  `scene.ts` (the static scene, painted once per resize into a cached layer, with the decor hooks), `interaction.ts`
  (hit-testing), `floorPalette.ts` (theme tokens read from CSS) and `decorArt.ts` (the decor art, its own chunk).
- `lib/` holds pure helpers (format, calendar, coaching, goals, decor lines, settings, prefs sync); `components/` the
  shared UI (Dialog, Term, Icon, Avatar, SettingsMenu, SaveIndicator…); styling is `theme.css` tokens plus a few
  per-screen CSS files loaded with their lazy chunk (UI-NOTES "Round 8 — B").

## Bundle layout (vite build)

`vite.config.ts` splits the sims into cacheable chunks (`manualChunks`): `react`, `content`, `sim-core`, and
`paths` (sim-empire + sim-stars + sim-career together). Everything the first paint doesn't need is a lazy chunk:

| Chunk (round 11 size) | Loaded when |
| --- | --- |
| `index` (≈196 kB) | first paint: App, title, planning, service shell, evening, save facade |
| `content` (178 kB), `sim-core` (130 kB), `paths` (154 kB), `react` (142 kB) | at start (the reducer and save envelope call them synchronously) |
| `HandsOnShift` (113 kB) | the first hands-on shift (React.lazy in App) |
| `RestaurantView` (38.6 kB), `sprites` (10.6 kB) | Service, prefetched in idle time; Service imports the view for types only |
| `decorArt` (18.8 kB) | the first decorated room drawn, or the Decorate tab |
| `EmpireTab` (47 kB), `StarsTab` (24 kB), `mapParts` (10 kB) | those tabs |
| `StaffTab`, `DecorateTab`, `MenuMatrixPanel` | those tabs / panels |
| `MyShift`, `CareerEvening`, `HandoverModal` | career screens |
| `BoardMeeting`, `GuideEnvelope`, `WinScreen` | Empire board, Stars guide day, an ending |
| `saveCore`, `saveCodec`, `saveCloud`, `saveFiles`, `SlotPicker`, `SaveSheet` | the save layers (below), the picker, the save mark's sheet |

Fonts are self-hosted from `@fontsource` (no network font requests; OFL in `public/fonts-licence/`). `base: "./"`
makes the build work from any path (GitHub Pages project site, claude.ai artifact). Two guards keep the split honest:
`round8.review.test.ts` pins Service's type-only import of the floor view, and UI-NOTES lists the modules that must
never be imported statically from main-chunk code. Chunk sizes are compared before/after in each round's notes.

## Saves (layers)

One **envelope** per game (`state/save.ts`): `{ kind: "full-plate", v: 1, game, career?, empire?, stars?, meta }`. Each
sim serialises its own state into a string field; `meta` is the rest of `PathMeta` as plain JSON, minus transient UI
(the live hands-on session, tonight's event lists). `decodeSave` also reads a bare round 1–2 GameState and an
uncompressed save file. Autosave runs on every phase/day/path change, never per tick.

Behind one store (`state/saveStore.ts` facade → lazy `saveCore.ts`), up to six slots live in three layers:

1. **Account** (`saveCloud.ts`): inside claude.ai, the viewer's private `data/users/<uid>/` collection — gzip+base64,
   chunked, two banks, header written last; a conflict rule keeps the other copy as a backup.
2. **Device** (`saveCore.ts`): the same packed blob in `localStorage` (`full-plate:slot:v1:<id>` + an index; Round 13: every key goes through `lib/storage.ts`, prefixed `<path>/` on a project path such as GitHub Pages' `/full-plate/`, with a one-time move of the old keys); a
   reload offline still continues. Round 1–8 single saves are imported once.
3. **Save file** (`saveFiles.ts`): `fullplate-<name>-day<N>.fpsave.json`, via the `downloads` capability or
   `<a download>`; Load a save file reads it back (and old raw envelopes).

With none available the slots live in memory and every save surface says **Not saved**. Settings and onboarding flags
ride along in one `prefs` document. Full design, failure handling and the test doubles: `docs/SAVES.md`.

Compatibility is tested against real old files: `src/__tests__/fixtures/corpus/` (19 reviewer saves from rounds 6–9
and 10 generated in round 11) — each must decode, re-encode to a fixed point, and play a day (`corpus.test.ts`).
Never delete a corpus file; when the format changes, add a new one.

## Tests and tooling

- `pnpm -r test`: vitest 4 in every package (jsdom for the game). sim-core runs with v8 coverage (≥ 80 % lines on
  `src/systems/**`). Long headless tests carry their own speed bounds; `testTimeout` is 60 s everywhere.
- Headless runners (`pnpm headless`, and each path package's `headless`) print balance tables; tests pin the claims
  they support, aggregated over seeds rather than hand-picked ones (PIPELINE.md, "Test honesty").
- Browser checks outside vitest: `pnpm --filter @full-plate/game probe` and `audit` (Playwright on the built game,
  every screen, with a committed baseline). See README and `docs/PIPELINE.md`.
- CI: `.github/workflows/pages.yml` on push to master — frozen install, typecheck, test, build, deploy to Pages;
  least-privilege permissions and SHA-pinned actions (PIPELINE.md). Round 13: `.github/workflows/ui-checks.yml` runs
  the probe and both type audits against the build on pull requests and pushes — a separate check that doesn't hold
  up a deploy (UI-NOTES "Round 13 — A" says how to make it required).
- Floor frame times: `node scripts/perf-floor.mjs` (the app at 4×, 4× CPU throttle, software raster; `--passes` per
  paint pass) and `--bench` (the renderer alone on fixed states, `floor-bench.html`); UI-NOTES "Round 13 — A".

## Conventions worth knowing before you change things

- A new command or field goes in sim-core `types.ts` first; optional fields keep old saves loading (add a corpus file).
- UI text never below 13 px (canvas included); tap targets 44 px; glossary words wrap in `<Term>` (UI-NOTES).
- Canvases read theme tokens through one list each (`floorPalette.ts`, `handson/src/palette.ts`).
- Keep `canvas/RestaurantView`, the hands-on screen, the save layers and the path tabs out of the main chunk.
