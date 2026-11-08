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

### Tests

`src/__tests__/round2.test.tsx` (+ `fixtures/round2.ts`: a real `newGame` state with incidents, goals and owner coverage added by hand; every transition still goes through the real sim): RESPOND_INCIDENT from the card and through the reducer (asserting either outcome: resolved by the sim, or refused as a toast), alert/ticker absorption, auto-pause rules, highlight targets, evening incident lines, goals rendering/tiers/flash/toast, the worst-dish filter, train blockers, owner-covered copy, and the keyboard guard.

### Screenshots

Playwright, fixture saves made with the real sim (scratchpad `shots/r2/`): `01-title-saved`, `02-planning-goals-firstrun`, `03-planning-help`, `04-planning-staff-train`, `05-settings`, `06-service-incident`, `07-service-incident-hover`, `08-service-goals-open`, `09-service-owner-covering`, `10-evening`, `11-evening-shortcut-to-restaurant`, `12-service-keyboard-table`, `13-service-after-respond`.

### Contract gaps (round 2)

12. **Incident severity / option outcome tone.** `INCIDENT_RESOLVED` has free text only; the ticker colour is guessed (ignored = bad, else good unless the text sounds bad). An `outcomeKind: "good" | "bad"` would remove the guess.
13. **Option affordability.** `IncidentOption` has no `disabled`/`reason` (e.g. "no porter on", "not enough cash"); the UI can only show the cost.
14. **Training fee and effect** are not described by the contract; the UI shows "£—" until a constant is exported and can't preview the skill gain.
15. **Break length.** No constant for how long `GIVE_BREAK` lasts, so the button can't say "15 min".
16. **Goal reward paid?** `GOAL_COMPLETED` has only `goalId`; the toast reads the reward from `state.goals`, which assumes the goal is still in the list after completion.
