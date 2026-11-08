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
