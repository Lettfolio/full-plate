# Full Plate — UI notes (packages/game)

## Running

| What | Command |
| --- | --- |
| Dev (real sim-core + content) | `pnpm --filter @full-plate/game dev` |
| Typecheck | `pnpm --filter @full-plate/game typecheck` |
| Tests (real sim + content) | `pnpm --filter @full-plate/game test` |
| Static build → `packages/game/dist/` | `pnpm --filter @full-plate/game build` |

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
10-year-old. Structure from round 7 is kept (pinned bottom-right primary, day strip above the tabs, settings sheet
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
