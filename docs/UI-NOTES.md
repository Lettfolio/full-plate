# Full Plate — UI notes (packages/game)

## Running

| What | Command |
| --- | --- |
| Dev (real sim-core + content) | `pnpm --filter @full-plate/game dev` |
| Typecheck | `pnpm --filter @full-plate/game typecheck` |
| Tests (real sim + content) | `pnpm --filter @full-plate/game test` |
| Static build → `packages/game/dist/` | `pnpm --filter @full-plate/game build` |
| Dev server reachable from a tablet on the LAN | `pnpm --filter @full-plate/game dev:lan` (round 11: `dev`/`preview` are localhost-only) |
| Layout/touch/contrast probe; type audit (own preview, baseline) | `pnpm --filter @full-plate/game probe` / `audit` / `audit:large` |

Keys during service: <kbd>Space</kbd> pause/resume, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>4</kbd> speed, <kbd>Esc</kbd> clear the selection.

## The sim door

- `src/sim.ts` is the **only** module that touches the simulation or content. It re-exports the sim-core API, `content`, and the constants the UI shows (`SERVICE_TICKS`, calendar constants and `weekdayOf`/`monthOf`, `TABLE_COST`, `RECRUITMENT_FEE`, `HIRE_CASH_BUFFER_SHIFTS`, `SHIFT_HOURS`, `MAX_MENU_ITEMS`, `shiftCost`).
- **Hiring affordability** has one home: `hireCheck(state, person)` in sim.ts → `{ fee, perShift, needed, canAfford }`, built only from sim-core's `recruitmentFeeOf`, `HIRE_CASH_BUFFER_SHIFTS` and `shiftCost` (sim-core's HIRE/HIRE_STAFF rule). The Staff tab's candidate and old-colleague cards call it; no screen does the sum itself. Swap in a sim-core `canHire` here if one is ever exported (it would also cover `MAX_STAFF`, which isn't exported).
- The milestone-1 stubs (`src/dev/`, `VITE_USE_STUBS`, tsconfig `paths` fallbacks) were removed at integration; see docs/REVIEW.md.

## Structure

```
src/
  App.tsx              title → new game → phase router (planning / service / evening, event modal, game over)
  sim.ts               the one door to sim-core + content (stub switch)
  state/gameReducer.ts useReducer: GameState + UI memory derived from SimEvents
  state/save.ts        localStorage save/load, useAutosave (on day/phase change, never per tick)
  screens/             TitleScreen, NewGame, Planning (+ planning/*Tab), Service, Evening, EventModal, GameOver
  canvas/RestaurantView.ts  pure canvas renderer; its only memory is cosmetic sprite positions
  components/          MoneyText, Bar, Stars, Tabs, Stepper, StatusBar, Plate
  lib/                 format (pence → £), calendar, content lookups, staff helpers, starterMenu
  theme.css            all styling; CSS variables at the top
```

- Tick pacing: requestAnimationFrame runs 2 × speed ticks per real second (one service takes 60 s at 1×). Remainders carry between frames, and one frame runs at most 8 ticks, so a backgrounded tab does not fast-forward.
- Autosave: a save is written every time the day or phase changes. Starting service saves the tick-0 state, so Continue after closing the tab mid-service replays that service from 12:00. A game-over removes the save.

## Contract gaps

Closed at integration (see docs/REVIEW.md): calendar (1), rejected-command reasons (2, toasted from the LOG "bad" event), prices before you click (3, exported constants), `eightySixed` (4), `comped` (5), `gameOverReason` (6), `hired` candidates (7).

Still open:
8. **Who serves whom.** Nothing links servers to tables; server movement on the canvas is cosmetic. `Customer.eatUntil`/`stageTick` exist but are not drawn yet.
9. **Log entries have no subject.** `LogEntry.ref?` would let a ticker line highlight a table.
10. **Stock quotes.** The order sheet shows base `unitCost`; the real charge includes seasonality and the difficulty multiplier. *Nice to have:* `orderQuote(content, state, ingredientId, qty)`. ORDER_STOCK cannot be cancelled.
11. **Reputation by source.** `DayResult` has only totals.

## Known rough edges

- The canvas lays out up to ~14 tables in a grid. Above that it still works, but tables get small. Queue sprites cap at two rows on the pavement, and the "N waiting" badge counts the rest.
- Smooth movement is cosmetic interpolation between tick positions. At 4× people walk fast but stay readable.
- The menu matrix places dishes with no sales on margin alone, along a vertical line. It becomes meaningful after day one.
- Fonts (Fredoka, Nunito) are bundled through @fontsource; there are no network font requests.
- Light theme only. The minimum width is 1024 px (`body { min-width: 1024px }`).

## Round 2 (incidents, goals, staff matters, review fixes)

### What's on screen

