# Full Plate — pipeline, tests and docs honesty (Round 11 — E)

Closes the red-team's pipeline and test-claims findings (docs/RED-TEAM.md): S7, S8, S9, S13, T1, T2, T3, T4, and the
U12 item "`RestaurantView.ts` is 1,217 lines". No game behaviour changed.

## CI (S7, S8) — `.github/workflows/pages.yml`, `.github/dependabot.yml`

- `permissions: {}` at workflow level. **build** gets `contents: read` only (it installs ~270 dev dependencies and
  runs their code); **deploy** gets `pages: write` + `id-token: write` and runs no project code. `configure-pages`
  moved from build to deploy (it calls the Pages API, which needs `pages`; its outputs were never used by the build).
  Checkout no longer persists the token (`persist-credentials: false`).
- Every action is pinned to the full commit SHA its tag resolves to today (looked up with `git ls-remote --tags`;
  the `gh api …/git/ref/tags/…` route was refused by this session's GitHub proxy, the public git protocol was not):

  | Action | Was | Pinned to |
  | --- | --- | --- |
  | actions/checkout | `@v4` | `11d5960a326750d5838078e36cf38b85af677262` # v4.4.0 |
  | pnpm/action-setup | `@v4` | `b906affcce14559ad1aafd4ab0e942779e9f58b1` # v4.3.0 (what `v4` points at; v4.4.0 is the v5.0.0 commit) |
  | actions/setup-node | `@v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` # v4.4.0 |
  | actions/configure-pages | `@v5` | `983d7736d9b0ae728b81ab479565c72886d7745b` # v5.0.0 |
  | actions/upload-pages-artifact | `@v3` | `56afc609e74202658d3ffba0e8f6dda462b719fa` # v3.0.1 |
  | actions/deploy-pages | `@v4` | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` # v4.0.5 |

  Same majors as before (no behaviour change); Dependabot proposes the next ones.
- `--frozen-lockfile` kept; `setup-node` reads `.nvmrc` (22).
- Dependabot: `github-actions` and `npm`, monthly, one grouped PR per ecosystem (npm: dev tooling and runtime grouped
  separately, at most 5 open).
- Guarded by `src/__tests__/round11.pipeline.test.tsx` (permissions per job, 40-hex pins with a `# vX.Y.Z` note, the
  Dependabot ecosystems).

## Dependencies (S9)

