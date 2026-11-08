# Hands-on shift — integration notes (`@full-plate/handson`)

The playable shift from BRIEF "Hands-on mode: first person, Roblox-style": a top-down 2D canvas scene of the same
restaurant (kitchen strip and pass on top, dining room, bar and till on the right, door at the bottom — the
`RestaurantView` arrangement on a walkable 30 × 15 grid). The player walks one character and performs short discrete
verbs. The package is pure TypeScript with no React and no runtime dependencies beyond sim-core types (and sim-core's
`rng.ts`).

```
packages/handson/
  src/types.ts     HandsOnInput, HandsOnSession, Station, Item, HandsOnResult …
  src/session.ts   createSession / updateSession — the deterministic state machine
  src/verbs.ts     TUNING + pure judging functions (cook band → quality, chop hit, pour, speed bonuses, points)
  src/layout.ts    tilemap + stations from GameState.tables; dish → station (stove/oven/fryer/cold/pour), short names
  src/hints.ts     nextHint(session, state): the tutorial's "next sensible action" + which station to point at
  src/score.ts     summarise() for the score screen, coachingTip()
  src/render.ts    render(ctx, session, state, view) — pure canvas draw
  src/input.ts     keyboard + gamepad (+ optional touch) → HandsOnInput
  src/nav.ts       BFS path / steerToward (tap-to-walk, bots)
  src/bot.ts       hint-following bot (tests, demo autopilot, attract mode)
  src/fixture.ts   a tiny deterministic service loop for the demo/tests; applyResults() is the reference
                   implementation of the proposed sim commands below
  demo/            Vite page: playable chef / server / bar shift, 3-minute timer, score screen
```

Commands: `pnpm --filter @full-plate/handson typecheck | test | build | demo` (demo serves on :5304; `build` writes a
static demo to `packages/handson/dist`). Demo debug params: `?role=server&auto=1&t=40` (role, bot autopilot,
fast-forward seconds).

## API

```ts
createSession(state: GameState, role: "chef" | "server" | "bar", opts?: {
  tutorial?: boolean;          // hints + pointer arrow (default true)
  shiftSeconds?: number;       // shift mode: ends at N seconds, freezes, render shows the score screen
  playerStaffId?: StaffId;     // career mode: the chef only takes tickets that are unassigned or assigned to them
  content?: ContentPack;       // real dish names, food cost (drop cost), qualityCeiling
  seed?: number;               // verb variation; default hashSeed(state.seed, day, tick, role)
}): HandsOnSession

updateSession(session, state, input: HandsOnInput, dt: number): { session; results: HandsOnResult[] }
render(ctx, session, state, { width, height, dpr?, forceHint?, continueLabel? }): void
nextHint(session, state) · summarise(session) · botInput(session, state, skill) · createInputSource(window)
serialize(session) / deserialize(json)
```

`HandsOnSession` is plain JSON (≈10 KB mid-shift). `updateSession` never mutates its arguments.

### Results the session emits

```ts
type HandsOnResult =
  | { type: "PLATE_COOKED"; ticketId; quality /*0-100, sim scale*/; execution /*0-1*/; station; speedBonus /*0-1*/ }
  | { type: "TABLE_SERVED"; customerId; ticketId; speedBonus /*0-1*/ }        // one per plate put down
  | { type: "TABLE_CLEARED"; tableId }
  | { type: "PAYMENT_TAKEN"; customerId }
  | { type: "DROPPED"; cost: Pence; item; ticketIds? }                        // ticketIds = plates to re-fire
```

`quality` = the player's execution × the dish's `qualityCeiling`, so a perfect hands-on plate of a 72-ceiling soup is
72 — the same scale `KitchenTicket.quality` and `ServiceTally.qualitySum` already use. Drinks (bar) come through
`PLATE_COOKED` with `station: "pour"`.

## How the game mounts it

**One loop, fixed step.** The demo (`demo/main.ts`) is the model:

```ts
const input = createInputSource(window);
let session = createSession(state, role, { content, playerStaffId, shiftSeconds });
// every animation frame, in fixed 1/60 s steps:
const { session: next, results } = updateSession(session, state, input.read(), 1 / 60);
session = next;
for (const cmd of toCommands(results)) state = applyCommand(content, state, cmd).state; // see below
// the sim keeps ticking at its own rate: one sim tick every N real seconds (career shift: ~1.5 s)
render(ctx, session, state, { width, height, dpr });
```

