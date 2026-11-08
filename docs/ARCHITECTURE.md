# Full Plate — Architecture (Milestone 1: Owner start, first restaurant)

Read the brief first: `docs/BRIEF.md` (exported from the design doc). This file is the build contract.

## Milestone 1 scope
One restaurant in one district. The player:
1. Picks a district and names the restaurant (NEW_GAME).
2. **Planning (morning):** sets menu and prices, hires/fires, sets rota, orders stock, buys tables.
3. **Service:** watches customers arrive, queue, sit, order, eat, pay and rate, at 1x/2x/4x. Can comp a table or 86 a dish.
4. **Evening:** reads a one-screen P&L, best/worst dish, reviews, staff mood, reputation delta.
5. Survives loan repayments, rent and a slow winter. Random events with 2–3 choices appear some mornings.
6. Game over on sustained negative cash (normal/hard); cosy never bankrupts.

Out of scope for M1: franchising, critics/stars, career ladder, first-person mode, multiplayer, save slots UI (but `serialize`/`deserialize` must exist).

## Packages (pnpm workspace)
```
packages/
  sim-core/   @full-plate/sim-core   pure TypeScript, zero runtime deps, vitest. The contract is src/types.ts.
  content/    @full-plate/content    JSON data files + a loader that validates against types and exports a ContentPack.
  game/       @full-plate/game       Vite + React 18 + TypeScript. Imports sim-core and content. Canvas-drawn restaurant view.
```
- `sim-core` must never import from `game` or `content`. It receives a `ContentPack` as an argument.
- `content` may import types from `sim-core` (type-only).
- `game` imports both.

## Determinism rules (sim-core)
- All randomness through `src/rng.ts` (xoshiro128** or PCG; state stored in `GameState.rngState`). No `Math.random`, no `Date`.
- Money is integer pence. Use `Math.round` at the end of each calculation, never accumulate floats in state.
- `tick`/`applyCommand` return a **new** state object (structural sharing is fine; mutation of the input is not).
- Same seed + same command sequence ⇒ byte-identical serialized state. There is a test for this.

## Systems order per tick (service)
ArrivalSystem → SeatingSystem → OrderSystem → KitchenSystem → ServiceSystem (eating, patience) → PaymentSystem → ClearingSystem → LogSystem
Per day (evening): FinanceSystem (rent/day, wages, loan) → WasteSystem → ReputationSystem → StaffMoodSystem → EventDeck (maybe queue an event for next morning) → StatsSystem.

## Key formulas (first pass — balance agent may tune via content/balance.json, not code)
- **Potential arrivals/day** = district.footfall × seasonCurve[month] × (0.5 + popularity/100) × Π footfallMods × weekendMult.
- **Choice to enter:** each potential party enters with p = sigmoid(appeal − priceGap − queuePenalty) where appeal = Σ over active menu dishes of baseAppeal[segment] (capped), priceGap = (avgMenuPrice − segment.averageBudget)/averageBudget × priceSensitivity, queuePenalty grows with queue length.
- **Patience** falls per tick waiting; speedWeight scales the fall. At 0 → walkout, popularity hit.
- **Dish quality** = min(qualityCeiling, chef.skill × traitMult − max(0, skillRequired − chef.skill) × 0.8 − fatiguePenalty) + ingredient freshness bonus ± small noise.
- **Satisfaction** = weighted(qualityWeight × avgDishQuality, speedWeight × (100 − waitPenalty), (1−priceSensitivity) × value) and server charm adds up to +10.
- **Rating** 1–5 from satisfaction bands. **Reviews**: rate ≈ reviewRatePer10Covers; text templated from content.
- **Reputation:** popularity moves toward the day's mean rating×20 by 10% per day, plus walkout penalties; prestige moves on reviews ≥4 with quality ≥70 and on critic events. Both decay toward 50 slowly.
- **Menu matrix:** popularity = sold7d vs mean; margin = margin7d/sold7d vs mean → star / ploughhorse / puzzle / dog.
- **Waste:** prep waste = covers × ingredient cost × share; plate waste from low satisfaction; spoilage when stock.oldestDay + shelfLife < day.
- **Finance:** rent/30 per day; wages = Σ staff on rota × wage × 10h; loan: equal daily payments; cash < −(3 months costs) for 14 days ⇒ GAME_OVER (normal). Cosy: clamp at 0 with a warning.

## sim-core public API (index.ts)
```ts
export function newGame(content: ContentPack, cmd: Extract<Command, {type:"NEW_GAME"}>): GameState
export function applyCommand(content: ContentPack, state: GameState, cmd: Command): StepResult
export function tick(content: ContentPack, state: GameState): StepResult
export function runDay(content: ContentPack, state: GameState): StepResult
export function candidates(content: ContentPack, state: GameState): Candidate[]
export function classifyMenu(content: ContentPack, state: GameState): Record<DishId, MenuQuadrant>
export function serialize(state: GameState): string
export function deserialize(json: string): GameState
export * from "./types"
```
Plus `src/headless.ts`: a CLI (`pnpm headless --days 365 --seeds 200 --strategy balanced`) that plays with simple scripted strategies and prints survival rate, median cash curve, covers/day, and writes `out/balance.csv`.

## game (UI) layout
- `src/App.tsx` — phase router. Keeps `GameState` in a reducer; all changes via `applyCommand`/`tick`.
- `src/screens/NewGame.tsx` — district picker (cards with rent, footfall, segment mix), name input.
- `src/screens/Planning.tsx` — tabs: Menu (matrix view + price editor), Staff (roster, rota grid, candidates), Stock (order sheet with shelf life), Restaurant (buy tables). "Open for service" button.
- `src/screens/Service.tsx` — left: canvas restaurant (tables, queue outside, kitchen pass, little people moving between stages; colour by patience). Right: live ticker (log), today's running totals, speed controls, Comp / 86 actions. Uses `requestAnimationFrame` to call `tick` N times per second by speed.
- `src/screens/Evening.tsx` — P&L card, dish best/worst, reviews list, staff mood changes, reputation bars, "Next day" button.
- `src/screens/EventModal.tsx` — title, body, 2–3 choice buttons.
- `src/canvas/RestaurantView.ts` — pure canvas drawing given state; no React state inside.
- Style: warm, readable, cosy. Big type. No gradients soup. CSS variables for theme; dark mode optional.
- Autosave to localStorage on every phase change via `serialize`; "Continue" on the title screen.

## content
- `data/*.json` one file per collection; `src/index.ts` loads, validates (hand-written guards, no zod to keep deps minimal), and exports `content: ContentPack`.
- Ingredient costs, wages, rents in **UK pence** anchored to the brief's figures (NLW £12.71/h, rent £2–5k/month outside London).
- Targets for headless: ~70–80% of "balanced" scripted owners survive year 1 at normal; cosy 100%; hard ~50%.

## Quality bar
- `pnpm -r typecheck` and `pnpm -r test` pass. sim-core ≥ 80% line coverage on systems.
- Determinism test, serialize round-trip test, a 365-day smoke test under 2s.
- UI runs with `pnpm dev`; `pnpm --filter @full-plate/game build` produces a static `dist/` deployable to Vercel.