| Where | What | Sim contract used |
| --- | --- | --- |
| Service, top of right panel | **Incident cards**: icon, title, body, countdown bar (`ticksLeft` against ticks elapsed since `startedTick`), 2–3 option buttons with cost (red) or "free" (green). Click → `RESPOND_INCIDENT`. Resolved cards show the outcome and fade (1.6 s). | `state.incidents`, `INCIDENT_STARTED`, `INCIDENT_RESOLVED` |
| Service canvas | Pulsing tomato ring + "!" badge on the incident's table (`tableId`, or the table of `customerId`), on a queueing party, or on a staff sprite (`staffId`). Hovering/focusing the card makes its ring stronger. | `Incident.tableId/customerId/staffId` |
| Service | **Auto-pause** on `INCIDENT_STARTED` at 1×/2× (setting); at 4× never pauses, shows an info toast. The tick batch stops on the tick an incident starts so the pause lands exactly there. | |
| Service ticker | Outcome line per `INCIDENT_RESOLVED` (good unless ignored or the text says they left/walked out/…). Skipped if the sim already logged the same text. | |
| Service, under the clock | Weekday name; **staff strip**: each person on the floor today, fatigue bar, Break (`GIVE_BREAK`), "☕ On break" while `tick < breakUntilTick`. | `Staff.fatigue`, `Staff.breakUntilTick` |
| Service | Amber banner "You're covering the kitchen and the floor yourself — expect slow food." | `state.ownerCovering` |
| Service + Planning | **Goals** card: up to 4 unfinished goals of the lowest unfinished tier, progress bar, hint, reward chip, "Show me" (jumps to the tab for add_dishes / hire_role / order_stock / buy_table). Collapsed one-liner on Service. Goals completed today flash with their reward; `GOAL_COMPLETED` → celebratory toast. On a fresh game (empty menu) the card is spotlit (amber ring, pulses twice) and sits left of the tabs, first in reading order. | `state.goals`, `GOAL_COMPLETED` |
| Planning > Staff | **Train** per person (`TRAIN`), fee from `TRAINING_FEE` if sim-core exports it (else "£—"). Disabled with the reason shown when they're the only one in their role on today, already training, or out of planning. "📚 Training today" when `trainingDay === day`. | `Staff.trainingDay` |
| Planning | "What do I do?" popover: five first-week steps. | |
| Evening | **What happened today**: one row per incident with the button label chosen ("Left it" for ignored) and the outcome. From `DayResult.incidents`, with labels from the resolved `state.incidents`. | `DayResult.incidents` |
| Evening | **Owner covered**: honest comparison with the most recent day nobody was missing (covers, walk-outs, ★), or a plain line if there isn't one; **Hire →** goes to tomorrow's Staff tab. | `DayResult.ownerCovered` |
| Evening | Walk-outs > 5 and room for a table → "Buy a table →" (tomorrow's Restaurant tab). | |
| Evening | **Worst dish** ignores dishes under 3 plates; labelled "Lowest quality" (one dish ≥ 8 points below the rest's average) or "Least popular" (fewest plates against its own course), with the reason; "Nothing stood out" otherwise. Uses the service tally still on the state in the evening. | `state.service.dishes` |
| Status bar | ⚙ Settings: auto-pause on incidents, starting speed. `localStorage` key `full-plate:settings:v1` (not in the save). | |
| Title | Saved game shows the name, then **Day N · £cash** large, the date small. | |

### Review fixes (docs/REVIEW.md)

- "86": header reads **"Take off today's menu (86)"** with a tooltip; each button has a tooltip and an aria-label "Take X off today's menu"; done rows say "Off today".
- Keyboard: seated tables are a list of buttons in Manager's actions (Tab to move, Enter/Space to select). Space/1/2/4 shortcuts are ignored when focus is on a button, input, radio, tab or link (`shortcutsBlocked`), so Space presses the focused button. Escape still clears the selection.
- Contrast: `--tomato` `#e0533d → #c4412b`, `--basil` `#4d8f47 → #3c7a37` (canvas copies too). As text on cream 4.6:1 / 4.8:1; white labels on them 5.1:1 / 5.2:1 (were 3.5–3.9:1).
- Walk-outs → table tip and worst-dish filter: see the table above.

### Before and after the sim lands

The UI reads every round-2 field as optional:

- `incidents`, `goals`, `ownerCovering` undefined or empty → no incident cards, no Goals card (Planning keeps its old full-width layout), no banner. `DayResult.incidents/ownerCovered` absent → those evening blocks are hidden.
- `TRAIN` / `GIVE_BREAK` / `RESPOND_INCIDENT` rejected (LOG "bad") → a toast. During service a refusal is a result with exactly one LOG "bad"; it becomes a toast and is kept out of the ticker.
- `sim.ts` reads `TRAINING_FEE` (or `TRAIN_FEE` / `TRAINING_COST` / `TRAIN_COST`) and `suggestedOrder` by name, so the game typechecks and runs with or without them. `restockLines()` (planning/stockNeeds.ts) calls `suggestedOrder` when present, else the UI forecast. The evening "Restock for tomorrow" and the Stock tab "Fill what's short" both go through it.
- `Staff.trainingDay/breakUntilTick` are read through `lib/staff.ts` helpers.

### Verified against the live sim

When this section was written, sim-core's round-2 work was in the working tree but not committed. The game typechecks and all 41 tests pass against it and against the committed sim-core (a worktree at `d75082e`). A Playwright run on the live sim (2×, Student Quarter, chef only) showed the following. Goals came from the sim. Goal toasts fired. The owner-covering banner appeared. A `big_party` incident auto-paused the game and was resolved by clicking an option. The evening list and the owner-covered note were correct. "Restock for tomorrow" used `suggestedOrder`. `TRAINING_FEE` (£120), `BREAK_TICKS` and `TRAINING_SKILL_GAIN` are picked up by name.

**Still to do once sim-core commits:** delete the UI forecast (`stockNeeds`/`shortfall`/`expectedCovers` fallback in `screens/planning/stockNeeds.ts`) and import `suggestedOrder` directly in `sim.ts`. It is kept for now so the committed game still builds against the committed sim-core, which lacks `suggestedOrder`. The Stock tab's per-ingredient "needed" column also comes from the UI forecast. The sim's forecast API returns only order lines, not per-ingredient need.

### Tests

`src/__tests__/round2.test.tsx` (+ `fixtures/round2.ts`: a real `newGame` state with incidents, goals and owner coverage added by hand; every transition still goes through the real sim): RESPOND_INCIDENT from the card and through the reducer (asserting either outcome: resolved by the sim, or refused as a toast), alert/ticker absorption, auto-pause rules, highlight targets, evening incident lines, goals rendering/tiers/flash/toast, the worst-dish filter, train blockers, owner-covered copy, and the keyboard guard.

### Screenshots

Playwright, fixture saves made with the real sim (scratchpad `shots/r2/`): `01-title-saved`, `02-planning-goals-firstrun`, `03-planning-help`, `04-planning-staff-train`, `05-settings`, `06-service-incident`, `07-service-incident-hover`, `08-service-goals-open`, `09-service-owner-covering`, `10-evening`, `11-evening-shortcut-to-restaurant`, `12-service-keyboard-table`, `13-service-after-respond` (pre-sim: the refusal toast "Unknown command."); live sim: `20-live-planning-goals`, `21-live-staff-train`, `22-live-service-incident` (auto-paused), `23-live-incident-resolved`, `24-live-evening`.

### Contract gaps (round 2)

12. **Incident severity / option outcome tone.** `INCIDENT_RESOLVED` has free text only; the ticker colour is guessed (ignored = bad, else good unless the text sounds bad). An `outcomeKind: "good" | "bad"` would remove the guess.
13. **Option affordability.** `IncidentOption` has no `disabled`/`reason` (e.g. "no porter on", "not enough cash"); the UI can only show the cost.
14. **Training fee and effect** are not described by the contract; the UI shows "£—" until a constant is exported and can't preview the skill gain.
15. **Break length.** No constant for how long `GIVE_BREAK` lasts, so the button can't say "15 min".
17. **Incident start lines.** The sim logs the incident title as a LOG "bad" with an extra "!" ("Whoops, a spill!!"), which duplicates the card. Consider kind "info" and no added "!".
16. **Goal reward paid?** `GOAL_COMPLETED` has only `goalId`; the toast reads the reward from `state.goals`, which assumes the goal is still in the list after completion.

## Round 3 (start picker, career, hands-on, the fork, Empire, Stars)

All four path packages are mounted, and the round-3 sim-core hooks (`3161364`, `54a21a6`) are in use. `sim.ts` still probes them at load (`HOOKS`), so this game also builds against an older sim-core. Every probe is true on the committed sim-core.

### Content
- The sim always cooks with **`fullContent`** (plus `extras.incidentText`/`goalText` in the pack), so a save that names `ff_*`/`fd_*` dishes loads.
- Career employers use the library pack (`careerContent`), because the AI owner picks from whatever it is given.
- The recipe book (`lib/library.ts`) and the suggested starter menu use `inLibrary`. The fast-food section unlocks after the Empire choice and fine dining after the Stars choice.

### Screens

| Screen | What |
| --- | --- |
| Title | **Continue** (owner save) and **Continue career** (career save), each with a save card. **New game** opens the start picker. |
| `StartPicker` | Five starts with a line from the brief (Owner, Apprentice chef, Bar, Waiter, Restaurant manager), plus difficulty and district. Employee starts also ask for a name and a first boss (balanced, premium or cheap). Owner goes on to the old lease screen with the district and difficulty preselected. |
| Career › Planning = `career/MyShift` | Today's status, the four meters, and what the owner did this morning. Also: the week's 7 shift toggles (`TAKE_SHIFT`), ask for a promotion or a raise, a mentor hour, the promotion checklist (rung copy from `careerText`), co-workers with mentor and rival tags, offers (accept or decline), the savings bar, the last payslip, and **Open my own place** (pick a district, preview the perks, `OPEN_OWN_PLACE`). When out of work, the same panel shows the offers with a Next day button. |
| Career › Service | "Watch your shift": the old Service screen, read-only. The player is ringed, incident cards have no buttons ("The boss is dealing with it"), and comp and 86 are hidden. **Play my shift (hands-on)** mounts `HandsOnShift`. **Skip to end of shift** runs the remaining ticks, with the owner answering incidents. Managers and days off only get Watch. |
| `HandsOnShift` | The handson canvas. One 60 fps fixed-step loop runs `updateSession` → `handsOnResults` → `render`. The sim ticks every 1.5 s (a 3-minute service). Keyboard and gamepad come from `createInputSource`. It has Pause, Skip and (for jump-in) **Back to the office**. Shown with `SET_HANDS_ON { role, staffId: "player" }` for the career. |
| Career › Evening = `career/CareerEvening` | Pay, tronc so far, the hands-on score, the meters, the savings bar, the payslip on pay day, the weekly review card (Sundays), a promotion banner, today's career log, and the team. **Next day** calls `finishCareerDay` with the owner's queued evening commands. |
| Handover | `career/HandoverModal`: savings, loan, cash at opening and perks. The owner game then continues under the career save key. `SET_OWNER_PROFILE` gets the player's stats. The manager's cheaper hiring uses `GameState.recruitmentFee`, with `applyWithPerks` as the fallback. |
| Owner › Service | A **Jump in** card (on the pass, on the floor, behind the bar). It mounts `HandsOnShift` (open-ended) until Back to the office or close. |
| Fork | `paths/ForkCard` in the evening. It appears when **day ≥ 365** and either **popularity ≥ 60** or **≥ 90 profitable days**, and only for the owner game (including after a career handover). The choices are **Think about it** (the card returns 7 days later), **Be everywhere** (brand name) or **Be the best**. Empire needs at least 14 trading days of history to calibrate. |
| Planning › **🍔 Empire** tab = `paths/EmpireTab` | KPI row; association and overdraft alerts; the SVG world map (adapted from the sim-empire demo, keyboard-focusable city pins); "money from the flagship" (`TRANSFER_FROM_FOCUSED`); the news log. Side panels: **City** (blurb, facts, country rules, Enter city, Localise, open a company or franchise site per district), **Sites** (Run it hands-on = `FOCUS_SITE`, buy the plot, sell franchise, buy back, remodel), **Brand** (lock the formula, the research tree, the 3 formula presets from `extras.formulas`, recognition bars, campaigns, product launch, franchisee idea, suppliers) and **Contract** (fee, royalty, ad fund, rent ±, attractiveness). Buttons the association blocks are disabled, with the reason as a tooltip. |
| Planning › **⭐ Stars** tab = `paths/StarsTab` | The five prestige-track cards (`criticText.guideNames`); the kitchen card (stress, steadiness, chef reputation, rumours, cosy hint, relaunch, hand back, the El Bulli close); tasting menus (`SET_SET_MENU`, in-season pill); test kitchen; sourcing; bookings and ticketing; stagiaires (paid or unpaid, count); the group (satellites, train head chef, rival); refit (`CLOSE_FOR_REFIT`); last night's log. The Smyth-arc card (back or let go) sits at the top while it is live. It reads `starsView` only. |
| Guide day | `paths/GuideEnvelope`: a sealed envelope, then **Open** reveals the stars (animated), a line from `criticText.guideDay`, the reason, and the year's inspector table. The header badge keeps last year's stars until it is opened. |
| Header | Path badges (Career, Empire, Stars). Career rungs show savings, rung, reputation and mood instead of cash and loan. An **Empire strip** shows sites, meals served, HQ cash, franchisee mood and the association. A **Stars strip** shows the stars, days to the guide, stress, steadiness and streak. |
| Owner Evening | Adds an Empire card (meals, HQ, sweep the till to HQ), "News from the guides" (Stars events) and the jump-in score. |
| `WinScreen` | Uses the GameOver shape. Empire meals or regions win, and Stars dynasty, El Bulli or handed back (text from `criticText.endings`). It has Keep playing (wins) and Title screen. |

### Wiring (state/pathEngine.ts, state/gameReducer.ts)
- `AppState.meta: PathMeta` (state/paths.ts) holds the career, the empire, the stars, the fork, the win, the hands-on session and event lists. `appReducer` runs `settle()` after every transition:
  - **On entering evening, event or gameover**, `eveningHooks` runs once per sim day (`lastPathDay`): `stepCareerDay` (it queues the owner's closing commands), `stepEmpireDay(content, empire, history.at(-1))`, and `stepStarsDay` → `applyStarsEffects` → `FIRE` on `HEAD_CHEF_LEFT`. Then it decides on the fork card.
  - **On entering planning**, it runs once per day (`morningDay`): `beginCareerDay` (the AI owner plans), and for Stars the refit handling.
- **Career service:** every tick runs `ownerIncidentResponses` before `tick`, and career shifts don't stop for incidents.
- **Pack:** `packFor(meta)` is the career library pack, or `withSignatures(fullContent, stars)` on the Stars path.
- **Stars refit:** Planning shows "Closed for the refit". The button takes everyone off today's rota first (`CLOSE_TODAY` pays rostered staff 50%), then sends `CLOSE_TODAY`. `prepareService`'s ×0 footfall is kept only for an ended run.
- **FOCUS_SITE:** it parks the current site's GameState (serialised in `meta.parked`) and recalibrates the model on that site's history when it has ≥ 14 days. The new site gets a parked state if it has one; otherwise it gets a fresh `newGame` with the formula menu at the brand's price index, no loan and the flagship's team.
- **Saves:** see `state/save.ts`. The envelope is `{ kind: "full-plate", v: 1, game, career?, empire?, stars?, meta }`, with each layer's own serialiser. Owner games use `full-plate:save:v1` and career games `full-plate:career:v1`. A bare round 1–2 GameState under the owner key still loads as a plain owner game. Saves are written on day or phase change and on path changes (fork, empire or stars command counters, career day or log).

### Stubbed or thin
- **Rival stars across the group:** satellites never earn stars (sim-stars). "Across the group" means the flagship.
- **Product launch:** it uses a fixed name ("The Big One") and the stretch fit. There is no naming dialog.
- **Franchise sale:** it always goes to the first waiting applicant. There is no applicant picker, and no ownership slider per region.
- **Promoted sites (FOCUS_SITE):** they copy the flagship's team instead of hiring by `staffQuality`. There is no `newGameFromSite` in sim-core.
- **Hands-on summary:** fed into `stepCareerDay` (review pass): the running score is reported each tick (`handsOnScore`).
- **Former colleagues:** the Staff tab lists "Old colleagues" after a handover and hires them with sim-core `HIRE_STAFF` (review pass).
- **Code-split (review pass):** HandsOnShift, MyShift, CareerEvening, WinScreen, GuideEnvelope, HandoverModal, EmpireTab and StarsTab are `React.lazy`; vite `manualChunks` splits react/content/sim-core/paths.
- **Fork (review pass):** also needs the last 28 days in profit; a Sunday evening card says what's missing. Empire buttons are disabled with "Needs £X; HQ can spend £Y". Stars owners get "Close tonight". `?autopilot=0–1` lets handson's bot play the canvas.
- **Empire charts** (monthly sparklines) and the per-site detail drawer from EMPIRE-NOTES are cut.

### Tests (`src/__tests__/round3.test.tsx`, `r3content.test.ts`)
- **Start picker routing:** owner vs career, and all five starts.
- **A whole employee day through the reducer:** the owner plans, the shift runs, `stepCareerDay` runs, and the owner closes the day. `TAKE_SHIFT` re-rosters the player.
- **Fork trigger:** not before day 365, not without the milestone, not in career. The card shows in the evening, Think about it snoozes it 7 days, and Empire forks.
- **Path wiring:** the empire steps once per evening, and a transfer moves till cash to HQ. The stars layer steps.
- **Save envelope:** owner, Empire and Stars round-trip; legacy bare saves load; the career key is separate; envelopes with a future version are rejected.
- **Hands-on:** `SET_HANDS_ON` on start and stop, `PLAYER_COOKED` reaching the live tally, and the career `staffId`.
- **Content:** the full pack round-trips with `ff_*` dishes, the starter menu is library-only, and recipe-book unlocks follow the path.

### Screenshots (scratchpad `shots/r3/`, script `shots/r3.mjs`; fixture saves generated with the real sim)
`01-start-picker` · `02-my-shift` · `03-watch-shift` · `04-employee-handson-shift` · `05-career-evening` · `06-career-next-morning` · `07-fork-card` · `08-evening-after-snooze` · `09-owner-service-jumpin` · `10-owner-jumped-in` · `11-back-to-office` · `12-empire-map` · `13-empire-city` · `14-empire-brand` · `15-stars-tab` · `16-guide-envelope` · `17-guide-envelope-open`. The run had no JS errors.

### Round 3 review: Stars fixes (`d26ab5f`, `ebada83`, `ff57da7`)

| Where | What |
| --- | --- |
| Planning, notices strip (every tab) | **Stock warning** (`planning/StockWarning.tsx`) when the larder **on hand** won't cover sim-core's forecast (`forecastNeeds`) for a menu dish: "📦 Tonight's larder won't cover 4 dishes (2 will be off the menu when the doors open): Duck (none left), Lamb (about 3)…", then "Deliveries arrive tomorrow morning, so tonight cooks from what's on the shelf." Buttons: **Order to cover tomorrow · ≈£X** (sim-core `suggestedOrder` → ORDER_STOCK lines; becomes "✓ Ordered") and **See the larder**. Hidden on day 0 and while closed for a refit. Logic: `tonightRisk()` in `planning/stockNeeds.ts`. |
| Same, Stars in inspection season | The callout turns red with `role="alert"` and a headline: "🕵️ **Inspectors are about — a short menu tonight could cost you a star.**" ("the star" once one is held), plus "3 dishes or more off counts as an off night for the guide. Closing tonight doesn't count against you." (the existing **Close tonight** button). |
| Evening, Stock for tomorrow | In inspection season (for tomorrow) with something short, the card is red and adds "🕵️ Inspectors are about. Run out tomorrow and a short menu could cost you a star." |
| Evening, News from the guides | 📉 the sim-stars `SHORT_MENU` sentence: which dishes were off and that the guide counted an off night. |
| Stars tab, top of the left column | **What's holding you back** (from your last week): the top two criteria below the next star's bar as a pill + one sentence (`starsHints`), the rest under "Also worth a look (n)", a line after a guide day naming the criterion last year's inspectors marked lowest (revealed visits only), and "The inspectors' own marks stay secret until guide day." |
| Staff tab | Hire buttons use `hireCheck` (see "The sim door"). |

Why the button says "tomorrow": `ORDER_STOCK` is delivered the next morning, so nothing ordered in the morning can cover tonight. The honest choices tonight are a shorter menu or closing; the order protects tomorrow. A same-day buy needs sim-core (STARS-NOTES §5.9).

Tests: `src/__tests__/starsReview.test.tsx` (real sim + reducer): `tonightRisk` vs `suggestedOrder`; the plain and the inspection-season warning; no warning when covered; an empty larder in inspection season played through the reducer ends with a named `SHORT_MENU` and one more window entry; the Stars tab hint card; `hireCheck` against sim-core's HIRE at the cash edge (with and without the career fee) and the Hire button's disabled state.


## Round 5 (readability for a 10-year-old at 1280×800)

### Type scale

| Token / rule | Size | Use |
| --- | --- | --- |
| `--fs-base` | 16 px | body copy, Empire side panel |
| `--fs-sm` | 15 px | secondary copy, small buttons, callouts |
| `--fs-xs` | 14 px | **the minimum for any sentence**: hints, subtitles, table cells |
| `--fs-label` | 15 px | panel labels (KPI and track labels, big-number labels) |
| `--fs-micro` | 13 px | tiny chrome only: tab badges, initials, clock ends, caps counters, `.term__real` |
| canvas | ≥ 13 CSS px | `RestaurantView` (`CANVAS_MIN_PX`) and handson `render.ts` (`MIN_TEXT_PX`) floor every label; both draw in CSS pixels at the container size |

**Nothing on screen is below 13 px.** Two guards:

- `src/__tests__/typeScale.test.ts` (vitest): tokens, every CSS `font-size`, inline TSX `fontSize`, and the canvas label sizes in both renderers.
- `scripts/type-audit.mjs` (Playwright): walks 25 screens (title, start picker, lease, the four planning tabs, help, settings, service, evening, fork, game over, win, the Empire tab and its three panels, Stars, my shift, watch, hands-on, score card, career evening) at 1280×800 and fails on any rendered text below 13 px: DOM text by `getComputedStyle`, SVG text times its on-screen scale, canvas text through a `fillText` probe. Screenshots at deviceScaleFactor 2.

  ```
  pnpm --filter @full-plate/game build
  node packages/game/scripts/type-audit.mjs     # starts `vite preview` on :4173 if nothing is there
  ```

  Env: `FP_AUDIT_SHOTS` (screenshot dir, default `scripts/.audit-shots`), `FP_AUDIT_MIN` (13), `FP_AUDIT_ONLY` (comma list of screen names), `FP_AUDIT_URL`, `FP_AUDIT_SKIP_GEN=1`. The saves it loads are built first by `scripts/audit-saves.gen.ts` (real sim, run through `scripts/vitest.audit.config.ts`; not part of `pnpm test`). Exit 1 when anything is too small or the page throws.

### The Term convention

Trade words stay (the brief wants real economics) but never stand alone. `lib/glossary.ts` holds each one as `{ term, plain, explain }`; `components/Term.tsx` shows it:

- `<Term id="royalty" />`: the plain label ("Money the brand gets from each shop") with the real word in small text beneath (`.term__real`), and `term: explanation` as the tooltip. Use it for labels: KPI keys, fact lists, contract rows, card titles.
- `<Term id="covers" inline>guests</Term>`: a dotted-underline `<abbr>` (focusable) whose tooltip is the term and the one-liner. Use it inside sentences.
- `children` replace the plain label; the real word is kept either way.

Add a word to the glossary before using it in UI copy. Covered so far: covers, footfall, prestige, popularity, margin, 86, takings, tronc, the four menu-matrix quadrants, food guides, stagiaires, consistency, and the Empire words (royalty, ad fund, franchise fee, rent on your land, take, franchise, company-owned, licence, standardisation, recognition, saturation, cost index, HQ cash, the development facility, overdraft, the association, franchisee mood, margin 7 days, crew skill, property, remodel). RevPASH, GP%, amortisation are not on any screen.

### Empire side panel

Three tabs instead of four: **🏪 My shops** (the picked city: facts, country rules, open a site; then every site), **🍔 The brand** (formula, presets, recognition, campaigns, suppliers) and **💷 Money** (HQ money and what it can spend as two big numbers, the move-from-the-flagship control, which used to sit under the map, and the franchise contract). Each site shows three big numbers (profit this week, sales a year, how alike) with the real term beneath, instead of one 12 px line. Every control from round 4 is still there (`empireFocus.test.tsx` checks them). Map labels are 13.5–14.5 px on screen.

### Other layout fixes for the bigger type

- Planning › Menu with the goals sidebar: each dish row is two lines (name and facts, then price, margin and buttons); it was five columns that broke the name a word a line.
- Hands-on bar may wrap the key hints onto a second line; the clock track keeps 12:00 and 22:00 apart. The hands-on header is 80 px (was 64) so 13–14 px ticket slips fit.
- Result (audit, `FP_AUDIT_MIN=13`): 1331 text runs below 13 px before (12.5 px `--fs-xs` everywhere, 10–11 px canvas labels, 10.5 px SVG), 0 after, on every screen.

### Contrast

WCAG AA (4.5:1) is checked in `src/__tests__/contrast.test.ts` against the live tokens. Changes: `--ink-faint` `#72675c → #6a5f54` (was 4.4–4.5:1 on cream-deep and the tomato/plum washes); new `--sky-deep` (porter avatar, white 5.1:1; was 3.5:1) and `--amber-deep` (score-card "work on" badge, white 5.4:1; was 2.2:1); canvas faint labels use `#6a5f54` / ink-soft (were `#8f857a`, 3.3:1 on the kitchen tiles); menu-matrix axis labels use ink-soft. Tomato `#c4412b` and basil `#3c7a37` already pass (4.6 / 4.8:1 on cream; white on them 5.1 / 5.2:1).

### Round 5 review

- **`<Term>` tooltips are keyboard-accessible.** The explanation was a `title` attribute (never shown on focus, unreliable in screen readers; the block form wasn't focusable). Both forms are now `tabIndex=0` with `aria-describedby` → a `role="tooltip"` span shown on `:hover`/`:focus`/`:focus-within` (no fade: a fading tip read through to the text beneath). In tests, strip `.term__tip` before matching `textContent` (`visibleText` in `empireFocus.test.tsx`).
- **Service canvas:** table numbers draw after people and staff (`drawTableNumbers`, paper ring); a full room hid 7 of 11 badges.
- **Menu matrix:** labels try above then below their dot, avoid the quadrant titles, the axis label and other dots, are clamped inside the chart and cut at 22 characters (`shortName`); hover still labels any dot.
- **Empire:** the city card's "(collapse below £400k)" (stale: it ignored the price level and showed with no shops) → "(a shop below £X is in trouble)" in today's pounds, or "no shops yet". Each Franchise button carries a verdict ("they'd do fine / only just get by / lose money"; basil-deep / amber-deep / tomato-deep on paper, all ≥ 4.5:1).
- Audit after these: 25 screens, 0 text runs below 13 px, 0 page errors.

## Round 7 — A (career and hands-on UX)

Audit: `docs/UX-AUDIT-R7.md` § A (2 P1, 9 P2, 8 P3). Screens at 1280×800 and 1024×768 with touch emulation (iPad
landscape); before/after shots in scratchpad `shots/r7/a/{before,after}/`, scripts `career.cjs` (screens + a tap-target,
text-size and contrast probe) and `touchplay.cjs` (a touch-only playthrough: onboarding → fridge → USE → prep → chop).

| Where | What changed |
| --- | --- |
| Hands-on, touch (A1, P1) | `lib/touchControl.ts`: tap a station to walk there (handson `steerToward`), press the station she's at — or anywhere while a verb runs — as USE (held while the finger is down, so a tap chops and a hold cooks/pours), tap a slip to go to the fridge. Big **USE** (88 px) and **Drop** (62 px) buttons in a column at the far right over the back-bar shelves. Pointer events with capture, presses latched for one read, `touch-action: none`. Touch is on when `(pointer: coarse)` matches (`lib/device.ts`) or after the first touch on the canvas; key hints hide and the canvas says **USE** instead of **E** (`HandsOnView.keyLabel`). |
| Hands-on, onboarding (A2, P1) | `lib/onboarding.ts` + the overlay in `HandsOnShift`: three steps with a spotlight and a pointer card — **Grab a slip** (rail), **Cook at your station** (her appliance), **Send it to the pass** — per role (server and bar get their own three). Shown once per save and role (`full-plate:onboard:v1:<role>:<seed>` in localStorage; a blocked store just shows it again), **Skip** at any step, replay from the **?** button. The shift waits while it is up. `?autopilot` pages through it every 2.5 s. |
| Hands-on bar (A3, A10) | One row at 1024 px: kicker is the station label only (`shiftKicker` → "Your shift · Sides · Desserts"), no duplicate points (the canvas HUD has them), key hints hidden on touch and below 1100 px; **?**, Pause and Skip are 44 px. The world went from 23 px to 32 px tiles at 1024×768. |
| Canvas (A4, A5) | Her station's appliances: dashed tomato outline and a **Yours** tab. Tables: a mood face (happy / flat / cross at 60% / 30% patience) and a 5 px ring over a faint track. Slips: a draining wait bar along the bottom in the head colour. |
| Canvas (A12–A15, R6 P3s) | "PASS" moved to the counter's left end; NPCs drawn clear of the player (`avoidPlayer`); a toast born on a head rises beside it; the sous chef **sets off when a slip falls due** and waits under it (HANDSON-NOTES Round 7). |
| Score card (A7, A8) | Spans the evening: result (stars, headline, notes) beside a ticket-style **Next shift, try this** — the coach's tip at 20 px (E → USE on touch, `forDevice`) and one sentence from the night's numbers (`nightCoaching`: "Three plates at 89% tonight — about two more plates would have earned a second star", using `ShiftSummary.nextStarAt`). The page heading became "Evening at <restaurant>"; the shift's numbers are a short list; "bond -1" is words ("just met"). |
| My shift (A9, A10, A19) | Why promotion/mentor are grey, as visible text under the buttons; 44 px buttons, 48 px weekday toggles; disabled buttons dashed at 0.62 opacity; "You're on today" is one short sentence (first shift: "starts with a quick how-to"). |
| Start picker | Back is 44 px. |
| Lazy chunks (A16) | `components/Skeleton.tsx`: a page-shaped placeholder with a slow sheen (still under reduced motion) instead of "Loading…" (App's `Loading`). |
| Keyboard | handson input ignores keys whose target is a button or field (`onControl`), so Enter/Space press Next, Pause and Skip during a shift. |

Shared files: theme.css additions are appended under `/* R7-A */` (no tokens or classes renamed or removed);
`components/Skeleton.tsx` is new; App.tsx's `Loading` now renders it (one line).

Numbers: HandsOnShift chunk 84.1 → 95.9 kB (budget ~170). Type audit (`FP_AUDIT_URL` on a private port): 27 screens,
0 text runs below 13 px, 0 page errors. Probe after (per screen, 1280 / 1024-touch): every career control ≥ 44 px
except the header's Settings (C) and the watch view (B's Service.tsx, A11); the two remaining sub-4.5:1 runs are
the disabled promotion/mentor buttons (now ~3.9:1, disabled controls are exempt), with their reasons as text.

Tests: `src/__tests__/round7.careerUx.test.tsx` (onboarding steps, storage once per save/role, card placement and
spotlight; the overlay in `HandsOnShift` once per save, Skip, replay, the touch switch; the touch controller on a real
session; coaching; the sous chef's lead-in over three bot shifts through the reducer) and handson `test/r7.test.ts`.

Still open: the career start button sits ~1,400 px down the start picker at 1024×768 (A17); the watch view's small
"Play my shift" and its "Break" buttons on a read-only career view are B's (A11); slip pills can crowd "TABLE n"
on a 132 px slip.

## Round 7 — B (the owner's daily loop)

Audit: docs/UX-AUDIT-R7.md § B (4 P1, 10 P2, 6 P3). Every P1 and P2 in my surface is fixed; the shell items (toast
anchoring, Save & quit / ⚙ at 34 / 32 px) belong to agent C.

### What changed

| Where | What |
| --- | --- |
| Planning, Service, Evening | **Three beats.** `components/DayRhythm` (☀️ Get ready → 🍽️ Service → 🌙 Evening; done beats ticked, the current one ringed in its colour, `aria-current="step"`) heads Planning and Evening and sits compact at the top of the Service side panel. It replaces the caps "MORNING" / "EVENING · DAY 22 · …" eyebrows (the date stays in the status bar and as the Evening heading's tooltip). |
| Planning, Evening | **One primary button, always bottom-right.** `.actiondock` is sticky at the bottom of the scrolling page: Planning's hints + **Open for service →** (was below the fold on every tab at 1280×800 and 1024×768), Evening's average spend + **Next day →** (was top-right). |
| Planning › Menu | Opens on **📋 Today's menu** (the dish list, full width). **📊 Menu matrix — for experts** brings back the 2×2 and its legend beside the list. The choice is remembered per browser (`localStorage` `full-plate:menuView:v1`, try/catch; list when blocked). The matrix + legend are `planning/MenuMatrixPanel` (React.lazy, 4.1 kB chunk); `QUADRANT` moved to `planning/quadrants.ts` and is re-exported from `MenuMatrix`. The ✕ that removes a dish asks once (Remove / Keep). |
| Planning › Stock | A summary line ("Next service: about 117 guests. 14 things will run short — tap Fill what's short, then Place order.") and, per ingredient, **"You'll need about 31 — you have 23. Order 8 more."** (`forecastLine` in `lib/dayLoop.ts`; need rounds up, stock rounds down, orders count as "+ N coming"). Fixes the raw floats ("16.508", "short 7.440000000000001"). The column is "Next service". |
| Planning › Staff | **Who's on this week** (`planning/RotaWeek`), full width above the team: a row per job, a column per day (today marked), a face per person. Two or more in one job on a day = amber cell with "×2"; nobody = red "You". Under it, in words: "Two chefs on Fri, Sat and Sun — the extra shifts cost about £559 a week." (`doubledShifts`: every shift but the dearest each day, i.e. the least she'd save). After a losing fortnight (`meanProfit` over `ROTA_ADVICE_DAYS` < 0, the round-5 rule) the note turns red. The person cards' rota buttons on a doubled day are amber-deep with "another chef is on too". Replaces the "Who's on each day" table of numbers. |
| Planning › Restaurant | Table chips `#8f6436` (white numerals 5.6:1; were 2.5:1). |
| Service | **Live summary**: 🍽️ Served, 😊 Happy (stars), ⏳ Waiting (people in the queue), 🚶 Walked out, each with "▲ 3 this hour" coloured by whether up is good (`hourTrend`, one sample per tick kept in a ref; cosmetic). The walk-out tile flashes when the count goes up. "Takings so far" counts up. The **speed deck** reads ❚❚ Pause / ▶ 1× / ▶▶ 2× / ▶▶▶ 4× (52 px tall; paused turns amber-deep, "Paused"). Jump in moved below the summary, so the clock, speed and summary are first. |
| Evening | **Tonight's money** (`TonightMoney`, exported): "Tonight you made / lost", a 64 px figure with ▲/▼ in basil/tomato that counts up from £0, "£52 worse than last night", guests / walked out / stars / cash in the bank, and the last seven nights as up/down bars (tonight outlined). The P&L table is a `<details>` "Where the money went" (closed; the table and its rows are unchanged). The four KPI tiles are folded into the figure. The tip card is still first (tests unchanged). |
| GameOver | The cause in one sentence from her last fortnight (`gameOverCause`): "You lost money on 11 of your last 14 days, mostly because wages took £6 of every £10 that came in (two chefs were often on the same shift)." (wages / food / rent and bills / loan; the doubled-up clause when `rotaAdvice` holds). The bank's rule follows in small text. Buttons: Title screen · New game · **Play this start again** (same seed; the seed is only in its tooltip). **No "try again from last Monday"**: a game over deletes the save and nothing keeps a weekly snapshot; that would need a second save slot. |
| Morning post | Effect chips carry ▲/▼ as well as colour; "footfall" → "people passing". |
| Micro-feedback | `MoneyText countUp="change" \| "mount"` (eases over 650 ms; off under prefers-reduced-motion and where `matchMedia` is missing; `data-pence` and the accessible name are the final value). Ghost buttons get a pressed state; rota toggles press down. |
| Tap targets | On `.planning`, `.evening`, `.actiondock`, `.service__side`, `.gameover`: buttons ≥ 44 px tall, steppers and ✕ 44×44, rota days 44, Break / table list / goals toggle 44. Career, paths and the shell keep their sizes. |

Styles: one block at the end of theme.css under `/* R7-B */` (add-only; new tokens `--beat-morning/-service/-evening`).
Pure selectors: `lib/dayLoop.ts` (`forecastLine`, `wholeHave/wholeNeed`, `rotaWeek`, `doubledShifts`, `daysPhrase`,
`losingFortnight`, `lastNights`, `versusYesterday`, `gameOverCause`); `sim.ts` re-exports sim-core's `rotaAdvice`,
`meanProfit`, `ROTA_ADVICE_DAYS`. No sim rule or command changed.

### Numbers

- Probe (`shots/r7/b/shoot.cjs`, 1280 / 1024): targets < 44 px Menu 22 → 4 / 12 → 3 (left: the shell's Save & quit and ⚙, and the inline `margin` glossary word), Staff 16 → 2, Stock 9 → 2, Service 12 → 2–3 (⚙, the inline "Served" word, the toast's ✕), Evening 7 → 5 (shell 2, inline glossary words 2–3), GameOver 3 → 0. Contrast: Restaurant 6 → 0. Text < 13 px: 0 → 0.
- Type audit (`FP_AUDIT_URL=http://localhost:4792/`): 27 screens, 0 text runs below 13 px, 0 page errors.
- Bundle: main JS 171.5 → 178.7 kB (+7.2), main CSS 75.0 → 85.6 kB (+10.6); the matrix is a 4.1 kB lazy chunk.

### Tests

`src/__tests__/round7.dayLoop.test.tsx` (14): the Menu list/matrix toggle (default list, lazy matrix appears, choice
remembered, back to list), remove asks once; `forecastLine` (short / ok / coming / idle / opening, rounding) and the
Stock tab on a real played day (fractional stock, no fraction shown, every row's line); `rotaWeek` / `doubledShifts`;
the week strip's doubled and empty cells, labels, note, red after a losing fortnight; doubled marks on the person
cards; `TonightMoney` (lost, ▼, vs last night, 7 bars, tonight's bar) and `MoneyText countUp` keeping the final value;
`gameOverCause` for wages + doubled shifts, food, rent, an empty room, no history; GameOver renders the cause and no
"seed"; `hourTrend`; `DayRhythm`.

### Screenshots

Scratchpad `shots/r7/b/before/` and `shots/r7/b/after/`: `{1280,1024}-planning-{menu,staff,stock,restaurant}`,
`-planning-menu-matrix` (after), `-planning-first-day`, `-service-1x`, `-service-paused`, `-evening-after-service`,
`-evening-{rota,overstock,dog}`, `-evening-rota-why`, `-evening-rota-full` (full page), `-gameover`; `report.json` in
each holds every probe offender.

### Left open

- Toast anchoring (bottom-centre over the service queue at 4×) and the status bar's 34 / 32 px buttons: shell (C).
- "Try again from last Monday" needs a weekly snapshot save slot (save.ts) — not built.
- Inline glossary words are 17–19 px tall targets (inline text; WCAG exempts it).
- Notices (stock warning, worn-out) still take ~250 px above the tabs on a bad morning; the dock keeps Open visible, but the tab content starts low at 1024×768.

## Round 7 — C (shell, onboarding, Stars and Empire)

Audit: docs/UX-AUDIT-R7.md § C (5 P1, 9 P2, 8 P3). Shots: scratchpad `shots/r7/c/{before,after,after-large}/` (script
`r7c/shots.mjs`, 1280×800 and 1024×768, with a `metrics.json` of small targets, contrast and overflow per screen).

### New tokens and shared classes (theme.css `/* R7-C */`)

| Token / class | Value / use |
| --- | --- |
| `--tap` | 44 px: the smallest tap target on the shell, start screens and path screens |
| `--awning` | red-and-cream stripe (the shop awning): top edge of the title, header and win screen |
| `--hero-num` | 44 px (48 with Bigger text): the one big number on a hero card |
| `--cheer` | `#fdf0c9`: celebration wash (win card halo, the board's pick) |
| `--verdict-fair/thin/loses` | basil-deep / amber-deep / tomato-deep (franchise verdict badges, on their washes ≥ 4.5:1) |
| `:root[data-text="large"]` | Settings › Text size › Bigger: `--fs-*` ×~1.12 (16→18, 15→17, 14→15.5, 13→14.5; h1–h3 +3–4 px) and the old hard-coded 17–24 px rules bumped |
| `.btn--tap`, `.iconbtn--tap` | 44 px min height / 44×44 (opt-in; the global `.btn`/`.iconbtn` are unchanged for the other surfaces) |
| `.hero` (+ `.hero__num`) | a card with one big number and one chart-like element (Empire side tabs) |
| `.verdict--fair/thin/loses` | coloured badge with an icon |

No existing token or class was renamed or removed. Two global behaviour changes: `.term__tip` is `display:none` until
hover/focus (the hidden tips widened Planning and the Empire by up to 137 px), and `.tab` is ≥ 48 px with an icon slot.

### What changed

| Where | What |
| --- | --- |
| Title | Original SVG shopfront (`components/Shopfront.tsx`; the only motion is the steam, off under reduced motion). **Continue** is a big card with the save inside it (`aria-label` "Continue", the save as its description); **New game** asks first when a save exists; **How do I win?** opens the explainer. |
| `components/GoalExplainer.tsx` | "How do I win?": two paths, an original picture each (`EmpirePicture`, `StarsPicture`, also on the fork card), three lines each. From the title and the fork (`atFork` changes the first line). |
| `components/Dialog.tsx` | `Dialog` (Escape/backdrop close, focus in and back, ✕ 44 px) and `ConfirmDialog` (`role=alertdialog`, the safe answer focused first). Used by the settings sheet, the explainer and both "Start a new game?" confirmations. |
| Start picker | Five cards: icon disc, one plain line, "🎮 what you play", a 3-pip road-to-your-own-place meter. Heading "Who do you want to be?". Difficulty is `components/DifficultyPicker.tsx` (🧸 Cosy / 🙂 Normal / 🌶️ Hard, one child-readable line each), shared with the lease screen. 5 columns at 1024 too. |
| Header (`StatusBar`) | Awning stripe; a day chip; cash with "▲ made £X yesterday" / "▼ lost …" (`history.at(-1).profit`); one **Settings** button (icon only ≤ 1180 px). Props are now `onQuit` / `onNewGame` (absent during service). |
| Settings (`components/Settings.tsx`) | A sheet: Text size (Normal / Bigger), Sound (On / Off), Service starts at (1× 2× 4×), the pause checkbox, then "Your game saves itself every morning and every evening", **Save and go to the title screen** and **Start a new game…** (confirm). During service: a note instead of the two buttons. |
| `lib/settings.ts` | Adds `sound` (default on) and `textSize` (`"normal" \| "large"`); old stored settings load with the defaults. `applyTextSize` sets/removes `data-text="large"` on `<html>`; `getSettings()` applies it on first read, and `main.tsx` calls it before the first render. |
| `lib/sfx.ts` | `playSfx("tap" \| "good" \| "open" \| "win")`: Web Audio triangle blips, no files; a no-op when Sound is off or Web Audio is missing. Used by good toasts, the fork choice, the guide envelope and the win screen. UI-only, never touches the sim. |
| Tabs | Icon + word on every tab: `TabDef.icon`, else a leading emoji split off the label, else `TAB_ICONS[id]`. The icon is `aria-hidden`, so tab names are unchanged for tests. Stronger active state. |
| Toast | Round icon badge, 44 px ✕, a chime on good toasts. |
| Stars tab | **Hero:** the guide card (stars, the days-to-guide number, a year strip with the inspection season hatched and "today" marked, one sentence that changes in season) beside **What's holding you back**. Then **Your last 60 nights**: one square per night from `stars.consistencyWindow` (the kitchen's own record, never the inspectors'), steady / wobbly / bad, with counts and steadiness. The other four guides follow, smaller. Selectors: `lib/starsStrip.ts` (`nightStrip`, `guideYear`; "bad" is the sim's own off night, `OFF_NIGHT_DROP`). |
| Empire side tabs | **My shops:** "N shops open" + a stacked bar per city (own / franchise / licence; tap a row to pick the city), then the city card, then **Shops in {city}** (the one you run first, five at a time, "Show all N"). **The brand:** "N of 5 regions know your name" + a bar per region with the win line + a meals line. **Money:** HQ's last 30 days + a bar per month from the board minutes. Franchise verdicts are badges. Map pins have a 26-unit invisible hit circle (≥ 44 px on screen). `shopsByCity` is exported. |
| Board meeting | A calendar-leaf date in the banner; a bar under each money line; the decision in its own amber box with a bigger question; option cards with a "💡 The board's pick" ribbon (the "Board's tip" line stays); Skip 44 px. |
| Guide envelope | The inspectors' table has a column per criterion; a chime on opening. |
| Win screen | Confetti (twice, off under reduced motion), "You won!", the final figure (meals, or stars at your best), **the journey** (`journey()`: opened, the fork, first franchise, 100th shop, first star, three stars, the ending; sorted by day), centred KPI tiles, **Save a picture** (a 1200×630 canvas card → PNG download). |
| Fork card | The explainer's two pictures; "How do I win?" opens the explainer over the card; 44 px buttons. |

### Bigger text at 1024 px

Checked on every screen above at 1024×768 and 1280×800 (`after-large/`): no horizontal overflow, no text below 13 px.
At ≤ 1180 px with Bigger text the planning tabs drop their icons and narrow, and the Menu tab's two columns may shrink
(`:root[data-text="large"] .menu-layout`, scoped to Bigger text only).

### Checks

- Type audit at 1280: `FP_AUDIT_TEXT=large` runs it with Bigger text. It now also visits the goal explainer and the
  new-game confirmation (29 screens). Both runs: **0 text runs below 13 px, 0 page errors**. Settings closes with
  Escape in the script (the sheet is a modal).
- Tests: `r7shell.test.tsx` (settings persistence and old settings, `data-text` on and off and on first read, sheet
  close, save-and-quit, new game confirm/cancel, the in-service note, the explainer from the title and at the fork, the
  title's Continue and New game confirm, ConfirmDialog Escape/backdrop) and `r7paths.test.tsx` (`nightStrip`,
  `guideYear`, the Stars hero order, `shopsByCity` + city pick, brand and money heroes, verdict badges, the board's pick
  ribbon, the win journey).
- Main chunk 171.5 → 185.6 kB (+14.1 kB; Dialog, Settings sheet, GoalExplainer and Shopfront are in it). Stars, Empire,
  board and win changes are in their lazy chunks.

## Round 7 — review (conventions after the merge)

- **Sheets hold the clock.** Any `aria-modal="true"` dialog (`lib/modal.ts` `modalOpen()`) pauses Service's ticks and
  the hands-on shift, and owns the keys (`shortcutsBlocked`, handson `onControl`). The hands-on onboarding is
  `aria-modal="false"` and has its own hold. When a sheet closes during a shift, or a bar button is pressed with a
  pointer, focus goes back to the canvas so Space/E use a station.
- **Confirms focus the safe answer** (C's `ConfirmDialog`, B's inline Remove → Keep), and Keep returns focus to the
  control that asked.
- **Toast placement.** Bottom-centre, above `.actiondock`; during service it sits at the top of the floor under the
  PAUSED badge (`toastPlacement`), never over the pavement queue or the speed deck.
- **Term tips flip** leftwards when they would run off the right edge (`placeTip`, `data-flip`): no sideways scroll
  while a tip shows.
- **The planning bar** is two rows at every width: day strip + heading, then tabs + help (B's ≤ 1180 px layout).
- **At ≤ 1180 px**: the Menu is one column (matrix ≤ 460 px above the list); Stock folds Keeps and Unit cost under the
  ingredient; Staff stacks the team above the job hunt (person cards ≥ 340 px). No large-text-only layout rules remain.
- **Start picker**: the start button lives in an `.actiondock` with the choices summed up; the lease shows a picked
  difficulty as a reminder with Change.

## Round 8 — A (maps)

The owner asked for "better maps". The world stays invented (same 5 regions, 12 cities, ids and countries); what
changed is how it is drawn and used. Shots: scratchpad `shots/r8/a/{before,final,final-large,probe}/` (scripts
`r8a/shots.mjs`, `r8a/probe-maps.mjs`, `r8a/drag.mjs`).

### Files

| File | What |
| --- | --- |
| `screens/paths/worldGeo.ts` | Geography and maths only: coastlines (a dozen hand-placed points per landmass, three rounds of seeded midpoint displacement, Catmull-Rom curves), forest/desert patches, scattered trees and dunes, peaks, hills, rivers, region label spots and halo ellipses, `LABEL_SIDE`, `cityPos`, and the pan/zoom functions (`clampView`, `zoomAt`, `centreOn`, `toScreenPct`, `routePath`). `hash32` (FNV-1a) for stable placement. No `Math.random` anywhere. |
| `screens/paths/WorldMap.tsx` | `WorldMap` (Empire), `CityMap`, `cityMix`, `supplyRoutes`, `rentLevel`, `ShopIcon`. |
| `screens/paths/mapParts.tsx` | `MapLegend`/`LegendItem`, `CityBoard` (the tiled district map), `footfallWord`, `districtRent`. No sim-empire import, so the Stars chunk stays lean. |
| `screens/paths/StarsMap.tsx` | The Stars path's map (`starsPlaces`, `homeCity`). |
| `screens/paths/map.css` | Every map style. Map-only colours are variables on `.worldmap, .citymap, .starsmap, .legend` (`--map-sea`, `--map-land`, `--map-coast`, `--map-route`, `--map-halo`, `--map-halo-won`, …). Own/franchise/licence reuse `--tomato/--amber/--plum`; "won" is basil; focus rings `--sky-deep`; tap size `var(--tap, 44px)`. Nothing was added to theme.css. |

### How the world map is built

- **Two layers.** An SVG scene (sea gradient, a faint graticule, recognition halos, two pale depth bands drawn as wide
  round-joined strokes of each coast, land, forest/desert patches clipped to their landmass, terrain symbols, rivers,
  scandal outlines, supply routes, a compass) under an HTML layer of region labels and city pins. Pins are real
  `<button>`s, 44×44, centred on the city, with the name beside them in CSS px. Zooming never shrinks a label (the
  type audit has nothing to find), and the pins are in the tab order in content order.
- **Pins.** A paper disc with a donut of own / franchise / licence and the shop count; a striped badge while any are
  being built; a gold crown on the HQ city; 🍳 on a commissary hub; a small dot for an entered city with no shops, a
  hollow grey dot for one not entered, dashed for forced out. The picked city has a blue ring (`aria-pressed`).
  Accessible name: "Harbourton, Albrenn: 24 shops (1 your own, 23 franchise), 3 being built, your HQ".
- **Tooltip** on hover or focus (`role="tooltip"`, linked by `aria-describedby`): shops by kind, rent level
  (£/££/£££ from `costIndex`), the region's recognition, entry cost if not entered.
- **Halo** (replaces the bar under each region): a radial glow round the region, amber, green once recognition ≥ 60,
  opacity 0.15 + 0.6 × recognition/100 (nothing below 3). The label under each region name says "known 67 ✓".
- **Routes**: a dashed, gently curved line from the hub to every city with shops (open or building). The hub is HQ's
  city; in a region that has a commissary (and isn't HQ's) it is that region's busiest city (green route).
- **Pan/zoom**: wheel (zoom about the cursor; at 1× zooming out — or at 4× zooming in — the wheel scrolls the page
  instead), drag, two-finger pinch, and +/−/reset buttons (44 px, top left). Clamped to 1–4× and to the map's edges,
  so it can't be lost. `touch-action: pan-y` at 1× (a finger can still scroll the page), `none` when zoomed. A drag
  that starts on a pin pans and does not pick. A pin pushed off the frame is transparent and unclickable but stays
  focusable; focusing it re-centres the map. A minimap (bottom right) shows the view while zoomed.
- **Map key**: a 44 px "Map key" toggle (`aria-expanded`) over a row of swatches. Open by default when the map is at
  least 720 px wide, folded when narrower.

### City map

Tapping a pin (or a city row in "My shops") swaps the world for that city: ← World map, the name, country and region,
chips (shops, rent, known), then `CityBoard`: inland districts side by side, the seafront full-width along the bottom
with the sea under it. Each tile: name, "👣 Very busy / Busy / Steady" (content footfall ≥ 100 / ≥ 80 / less), rent
(content `monthlyRent` × city `costIndex`: < £2,400 cheap, < £3,300 middling, else pricey), a shop icon per shop (up
to 12, "+N"; awning in the owner colour, dashed while building, a star on the one you run) and **+ Open here** (free
district) / **+ Open another**. That button switches the side panel to My shops, scrolls to the district's
open-site row (`data-opensite`), flashes it and focuses its first enabled button: the existing flow does the rest.
A city not entered shows "Not entered yet · Enter {city}…", which goes to the Enter button (`data-enter-city`).

### Stars map

`StarsMap` sits under the prestige tracks: the home city's `CityBoard` with every restaurant as a pin (flagship with
its stars, satellites "no stars", the rival with its stars), a locator of the Isles, last guide's revealed visit
count, and the latest two rumours headed "Overheard (might not be true)". In inspection season the flagship's
district gets a plum edge and "🕵️ Inspectors are about". Nothing hidden is read (STARS-NOTES "What the UI may show").

### Numbers

- Chunks: EmpireTab 33.4 → 47.2 kB, StarsTab 18.9 → 23.9 kB, plus a shared `mapParts` chunk of 10.0 kB JS (both
  paths) and 15.5 kB CSS. Empire in total +23.8 kB, Stars +15.0 kB. Main chunk unchanged.
- Tests: `round8.maps.test.tsx` (14): every city on land in its own region; view clamps; every city a focusable
  button with a name; tooltip; zoom buttons clamp and disable; routes only to cities with shops (and from a
  commissary); the key toggles; picking a city shows its districts and Back returns; Open here focuses the side
  panel's row; a city not entered offers Enter; the Stars map pins every restaurant; placement is stable; a hidden
  visit never shows; map styles stay out of theme.css. Game 291 tests, all packages green.
- Type audit: two new screens (`47-empire-map-zoomed`, `48-empire-city-map`): 31 screens, 0 runs below 13 px, normal
  and Bigger. Probe (`r8a/probe-maps.mjs`, the R7 probe's metrics) on the world map, zoomed, tooltip, city map, a
  city not entered and the Stars map at 1280/1024 × normal/Bigger: 0 targets < 44 px, 0 text < 13 px, 0 contrast
  failures, 0 sideways scroll. "Covered" hits left are the Map key sitting under the action dock until scrolled.

## Round 8 — B (interface system)

Brief: make the whole game look designed, not generated, while staying light, friendly and high-contrast for a
10-year-old (Round 11b: the player is 14, the target 12+; see "Round 11b — age 14"). Structure from round 7 is kept (pinned bottom-right primary, day strip above the tabs, settings sheet
holding the clock); this round is tokens, icons, components and a restyle. Styles: the token block at the top of
`theme.css` (rewritten, add-only) and one block at the end under `/* R8-B */`.

### The look in one paragraph

A faint kitchen-tile grid on the **page tier only**; flat paper **panels** with one header row over a hairline; the
**header is a dark ink band** under the awning stripe — the game's HUD — with cream text and lighter "HUD" steps of
tomato/basil/plum; chunky **sticker buttons** (2 px ink outline, hard offset shadow) at 44 px, 52–56 px for the one
primary; **drawn icons** in currentColor instead of emoji chrome; **sentence-case labels** above big Fredoka numbers;
tabular figures in every table.

### Token reference (theme.css `:root`)

Older names stay the source values (`--cream`, `--paper`, `--ink*`, `--line*`, the accents and washes, `--fs-*`,
`--r*`, `--shadow*`, `--gap`, `--beat-*`, `--tap`, `--awning`, `--hero-num`, `--cheer`, `--verdict-*`). The first
`--name: #hex` / `--fs-x: Npx` of each must stay a literal: `contrast.test.ts` and `typeScale.test.ts` parse them.

| Group | Tokens | Notes |
| --- | --- | --- |
| Type roles | `--fs-display` 40 (44 Bigger) / `--lh-display` 1.05 · `--fs-title` = h1 / `--lh-title` 1.12 · `--fs-heading` = h3 / `--lh-heading` 1.2 · `--fs-body` = base / `--lh-body` 1.45 · `--fs-small` = xs / `--lh-small` 1.35 · `--fs-num` 26 (29 Bigger) · `--fw-label` 800 | Roles alias the `--fs-*` sizes, so Bigger text scales them. One `<h1>` per screen at `--fs-title`; game over uses `--fs-display`. |
| Spacing | `--space-1…10` = 4, 8, 12, 16, 20, 24, 32, 40 | 4 px base. |
| Radius | `--radius-xs` 6 · `-sm` 8 · `-md` 14 · `-lg` 20 · `-pill` | Smaller things, smaller corners. |
| Elevation | `--elev-1` (= `--shadow`, resting) · `--elev-2` (= `--shadow-lift`, raised/dock) · `--elev-3` (dialogs, toasts) | Warm brown, never grey. |
| Surfaces | `--surface-page` · `-panel` · `-raised` (#fff) · `-inset` (#f7eedc, zebra/wells) · `-ink` (header) · `--on-ink` / `--on-ink-soft` · `--border-subtle` / `-strong` / `-ink` | Only the page tier is textured. |
| Semantic | `--money-up/-down` · `--success/-fill/-wash` · `--warning…` · `--danger…` · `--info…` · `--own` / `--franchise` / `--licence` · `--hud-up/-down/-pop/-prestige` | Text uses the plain names (deep steps, ≥ 4.5:1); fills use `-fill`. HUD steps are ≥ 6:1 on the band. |
| Charts | `--chart-grid` · `--chart-axis` · `--chart-up` / `-down` · `--chart-1…4` (tomato, amber, plum, sky) | Categorical order fixed, never cycled. own/franchise/licence validated with the dataviz validator: CVD ΔE ≥ 20; amber is < 3:1 on paper so it is always labelled. |
| Controls, motion | `--control-h` 44 · `--control-h-lg` 52 · `--focus-ring` (sky-deep, 4.7:1) · `--focus-ring-on-ink` · `--dur-fast` 150 ms · `--dur` 200 ms · `--ease` | |

### Icons (`components/Icon.tsx`)

24 px grid, 1.75 px round stroke, `currentColor`; play/pause/fast-forward are solid. `<Icon name="x" />` is
decorative (`aria-hidden`, `focusable=false`) — the button or label carries the name; `<Icon name="x" title="…" />`
is `role="img"` with a `<title>`. `ArrowLabel` turns an old `"Next day →"` string into the words plus a drawn arrow
(the name is just the words).

Set: menu, stock, rota, people, chefHat, money (£ coin), stars, empire (globe), shop, restaurant (table), settings,
sound, soundOff, textSize, speed (gauge), pause, play, fastForward, fastest, close, back, forward, chevronDown, plus,
minus, info, help, warning, check, pin, trendUp, trendDown, sun, service (cloche), moon, trophy, smile, timer, walkOut,
key, knife, glass, clipboard, gamepad, heart, chilli, balance, target, chart, calendar.

Where they replaced emoji: planning and Empire side tabs (`TAB_ICONS` now maps ids to icon names; emoji labels still
work as a fallback), the header (Settings, difficulty chip, cash trend, Empire strip), the settings sheet options and
stamp, dialog close/stamps, toasts, the day strip, the speed deck (❚❚ ▶ ▶▶ ▶▶▶), the live tiles, the stock forecast and
order-sheet status, the Menu list/matrix toggle and ✕, steppers (− +), Goals, "What do I do?", Jump in, the covering
banner, the start cards, the difficulty picker (heart / gauge / chilli badges in the difficulty's colour instead of
🧸 🙂 🌶️), title/back buttons, game over, Evening's best/worst dish and money arrow, the career checklist and the
handover stamp. **Emoji stay as content**: dishes, districts, incidents and their evening lines, staff moods, review
sources, advice tips, the win journey, Stars news.

### Component patterns

| Pattern | Use |
| --- | --- |
| `Panel` (components/Panel.tsx) | `.card` + `.card__title` header row: title (h3, optional icon), `sub` in soft ink, `action` pushed right, a hairline under it. Old `.card__title` markup gets the same look. |
| `StatTile` | `.kpi` label (sentence case, `--fw-label`, ink-soft) above a `--fs-num` number; optional delta chip (`.chip--up/down/flat`) with a trend icon **and** words. `.kpi`, `.bignum`, `.counter`, `.livesum__tile` share the tile look. |
| Buttons | `.btn` secondary (paper, ink outline) · `.btn--primary` · `.btn--green` (money confirm) · `.btn--ghost` · `.btn--danger` (new, outlined red) · `.btn--xl` = the screen's one primary. All `min-height: var(--control-h)`; xl `--control-h-lg` (56 in the dock). Hover lifts 1 px, press sinks. |
| Chips | `.pill` is now sentence case (capitalised), with an optional 16 px icon; `.chip` for deltas; `.diffchip--{cosy,normal,hard}`. |
| Tables | Caption (sr-only is fine) + `scope="col"` headers + a `scope="row"` first cell; 2 px ink rule under the header; zebra on `--surface-inset`; totals row with a 2 px ink rule above in Fredoka. `.pnl` and `.stocktable` follow it. |
| Controls | Steppers 2 px outline with Fredoka value; `.seg` toggles on an inset track; `.switch` = an `appearance:none` checkbox drawn as a 72×44 switch (was a 26 px box, the probe's one small target). |
| Callouts / hints | Wash + 1.5 px border + a 5 px edge on the reading side; hints are pills. |
| Charts | A 2 px axis at zero, gridlines in `--chart-grid`, 4 px rounded data ends anchored at the baseline, today ringed with a paper gap. Empire month bars get the same baseline/grid; stacked city bars get a 2 px paper gap between parts. |
| Dialogs / toast | Modal: 2 px ink outline, `--elev-3`, paper banner with a round stamp holding an icon. Toast: ink pill, tone-coloured icon disc. Both animate 200 ms, none under reduced motion. |

### Do / don't (for later rounds)

- **Do** use the R8 token names in new CSS; **don't** rename or delete an older token (A's map.css and C's canvas read
  them via `getComputedStyle`).
- **Do** put an `Icon` in chrome; **don't** add emoji to buttons, tabs, headers or labels. Emoji are for content.
- **Don't** write all-caps tracked labels. Labels are sentence case, bold, `--ink-soft`. (The brief asked for small caps
  above stat numbers; synthesized small caps in Nunito render at ~11 px glyph height, under the 13 px floor in spirit,
  so labels are sentence-case bold instead.)
- **Don't** scope header rules as `.status <descendant>`: the settings sheet renders inside `.status`. Scope to
  `.status__stat`, `.status__end > …`, and keep `.modal { color: var(--ink) }`.
- **Do** keep one primary per screen (`.btn--xl`, bottom-right dock). **Don't** add a second tomato button beside it.
- **Do** put a caption and scopes on any new `<table>`; numbers right-aligned with `tabular-nums`.
- **Do** give every hover/press transition a `prefers-reduced-motion` off switch (the R8 block has one list).

## Round 8 — review (conventions after the merge)

A's and B's sections above are kept as each builder wrote them, in merge order (A then B); C's notes are in
HANDSON-NOTES "Round 8 — C". Where this section and theirs disagree, this one is current.

- **Map styles live in `screens/paths/map.css`**, never theme.css (A's test pins it). The old one-svg map's theme.css
  rules (`.empire__map svg*`, `.pin-hit`, `.empire__legend`) are gone, and so is map.css's block that undid them.
- **Ownership colours are `--own` / `--franchise` / `--licence` everywhere** (B's tokens: tomato / amber / plum).
  `OWN_COLOUR` in WorldMap.tsx is `var(--own)`, `var(--franchise)`, `var(--licence)`, so the map pins, the map key, the
  My shops city bars, the site dots and any chart agree. Amber is under 3:1 on paper: always beside a word.
- **Canvases read tokens**, listed in one place each: `handson/src/palette.ts` (`TOKEN_VARS`) for the kitchen and
  `game/src/canvas/floorPalette.ts` (`FLOOR_TOKENS`) for the owner's floor. A token they read must stay a literal
  colour (or a `var()` alias of one) in theme.css; a miss falls back silently to the default, so `round8.review.test.ts`
  resolves each one. `--awning` must stay a two-colour stripe gradient.
- **The owner's floor is a lazy chunk.** Service.tsx imports `RestaurantView` for types only and loads it with
  `import()` (prefetched in idle time); the frame loop that drives the sim clock starts at once and draws once the view
  lands. Don't add a static import of `canvas/RestaurantView` or `@full-plate/handson/{sprites,layers,palette}` to
  anything in the main chunk.
- **Pills are sentence case in the source.** `.pill` has `text-transform: none` (B's `capitalize` produced Title Case:
  "You Run This One", "Out Of Season"). Write "In season", "Worked"; capitalise a data word in JSX.
- **No all-caps eyebrows.** The career screens' kicker lines use `.panel__eyebrow`; the hands-on kicker ("Your shift ·
  Sides") is sentence case too, and `.caps` is gone. Map region names are the one tracked-caps exception (cartographic
  labels, `map.css`).
- **Chrome glyphs are Icons**: the city map's Back and Open here use `back` / `plus` like the rest of the game.
- **Empire totals** are six tiles at ≥ 1181 px and three a row below (`.empire__stats`).
- **Type audit** measures canvas text drawn into offscreen layers too (C's cached scenes), at the layer's dpr.

## Round 9 — saves

Design and storage: docs/SAVES.md. UI conventions added this round:

- **Title.** The Continue card plays the most recently played slot (its name, day, cash, date; a path or the
  restaurant's name underneath when the slot's name differs). Under it: **Your games** (folder icon + count) and New game.
  One line under the buttons says where games are kept: "Your games are saved to your account ✓" / "Saved on this device
  only — sign in to keep it everywhere" / "Not saved — this browser won't keep games. Use Save to a file." With no
  games, a ghost "Load a save file" button opens the picker.
- **Your games** (`screens/SlotPicker.tsx`, lazy, styles in `screens/slots.css`) is a wide `Dialog`: a card per slot
  (name as h3, path pill, Day N + cash in Fredoka 20, date, "Played 2 days ago · On your account / This device only")
  and dashed "Empty slot" cards up to six. Actions are 44 px: Continue (primary), Rename (inline input), Save to a file,
  Delete (red text; the round-7 `ConfirmDialog` with "Keep it" focused first). Load a save file sits under a dashed rule.
  In "new" mode (New game) it is "Where shall we save your new game?": **Start in an empty slot** first, then each game
  with "Replace with a new game" (asks first).
- **Which one shall we play?** (`ConflictDialog`): two big option cards, the newer one outlined green with a "Newer"
  pill and focused; one line promises the other is kept as a backup.
- **Header save mark** (`components/SaveIndicator.tsx`): a `.shellbtn` before the difficulty chip — cloud "Saved ✓"
  (`--hud-up`), "Saving…" (`--on-ink-soft`), cloud-off "This device only" (`--on-ink`), warning "Not saved"
  (`--hud-down`). Text hides below 1181 px like Settings (44 px icon button, the name stays in `aria-label`). Tap → a
  small sheet (lazy `SaveSheet.tsx`) with one sentence of why and Save to a file.
- **Settings › Save & quit** shows "Saving…" (disabled), then a status line with an icon — "Saved to your account ✓" /
  "Saved on this device only — sign in to keep it everywhere" — and quits 0.9 s later. When nothing can keep the game it
  stays open on "Not saved — use Save to a file to keep this game" with Save to a file and "Quit without saving".
- **Icons:** `cloud`, `cloudOff`, `save`, `folder`, `download` joined `Icon.tsx`. The picker's pencil / trash / upload are
  drawn the same way inside SlotPicker.tsx to keep them out of the main chunk.
- **Copy:** "Saved to your account ✓", "Saved on this device only — sign in to keep it everywhere", "Save to a file",
  "Load a save file". Sentence case; nothing under 13 px (the type audit has the new screens).
- **Chunks:** main JS +10.5 kB (182.8 → 193.2 kB). The store core, the account, packing, files, the picker and the mark
  sheet are lazy chunks; don't import `saveCore`/`saveCloud`/`saveFiles`/`saveCodec` statically from main-chunk code
  (type imports are fine).

## Round 10 — A (decorating)

Theme: make it feel like *her* restaurant. Sim model and balance: SIM-NOTES "Round 10 — A"; catalogue: CONTENT-NOTES.

### The Decorate tab (`screens/planning/DecorateTab.tsx`, styles in `screens/planning/decorate.css`, lazy)

A Planning tab after Restaurant (`TAB_ICONS.decorate = "paint"`; badge `!` when something is tired, else the number
of items coming tomorrow). Two columns at ≥ 1181 px (one below):

- **Your dining room** (Panel, `paint` icon, the style as a basil pill: "Cosy café" / "Plain and simple" / "A bit of
  everything"): the real `RestaurantView` drawing an empty room (`preview: true` hides tickets, staff and the "you're
  cooking" signs) with the **hovered or focused card's item fitted** — tapping a card's name pins it — a caption
  ("Trying out Silk damask — not bought yet." / "This is your room today.") and three StatTiles (prestige and
  popularity from decor, upkeep a day). Sticky beside the cards so the room changes as the pointer moves.
- **Slot buttons**: nine 44 px buttons, icon + word (Floor, Walls, Lights, Seats, Tables, Sign, Plants, Music, Window),
  `aria-pressed`; a blue dot = coming tomorrow, a red dot = looking tired (with sr-only words).
- **Cards** (one per item, cheapest first): name (Fredoka heading) and price; the child-friendly description; effect
  words as plum pills — the style first ("Cosier", "More fun", "Smarter", "Posher"), then "+1 prestige",
  "+1 popularity", "Comfier", "Guests stay longer", "Guests order more"; "Room prestige +2 → +3" when it changes it;
  "Costs £1.00 a day to keep. 1 table closed on fitting night." One state per card: **Buy · fit tomorrow · £950**
  (green), **Coming tomorrow**, **In your restaurant** (the current item, outlined basil), **Keep this one** (cancels
  tomorrow's swap, refund), **Need £340 more** (disabled), **Put it back · free** (the starter).
- **Wear**: the slot's item, when worn or tired, gets a callout above the cards — "**Looking tired** — your squashy
  cushions have lost their shine, so guests notice less and it drags your prestige." with **Refresh · £70**.
- Elsewhere: the header's **style badge** (`pathbadge--style`, only when a style is dominant), a Planning hint
  "Your rugs look tired" / "3 things in your room look tired" (→ Decorate), and the evening's **What happened today**
  rows (`lib/decor.ts decorLines`): "🎨 Your new brass pendants — Guests stayed a bit longer and ordered more.",
  "🪜 The fitters were in — 2 tables were closed tonight…", "🧽 Your gingham cloths look tired — a refresh (£40)…".

### The canvas (`canvas/decorArt.ts`, colours in `canvas/decorPalette.ts`)

`roomLook(content, game)` (memoised per decor object, day and table count) gives each slot's item id and wear band
(0 fresh / 1 worn / 2 tired) and a `key` that joins RestaurantView's static-layer key, so the cached scene is rebuilt
**when the decor shown changes** (a purchase, a preview hover, an item going tired) and never per frame (test: 4
builds over 6 renders with 3 changes). Everything static is painted into the cached scene; only the dust sheets and
the music note are live.

| Slot | Drawn as |
| --- | --- |
| floor | oak planks (starter) · rugs under each table · black-and-white checker · terrazzo chips · herringbone parquet |
| walls | the wall bands' colours + papered/painted side walls: sunny yellow · stripes · wood panels · plum damask with gilt |
| lighting | pendants hung between the tables in each row (lanterns, brass domes, chandeliers with crystals) or fairy-light strings over the aisles; the floor's light pools and the evening glow take the lamp's colour and reach |
| seating | cushions on the chairs · rainbow chairs · leather banquettes with buttons · velvet armchairs |
| tables | gingham check · painted tops with stars · white linen · veined marble (occupied tops are redrawn live the same way) |
| signage | the name board: chalkboard (+ an A-frame on the pavement) · painted green-and-gold · pink neon (glows at dusk) · gold leaf |
| plants | corner pots (starter) · herb pots on the sill · hanging baskets · big palms · a flower wall down the left |
| music | radio · jazz speakers on the walls · jukebox · grand piano, bottom-left; a plum note floats up while it plays (still under reduced motion) |
| window | planters (starter) · cake stands · a lit menu case by the door · a toy train · seasonal flowers |
| fitting night | dust sheets with a cone over the fitters' tables (`closedTableIds`) |

Worn items fade 22% toward `worn`, tired ones 55% with scuffs (and wilting plants, a dim neon). The starter kit paints
nothing new: an undecorated room is the round-8 picture.

**Chunking.** `decorArt` is its own lazy chunk: RestaurantView imports it with `import()` the first time it draws a
room that has `decor` (and the Decorate tab preloads it); until then — and always for undecorated rooms — the
round-8 picture is drawn, and the key change rebuilds the scene once it lands. Don't import `decorArt` statically from
RestaurantView.

### Numbers

- Chunks (raw / gzip, vs master): main `index` 193.7 → 197.5 kB (+3.7 / +1.7 gz); `RestaurantView` 36.5 → 38.4 kB
  (+2.0 / +0.8 gz); new lazy `decorArt` 18.8 kB (6.9 gz), `DecorateTab` 7.5 kB + 3.6 kB CSS. The eager `content` chunk
  grows +15.3 kB (+4.2 gz: the catalogue) and `sim-core` +6.2 kB (+2.3 gz).
- Tests: `__tests__/round10.decor.test.tsx` (11): catalogue, buy/refund, need-more, refresh, prestige hint, hover
  preview, scene-cache invalidation, every slot drawn + dust sheets, evening lines, style badge, lazy tab.
- Type audit: a `13b-planning-decorate` step (Sign slot, hovering the gold lettering, canvas measured).

## Round 10 — B (the staff room)

### Portraits (`components/Avatar.tsx`, `components/people.css`)
- `<Avatar person={staff} size={96} mood={staff.mood} />` or `<Avatar spec={playerAvatar(look, role)} … />`. SVG, viewBox 100: shoulders r 34 at (50, 103), head ≈ 24 at (50, 57) — the sprite's 0.64 head-to-body ratio; one warm outline `#3a2c22` at 4.4 (≈ 0.13 × body radius, as `sprites.ts`); light from the top-left (shoulder highlight, lower-right shade); rosy cheeks, dot eyes with a catch-light, a mouth that follows mood (grin ≥ 75, smile ≥ 50, flat ≥ 30, frown); toque / cap / bare head by role; the disc is the person's favourite colour. Decorative by default (the card names the person); `title` makes it `role="img"`. Clip ids come from `useId`.
- Sizes in use: 96 (person and candidate cards), 72 (score card), 64 (My shift), 52 (look picker), 36 (co-workers), 32 (evening), 30 (rota grid, StaffStrip). The rota's overlapping faces replace initials (fixes R7 "two people share KB").

### Staff room (`screens/planning/StaffTab.tsx`, `staffRoom.css`; lazy chunk 13.9 kB)
- Order: the hiring sheet (when open) → "Who's on this week" (mini portraits) → "Your team" (+ "Hire someone (3 looking for work)").
- Person card: portrait, name, role · wage/h, mood face + word + the evening's reason (▲/▼), trait chips, "Loves … / Hates …" chips, "Gets on with … / Clashes with …" (only among the current team), skill bars, rota, Training (one button per track for the role: name, three level dots, next fee; disabled with the reason — training today, the only one of their job on today, finished, no cash), Let go.
- Chips with tips use the Term pattern (focusable `.term` wrapper, `role="tooltip"` element, `placeTip` flip) with `.chip`; colours from tokens (success/danger/plum/warning washes).
- Hiring sheet: three candidates (the goal's role first), each with portrait, a "why me" quote bubble, traits, like/dislike, skill bars, "Asks £x/h · about £y a shift", Hire · fee (`HIRE { candidateId }`, `hireCheck` unchanged). Opens by itself with no staff or with a "Hire a …" goal; Close when you have a team. Old colleagues (career handover) appear under it with a quote.
- Evening "How the team feels": a level-up line (graduation icon, amber wash) per training level finished today; each moved mood shows its reason under the name.
- Start picker (career): "How you look" — six portraits in the job's clothes, a radiogroup of 60 px buttons; passed to `newCareer` as `look`.
- Icons added: `user`, `thumbsUp`, `thumbsDown`, `graduation`, `bolt` (`people` / `heart` existed).
- Type audit: new screen `11b-planning-hire-sheet`; 36 screens, 0 text < 13 px, normal and Bigger. R8 probe: unchanged counts on every screen at 1280/1024 × normal/large (the only diff is a toast caught mid-fade on the career watch screen, timing).

## Round 10 — review

- **One rule for a person's colours.** Skin and hair come from sim-core `avatarFor` (keyed by staff id) everywhere: staff-room portraits, the dining room (`RestaurantView.staffLook`) and the hands-on floor (colleagues and the sous chef are keyed by staff id, not first name). The career player's chosen look (`playerAvatar(career.look, role)`) now dresses their sprite on the hands-on floor (`SessionOptions.look`, `HandsOnShift look`) and in the dining room (`RenderOptions.playerLook`), as on My shift and the score card. Owner "Jump in" keeps the old fixed "you" colours.
- **Fitting night on the hands-on floor.** The fitters' tables (sim-core `closedTableIds`) are drawn under a dust sheet with no place settings, as the dining-room view does; the sim never seats them.
- **The sous chef on the hands-on floor** is the on-shift chef with the highest "Cover the pass" level (as the sim's `passCover`), so the name tag, the sprite and the covering cook are one person.
- **Planning tab row at 1024** (Menu, Staff, Stock, Restaurant, Decorate; + Empire/Stars on those paths): one row, every tab 48 px tall, 17 px labels, normal and Bigger text, no overflow — no scroller needed.
- **Busy evening order:** What happened today (new decor's first night and the fitters first, then the day's incidents) → What people said → How the team feels (level-ups first, then each mood reason). Goal toasts queue one at a time in the toast region; sampled over 6 s on three evenings, none overlapped the pinned dock.
- Type audit: 37 screens, 0 text < 13 px, 0 page errors, normal and Bigger.

## Round 11 — B (stop silent losing)

Red-team U3, U2, G2, U6, U4, U5 and the U12 items (mood sign, review on a bad night, "You's career"). Rules live in sim-core `bank.ts` (SIM-NOTES "Round 11 — B"); the UI only reads them.

### The bank (U3)
- **Header chip** (`components/Bank.tsx BankChip`, in the Cash stat under the trend): "⚠ Bank: 12 days left" while cash is under the overdraft line (`bankStatus`), amber, **red at ≤ 5** (`.bankchip--red`). Never on Cosy, never on the game-over screen.
- **Evening card** (`components/BankCards.tsx BankCard`, a 3.7 kB lazy chunk fetched only when one of its cards is due): from the first night below the line, across both columns under tonight's money. "The bank is worried: N days left", the cash, the line and how far off she is, then what to do, each with a one-tap action where one exists: *Raise prices 10%* (`SET_MENU_ITEM` × active dishes, applied tomorrow morning through the round-6 `onAct` path, toast "Done: prices are 10% higher."), *Buy cheaper stock* (→ Stock), *Fewer shifts* (→ Rota, when she has staff), and either *Borrow £X* (the starter loan, when the bank would lend) or "Don't buy anything new until you're back above the limit".
- **Morning banner** (`BankBanner`, `role="alert"`) on the last 3 days: "2 days left with the bank! Tonight your cash needs to be above −£13,680 (you have −£17,023)…".
- **Starter loan tip** (`StarterLoanTip`, labelled "Goal"): a staffless Normal/Hard owner who can't afford any chef sees "The bank will lend you a first wage · You need £67 more to hire a chef · Borrow £1,000" — in the evening (when the bank card isn't showing), on the morning notices (not on the Staff tab) and at the top of the hiring sheet.
- **Archive, don't delete.** `saveStore.isOver` is now always false; `isLost(game, meta)` (game over on any path but a running career) sets `SlotSummary.archived` (optional; `pickSummary` carries it to the index and the cloud header). Your games shows the slot greyed and dashed: "Lost — day 93", primary **Start over with the same restaurant** (App `restartSlot`: same seed, street, name and difficulty, in that slot) and a ghost **What happened** (opens it: the game-over screen). The title's Continue skips archived slots. The game-over screen says "It's kept in Your games as “Lost — day N”…" and its main button is the same "Start over with the same restaurant". There is no weekly checkpoint in the save, so no "Try again from last Monday".

### Never spend into a hole (U2, U6)
- `components/SpendGuard.tsx useSpendGuard(game)` → `{ guard(cost, what, run), dialog }`. A purchase that `spendCheck` calls risky (leaves under 3 days of running costs, or — with no chef — less than the cheapest chef needs) opens the round-7 `ConfirmDialog`: **"This leaves you with £630 — are you sure?"**, "Hand-painted sign costs £500. A normal day costs about £365 to run (rent, wages, bills and stock), so that's less than three days of it…", *Keep my money* (focused) / *Yes, buy it*. Used by decor buy and refresh, Buy table, training tracks, and a Stock tab order bigger than tomorrow's shortfall. The evening Restock button and hiring are not guarded (they're how she gets out).
- Decorate's live caption tells the truth: after a buy it reads "Bought Herringbone parquet — the fitters come tomorrow. You have £9,680 left." (was "Trying out … — not bought yet" while the cash dropped).
- A disabled **Hire** says why as text under the card ("Needs £1,213 in the bank (you have £1,130)", danger colour, `.candidate__needs`); the `title` is gone. Buy table says "Needs £X more".
- "Hire →" prompts (evening covered-the-kitchen card, the tiredness note) and the dock's "Hire a chef" read **"Save £68 to hire a chef"** when nobody in today's pool is affordable (`hirePromptText` / `sim.ts hireShortfall`).
- Evening table tip: greyed (`.tip--off`) with "Can't afford" and a line saying why when a table would leave under 3 days of running costs. Morning post: a choice whose cash cost she can't pay is disabled, faded, "· Can't afford", focus goes to the first open choice; if every choice costs money none is disabled.

### Smaller fixes
- **U4:** the app reducer drops a toast left over from before a phase change (service → evening, evening → morning); one raised by the change itself (a goal at END_DAY) stays. The incident toast at 4× says "— choose what to do on its card." (no "right-hand panel").
- **U5:** the dish list shows no Star/Dog/… pill until a dish has 7 days of sales (`quadrants.ts QUADRANT_MIN_DAYS`, `judged`); until then a short line "New: judged after 7 days of sales". With a label, its short advice is visible text under the name ("Think about taking it off", 13 px `.dish__hint`), no `title`. The expert matrix is unchanged (positions are data).
- **U12:** the evening's mood reason shows only when its sign matches tonight's change (the sim now picks a matching reason too); reviews on a rough night come from the "rough" pool; a blank career name makes the slot "Your career".

### Numbers
- Main JS `index` 196,315 → 201,144 B (**+4,829 B**, budget 6 kB); main CSS +1,157 B; new lazy `BankCards` 3.7 kB; `StaffTab` +0.3 kB, `DecorateTab` +0.35 kB, `SlotPicker` +0.5 kB; the eager `sim-core` chunk 129,965 → 133,232 B (+3.3 kB: bank.ts, the loan, the starter chef).
- Type audit: 38 screens (new `32a-lost-slot`; `32-game-over` is reached through Your games → What happened), 0 text runs < 13 px, 0 page errors, normal and Bigger.
- Tests: `__tests__/round11.losing.test.tsx` (19); `round7.dayLoop` (button name), `starsReview` (Needs £X as text) and `round9.saves` (archived, not removed) updated.
- Playtest (built dist, 1024 × 768 touch, Playwright): the red-team's s7 Hard decor spree now buys floor/walls/lights/seats/tables and is asked at the sign ("This leaves you with £630 — are you sure?"), keeping £1,130 — enough for a chef; the no-hire child's day-31 morning shows "Save £68 to hire a chef" and the loan tip, Borrow → £1,837 → hires a chef; day 81 shows "Bank: 13 days left" and, after service, the bank card; day 92 the last-days banner; the loss is kept as "Lost — day 93" and Start over opens day 1 of the same restaurant. 0 page errors.
## Round 11 — D (tablet and child fit)

Red-team U1, U7–U11 and D's U12 items. No sim behaviour changed; content changes are words only (CONTENT-NOTES
"Round 11 — D"). Tests: `game/src/__tests__/round11.fit.test.tsx`, `content/test/round11.words.test.ts`.

### iPad portrait (U1)

- **One breakpoint**, `lib/layout.ts NARROW_QUERY` = `(max-width: 1023px)`, used by the R11-D block at the end of
  theme.css and by `useNarrow()`. `body` loses its 1024 px floor there (it still applies ≥ 1024).
- **Header**: name/date and the save · difficulty · settings buttons on row one; cash, reputation, loan on row two.
- **Planning**: the tab row scrolls sideways (no scrollbar) with an edge fade only on the side that has more tabs
  (`Tabs.tsx markTabEdges` sets `data-more-left/right`); the picked tab scrolls into view. Goals sit above the panel,
  folded to one line (`GoalsCard collapsible`) after the first run. The action dock stays pinned at the bottom: the hint
  pills in one sideways-scrolling line, the primary on the row below. Toasts sit above the taller dock.
- **Service**: the floor on top (≥ 300 px, 44 % of the height), the side panel below with its own scroll. Hands-on:
  the shift bar wraps (the clock track on its own row). Evening: one column.
- Checked on the built game at 768×1024 with touch: no sideways scroll (scrollWidth 768) on title, all five planning
  tabs, service, hands-on, evening; "Open for service" on screen on every tab; 0 targets < 44 px; 0 text < 13 px.

### Plain words (U7)

`86` → **Take off tonight** (Service list header is a `<Term id="eightySix" inline>`; buttons "Take off" / "Off
tonight"); "Comp this table" → **Make their meal free** / "On the house ✓"; HQ → **head office** in every sentence
(the Empire strip keeps an `HQ` chip, tipped); "Royalty" contract row → **Share of their takings**; board "Royalties"
→ "A share of franchise shops' takings"; "Franchisee mood" → "Shop owners' mood"; satellite → **sister restaurant**
(StarsMap, StarsTab "The group"); "VAT to the taxman" → "Tax on sales, to the tax office"; tronc → "shared tips"
(career payslip); footfall on the lease screen is an inline tip on "People walking past". Career rung titles keep
commis / chef de partie / sous chef through `RungName` (Term.tsx), which tips them ("Apprentice chef", "Section chef",
"Second chef"). New glossary ids: `commis`, `chefDePartie`, `sousChef`, `satellite`. Rule for later rounds: a trade word
on screen is either gone or inside a `Term`; the key-screen test strips `.term__tip`/`.term__real` and fails on the rest.

### "No grown-up drinks" (U8)

Settings sheet switch, **on by default** (`Settings.noGrownUpDrinks`, stored and synced with the other preferences).
`sim.ts syncSoftDrinks()` applies content's `applySoftDrinks` at load and on change; the menu, stock list, reviews and
the Stars glasses read the soft names at once. Ids and numbers are identical (test: a week with the drinks on the menu
gives the same cash, RNG state and history with the setting on or off).

### Keyboard (U9)

- `Term` (and the staff-room trait chips) are **`tabIndex=-1`**: still focused by a tap or click (tip shows), out of
  the Tab order. Day-1 Menu (1280 px, starter menu) goes from 156 tab stops to 107 (the 71 terms are gone); "Open for service" is Tab, Enter from the top (was 70 Tabs).
- **"?"** anywhere (not in a text field, not under another sheet) opens **What the words mean** (`WordsSheet.tsx`, the
  dialog is a lazy chunk): every `.term` on screen with its tip, read from the DOM when opened.
- Two **skip links** are the first Tab stops in a game: "Skip to main action" (`App.focusMainAction`: the screen's
  enabled `.btn--xl`, service's `[data-main-action]`, else the first `.hint--link` that says what to do instead) and
  "What the words mean (?)". They show on focus only.

### Pacing (U10)

- Owner service has **Skip to evening** (`data-main-action`, under the speed deck): the reducer's `skipShift` runs the
  remaining ticks at once. For an owner it is exactly the ticks watching would run (problems left unanswered time out
  the same way); the test compares the serialised end state with ticking one at a time.
- **Remembered speed**: a speed picked on the deck (or 1/2/4 keys) is saved as Settings › Service starts at
  (`speedPicked`). Until a speed is picked, **Cosy starts every service at 4×** (`startSpeed`).
- "How do I win?" now says the honest length: 365 game days, about a minute a day at 4× or with Skip, so the fork comes
  after about 3–6 hours of play. (The explainer and the fork card are now lazy chunks.)
- **Minutes to day 30** (a child's planning + evening ≈ 45 s a day, red-team timing; service 60 s at 1×, 15 s at 4×,
  ≈ 1 s skipped): **before** 30 × (60 + 45) s ≈ **52 min**; **after**, Cosy at 4× ≈ **30 min**, with Skip to evening
  ≈ **23 min**. Day 365: before ≈ 10.6 h at 1× (1.8 h best case); after ≈ 6 h at 4×, ≈ 4.7 h skipping.

### Reload mid-shift (U11)

- The autosave key (`useSaves.autosaveKey`) adds the sim-hour and the hands-on role during service: a save every hour
  of service and when a hands-on shift starts or stops.
- The envelope stores `meta.handsOnResume` (`{ role, jumpIn }`) instead of the live session. On load the reducer drops
  the sim's hands-on hold (as before); `resumeHandsOn` then re-runs `handsOnStart` — a fresh session at the saved clock, like Jump in —
  with the toast "Back on your shift from 13:05 — the game saves every hour of service." `load` itself still drops the live session (the round-4/5 contract and its tests); App dispatches `resumeHandsOn` right after it. So a reload costs at most the
  part of an hour since the last save, and lands in hands-on play, not the watch view.

### Small things (U12, S12)

- "Click a table" → **Tap** on a coarse pointer (`useCoarsePointer`, canvas label and the manager's card).
- Stock: the order sheet lists only what the menu uses (plus anything on hand, coming or in the basket); **Show
  everything (N more)** opens the rest. Day 1 is ~20 rows, not 100.
- **One pounds formatter**: `formatPence` / `formatPounds` live in sim-core `money.ts` (pure); the game's
  `lib/format.ts` re-exports them; sim-core (advice, commands, incidents, forecast, goals), sim-empire (engine, board,
  unit economics), sim-stars, sim-career, handson (score, toasts), Empire/Board screens, the staff room, map tips and
  the dining-room floaties all use it. One minus sign: "−£12" (was "-£12" in the evening tips and "£-12" in Empire logs).
  `formatPence(p, { trim: true })` gives "£12" / "£12.50" (incident and command lines). Headless console tables keep
  their own padding formatters.
- **Playtest switches**: `?autopilot=` and `?perf=` only work in a dev build or with `localStorage["full-plate:dev"] =
  "1"` (`lib/perfMeter.ts devSwitches`). Playwright playtests set the flag before loading (the type audit does).
  The audit also takes `FP_AUDIT_VIEWPORT=1024x768` / `768x1024` (touch below 1024) and sets `speedPicked` so Cosy saves
  keep its speed.

### Checks (built dist, `vite preview`)

- **Type audit** (37 screens): 0 text runs < 13 px, 0 page errors at 1280×800, 1024×768 and 768×1024 (touch), normal
  and Bigger text at 1024 and 768. Two audit fixes: the "repaint the canvas layers" nudge now changes the height, not
  the width (1023 px crossed the portrait breakpoint and measured a transient 8.3 px layout; a width change also leaves
  layers one blit off scale), and the title's shopfront stacks above the buttons when narrow (its sign text was 10.9 px).
- **R7 probe at 768×1024** (touch, normal + Bigger): no sideways scroll on any screen after stacking the Stars tab's two
  columns (Bigger text pushed one 39 px past the edge); 0 targets < 44 px (the one hit is the start picker's visually
  hidden radio input), 0 text < 13 px, 0 term tips widening the page. "Covered" hits are content scrolled under the
  pinned dock, tabs scrolled under the edge fade, and Empire map pins under the header — all by design. Contrast hits are
  toasts caught mid-fade and the ★ glyph (as at 1024).
- Playtest screenshots (768×1024 touch, 1024×768 touch, 1280×800): every planning tab, service, hands-on, evening,
  the words sheet, the skip link; keyboard at 1280: Tab → "Skip to main action", Enter → focus on "Open for service";
  in service the same skip link lands on "Skip to evening", which reaches the evening in ≈ 0.3 s.
- Main JS 195.85 → 195.49 kB (−0.4 kB): the words dialog, the fork card and "How do I win?" are lazy now.
## Round 11 — E (pipeline)

Details and numbers: docs/PIPELINE.md. What UI work needs to know:

- **The probe and the audit are in the repo** (`scripts/probe.mjs`, `scripts/type-audit.mjs`, shared walk in
  `scripts/lib/harness.mjs`) and fail above `scripts/probe-baseline.json`. A new screen goes into `walkScreens`; when
  your change lowers a count, run with `-- --update-baseline` and commit the new baseline with it.
- The probe counts glossary `.term`s, disabled controls, switches and handler-only elements as tap targets, at
  1280×800, 1024×768 and 768×1024 with touch. Master's honest count: 283–291 targets under 44 px per run, every one a
  Term; all 38 screens scroll sideways by 256 px upright.
- **Settings ends with the font credit** (`.sheet__about`, "Font licence" → `fonts-licence/OFL.txt`). Keep it last.
- `canvas/RestaurantView.ts` is split (layout, frame, people, paint, scene, interaction); its exports are unchanged.


## Round 11b — age 14

Rounds 5–11 wrote for a player of about 10; the owner's daughter is 14 and the brief says 12+. Round 11's real fixes
(portrait, keyboard, skip links, pacing, resume, the bank, saves) stay. Tests: `round11b.teen.test.tsx` (7), the
re-targeted `round11.fit` / `round11.review` word checks.

### Trade words back, each a tipped term

The screen says the real word; the tip says what it means. Rule for later rounds (replaces D's): **every trade word on
screen is a glossary term** — the key-screen test removes every `.term` and fails on any trade word left, and every
term must carry its tip. The "?" words sheet and the skip links are unchanged; terms stay `tabIndex=-1`.

| R11-D plain words | Round 11b on screen (all `<Term>`) | Where |
| --- | --- | --- |
| Take off tonight / Take off / Off tonight | **86** a dish for the rest of today / **86** / **86'd** | Service list header and buttons (buttons keep the aria name "86 Margherita (take it off for today)") |
| Make their meal free / On the house ✓ | **Comp** this table / **Comped** ✓ | Service manager's card |
| head office (every sentence) | **HQ** | Empire tab (Money, sinking card, minutes, Blockable reasons), strip, Evening, board meeting, EmpireEnd, world map legend / city line |
| A share of their takings / their share of takings / A share of franchise shops' takings | **Royalty** / **Royalties** from franchise shops | contract row, board rows |
| Shop owners' mood (strip) | **Franchisee mood**, **Franchisee association** | status strip |
| sister restaurant(s) | **satellite(s)** | Stars map, Stars tab |
| Tax on sales, to the tax office | **VAT** to the taxman | Evening sums |
| shared tips, by law / none on shared tips | **tronc**, shared by law / none on **tronc** | career payslip |
| People walking past | **Footfall** | lease screen |
| Running head office | Running **HQ** | board rows |

Kept from D: commis / chef de partie / sous chef through `RungName`; "Golden Plate" (not Michelin) and every other U12
fix. The map's hover tip says "Your head office (HQ) is here" in words (a term can't be tapped inside a tooltip).

- **`components/TermText.tsx`** wraps the trade words in strings the sims and content write: Service's log, the
  Evening's news / incidents / reviews, event cards (title, body, choices), incident cards, toasts, the Empire log,
  board question / options / worry / skip line, Stars hints / log / rumours, career notes and offers, the win journey.
  Words: 86'd, royalty holiday, royalty/royalties, franchisee(s), HQ, satellite(s), wholesaler(s), VAT, HMRC,
  call-out fee, sommelier(s), tronc, footfall, comp/comped. Case-sensitive where a lower-case word means something
  else (a vat of stock); "86 guests", "company", "HQs" are left alone.
- **Terms inside buttons** (`<Term inButton>`): a span with no tabindex (nothing focusable inside a button) and an
  aria-hidden tip, so the button's name stays its label. A tap on the word shows its tip (`data-open`, closes after 4 s)
  and does not press the button; a tap anywhere else does. `inButton="passive"` for a button whose whole label is the
  word (Service's 86): hover shows the tip, a tap presses, the list header explains it.
- **Underline once.** An inline term has its dotted underline the first time that word appears in a session (and until
  it is tapped); later copies are plain text, still tappable, still tipped (`term--quiet`). Settings › **Underline words
  I can tap** › First time (default) / Always. Day-1 Menu (the probe's planning save, 1280×800): **71 underlined → 1**
  (71 terms, 70 of them "margin"); every one still has its tip.
- New glossary entries: `comp`, `hq`, `franchisee`, `wholesaler`, `vat`, `hmrc`, `callOutFee`, `sommelier`;
  `feeHoliday`'s word is now "royalty holiday"; `eightySix` says "for the rest of the day".

### Defaults

- **Real drinks.** Settings › **Hide alcoholic drinks** (was "No grown-up drinks"; the field is still
  `noGrownUpDrinks` so stored prefs load) is **off** by default. A stored `true`/`false` is kept; prefs saved by R11-D
  after any other change carry `true` (it was the default then), so those players keep soft drinks until they flip it.
  The audit/probe boot without it, so they walk the real-drinks view. Flipping it re-words the planning screen at once
  (`useDrinksView()` in Planning's and MenuTab's memo keys; before, the menu kept "Pint of lager" until a tab change).
- **Normal** is the start picker's and the lease screen's default; Cosy keeps its 4× start. A Normal game starts each
  service at 1× until a speed is picked. "How do I win?" now adds "nearer ten if you watch every service at 1×".
- **Goals card** goes quiet from day 8 or once five goals are done (`lib/goals goalsQuiet`): no spotlight, no flash on a
  finished goal; "Show me" stays. Day 1 unchanged.

### Tone (light touch)

UI: "Oops! Something went wrong." → "Something went wrong."; career headline "Shift done — keep practising!" →
"Shift done. Room to improve."; staff tip "Put them on the same shifts!" → "."; sim lines "…hire some help!" →
"Time to hire some help.", "Never mind!" → "It happens.", "Hire a chef!" → "Now hire a chef."; goal titles/hints lose
their "!". Content voices: CONTENT-NOTES "Round 11b". Left alone on purpose: the bank and warning cards (U3/U6: clear,
not childish), "What a night!", "Let's cook!", promotion/win exclamations (earned), "a little" as an adverb.

### Checks (built dist)

- Main JS 194.92 → **199.18 kB** (budget 200; TermText, the term changes and the glossary). The next shell feature must
  move something out first.
- Type audit normal and Bigger: 117 screens each, 0 text < 13 px, 0 errors. Probe: terms (all still `.term`) 288 → 384
  at 1280, 312 → 396 at 1024, 288 → 365 at 768 (Bigger 275 → 370, 311 → 395, 287 → 364); non-term targets 0; 0 overflow;
  baseline re-set. `termCheck` skips a term inside a closed `<details>` (the Evening's VAT row).
- Playtest 1024×768 touch (shots `scratchpad/shots/r11b/`): Normal pre-picked; lease "Footfall" tap → tip; day 1 menu
  shows Pint of lager / Glass of house wine; Service "86" header tap → tip, 8 "86" buttons; Skip to evening; day 2;
  Settings drinks switch off; flipped → "Tall fizzy lemonade" on the menu and in the larder line at once; 0 errors.

## Round 12 — D: phone layout and bundle relief

Full audit, before/after per screen and the "not fixable in CSS" list with estimates: `docs/PHONE-AUDIT.md`.
Tests: `round12.bundle.test.tsx` (2), `round12.phone.test.tsx` (6).

### Bundle relief (main chunk 199.2 → 173.9 kB)

- **Settings sheet body** → `components/SettingsBody.tsx` (5.1 kB chunk). `Settings.tsx` keeps the header gear, the
  open flag and the "Save to a file" note; it warms the chunk on idle, hover and focus, and once loaded renders it
  synchronously (no Suspense round trip; the tests call `loadSettingsBody()` once). **New Settings rows go in
  SettingsBody.tsx** (before `.sheet__game`), not Settings.tsx.
- **The owner's Evening** → its own chunk (`Evening`, 22.9 kB), `React.lazy` in App.tsx inside the existing Suspense,
  fetched as soon as a day's planning or service is on screen. Evening.tsx itself is unchanged.
- Evening's bank/decor rows were not needed: the two moves gave 26 kB of headroom.

### Phone layout (`src/phone.css`)

Loaded always (main.tsx after theme.css). Two blocks only, the same strings as `lib/layout.ts`:
`PHONE_QUERY` `(max-width: 480px)` and `PHONE_LANDSCAPE_QUERY` `(max-height: 500px) and (orientation: landscape)`.
Every selector starts with `html ` so a lazy chunk's CSS (staffRoom.css, career.css, map.css…) can't beat it by load
order; a test fails if a rule sits outside the two blocks or loses the prefix. No screen's JSX changed.

- Upright: page scrolls as one (header scrolls away; `.screen--fixed` service keeps its frame); compact header (name +
  buttons, date, cash | loan, both bars on one row); planning tabs as a **bottom tab bar** with the dock on top of it
  (`--tabbar-h` 62 px); one column for start picker, lease, districts, staff room, floor plan, career shift; KPI tiles
  two a row; rows of buttons wrap; steppers keep 44 px; the larder table scrolls in its own box; dialogs are bottom
  sheets, Settings and wide dialogs full screen, raised above dock and tab bar (`.status-wrap:has(.modal-back)`).
- Sideways: header back on one row (per-day/sub lines hidden), service floor + panel side by side, the dock on one
  row, hands-on gets the header's height (the header is hidden during a hands-on shift sideways; Pause/Skip stay in
  the shift bar).
- `theme.css`: `body { min-width: 1024px }` deleted (the only theme.css change).

### Hands-on on an upright phone

`components/RotateCard.tsx`, mounted by App.tsx during a hands-on shift: "Turn your phone sideways" + "Play it
upright anyway". It is an `aria-modal` dialog, which HandsOnShift already treats as "a sheet is open" (lib/modal.ts),
so the shift's clock holds while it shows. No motion, no sound. HandsOnShift.tsx is unchanged.

### Probe

`scripts/lib/harness.mjs`: `parseViewports` ("390x844m" = phone), `contextFor` (iPhone 14 flags: isMobile, hasTouch,
3×, Mobile Safari UA, full-screen viewport), `FP_WALK_DEBUG=1` prints a failed step's whole Playwright call log, and
the career walk measures the turn card ("62r-turn-sideways", upright phone only) before carrying on upright. The probe's
default list adds `390x844m,844x390m`; the type audit accepts the same spelling (its default list is unchanged).

### Left out

The service panel's collapse toggle and a header "⋯" sheet (both need new buttons in A's/shared TSX; the compact
scroll-away header does the job for now); a phone menu matrix; canvas density on the floor and in the kitchen; touch
pan/pinch on the maps. Estimates in PHONE-AUDIT.md.

## Round 12 — A: juice, animation and a soundtrack

The watching part of the day moves now, in a Two Point / Dave the Diver register: small, quick, dry. All cosmetic —
nothing reads into or changes the sim (headless balance unchanged), nothing is in GameState or the save.

### On screen

**Service floor** (`canvas/juice.ts`, wired in `canvas/RestaurantView.ts`; the RestaurantView chunk is lazy):
- Busy pans sizzle (hot specks) and steam; food waiting on the pass steams under the heat lamps (more while the rest
  of the ticket is still cooking).
- A server carrying food from the pass carries the party's plates — one in hand, up to two more up the arm.
- **Paid beat**: when a party settles, a gold coin rises off its table and turns as it fades (400 ms); the "+£" note
  follows 250 ms later.
- **Five-star glow**: a party that paid with a 5 leaves a warm gold ring on its table that swells a little and fades (1.8 s).
- **The queue shuffles**: when the line moves up, people step up front to back, ~140 ms apart (÷ speed), instead of the
  whole line sliding at once.
- **Idle staff**: everyone standing still breathes (under a pixel), and a server waiting at the pass or a chef with
  nothing on looks about every couple of seconds. The existing walk interpolation is unchanged.

**Service panel** (`screens/Service.tsx`):
- "What's happening" lines slide in from the left (220 ms). Lines are now keyed by day/tick/order-in-that-tick, so when
  the log trims its oldest line nothing else re-mounts (before, every line re-animated once the log was full).
- The Served tile counts up; Takings already did (R7).
- **Rush**: 3+ parties queueing or 5+ tickets on the rail (one per party, as the pass draws them) (ends below 2 and 4, so it doesn't flicker). The header band warms
  (an inset tomato wash, 400 ms transition), and a worded "Rush on" chip appears by
  the weekday (so it isn't colour alone). The music speeds up and adds a hat line. No pulsing.
- Sounds: the pass bell when a plate is up (at most one every 0.7 s), the till when a table pays, a soft rising
  three-note for a five-star table, two falling notes when you 86 a dish, a rising/falling pair as a rush starts/ends.

**Evening** (`screens/Evening.tsx`, now its own lazy chunk — see Bundle):
- Tonight's money counted up already (R7, 650 ms); covers and the average score now count up too (600 ms), and every
  star row on the screen fills one star after another (90 ms apart).
- **"Best night so far"**: a new line under the big figure when tonight made money and beat every earlier night (at
  least two of them). Its one flourish: a single light sweep across the pill and a small nod of the trophy. Once.
- **Day-over transitions**: each screen fades in over 180 ms (`.screen > *`), so planning → service → evening reads as
  a cross-fade on the cream page rather than a cut.

**Soundtrack** (`lib/music.ts`, lazy, 6.8 kB): three looping 16-bar pieces, all synthesised (oscillators + one noise
buffer; no audio files, no licensed music): planning (calm, F major, 84 bpm, keys arpeggio), service (brisk, A minor,
112 bpm, bass + off-beat stabs + kick/backbeat; a rush eases it to 124 bpm with sixteenth hats and an extra kick),
evening (warm, E-flat, 72 bpm, held chords). The title plays the planning piece. The Music decor item picks the
instrument palette, so decorating is audible: Quiet room = clean keys, straight; Kitchen radio = tinny (band-passed)
square waves; Jazz speakers = soft detuned keys, swing, brushes; Jukebox = organ, the hardest swing, full kit; Grand
piano = plucked keys, no drums. The tune is a fixed-seed walk over chord tones (the same every loop).

### Settings (rows added at the end of the list, each marked `{/* R12-A */}`)
- **Animations** switch (on by default). Off sets `data-motion="off"` on `<html>`; with it — or the OS's
  prefers-reduced-motion — every count-up is instant (`lib/motion.tsx` `motionOk()`, shared by MoneyText), CSS
  animations and transitions are off app-wide, and the floor draws its still frames (no steam, no coin, no shuffle
  delay, no breathing; the five-star ring shows still). Music still plays.
- **Music** and **Sound effects** volume sliders (`components/VolumeSlider.tsx`): native range inputs, 44 px tall,
  arrow keys / Page Up/Down / Home / End, `aria-valuetext` "40%" / "Off". Defaults 40 % and 80 %. The existing **Sound**
  switch is the master: off silences both. Releasing the Sound effects slider plays the bell as a sample.
- Stored in the same settings record (`lib/settings.ts`: `animations`, `musicVolume`, `sfxVolume`); old stored
  settings load with the defaults; volumes are clamped to 0..1.

### How the audio is wired
`lib/sfx.ts` (main chunk, small) is the front door: `playSfx(kind)`, `setSoundtrack(scene, palette)` (App, from the
phase and `game.decor.slots.music`), `setRush(on)` (Service). The AudioContext is created on the first pointerdown /
keydown (autoplay rules; resumed on later gestures) and only then is `music.ts` imported. Where Web Audio is missing
every call is a no-op and nothing throws. At music volume 0 (or Sound off) the bus ramps to exactly 0 and the
scheduler stops, so nothing is scheduled. Playtest read-out: `window.__fpMusic()` with the dev switch
(`full-plate:dev`), giving scene, palette, bpm, rush, running, notes scheduled and the bus gain.

### Bundle
The main chunk was 199.2 kB of 200 before this round; this work would have taken it to 203.2. The Evening screen is now
a lazy chunk (`App.tsx`: `lazy(() => import("./screens/Evening"))`, prefetched as soon as service starts), so the
main chunk is **180.2 kB**; Evening is 23.3 kB, music 6.8 kB.

### Left out, and why
- No confetti, no screen shake, no pulsing rush (brief, and the audience is 14).
- No per-dish plate art when carrying (plates use three fixed food colours, as on the tables).
- Music has no separate title piece (the planning piece plays on the title) and no crossfade between pieces — the old
  piece stops and the new one starts on its first bar with a 0.6 s fade-in.
- The hands-on canvas (HandsOnShift) is unchanged: its juice is its own.

### Numbers and checks (R12-A)
- Tests: workspace 1,241 → **1,259** (game 535 → 553: +18 in `round12.juice.test.tsx`; `r7shell` updated for the three
  new settings fields, nothing deleted). Headless balance (200 seeds × 365 days, normal) typical / cheap / nohire **90.0 / 68.0 / 0.0** —
  no sim file changed.
- Chunks: main `index` 199.2 → **180.2 kB** (Evening lazy); Evening 23.3, music 6.8, RestaurantView 38.6 → 41.5 kB;
  main CSS 135.7 → 139.3 kB.
- Floor cost: canvas calls per frame on a busy lunchtime at 4× (stubbed context, 300 frames) 751 → 792 (+5 %). The
  R8.6 Playwright method (4× CPU throttle, 5 s of rAF intervals at 4×) was run base/after on this machine but the
  machine was saturated by parallel builds (load 17–60): both builds dropped most frames (avg 35–150 ms) and the
  run-to-run spread swamped any difference. Re-measure on a quiet machine before trusting either.
- Type audit normal / large: 0 runs under 13 px, 0 errors. Probe: within noise of the baseline — the only rises were
  the live 4× service screen (whether an incident card has scrolled the side panel when the speed deck is measured),
  and the base build on the same machine shows the same rise (1280 large covered 12 vs baseline 8); not re-baselined.
- Playtest (built dist, 1024×768 touch, `scratchpad/shots/r12/A/`): new game → starter menu → day 1 and day 2 service
  at 2×/4× → evenings; paid coin caught on the floor (`21`–`24`), rush tint (`04`, `08`), evening count-up mid-way
  (`06`: £139 of £151), Settings rows (`11`), Animations off + Music 0 (`12`): `__fpMusic()` gain 0, scheduler stopped,
  notes 839 → 839 over 1.5 s; with Animations off the evening figure is final 60 ms in and `document.getAnimations()`
  is empty. 0 page errors.
- Pre-existing, not changed: the header's Settings sheet sits under the Evening's pinned action dock (header z 5,
  dock z 6). Raising the header fixes it but moves the probe's covered counts, so it's left for a layout pass.

## Round 12 — B: brand kit and postcard

The restaurant is visibly hers: a logo, house colours, lettering, a staff uniform and a menu style, all picked in one
sheet and then worn everywhere; and a postcard of any night, saved as a PNG. Game-side only — the sim never sees it.

### On screen

- **Restaurant tab › Your brand** (a full-width card under the dining room): the logo, the name in the brand's lettering,
  a line naming the parts ("Shield · Chilli · Chalkboard menu · staff in waistcoats"), the shopfront picture in the house
  colours with the logo on the corner, and **Edit brand** / **Postcard**. A brand nobody has edited says "Made from your
  restaurant's name — make it yours".
- **Brand kit** (the editor sheet, wide dialog that scrolls inside the viewport, its buttons pinned at the bottom): a sticky
  live preview on the left (logo + wordmark, the shopfront, the menu header in the chosen style, four staff portraits in
  the uniform — her own staff where she has them) and the choices on the right, each a radiogroup of ≥ 44 px buttons:
  - **Logo shape** (8): circle, shield, rosette, plate, tile, ribbon, hexagon, arch — each button draws the real logo.
  - **Picture** (14): knife and fork, chef's hat, flame, leaf, star, fish, coffee cup, chilli, noodle bowl, glass, whisk,
    pizza slice, cupcake, loaf. All drawn for this round as path data in `lib/brand.ts` (no outside art, no brand marks).
  - **Lettering** (4, the two bundled families only): Rounded (Fredoka 600), Strong (Nunito 800), Sign caps (Nunito 800,
    capitals, tracked), Slanted (Nunito 700 italic).
  - **House colour** and **Accent colour**: 18 curated swatches each plus **Or any colour** (a hex field; a bad code gets a
    one-line hint and changes nothing).
  - **Uniform**: Apron, T-shirt, Shirt, Waistcoat, and a colour (swatches + hex).
  - **Menu and sign style**: Classic, Modern, Chalkboard.
  - **Randomise** (a fresh decent brand from the game's seed and the click count: same clicks, same result), Cancel,
    **Save brand**.
- **Where the brand shows**: the header (a logo chip before the name, the name in the lettering; the awning stripe over
  the header in the two house colours), the Menu tab's "Today's menu" header in the menu style (classic: double rules;
  modern: a house-colour band; chalkboard: a board in a wooden frame), the Evening's header (a house-colour rule and the
  logo), the floor canvas (staff in uniform, the shop's awning in the house colours), the Staff tab's cards (portraits in
  uniform), the Empire strip (logo before the brand name: every shop flies it), the Stars guide envelope (the group logo
  on its banner), Your games (each game's logo; greyed when lost), the win picture (logo and house-colour stripe).
- **Postcard** (Evening header, and the brand card): a sheet with a **Wide** (1200×630) / **Tall** (1080×1350) switch,
  a preview, and **Save postcard**. The card: logo, name in the lettering, district · day · date, the room as the floor
  canvas draws it (staff in uniform), a headline, three numbers (guests fed, takings, rating — or tables / seats / dishes
  before the first night), the night's best review with its stars, and "Full Plate" small. Three layouts follow the menu
  style. It says under the preview: "Just the restaurant: its name, logo, room and the day's numbers. Nothing about you."
  No player name, no career name, no account anything.

### Rules

- **Contrast.** Brand colours are only ever fills, borders and stripes. Text on them is `--on-brand-*`: cream or ink,
  whichever reads better, or pure white/black if neither reaches 4.5:1 — the better of those is ≥ 4.58:1 for every colour,
  so any hex she types keeps the audit at zero (a test sweeps the palette and a 16×16×6 grid of hexes). The logo's motif
  falls back to the readable text colour if the accent nearly vanishes on the shape (< 1.6:1).
- **Default brand.** `defaultBrand(name)` hashes the name into every part; a word in the name picks the motif (Noodle →
  bowl, Fish/Chips → fish, Café/Coffee → cup, Pizza, Grill → flame, Bakery → loaf…). So every existing restaurant —
  all 29 corpus saves — looks branded on first load, no sheet. An Empire's default comes from the Empire brand's name so
  every shop matches (a game that never edited its brand gets a new default look at the fork, when she names the brand).
- **Career.** An employee wears the employer's default brand, read-only (stored codes are ignored until the handover);
  the brand card, if reached, says "This is X's brand. You can design your own once you run the place." After "Open my
  own place" the kit is hers.
- No new motion, no sound: nothing to switch. The sheet's buttons drop their transitions under reduced motion.

## Round 12 — F: Invent a dish

Name a dish, pick its course, plate and ingredients, set the price, and watch it sell in the real economy. Tests:
`round12.invent.test.tsx` (8, game), `content/test/customDish.test.ts` (16) and `customDish.fair.test.ts` (1).

### On screen

- **Menu tab › "Your cookbook"** (between today's menu and the recipe book): an **Invent a dish** button (chef's hat
  icon) and, once she has invented something, a strip of cards — plate emoji, name, course, the day it was invented,
  its suggested price, **plates sold all time**, and "On the menu" / "Resting" or an **Add to menu** button. Hidden in
  a career (the employer's menu isn't hers) until the handover; the button goes at 12 recipes.
- **The invent sheet** (a wide Dialog, scrolls inside with a sticky footer at 768 px tall): name (32 characters, live
  count; cleaned like a restaurant name), course (Starter / Main / Dessert / Drink as a segmented control), plate (20
  food emoji as 44 px toggles, each with a name for screen readers), ingredients (2–5 from the real list via a native
  select, each with a quantity stepper in quarters from ¼ to 3, its unit and per-plate cost, and a remove button).
  The right column updates as she goes: a plate preview with the cuisine it "reads as" and a vegetarian note;
  **ingredients cost**, **suggested price**, **skill needed** (with her best chef's skill beside it, and a warning when
  it's above), **prep time** in minutes; the **sell guess** — "Likely a favourite" / "Should sell steadily" / "A slow
  seller" / "A hard sell" with one line saying why (price, a thin plate, or who on this street likes it); and **your
  price** with the margin (a `<Term id="margin">`) and a note when it's over the going rate. Footer: Cancel and
  **Put it on the menu** (or **Save to cookbook** when the menu is full), disabled with the reason until there's a
  name and two ingredients.
- **Menu rows** show the chosen plate emoji instead of the course icon for an invented dish; everything else (price
  stepper, margin, Rest, ✕, the matrix, the stock forecast, the evening's tips) treats it like any dish.
- **Evening › What people said**: the first night an invented dish sells, one extra word-of-mouth review at the top
  names it ("Took a chance on the Midnight mushroom risotto. The chance paid off, which is more than I can say for my
  bus fare."), stars from that night's plate quality. Display only — the sim's reviews are untouched.

### Where the code lives

| File | What |
| --- | --- |
| `lib/brandCode.ts` | The `Brand` type, the option lists, the save code `1.<shape>.<motif>.<letter>.<primary>.<accent>.<uniform>.<uniformColour>.<menu>` (`encodeBrand` / `parseBrand` / `BRAND_RE`), `uniformPatch` + `dress`. No React/DOM/CSS: the save check and the canvas import it. |
| `lib/brand.ts` (+ `brand.css`) | Palette, names, contrast (`onColour`), `defaultBrand`, `resolveBrand`, `randomBrand`, `logoSvg` / `logoDataUrl`, `lettering`, `brandVars`, `applyBrand` (CSS variables + `data-brand` / `data-menu-style` on `<html>` + the canvas uniform), `useBrand`, `avatarUniform`. Lazy chunk. `brand.css` holds every page tint, keyed on `:root[data-brand]`. |
| `lib/brandHook.ts` | Main chunk, a few lines: `useBrandStyle(game, meta)` in App imports `lib/brand` and applies the resolved brand (null on the title). |
| `canvas/brand.ts` | `setCanvasBrand` / `brandLook`. `RestaurantView` has one new optional `RenderOptions.brand` (omitted = the page's brand, `null` = none) and dresses staff in `drawStaffMarker`; nothing else in canvas changed. The canvas awning comes from `--awning`, which `applyBrand` sets (handson's `awningColours` already read it). |
| `screens/planning/BrandTab.tsx` (+ `.css`) | `BrandCard`, `BrandSheet`, `Wordmark`, `Logo`. Lazy from RestaurantTab. |
| `components/PostcardDialog.tsx` | `PostcardDialog`, `PostcardButton`. Lazy from Evening; BrandTab imports it. |
| `lib/postcard.ts` | `postcardInfo`, `drawPostcard`, `roomPicture` (a hidden on-page canvas for a moment, so the theme and brand awning resolve), `makePostcard`, `offerPng`, `saveWinPicture` (WinScreen's old `savePicture`, moved). PNGs go out through `saveFiles.offerFile`, which now takes a Blob too (the `downloads` capability inside claude.ai, else `<a download>`). |
| `components/Avatar.tsx` | Optional `uniform` prop, spread over the spec. |
| `components/Shopfront.tsx` | Awning and name board read `--brand-primary/-accent/--on-brand-primary` (theme fallbacks), optional `logo`. Now lazy on the title screen too (main-chunk relief, below). |
| Saves | `PathMeta.brand?: string` (absent = default). `saveCheck.ts`: `brand: opt(str(80))`, then dropped if it fails `BRAND_RE` (a bad code shows the default, the save still loads). `SlotSummary.brand` (cleaned in `pickSummary`, `opt(str(80))` in the account header schema) for Your games. `autosaveKey` includes it, so saving a brand saves the game. Reducer action `{ type: "brand", code }`. Corpus: `r12-owner-branded-d40.json.gz` (an r11 owner save with a brand set through the reducer); `corpus.test.ts` treats `r1N-` files as generated. |

### Left out, and why

- **Hands-on kitchen sprites** don't wear the uniform: that canvas is the `handson` package (a sim package, and another
  builder's ground); its awning does follow `--awning`.
- **MyShift** (career) shows no brand card: the header already wears the employer's logo; a read-only card there would
  be a second place to say "not yours yet".
- **Empire per-shop logos on the world map**: the strip and every shop share one brand; drawing it on map pins would need
  the Empire tab's map code (not B's).
- A dedicated **receipt**: the postcard is the receipt-like keepsake; the Evening's sums table keeps the theme look.
- Picking a postcard layout separate from the menu style (it follows the brand, one less choice).

### Merge notes

Touched files others may also touch: `App.tsx` (one hook line, one `onBrand` prop), `screens/Planning.tsx` (prop
thread), `screens/planning/RestaurantTab.tsx` (props + one lazy card at the end — E adds a card too),
`screens/Evening.tsx` (one lazy `PostcardButton` in the head — A animates this file, E adds a mount point),
`screens/TitleScreen.tsx` (Shopfront import → lazy; C/G add buttons), `screens/planning/MenuTab.tsx` is **not** edited
(the header is styled by CSS on its existing structure: `.menu-layout > .stack--sm > .row:first-child`; if F changes that
row's position the style follows the first row), `canvas/RestaurantView.ts` (import + one option + one line in
`drawStaffMarker` — A owns canvas), `state/saveCheck.ts` (two schema lines + one cleanup — F adds custom dishes),
`state/saveStore.ts`, `state/useSaves.ts` (autosave key gains `:${m.brand}` at the end), `corpus.test.ts` (legacy filter).

### Checks (built dist)

- **Main JS 199.18 → 196.71 kB** (budget 200). The brand added ≈ 1.7 kB to the main chunk (the hook, two lazy mounts,
  the prop threads, the save fields); the title screen's Shopfront picture (4.5 kB) moved to its own chunk to pay for it
  (a same-size empty `<svg>` holds its place for the frame it takes to load). New lazy chunks: `brand` 8.87 kB (+ CSS
  2.7 kB), `BrandTab` 7.73, `postcard` 9.42, `PostcardDialog` 2.65 (+ CSS 4.6), `Shopfront` 4.59, `brandCode` 1.35.
  Changed: `RestaurantView` 38.57 → 38.69, `StaffTab` 14.29 → 14.44, `SlotPicker` 9.37 → 9.64, `WinScreen` 6.29 → 5.56
  (the picture code moved out), `saveCore` 9.28 → 7.10 + a 2.43 kB `saveCheck` module chunk (the cleaned schema now
  shares `brandCode` with the brand chunk), `saveFiles` 3.87 → 3.92.
- Tests: game 536 → 556 (`round12.brand.test.tsx`, 20); all packages pass.
- Type audit normal and Bigger: 117 screens each, 0 text < 13 px, 0 errors. (The first run found 4 runs < 13 px on the
  Restaurant tab: the shopfront's "Open" / "Today you're the boss" drawn at 300 px wide; `<Shopfront small>` leaves them off.)
- Probe within the baseline, no baseline change: the first run counted more `covered` / `underBar` (the header logo chip
  and a flex name row made the header taller, the menu header and evening stripe added height). The chip now sits inside
  the name's line box, the menu header's 6 px frame is taken back by a −6 px margin, and the evening stripe is a
  box-shadow with the Postcard button at the head's top right, so nothing on any screen moves down. Checked per screen
  against master's own probe at 768×1024 (the run that was one over): identical.
- Headless balance unchanged: typical 180/200 (90.0 %), cheap 136/200 (68.0 %), nohire 0/200 (0 %); no sim package touched.
- Playtest 1024×768 touch, built dist (shots `scratchpad/shots/r12/B/`, 18 + two downloaded PNGs): new game "Rosa's
  Kitchen" → its derived brand → Brand kit: Shield, Chilli, Sign caps, Navy / Butter (also typed as a hex), Waistcoat in
  Cherry, Chalkboard → saved → header chip, card and shopfront, chalkboard menu header, a server's card in the waistcoat,
  service with the server in the waistcoat and the awning in navy/butter → Evening → Postcard: Wide and Tall saved
  through the download path → reload → Continue: the brand is back → Your games shows the logo → a round-7 corpus save
  ("Rosie's") shows its derived brand (Shield · Cupcake · Modern). 0 controls under 44 px in the kit; 0 page errors.


## Round 12 — C: daily challenge, chapters and Quick year

### Today's challenge

- **Title › Today's challenge** (one button, under Your games / New game) opens a lazy intro screen
  (`screens/Challenge.tsx`): the date ("Tue 10 Nov · same for everyone today"), the scenario's name and one line, the
  restaurant and street, the goal in words, the scoring rule, **Start** / **Carry on: day N of 5** / **Start again**
  (confirm), today's best with its code, and **Your best days** (top ten).
- **One scenario per UTC date** (`lib/challenge.ts`): FNV-1a of the date picks the seed, street, name and start day
  (28–48); `dayNumber % 6` rotates six templates — Rescue the café, Rush week, Inspector due, Staff walked out, New
  rival opened, Festival weekend (Thu–Mon). `buildChallenge` runs the real sim with sim-core's scripted owner
  (`runStrategyDay`, `typical`, or `cheap` for Rescue) to the start day, a few days per slice behind a progress bar
  (≈0.1–0.7 s), then sets the problem up with ordinary commands only: REMOVE_MENU_ITEM (the best seller, Rescue), FIRE
  (all but one chef, Walkout), SET_MENU_ITEM ×1.2 prices (Rival), SET_ROTA weekend off for half the team (Festival).
  The goal's number comes from the restaurant's last week and is stored in the run (`ChallengeMeta.target`). Same date
  ⇒ byte-identical state (tested).
- **Play**: the normal game view on Normal, with a bar under the header (`ChallengeHud`): name, "Day 2 of 5", the goal,
  a meter, where it stands; on the fifth evening "Last night done. Next day shows your score." Any service can be
  watched, skipped or played hands-on. No save slot is touched: the run is packed (saveCodec) into
  `full-plate:challenge:v1:run` every morning, evening and service start, and goes through `saveCheck` on load.
  Reloading and pressing Today's challenge → **Carry on** resumes (tested in the app and in the playtest). A run from
  an earlier date is cleared ("Yesterday's run ended at midnight (UTC)"); only today's date is playable. Dev builds
  accept `?challengeDate=YYYY-MM-DD`; the shipped build ignores it.
- **Score screen** (`screens/ChallengeScore.tsx`, after the fifth evening's Next day, or a bust): the goal line
  (done / missed; Inspector says which night it was), Goal (1,000 if met, else up to 600 for how close) + Takings
  (1 per £5) + Reviews (guest-weighted rating × 100) − Losses (1 per £5 binned or spent on incidents, 10 per walkout,
  300 if the bank closed it). Scripted owners score ≈1,000–2,800. A **six-character code** (Crockford base 32: date
  mod 64, score 17 bits, 7-bit check; shown "FG4 X9V", Copy button) and **Compare**: type a code (any case, spaces or
  dashes; I/L read 1, O 0) → You vs Their code side by side with the day each was from and "They win by 250."; a wrong
  letter is caught ("That code doesn't add up."). Try again → the intro; Title screen.
- **Bests**: `full-plate:challenge:v1:best` (best per date, last 120 dates); a score that enters the all-time top five
  is also written as an onboarding-flag key (`full-plate:onboard:v1:challenge:<date>:<score>`), which the existing
  prefs sync already mirrors to the account (cap 50 flags, so at most a handful of these); the list merges both.

### Chapters

- Owner games, year 1, before the fork, not in a challenge: on the evening day 30·N ends, a lazy dialog
  (`screens/ChapterCard.tsx`) "Chapter N done · Chapter N of 12 · days …": 1–5 stars (1 + month in profit + average
  ≥ 3.5★ + ≥ 4.2★ + popularity up), profit / reviews / covers / popularity tiles, one "Next: …" line (the first thing
  missing; the last chapter says the visitors are coming), one button. Dismissed = `PathMeta.chapterSeen` (saved, in
  the schema). `paths.ts chapterDue` decides. Presentation only.

### Quick year

- Lease screen switch **Quick year** (off by default): `PathMeta.forkDay = 120` (`QUICK_FORK_DAY`). The fork turned out
  to be game-side state, not a sim rule, so **no sim package changed**: modules that read the fork day are
  `state/paths.ts` (`forkDayOf`, `forkDue`, `forkMilestone` — profitable days asked scale 90 → 30), `gameReducer.ts`
  (`settle`, the `fork` action), `screens/Evening.tsx` (the Sunday fork hint), `screens/paths/ForkCard.tsx` (kicker "A
  quick year done") and the chapter count (4). Unset ⇒ 365 exactly as before (sim state identical, tested). "Start over
  with the same restaurant" keeps it. Validated in `saveCheck` (120–365). Scripts `corpus.gen.ts` / `audit-saves.gen.ts`
  still use `FORK_DAY` (they build 365-day saves on purpose).
- "How do I win?" adds the chapters, Quick year and Today's challenge.

### Bundle

- Main chunk 199.18 → **199.02 kB**: the morning post (`EventModal`) is now a lazy chunk (2.9 kB, fetched as soon as
  an event evening starts), which pays for the title button, the routes and the fork-day plumbing. New chunks:
  `Challenge` 6.2 kB, `ChallengeScore` 4.8 kB, `challenge` (lib) 9.4 kB, `ChapterCard` 2.4 kB, `challenge.css` 6.8 kB.
  Never import `lib/challenge.ts` or the three screens statically from main-chunk code.

### Left out

- No Settings row (chapter cards are one tap to close; a switch would have cost main-chunk bytes).
- The probe/audit walk doesn't visit the challenge screens (that harness is D's this round); the playtest checked them
  for text < 13 px, controls < 44 px and sideways scroll instead (none).
- The code holds only the total, so Compare can't show the other player's breakdown.

### Checks (built dist)

- Tests: game +14 (`round12.challenge.test.tsx`: determinism and rotation, set-ups, score sum, code round-trip and
  typo, bests and the account mirror, run save + schema, Quick year fork at 120 (and not at 120 in a normal game) with
  both paths stepping on, chapters due/seen/stars, title button, score + compare, the app flow including resume and
  "Next day → score"). One copy change kept (`r7shell` pins the fork's "for a whole year" line).
- Headless balance unchanged: typical 90.0 %, cheap 68.0 %, nohire 0 % (200 seeds).
- Type audit normal and Bigger: 117 screens each, 0 text < 13 px, 0 errors, within baseline. Probe: within baseline,
  no baseline change (two full runs on a loaded machine showed a 768-px `21-service-4x` "covered 4" and a crashed
  1280 tab; reruns of this branch and a master build gave the baseline exactly, so both were timing).
- Playtest 1024×768 touch (shots `scratchpad/shots/r12/C/`): title → Today's challenge (Rush week, Two Forks) →
  Start → bar "Day 1 of 5 · Serve 490 guests"; reload → Carry on day 1; five days skipped (reload on evening 3 →
  Carry on day 3); fifth evening says Next day shows the score → 1,258, code FG4 X9V; a typed "FG5-whq" → "They win
  by 250."; "ABCDEF" → "doesn't add up"; Try again → intro with today's best. Lease: Quick year off by default, on →
  day 1. A quick-year save at day 120 (typical owner): chapter 4 card (3 of 5, "That's the year…") → closed in one
  tap → next evening the fork card, kicker "A quick year done". Text ≥ 14 px and no control < 44 px on the challenge
  screens, no sideways scroll, 0 page errors.

## Round 12 — E: a voice with an edge, a rival with attitude, regulars with storylines

Humour that treats a 14-year-old as clever, and people instead of market segments. Everything below is worked out
from the seed, the day and the sim's own results (`GameState.history`, `log`, `staff`, `menu`; Stars' critic reviews),
so a save says the same thing on every load and on every device. **Nothing is stored** (no new save field, no
PathMeta key, no localStorage) and the sim is untouched. Tests: `round12.voices.test.tsx` (game),
`content/test/round12.voices.test.ts`.

### On screen

| Where | What | Code |
| --- | --- | --- |
| Planning, top (owner games) | **Food Gossip**: the district's station (Pier 104, Campus 87.6, High Street FM, Park & Ride Radio) and one line for this morning. **More** (44 px, `aria-expanded`) lists the last seven mornings, newest first. Text only: no motion, no sound. | `components/GossipTicker.tsx`, `lib/gossip.ts` |
| Evening | **Plate Expectations** — Ruth Lessley's review on her visit nights (headline, stars, review, sign-off); **Your regulars tonight** (a newcomer's intro, a VIP order met with its photo, or the bad branch); the **framed clipping** on the night it's earned; **Tomorrow on Pier 104** — the line tomorrow's ticker will open with. One mount, after "What people said". | `components/EveningExtras.tsx` |
| Restaurant tab | **Across the road**: the rival's portrait, name, restaurant and personality; "who's winning on reviews" for the last complete week, the winning streak, their last three posts; the **framed clipping** badge once earned. Beside it, **Regulars** (who's a regular, open VIP orders) and **Open the Regulars book**. | `components/RivalCard.tsx` (`RivalCard`, `RegularsCard`), `lib/rival.ts` |
| Regulars book (sheet) | Each regular so far: portrait, job, usual dish, the story so far (bad-branch beats in soft ink), the open **VIP** order with "on your menu" / "not on your menu" and what meets it, and the photos (polaroids) they've left. | `components/RegularsBook.tsx`, `lib/regulars.ts` |
| Service floor | Regulars due tonight and the blogger are named guests: tap their table and a name tag ("Priya Nair", "Ruth Lessley (food blogger)") shows over it. | `lib/regulars.ts floorNames`, canvas `guestNames` |

### How each voice works

- **Gossip** (`gossipFor(game, day)`): a line for the morning of `day` reads only results up to `day − 1`, so past
  mornings never change. Precedence: opening day → the clipping → a regular's beat (its gossip line is the beat's
  reward) → the blogger's verdict → "Ruth Lessley is in the area" (her visit morning) → the guide critic (Stars: a
  rewritten `criticText.localCritic` line) → hard news (closed, a 1★ review, a hire, a dish ran out, a loan, new decor; demoted to soft news when the
  same kind also happened the morning before, so a dish running out every night isn't the headline every day)
  → Monday's rival result → soft news on 60 % of mornings (5+ walk-outs, a 5★ review, a rush ≥ 20 and 1.3× the recent
  average, a strong day, a loss, a quiet night ≤ 15 and < 0.6×, the best dish, a sorted problem) → a running joke every
  third morning on its day (Clive Halfway, the critic who never finishes; the council's bin lorry; episodes in order)
  → patter. A reaction quotes the real numbers ({covers}, {walkouts}, {dish}, {staff}).
- **Rival** (`rivalFor(seed, district)`): name from 16 × 12 names, one of **8 personalities** (Showman, Purist,
  Influencer, Penny-Pincher, Old Pro, Health Nut, Grill Boss, Fusion Fanatic), a restaurant from the personality's
  patterns. Weekly score = 3.3 + district lean (±0.1) + a seeded wobble (±0.3) + 0.006 × (the player's standing − 50),
  where standing is 20 × their average night over the four weeks before (worked out from saved results, never from
  live popularity, so a week's score never moves later). The player's score is their real nightly average that week
  (Monday–Sunday); a week with no open night is a forfeit ("You were shut all last week, so … wins by default"). Posts on 2–3 seeded mornings a week: "your bad night" (4+ walk-outs or
  under 3★), "your good night" (4.3★+ or a rush), else who led last week (or "close"). **Three weeks running** ahead
  earns the clipping, once, the Monday after: a gossip line and a badge on the Restaurant tab (cosmetic: not a decor
  item, so no sim number can move).
- **Blogger** (`lib/blogger.ts`): first visit day 8–12, then every 18–24 days (seeded). Her stars: the night's real
  average − 0.25, − 0.5 more if 3+ and over 15 % walked out, rounded, 1–5; open but nobody served (no stock) is 1★.
  A day shut with Close tonight gets its own (rude) post about the door.
- **Regulars** (`regularsFrom(seed, history)`): ten people join in a seeded order — the first on day 1, then 4–7 days
  apart — each on their first open day from their planned day, one a day, and only while fewer than **3** stories are
  running. The intro is beat 1; beats 2–5 are VIP orders: a dish from the beat's list (one that sold that day if any) on
  a weekday 5–8 days ahead. Met on that weekday (or a later one) when the dish sold and the night averaged **3.5★+**:
  the story moves on, a photo goes in the book and the beat's gossip line plays next morning. A beat with a `bad` branch
  moves on after a poorer night too (no photo: the date talked about his car); one without waits for next week ("they
  came but it wasn't a good night").

### Bundle

All of it is lazy. Main chunk **199.18 → 198.95 kB** (the three mounts and the VIP glossary entry cost ≈ 0.6 kB;
making `RestaurantTab` a lazy chunk paid for them). The voices data and libs are their own chunks (`vite.config.ts`
sends `content/src/voices.ts` and `data/{gossip,rival,regulars}.json` to `voicesData` instead of the start-up
`content` chunk); `content` grew 186.4 → 190.3 kB for the blogger's text in `criticText.json`.

### Left out, and why

- **No stored state.** The 400-day history cap (sim-core `HISTORY_MAX`) is the horizon: in a game past day 400 a
  beat or the clipping earned more than 400 days ago is re-derived from what the history still holds, and can drop
  out of the book. A memo in PathMeta (written by the reducer at END_DAY) would fix it, but the libs would have to be
  in the main chunk, which has no room. Same save, same text holds regardless.
- **Floor names are cosmetic memory**: a name stays on the party it was first given to for the day; a reload
  mid-service may give it to another party of the same kind.
- **No tag without a tap**, and the Service side panel doesn't name the guest (Service.tsx is Builder A's this round).
- The clipping is a badge, not a decor item: adding it to the decor catalogue would touch the decor content the sim
  reads (and the Decorate tab's counts).
- Career mode has none of this (the employer's restaurant isn't the player's).

### Checks (built dist)

- Main JS **199.18 → 198.96 kB**. New lazy chunks: `voicesData` 56.4 kB (JSON + validator), `voices` 3.0 kB (libs),
  `RestaurantTab` 5.0, `RegularsBook` 3.1, `EveningExtras` 2.9, `GossipTicker` 1.4; css `voices` 4.2 kB. `content`
  186.4 → 190.3 kB (blogger text), `RestaurantView` 38.6 → 39.1 kB (the name tag).
- The ticker is not shown on the wide Empire / Stars tabs (it pushed the stock warning under the sticky path strip:
  probe `covered` 5 → 7; back to 5).
- Probe baseline re-set: **term / targets<44 / targets<24 +1** in every run — the VIP term on the Restaurant tab's
  Regulars card; `underBar` at 1280×800 Normal 30 → 47 (the ticker adds a row to the planning screens, so more of a
  long menu sits under the dock until scrolled; every other run's `underBar` came in lower). Type audit Normal and
  Bigger: 117 screens each, 0 text < 13 px, 0 errors.
- Headless balance unchanged: typical 90.0 %, cheap 68.0 %, nohire 0 % (200 seeds × 365 days).
- Playtest 1024×768 touch (shots `scratchpad/shots/r12/E/`): a new game through the UI to day 19 (starter menu, two
  hires, restock each evening, Skip to evening): opening-day line, hire line, ran-out line, the 7-day list; Dev joins
  day 2, Ray day 8; Ruth Lessley "spotted" the morning of day 9 and her 4★ "getting good, and it knows it" review that
  evening; Ray's first VIP order met on day 16 (photo in the book); rival card "You're winning on reviews: 4.6 to their
  3.4"; two reloads of the same save gave identical ticker, rival and book text; 0 page errors.

| `packages/content/src/customDish.ts` | The content transform (`applyCustomDishes`, shaped like `applySoftDrinks`), the maths (`customDishFacts` / `deriveCustomDish`, `guessPopularity`), the recipe check (`checkCustomDish`, `cleanDishName`), and the game-side helpers kept here so they ride in the content chunk: `makeCustomDish`, `addCustomDish`, `inventInto`, `foldCookbook`, `cookbookStep`, `newDishReview` / `withNewDishReview`, `canInventIn`, `syncCustomDishes`, `customBase`. |
| `packages/content/data/customDishText.json` | The eight first-night lines (`newDish`). |
| `game/src/sim.ts` | `customRef` (the library pack the maths reads), `syncCustomDishes`, `cookbook` (sync + fold, once per reducer step), `cookingBase` (a fresh pack object for sim-stars' signature memo when dishes change). |
| `game/src/state/gameReducer.ts` | `{ type: "invent", dish }`; `appReducer` calls `cookbook()` after every step. |
| `game/src/state/paths.ts`, `saveCheck.ts`, `useSaves.ts` | `PathMeta.customDishes` / `cookbookDay`; the schema (types, ranges, name cleaning, the content recipe check, ≤ 12, no duplicate ids, every `custom:` id on the menu or set menu must be in the cookbook); autosave on a new recipe. |
| `game/src/screens/planning/CookbookStrip.tsx`, `InventDishSheet.tsx`, `invent.css` | The strip (lazy from MenuTab) and the sheet (lazy from the strip). |
| `MenuTab.tsx`, `Planning.tsx`, `App.tsx`, `Evening.tsx`, `lib/library.ts`, `lib/customDish.ts` | One lazy mount, the plate emoji in rows, the `onInvent` prop chain, `withNewDishReview` on the review list, `custom:` ids kept out of the recipe book, types. |
| `sim-core/src/util.ts` | The one sim-core change: the per-pack dish index is rebuilt when the pack's `dishes` array is replaced (`idx.dishList !== content.dishes`). No rule, number or RNG draw changes. |

How it hangs together: the recipe (inputs only) is saved in PathMeta, never in GameState. After every reducer step the
owner packs (`content` and `fullContent`) get their `dishes` array replaced by shipped + derived dishes (memoised on the
recipes array, so a tick costs one comparison); sim-core re-indexes because the array is new. The derived numbers are
a pure function of the recipe and the library pack, so a reload, an import on another device or a replay gives the
same dish. Ids are `custom:` + 8 base-36 characters hashed from the seed, day, count and name.

### Settings

None added. Motion: the sheet uses the Dialog's existing 200 ms pop (already off under reduced motion); the strip and
the icon toggles have no transitions. No sound.

### Left out, and why

- **Empire:** the dishes are in the pack every shop the player runs hands-on cooks from, but the brand formula still
  comes from the shipped presets (`extras.formulas`): putting an invented dish into a formula needs a picker in
  EmpireTab, which is outside this round's files.
- **Stars "refine":** skipped (time). The Stars game cooks invented dishes (signatures are memoised per pack object, so
  `cookingBase()` hands it a fresh object when the dishes change).
- **Editing or deleting a recipe:** not offered — a recipe's numbers are its identity, and the cookbook is a record of
  what she made. Take it off the menu with ✕ and it stays in the book.
- **A glossary term for "cookbook" / "signature dish":** plain words instead (main-chunk bytes).

### Checks (built dist)

- Main JS 199.18 → **199.97 kB** (budget 200): the strip (2.6 kB) and the sheet (8.8 kB) are lazy chunks, and the
  logic lives in the content chunk (186.4 → 196.4 kB). The main chunk carries the reducer step, the lazy mount, the
  plate emoji and the prop chain. Getting there meant writing those few lines without optional chaining (Babel's
  `?.` output is long) and moving every helper into content; the next main-chunk feature still has to move
  something out first (D's Settings split).
- Type audit normal and Bigger: 117 screens each, 0 text < 13 px, 0 errors. Probe: every count equal to master
  `496776e` except **768×1024 normal covered 33 → 37** (baseline raised): all four are the speed deck on the 4×
  Service shot. The walk reaches Service from the Menu tab, which is now longer, and Playwright's scroll to the
  off-screen "Speed 4" button lands the deck under the floor canvas. Opened from the top of the Menu, both master and
  this branch put the speed deck at y ≈ 1097 on a 1024-tall portrait screen, below the fold — a pre-existing layout
  issue for D's phone/portrait work, not something the cookbook adds.
- Playtest (built dist, 1024×768, touch; shots `scratchpad/shots/r12/F/`): new owner game, starter menu; invent a
  sensible risotto ("A slow seller": students might try it) and The Big Spender (5 luxury ingredients × 3, suggested
  £196.45: "A hard sell"); both on the menu with their plates; two days; day 1's reviews open with the first-night line
  for the risotto; the sim's own reviews name it on day 2; the cookbook shows 2 and 0 sold; Save to a file → a fresh
  browser profile → Load a save file → Continue: both dishes in the cookbook and on the menu. 0 page errors.

## Round 12 — G: visit a friend, and an invite-only co-op day

Social play without chat or strangers: everything opens with a code someone gave you, and nothing a visitor or guest
sends is free text. Over the artifact runtime's `db` (no server); on GitHub Pages or signed out every entry point says
"Sharing needs the Claude link…" (or "Sign in to claude.ai…") in one line. Design, data layout, safety and the co-op
decision with its numbers: **`docs/COOP-NOTES.md`**. Tests: `round12.visit.test.tsx` (17).

### On screen

- **Title › Visit a friend** (ghost button under New game). One code box (`ABCDE-23456`; case, spaces and dashes
  ignored) and a nickname (letters, digits, spaces, ≤ 16; filtered while typing, remembered on the device). The code
  opens whichever it is: a shared restaurant or a co-op day.
- **A visit** (read-only): the friend's dining room drawn by the real floor renderer in its empty-room preview (their
  tables, decor and sign), **This week** (nights open, covers, takings, profit, average rating — tipped terms), the
  **Menu** (dishes on, prices), **The team**, **What guests said** (the sim's reviews), and **Leave a review**: five 44 px
  star buttons and eight compliment chips (pick up to three), Send. "You've reviewed X today. Come back tomorrow."
  after one; "This is your own restaurant…" on your own code.
- **Restaurant tab › Friends** card (lazy): **Share my restaurant** → the code large, **Copy**, **Update**
  (re-share, same code), **Stop sharing** (the snapshot and its reviews go; the next share gets a new code). Under it,
  **Visitors**: stars, nickname, date and compliments, newest first (≤ 50 kept). Then **Plan tonight with a friend**:
  your nickname and **Invite a friend**.
- **Co-op panel** (host, bottom left, folds to a pill; lazy; mounted by App while this device hosts): the code until
  someone joins, then "Alice (you) with Bob · link N ms", the friend's last emote for 4 s, the plan when one comes in
  ("Bob sent a plan for tonight: Take off Margherita · Lasagne at £11.50 · Sam has tonight off") with **Use it** /
  **Not this time**, the six emotes, **End the co-op day**. It follows the game through service and the evening.
- **Co-op guest screen**: "Co-op day · you're Bob", "Chez Alice with Alice", emotes, then by stage: **Plan tonight
  for Alice** (each dish a toggle plus a price stepper; each staff member a toggle for tonight; "Send plan to Alice";
  "Alice used your plan." / "…kept their own plan this time."), "Alice is running tonight's service", **Tonight at …**
  (covers, walkouts, takings, profit, rating, best dish), or "Alice ended the co-op day" / "The two hours are up".

### Where the code lives

`state/share.ts` (db access, codes, names, the snapshot and its checks, reviews, the private record), `lib/visit.ts`
(the visit's throwaway room state, week totals), `lib/coop/protocol.ts` (documents, emotes, board/evening, plan →
commands), `lib/coop/session.ts` (DocWriter, join/resume, watchers, RttMeter), `lib/coop/hostFlag.ts` (the host flag,
lazy) and `lib/coop/flag.ts` (main chunk: `useHostOn`, `loadFriends`), `lib/coop/hand.ts`; screens `VisitFriend.tsx`
(entry; re-exports the dock and the card so all three share one chunk and one import site), `VisitRoom.tsx`,
`VisitShareCard.tsx`, `CoopShiftDock.tsx`, `CoopShiftGuest.tsx`, `CoopShiftParts.tsx`, `visit.css`. App: a `friend`
shell view and the dock mount; TitleScreen: `onVisit`; RestaurantTab: one lazy card; Planning: **the Stock tab is now
lazy** (see Checks). `scripts/lib/mockClaude.mjs` (the mock runtime, reusable) and `scripts/playtest-friends.mjs`.

### Settings, motion, sound

No new switch: nothing moves (an emote appears and goes after 4 s; no animation) and nothing makes a sound. All
controls ≥ 44 px; text ≥ 13 px; touch and keyboard (the stars are pressed-state buttons, the chips too).

### Left out, and why

- The real-time shared hands-on shift (COOP-NOTES "Why not"): the db's documented 30 s fallback delivery and write
  budget. `HandsOnShift` is unchanged (no `remote` prop).
- Watching a pretend service in a friend's room: the visit draws the empty room only (no customers); simulating their
  night on the visitor's device would need their stock and RNG in the snapshot.
- B's brand kit on the share: `ShareSnapshot.brand` is accepted and checked (plain data) but nothing fills it yet —
  `meta.brand` isn't on master and the Restaurant tab gets `game` only.
- A word filter for nicknames (none exists for restaurant names either).

### Checks (built dist)

- Main JS 199.18 → **195.14 kB**. The friends entry points alone took it to 200.74 kB (each `lazy(import())` site
  carries a preload list); after merging the three into one import site (`loadFriends` in `lib/coop/flag.ts`) and
  moving the host flag out, 200.26 kB, so **the Stock tab became a lazy chunk** (5.68 kB, "Opening the store room…"
  fallback, like Staff and Decorate). New chunks: `VisitFriend` 42.8 kB JS + 4.7 kB CSS (the visit, both co-op screens,
  the Friends card, the data layer), `StockTab` 5.7 kB.
- Tests 1,241 → 1,258 (+17, `round12.visit.test.tsx`). Type audit normal and Bigger: 117 screens each, 0 text < 13 px,
  0 errors, within baseline. Headless typical / cheap / nohire unchanged (sim packages byte-identical to master).
- Probe: normal runs equal to the baseline; the Bigger runs' `covered` rose 4–5, all on the live `21-service-4x` frame
  (the speed buttons under a status popup that depends on how many ticks a loaded machine ran in 6 s; nothing here is
  mounted there). Baseline not updated. The Friends card on `13-planning-restaurant` (off-db: one line) adds no counts.
- Playtest (`scripts/playtest-friends.mjs`, two contexts on the mock runtime, 1024×768 touch; shots
  `scratchpad/shots/r12/G/`): share → code; visit (room, week, menu, team, reviews) → 4★ + two compliments → the
  owner's Visitors list; second review the same day refused; invite → join → nicknames both ways, "link N ms"; the
  guest's plan (dish off, price up, staff toggled) → "Use it" → the host's menu changed, guest told; emotes both ways;
  service → the guest sees "running tonight's service" → Skip to evening → the guest sees the numbers; End → the guest
  sees it, the panel goes; no-db context: both entry points show the one line. 0 page errors.
