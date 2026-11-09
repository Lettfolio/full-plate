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
- **Hands-on summary:** it is not yet fed into `stepCareerDay` (CAREER-NOTES suggests an optional argument). It shows on the evening only.
- **Former colleagues as hireable candidates later in the owner game:** not done. There is no `HIRE_STAFF` in sim-core. The day-1 colleague perk is applied by sim-career's state edit.
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
