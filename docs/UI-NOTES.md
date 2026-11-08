# Full Plate — UI notes (packages/game)

## Running

| What | Command |
| --- | --- |
| Dev, fake sim + fake content | `VITE_USE_STUBS=1 pnpm --filter @full-plate/game dev` |
| Dev, real packages | `pnpm --filter @full-plate/game dev` |
| Typecheck (always against the real `types.ts`) | `pnpm --filter @full-plate/game typecheck` |
| Tests (always on the stubs) | `pnpm --filter @full-plate/game test` |
| Static build → `packages/game/dist/` | `pnpm --filter @full-plate/game build` |

Keys during service: <kbd>Space</kbd> pause/resume, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>4</kbd> speed, <kbd>Esc</kbd> clear the selection.

## Stubs and the real sim

- `src/sim.ts` is the **only** module that touches the simulation or content. It re-exports `newGame`, `applyCommand`, `tick`, `runDay`, `candidates`, `classifyMenu`, `serialize`, `deserialize`, `content`, `SERVICE_TICKS` and `MINUTES_PER_TICK`. Everything else imports from `./sim`.
- `VITE_USE_STUBS=1` selects `src/dev/stubSim.ts` and `src/dev/stubContent.ts`. The stub sim is a toy: it has plausible stages, a P&L and events, but no balance.
- **Switching to the real sim means unsetting the flag.** Nothing else changes.
- Safety nets for milestone 1:
  - `vite.config.ts`: in stub mode, the two workspace packages are aliased to stub modules, so stub dev works even while the real packages are mid-refactor. With the flag off, if `sim-core/src/index.ts` or `content/src/index.ts` does not exist yet, the build falls back to stubs, prints a yellow warning, and the header shows a "stub sim" pill. Once both files exist, this has no effect.
  - `tsconfig.json` `paths`: `@full-plate/sim-core` resolves to `../sim-core/src/index.ts` first. If that file is missing, it falls back to `src/dev/contractShim.ts`, which re-exports the real `types.ts` and declares the API signatures copied from ARCHITECTURE.md. Typechecking therefore always runs against the real contract. Once `index.ts` lands, the shim is ignored. Delete both shims after that.

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
  lib/                 format (pence → £), calendar, content lookups, staff helpers
  dev/                 stubSim, stubContent, typecheck-only shims
  theme.css            all styling; CSS variables at the top
```

- Tick pacing: requestAnimationFrame runs 2 × speed ticks per real second (one service takes 60 s at 1×). Remainders carry between frames, and one frame runs at most 8 ticks, so a backgrounded tab does not fast-forward.
- Autosave: a save is written every time the day or phase changes. Starting service saves the tick-0 state, so Continue after closing the tab mid-service replays that service from 12:00. A game-over removes the save.

## Contract gaps (things the UI needs that types.ts / the public API do not provide)

Each of these is either worked around in a clearly labelled spot or left out. None are hacked into the sim.

> **Update while writing this:** the sim-core agent has since added optional fields to `types.ts` (uncommitted when this was written), and they close gaps 4, 5, 6 and 7: `GameState.eightySixed`, `Customer.comped`, `GameState.gameOverReason`, and `Candidate.hired` / `GameState.hiredCandidates`. The UI reads these when they are present and falls back to its own event-derived memory when they are not, so it works against both the old and the new contract. Once those fields are committed, the fallbacks in `state/gameReducer.ts` (`eightySixed`, `gameOverReason`) can be removed. `Customer.eatUntil` and `stageTick` (gap 8) are not used yet.

1. **Calendar.** No public start month, weekday of day 0, or weekend definition. `lib/calendar.ts` copies sim-core's internal `constants.ts`: 30-day months, April start, `rota[day % 7]` with 0 = Monday. *Ask:* export `START_MONTH`, `DAYS_PER_MONTH` and `WEEKEND_DAYS` (or a `dateOf(day)` helper) from `index.ts`.
2. **Commands fail silently.** `StepResult` has no rejection signal. If HIRE fails a cash check, or BUY_TABLE runs past `maxTables`, the UI cannot say why. *Ask:* `StepResult.rejected?: { reason: string }`, or a `LOG` entry with kind `"bad"` on every rejection.
3. **Prices of things you can buy.** The table price (`TABLE_COST`) and the recruitment fee are not in `ContentPack` or `BalanceDef`, so the Restaurant and Staff tabs cannot show them before you click. *Ask:* move them to `BalanceDef`.
4. **86'd dishes are not in state.** EIGHTY_SIX has no field to read back. The reducer keeps its own `eightySixed` list for the current service. That list is lost on reload, which is harmless because mid-service progress is not saved anyway. *Ask:* `GameState.eightySixed: DishId[]`.
5. **Comped parties are not marked.** `Customer` has no `comped` flag, so the UI cannot show a comped table or disable a second comp. *Ask:* `Customer.comped?: boolean`.
6. **Game-over reason is not in state.** It only arrives in the `GAME_OVER` event. That is fine within a session, but a reloaded game-over state shows a generic message. *Ask:* `GameState.gameOverReason?: string`.
7. **`candidates()` and HIRE indices.** The contract says candidates are "deterministic from seed+day". It does not say whether a hired candidate drops out of that day's list. If they stay, a second HIRE with the same index hires a clone. The UI hides a candidate whose name and role match someone hired today. *Ask:* define it, ideally by removing hired candidates and keeping indices stable.
8. **Who serves whom.** Tickets carry `chefId`, but nothing links servers to tables. Server movement on the canvas is cosmetic (nearest needy table). The same goes for the time a party has left on the "eating" stage. *Nice to have:* `Customer.serverId`, `Customer.stageEndsTick`.
9. **Log entries have no subject.** `LogEntry` has no `customerId` or `tableId`, so clicking a ticker line cannot highlight a table. *Nice to have:* `LogEntry.ref?: { customerId?, tableId?, staffId?, dishId? }`.
10. **Stock demand forecast.** The "needed for menu" hint is a UI heuristic: yesterday's covers × 1.1 spread across active dishes. Seasonal ingredient prices (`IN_SEASON_COST_MULT`) are not exposed, so the order sheet shows base `unitCost`, and the real charge may differ. *Nice to have:* `orderQuote(content, state, ingredientId, qty): Pence`. ORDER_STOCK also cannot be cancelled.
11. **Reputation by source.** The brief's evening screen wants the reputation delta "broken down by source". `DayResult` has only the totals `popularityDelta` and `prestigeDelta`, so the UI shows the totals.

## Known rough edges

- The canvas lays out up to ~14 tables in a grid. Above that it still works, but tables get small. Queue sprites cap at two rows on the pavement, and the "N waiting" badge counts the rest.
- Smooth movement is cosmetic interpolation between tick positions. At 4× people walk fast but stay readable.
- The menu matrix places dishes with no sales on margin alone, along a vertical line. It becomes meaningful after day one.
- Fonts (Fredoka, Nunito) are bundled through @fontsource; there are no network font requests.
- Light theme only. The minimum width is 1024 px (`body { min-width: 1024px }`).