- **Service screen for employee rungs (career mode).** The apprentice / commis (chef), bar back (bar) and waiter
  (server) rungs replace the owner's Service screen with the hands-on canvas. `sim-career` passes the player's
  `StaffId` as `playerStaffId`; the AI owner and other staff keep running in sim-core. One in-game service
  (120 ticks) is 3 minutes at 1.5 s per tick, which is the demo's pacing; a career shift can also be a slice of
  service (e.g. the 18:00–20:00 rush = 24 ticks) to keep sessions short for a 12-year-old. At the end of the shift
  call `summarise(session)` and feed it to the career weekly review (points, mean quality, speed, drops).
- **Optional "jump in" during owner service.** A button on the owner's Service screen ("Jump on the pass" /
  "Help on the floor" / "Work the bar") pauses the management overlay, mounts the canvas with no `shiftSeconds`
  (open-ended) and a role the owner is covering or short on. Leaving (a "Back to the office" button; `Escape` is the in-game cancel key) unmounts it; the session can be kept in memory to resume. Same world, two cameras: the dining room layout and table
  numbers match `RestaurantView` (tables numbered in `state.tables` order).
- **Sizing.** `render` scales the 30 × 15 world to the canvas (tile = min(w/30, (h−64)/15)); at 1024 × 600 a tile is
  ~33 px and every label is ≥ 9 px bold, with key text 13–15 px. Pass `dpr` and size the backing store
  (`canvas.width = cssW × dpr`). Canvas below ~800 px wide still works but the ticket rail shows fewer slips.
- **Fonts.** The renderer uses `Nunito` (fallback system-ui) like the game; the game already loads it.

## Proposed sim-core commands (for the lead; not added to `types.ts`)

```ts
| { type: "PLAYER_COOKED"; ticketId: string; quality: number }               // from PLATE_COOKED
| { type: "PLAYER_SERVED"; customerId: CustomerId; ticketId: string; speedBonus: number } // from TABLE_SERVED
| { type: "PLAYER_CLEARED"; tableId: TableId }                               // from TABLE_CLEARED
| { type: "PLAYER_TOOK_PAYMENT"; customerId: CustomerId }                    // from PAYMENT_TAKEN (optional 4th)
// DROPPED needs no new command if the game applies it as a plate-waste cost; see below.
```

`PLAYER_SERVED` carries `ticketId` as well as the brief's `customerId`/`speedBonus` because one party has several
plates and the sim needs to know which one arrived. `fixture.ts → applyResults` implements all of this against a real
`GameState` and is the executable spec; the vitest suite exercises it.

### How the sim should treat them

1. **`PLAYER_COOKED {ticketId, quality}`** — valid during service for a ticket still in `state.tickets`. Sets
   `quality`, `ticksRemaining = 0`, and records the plate in the tally exactly as `kitchenSystem` does when an AI
   cook plates (`plates++`, `qualitySum += quality`, `dishes[dish].plated++`, emit `DISH_PLATED`). Then:
   - if the player is **not** the server (chef jump-in), deliver it as today (`deliverPlate`), i.e. same as AI;
   - if a hands-on **server** session is live, leave it on the pass (see "pass hold").
   While a hands-on chef is on shift, `assignTickets` should leave tickets **unassigned or assigned to the player**
   alone for the player — simplest rule: treat the player's `StaffId` as a cook with capacity 1 whose tickets never
   count down on their own. (With no `playerStaffId`, e.g. owner jump-in, the session only takes tickets with no
   `chefId`, so it shares the rail with AI chefs naturally.)