| | Before (master 9c9061e) | After (r11-e) |
| --- | --- | --- |
| vite | 5.4.21 | 6.4.6 |
| vitest, @vitest/coverage-v8 | 2.1.9 | 4.1.12 |
| @vitejs/plugin-react | 4.7.0 (range ^4.3) | 4.7.0 (range ^4.7) |
| tinypool (transitive, critical advisories) | 1.1.1 | gone (vitest 4 runs its own pool) |
| esbuild (vite's) | 0.21.5 | 0.25.12 |
| `pnpm audit` | **18** (3 critical, 1 high, 13 moderate, 1 low) | **0** |

- jsdom 31 and @testing-library/* were already current. vite 6 (not 7/8) keeps the Rollup + esbuild build. Two vite 6
  defaults grew chunks and are set back to vite 5's output in `packages/game/vite.config.ts`: `json.stringify: false`
  (vite 6's `"auto"` turned the content JSON into `JSON.parse("…")` strings, +11 kB on `content`) and
  `build.commonjsOptions.strictRequires: false` (commonjs v28 wraps every CJS module in a lazy init, +1.1 kB on
  `react`). Chunks vs master: index 195.85 → 196.73 kB (+0.35 of it the Settings About line), react 141.67 → 142.12,
  content 178.18 → 178.25, sim-core 129.89 → 129.97, paths 154.19 → 154.22, HandsOnShift 112.54 → 112.69,
  RestaurantView 38.48 → 38.57; every other chunk within ±0.1 kB.
- `/// <reference types="vitest" />` → `vitest/config` (vitest 4 moved the `test` key's types).
- **vitest 4 fails a synchronous test that overran `testTimeout`; vitest 2 never could.** Four long sim-core headless
  tests (365-day smoke, capacity, two advice runs) take 5–11 s on a loaded machine and had been passing past the 5 s
  default unnoticed. `testTimeout: 60_000` is now set in every package (sim-career and sim-empire already had it);
  the tests keep their own speed bounds (e.g. the smoke run's `< 30 s`).
- `dev`, `preview` and every package `demo` no longer pass `--host` (the dev server was reachable from the LAN);
  `pnpm --filter @full-plate/game dev:lan` is the explicit opt-in. The probe's own preview binds 127.0.0.1.
- `engines: { node: ">=22", pnpm: ">=10.16" }` in the root package.json; `.nvmrc` = 22.

## Fonts (S13)

`packages/game/public/fonts-licence/OFL.txt` (both copyright lines and the OFL 1.1 text, from the @fontsource
packages' LICENSE files, which are identical below the first line) ships in the build. The Settings sheet ends with
one "About" line crediting Fredoka and Nunito and a 44 px "Font licence" link (`sheet__about`, the last child of the
dialog — agent D's Settings edits sit above it).

## The probe and the audit (T1)

`packages/game/scripts/probe.mjs` (the round-7 review's scratch script, now in the repo) and `scripts/type-audit.mjs`
share `scripts/lib/harness.mjs`: Playwright, a private `vite preview` on a free port (127.0.0.1), the audit saves
generated with the real sim, **one walk over 38 screens**, and the committed baseline `scripts/probe-baseline.json`.
`pnpm --filter @full-plate/game probe` / `audit` / `audit:large` exit 1 when any count rises above the baseline (or
fewer screens are reached); `-- --update-baseline` rewrites it, `-- --no-baseline` just reports.

What changed from the round-7 probe (which reported "0 tap targets < 44 px"):

- **Targets** now include `.term` glossary words, disabled controls, `checkbox`/`switch` roles (a checkbox in a label is
  measured by the label), focusable `[tabindex]`, and any element with a React click/pointer handler (read from the
  element's React props). Click-away backdrops and wrappers around real controls are not targets. Also counted: < 24 px
  (the WCAG 2.5.8 floor).
- **Viewports**: 1280×800, 1024×768 and **768×1024**, all with `hasTouch`, Normal and Bigger text.
- **Contrast** against the colour actually behind the text: the element stack under the text's own box
  (`elementsFromPoint`), composited to the first opaque layer; gradients judged at every stop (worst counts). Text over
  a canvas/image/video isn't judged but counted (`overCanvas`). Disabled controls are exempt (WCAG 1.4.3).
- **Covered** splits "under a sticky/fixed bar at this scroll position" (`underBar`, reachable by scrolling) from
  "under something else" (`covered`). Terms "widen the page" only beyond the screen's own overflow.
- **Type audit** at 1024×768 as well as 1280×800, and canvas text measured on **every screen that shows a canvas**
  (9 per run), not three hand-picked ones.

### Honest numbers on master 9c9061e (summed over 38 screens per run)

| run | targets<44 | of which terms | <24 px | disabled / switch / handler | text<13 | canvas<13 | contrast (+ live) | overflow screens | covered | under bar | errors |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1280×800 normal | 283 | 283 | 194 | 0 / 0 / 0 | 0 | 0 | 4 (+0–2) | 0 | 5 | 37 | 0 |
| 1024×768 normal | 291 | 291 | 194 | 0 / 0 / 0 | 0 | 0 | 4 (+2) | 0 | 12 | 11 | 0 |
| 768×1024 normal | 291 | 291 | 193 | 0 / 0 / 0 | 0 | 0 | 4 (+0–2) | **38** (256 px) | 20 | 11 | 0 |
| 1280×800 Bigger | 269 | 269 | 194 | 0 / 0 / 0 | 0 | 0 | 4 (+0–2) | 0 | 8 | 37 | 0 |
| 1024×768 Bigger | 290 | 290 | 194 | 0 / 0 / 0 | 0 | 0 | 4 (+2) | 0 | 13 | 17 | 0 |
| 768×1024 Bigger | 290 | 290 | 193 | 0 / 0 / 0 | 0 | 0 | 4 (+0–2) | **38** (256 px) | 19 | 6 | 0 |

Three runs on master and three on r11-e gave identical numbers in every column except the live contrast count (the
ticker lines on the running service fade with age, and which lines are on screen at the sample depends on machine
speed), which is why that column has a slack of 3 in the baseline check. r11-e measures exactly master's numbers.

Type audit (`audit`, `audit:large`): 76 screens each, 0 DOM and 0 canvas text runs below 13 px, 0 page errors.

Reading it:
- Every small target is a glossary word: 71 on day-1 Menu at 44×17, 75 with the menu matrix open, 17 on Staff at
  ~30 px tall (personality chips), 10–32 on the Empire panels and maps. Inline words in a sentence are exempt from
  WCAG 2.5.8, but on a tablet they are what a finger hits — the red-team's point (U9 too).
- No disabled control, switch or handler-only element is under 44 px; those categories are counted so they stay at 0.
- Contrast: the empty ★ on the Stars strip / score card / career evening at 1.12:1 and the menu matrix's ● at 2.13:1.
  Decorative glyphs, but they carry meaning (an unearned star). Live: the service ticker's older lines (1.3–2:1).
- Portrait: all 38 screens scroll sideways by 256 px (`min-width: 1024px`, U1) — agent D's fix should bring this to 0.
- `covered` lists a few real overlaps (the Decorate tab's "Buy · fit tomorrow" button under its status line; the
  stock hint's buttons on the zoomed map) worth a look.

The baseline (`scripts/probe-baseline.json`, keys `probe`, `audit-normal`, `audit-large`) is committed at these
counts. Animations are let finish before each measurement (`settle`), so a fade caught half-way doesn't count. Lower it
when D's portrait/terms work lands. ~~CI does not run the probe yet~~ Round 13 (A): `.github/workflows/ui-checks.yml`
runs it — one job (`contents: read`, `permissions: {}` above it, actions SHA-pinned): frozen install, build, Playwright
`1.63.0` installed with `--ignore-scripts` into a folder beside the checkout (so the lockfile is untouched; the harness
finds it through `PLAYWRIGHT_PATH`), `playwright install --with-deps chromium`, then `probe`, `audit`, `audit:large`;
the probe's report and screenshots are uploaded when it fails. It runs on pull requests and pushes to master and is
**not** required: `pages.yml` doesn't wait for it. Once it has run green on master, make it blocking by adding
`ui-checks` as a required status check in the branch protection rule for `master` (Settings › Branches); to gate the
deploy itself, move the job into `pages.yml` and give `build` a `needs: ui-checks`. Since Round 13 the probe skips
whatever is behind an open modal (R12-F8).

## Test honesty (T2)

- **`round7.careerUx` lead-in** no longer hand-picks seeds. Seeds 1–16, each asserted ≥ 0.4 led/trips and 0 jumps (lead
  on and off), plus the 16-seed mean ≥ 0.5. Measured: 1.00 .53 .54 .64 .69 .63 .50 .71 .63 .60 .55 .46 .60 .60 .60
  .69 — mean 0.62, pooled 141/238 = 0.59, lowest 0.46 (seed 12). Out-of-sample seeds 17–24: mean 0.68, lowest 0.50.
  Zero jumps on all 24 seeds.
- **`careerParity`** runs seeds 1–30 for all three bots (was 30 / 10 / 10) and asserts the claim as statistics:
  pooled played÷day-off covers ≥ 95% − 2 standard errors (from the run's own per-seed spread) and ≥ 90%, no seed
  below 60%, extra walk-outs ≤ 2. Measured pooled: half speed 95.4% (1–10: 96.1%, 1–20: 94.5%, 1–40: 95.3%; per-seed
  0.74–1.41, sd 0.13, SE ≈ 2.4 points), full speed 96.1% (1–20: 94.3%), idle 99.3%. A 95% line on a mean with a
  2.4-point standard error is a coin toss; the per-seed table is in the test's header comment.
- Measured on this branch's sim (master's); agents changing `sous.ts`/pacing will move these — re-measure, don't
  re-seed.

## Save corpus (T3)

`packages/game/src/__tests__/fixtures/corpus/` — 29 gzipped files, 0.7 MB, listed in `index.json` (file, kind, the
localStorage key it lived under, origin, what it is):
- **19 legacy**: the 17 distinct files behind the red-team's "33 old saves" (rounds 6–7: `shots/r6/review`,
  `shots/r6/c`, `r7c/saves` — the r7rev and shots/r7/b sets are byte-for-byte copies of r7c) and two round-9 save
  files (`.fpsave.json`, one gzip-b64). Never regenerated.
- **10 generated** by `scripts/corpus.gen.ts` (fixed seeds, `npx vitest run --config scripts/vitest.corpus.config.ts`):
  careers on the chef (apprentice, day 4 and an evening), waiter (day 5) and manager (day 6) tracks; owners staffed on
  Normal (day 40, 3 staff), Hard (day 15), decorated on Cosy (bought, then fitted two days later); an Empire in year 4
  (franchise style) with a board meeting waiting; a Stars restaurant in year 3 (sim-stars' headless script).

`corpus.test.ts` (31 tests): every file decodes (save files via `decodeSaveFile`); `encode(decode(x))` is a fixed
point, and byte-identical to the file for the generated ones (12 of the 19 legacy files are byte-identical too; the 7
older ones pick up or drop fields added since, once); then one day is played through the real reducer (board meeting
skipped, service skipped to the end, first event choice, Next day) and the result still encodes and decodes. A
`validateLoaded` (agents A/B) that rejects any of these is a regression to look at, not a fixture to delete.

## Docs (T4)

`README.md` (what it is, requirements, every command, package map, saves in a paragraph, the autopilot flag, where
the docs are) and a rewritten `docs/ARCHITECTURE.md` (seven packages and their dependency rules, determinism, a day
end to end, the lazy-chunk layout with sizes, the save layers, tests and tooling).

## RestaurantView split (U12)

`canvas/RestaurantView.ts` 1,217 → 679 lines (the class: frame order, people movement, per-frame drawing), plus
`layout.ts` (geometry, 98), `frame.ts` (per-frame palette/decor/motion as ES live bindings with two setters, 30),
`people.ts` (sprite records, staff looks, 42), `paint.ts` (colour maths and drawing helpers, 148), `scene.ts` (static
scene layers and the decor hooks, 249) and `interaction.ts` (hit-testing). Its public exports are unchanged (re-exported).
Proof of no behaviour change: a throwaway test rendered the same states through the original and the split view into
a recording 2D context — 218,467 calls (plain room) and 244,741 (every decor slot filled) identical, plus `pick()`;
round8/round10 canvas tests and canvasOrder unchanged and green. `typeScale.test.ts`'s canvas-label guard now walks
every `canvas/*.ts` (the labels moved to scene.ts). Chunk 38.48 → 38.56 kB.