2. **Pass hold (needed for the server role).** Today `kitchenSystem` delivers a plate to the customer in the same
   tick it's plated, so nothing ever sits on the pass. When a hands-on server/bar session is live, the kitchen should
   instead keep plated tickets in `state.tickets` with `ticksRemaining <= 0` and `quality` set, and **not** call
   `deliverPlate`. The session shows those as plates under the heat lamps (food) or on the bar (drinks). A flag on
   the service tally is enough, e.g. `ServiceTally.handsOn?: { role: StaffRole; staffId?: StaffId }`, set by a
   `PLAYER_JOINED`/`PLAYER_LEFT` pair or by the game before START_SERVICE. Other servers on the rota can still carry
   (deliver after a short delay, as the fixture's AI does), so a slow player never strands food.
3. **`PLAYER_SERVED {customerId, ticketId, speedBonus}`** — the held plate reaches the table: remove the ticket,
   `deliverPlate(c, quality, tick, remakeOf)` (which sets `servedTick` when the last plate lands, so the normal
   `serviceSystem` moves them to eating). Add a small satisfaction lift scaled by `speedBonus` via the existing
   `satisfactionBonus` (suggest `+2 × speedBonus`, capped) — warm food, quickly, is noticed.
4. **`PLAYER_CLEARED {tableId}`** — `dirtyTicks = 0` for an unoccupied table: it can seat the next party this tick.
   This replaces the porter/server's clearing time; it does not touch money.
5. **`PLAYER_TOOK_PAYMENT {customerId}`** — runs the existing `paymentSystem` settlement for that one party now, without
   spending `actionsLeft` (the player's walk to the till *was* the action). Rating, tips, reviews unchanged.
6. **`DROPPED {cost, ticketIds}`** — charge `cost` as plate waste (`ServiceTally.plateWaste += cost`, which already
   flows to `DayResult.waste.plate` and profit; ingredients were consumed when the ticket fired, so no stock change),
   and for each `ticketId` reset the ticket to cook again (`ticksRemaining = prepTicks`, clear `quality`; it keeps its
   `createdTick`, so the customer's wait shows). A raw drop costs 60% of the dish's food cost, a cooked plate 100%, a
   tub of dirty plates 80p a plate (breakage). Never more than a few pounds: soft failure.

All commands should be rejected (LOG "bad", state unchanged) when the ticket/customer/table no longer matches — the
session can be a tick behind the sim. The session prunes its own "claimed/served/cleared/paid" marks when the state
catches up, so a rejected command never leaves the player stuck.

### What the AI keeps doing

The roles the player isn't playing are still run by the sim's staff (or the owner covering). In the fixture:

| Player is | AI cooks food | AI pours drinks | AI carries food | AI carries drinks | AI pays/clears |
|---|---|---|---|---|---|
| chef   | — | yes | yes | yes | yes (fast) |
| server | yes | yes | — | — | slow fallback (a manager after ~14 ticks) |
| bar    | yes | — | yes | — | slow fallback |

That table is the suggestion for the real sim too: whatever the player's role covers, the sim backs off on, but with a
slow fallback so a child who wanders off doesn't wreck the restaurant.

## Verbs and roles

Every verb is 1–3 s and soft-fails. The prompt bubble under the player always says what `E` will do here (or why not).

| Where | Carrying | Verb | Mechanic | Result |
|---|---|---|---|---|
| Fridge | nothing | grab (0.5 s) | auto-picks the oldest open food ticket | carry raw |
| Prep board | raw | chop (2 s) | knife slides across; tap E on 3 marks (±0.07) | prep 0.4–1.0 |
| Hob / oven / fryer (the dish's own) | prepped | cook (2.0–2.8 s) | **hold** E; release with the needle in the green band (random position each time; fryer tighter, oven wider) | cook 0.25–1.0 (band ≥ 0.9, pale gently lower, overdone faster, burnt 0.25) |
| Pass (chef) | cooked or cold-prepped | plate (1 s) | fixed | `PLATE_COOKED` (execution = 0.35 prep + 0.65 cook) |
| Pass (server) / bar (server, bar) | ≤ 3 plates (server) / 2 (bar) | pick up (0.5 s) | prefers more plates for a party already on the tray | carry plates |
| Table with that party | plates | serve (0.8 s) | only the matching table accepts; others say "that's for table N" | `TABLE_SERVED` per plate |
| Dirty table | nothing | clear | tap E three times | `TABLE_CLEARED`, carry dirty |
| Wash-up | dirty | drop off (0.4 s) | fixed | — |
| Till | nothing, or a tray of plates | take payment (1.2 s) | oldest paying party | `PAYMENT_TAKEN` |
| Bar (bar role) | nothing | pour (≤ 1.8 s) | **hold** E; release at the dashed line; holding to the top overflows | `PLATE_COOKED` (station "pour"); overflow = small `DROPPED` |
| anywhere | anything | bin | Q twice within 1.6 s | `DROPPED` |
| walls | 2–3 plates | — | a full-speed bump wobbles the tray; 1 wobble ≈ 0.45 + 0.28/extra plate, decays 0.45/s; ≥ 1 drops | `DROPPED` with `ticketIds` |

Roles: **chef** = fridge, board, hob/oven/fryer, pass. **server** = pass pick-up, tables, clearing, wash-up, till.
**bar** = pour, carry drinks, till, clearing. Kitchen stations refuse non-chefs; tables refuse the chef (with a reason).

Dish → station is a name heuristic in `layout.ts → cookMethod` (fryer: chips, fish & chips, katsu…; oven: pizza, pies,
roasts, crumble…; cold: salads, desserts like tiramisu/Eton mess, cheese board; drinks pour). **Content could own this**
later as an optional `DishDef.station`; the heuristic is the fallback.

**Tutorial.** `nextHint` gives one sentence and a station id; the renderer shows it as a banner at the bottom and a
bouncing arrow over that station, and stations glow when the player is at them (gold if `E` will work, grey if not).
Hints follow the real rhythm: oldest ticket first; food on the pass before anything else (server); payment first (bar).

## Scoring and the shift

Points: plate = 0.6 × quality% + 30 × speed bonus; serve = 30 + 20 × speed bonus; clear 15; payment 20; drop −25.
Chef speed bonus: 1 if plated within 30 s of the ticket landing, 0 by 90 s. Server: 1 within 8 s of the plate being
up, 0 by 40 s. Stars (3-minute shift): chef 250 / 650 / 1150, server and bar 200 / 550 / 1000 — tuned with the bot on the
demo fixture: a perfect bot scores chef ≈ 1,700 (21 plates, 97%), server ≈ 1,800 (31 served), bar ≈ 1,900; a sloppy
chef bot (skill 0.2) ≈ 1,140 at 60% quality. A first-time human lands around 1–2 stars, which is the intent.
The score screen shows the role's stats and one coaching tip chosen by `coachingTip` (drops → slow down; missed chops
→ rhythm; overcooks → let go earlier; slow tickets → work the rail left to right; till waits → check for the gold £).

## Controls

| | Keyboard | Gamepad (standard mapping) | Touch (optional) |
|---|---|---|---|
| Walk | WASD / arrows | left stick / d-pad | `source.setTouch({ moveX, moveY })` from a virtual stick, or tap-to-walk with `steerToward` |
| Use (tap: chop, clear; hold: cook, pour) | E / Space / Enter | A | `setTouch({ interact: true })` on a big button |
| Cancel / bin (twice) | Q / Esc / Backspace | B | — |

Input is abstracted: the session only ever sees `HandsOnInput` and does its own press edge detection.

## Determinism

`updateSession` uses no clock and no `Math.random`. Time is Σdt (clamped to ≤ 0.1 s per call so a tab switch can't
skip a timing window); the only randomness (chop-mark jitter, green-band and pour-line position) comes from sim-core's
xoshiro `Rng`, whose state lives in the session. Tests replay a seeded input script with jittery dt for 40 s per role
and require identical sessions, results, hints and fixture state. `render` reads `session.time` for animation, so a
paused session draws a still frame; it never writes.

**Import note:** sim-core's index doesn't export `Rng`, so `src/rng.ts` re-exports it by relative path
(`../../sim-core/src/rng`). When the lead adds `export { Rng, hashSeed } from "./rng"` to sim-core's index, change that one
file to import from `@full-plate/sim-core`.

## Performance

- `updateSession` ≈ 0.06 ms per call (structuredClone of a ~10 KB session + O(tickets) scans), measured in vitest over a
  full 3-minute server shift. Fine at 60 Hz; if a phone needs it, the clone can be replaced with targeted copies.
- `render` ≈ 2.3 ms per frame at 1024 × 600 (dpr 1) in headless Chrome. No images, no offscreen buffers; the tile
  floor is the biggest cost (≈ 1,800 rects) and could be cached to an offscreen canvas if needed.
- The sim should keep ticking at its own rate (1 tick ≈ 1.5 s for a 3-minute service); results are applied as commands
  between frames, so there is never more than one tick of lag.

## Limits and follow-ups

- Up to 12 tables are shown (`MAX_TABLES`); a bigger floor needs a scrolling camera (the coordinate system already
  supports it — render would translate by the player position).
- Customers are seated at tables in place (no walking in from the door yet); `RestaurantView`'s sprite walker could be
  borrowed for that once the two views share a sprite module.
- Ordering (taking an order at the table) is not a verb yet: tickets arrive from the sim. It would be a natural
  server verb ("tap E for each dish on the order pad") once the sim exposes a seated-but-not-ordered hold.
- Co-op (parent manages, child on the floor) needs only a second session against the same state.
