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
  src/bot.ts       hint-following bot (tests, demo autopilot, attract mode); `pace` < 1 = a slow child
  src/station.ts   round 4: the career commis station (commisStation, stationTickets, STATION_LEVELS)
  src/pacing.ts    round 4: tempo (real seconds per sim tick) and rail size for a station
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
  station?: StationPlan;       // round 4, career chef: the player's own section (commisStation)
}): HandsOnSession

updateSession(session, state, input: HandsOnInput, dt: number): { session; results: HandsOnResult[] }
render(ctx, session, state, { width, height, dpr?, forceHint?, continueLabel? }): void
nextHint(session, state) · summarise(session) · botInput(session, state, skill, pace?) · createInputSource(window)
commisStation(state, content, level) · stationTickets(session, state) · shiftTempo(session, state) · shiftNotes(session)
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
  | { type: "TICKET_CLAIMED"; ticketId }                                       // round 3 review → PLAYER_CLAIMED
  | { type: "RAIL_RESIZED"; cap }                                              // round 4: re-send SET_HANDS_ON station
// round 5: the session no longer covers (no `covered` PLATE_COOKED); the sim's sous chef does, in sim ticks
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

## Round 4: the commis station and pacing (career chef)

Round 3's playtest: the apprentice raced the head chef for the oldest ticket and a slow child got 1–5 plates a shift.
Now an employee chef **owns a station**, the restaurant **paces itself** around them, and nobody can stall service.

### The station (`station.ts`)
- `commisStation(state, content, level)` picks the player's section from today's menu. Starters, sides and desserts
  first (whole courses), then mains, easiest first (skill required, then prep time), until the section carries
  `minShare` of the kitchen's expected plates (7-day `sold7d`; course weights before any sales). Drinks are never on a
  station. The balanced career employer serves 3 mains, a coffee and 2 desserts, so a commis gets **"Desserts ·
  Burgers"** (≈ 30 tickets a service).
- `level` is the chef-track rung (the reducer's `careerStation`). Other tracks and owner jump-ins have no station.

| level | title | rail (`cap`) | idle cover | hard cover | section | target plates/min | base s/tick |
|---|---|---|---|---|---|---|---|
| 0 commis | Commis station | 2 | 30 s | 80 s | ≥ 30% of plates, ≤ 1 main | 2.2 | 1.6 |
| 1 chef de partie | Your section | 2 | 26 s | 70 s | ≥ 45%, ≤ 2 mains | 2.6 | 1.5 |
| 2 sous chef | The pass | 3 | 22 s | 60 s | every food ticket | 3.0 | 1.4 |
| 3 head chef | The pass | 3 | 20 s | 55 s | every food ticket | 3.4 | 1.3 |

- **The rail** is the oldest `cap` tickets of the station's dishes, counting the ones the player has picked up
  (`stationTickets`). The canvas rail shows only these, behind a tomato station tag ("COMMIS STATION · Desserts ·
  Burgers"); an empty rail reads "Your station is clear — next ticket coming…". Hints say "Your ticket: …".
- **sim-core contract** (additive): `SET_HANDS_ON { role: "chef", staffId, station: { dishIds, cap } }`. Re-sending the
  same role/person keeps `since`. `kitchen.ts → stationRail` reserves exactly that rail (no 4-tick fallback; only
  `HANDS_ON.stationFallbackTicks` = 40 as a safety net if the view dies) and reserves nothing else, so station tickets
  beyond the rail and every other dish are cooked by the AI as normal. The reservation is computed after stale claims
  are released, so a ticket the child still holds after `claimTimeoutTicks` stays theirs.
- **The sous chef covers.** If the player does nothing (no verb started or finished) for `idleCoverSecs` while work is
  on their rail or in their hands, they get a nudge at 60% ("Sam: Need a hand? Your ticket's on the rail…"), then the
  sous chef plates the oldest (or the one in hand): `PLATE_COOKED { covered: true }`, execution 0.6 × the dish ceiling,
  speed bonus 0, no points, and a friendly line. The clock starts when the work arrives, so waiting for a ticket is not
  idling. A rail ticket left `hardCoverSecs` is covered however busy the player is. A ticket that vanishes while
  carried (the table left) costs nothing.
- **Round 4 review: a table about to give up is covered at once** (`COVER_PATIENCE` = 40). The restaurant runs on sim
  ticks, a party only eats once every plate is in, and a station ticket waited 7–8 ticks on a child's rail against ~2
  for an AI cook. Tables turned slower, the queue walked out and the employer lost money on every hands-on day (10
  seeds, first shift: skip 77 covers / 1.4 walked-out covers / +£131; half-speed child 58 / 12.6 / −£95; even a
  perfect bot 58 / 10.9 / −£79). The sous chef now plates any rail ticket (or the one in hand) whose party's
  patience is down to 40 ("Table 4 can't wait any longer — I've sent their chips!"). After: child 62 / 7.2 / −£24,
  plates 7.8 → 6.5 a shift. **Fixed in round 5** (below): covers were ~15% below a skipped shift.

### Pacing (`pacing.ts`)
- `shiftTempo(session, state).secondsPerTick` is how long the game waits between sim ticks (HandsOnShift and the
  headless harness share `secondsPerTick`). Empty rail → **0.5 s** (fast-forward to the next station ticket). Rail
  with room → base × 0.8. Full rail → the level's base, slowed by `target / rolling plates-per-minute` up to × 1.5 for
  a slow player (2-minute window, after 45 s of warm-up). A 120-tick service is 2–5 minutes of real time.
- `railCapFor`: a player at ≥ 1.3 × their target rate gets one more ticket on the rail (≤ 4). The session emits
  `RAIL_RESIZED`; the reducer re-sends `SET_HANDS_ON` with the new cap.
- Server, bar and owner jump-ins keep the flat 1.5 s a tick.

### Score card
- `summarise` adds `notes`: three one-liners from `shiftNotes` — up to two good things, then the one to work on ("Fast
  on the pass!", "Beautiful plates — 89% quality!", "Two plates went cold"). Plates that waited > `COLD_PLATE_SECS`
  (60 s) "went cold". The canvas score screen and the career evening card show them.
- A commis station's star bars are gentler (150 / 380 / 750; chef de partie 200 / 500 / 950; the pass keeps
  250 / 650 / 1150).

### Verified with the bot (`?autopilot=skill[,pace]`, headless through the real reducer)
`packages/game/src/__tests__/handsOnHarness.ts` runs the HandsOnShift loop (60 Hz session, a sim tick every
`secondsPerTick`) with `botInput` through `appReducer` — what `?autopilot=` does in the browser. A career week on
seeds 5 and 7, every worked shift:

| bot | before (HEAD of round 3) | after round 4 |
|---|---|---|
| skill 0.55, full speed | 10–13 plates / 180 s | **13–17 plates** in 134–167 s, ★★★ (mostly) |
| skill 1 | 11–15 | 14–17, ★★★ |
| skill 0.55, **half speed** (`pace` 0.5) | 4–7 | **7–8 plates** in 157–176 s (one every ~22 s), ★★ |
| skill 0.4, pace 0.35 | — | 6–7 plates in 172–196 s |
| idle (no input) | 0 plates, the AI cooked everything | 0 plates; the sous chef covers the rail; service completes |

The rail is empty for 1–18 s a shift. `careerHandsOn.test.ts` pins ≥ 10 plates (full speed) and ≥ 5 (half speed) on
every shift of a week, < 30 s dry, and a shift of 2–5 minutes.

## Round 5: the station in sim time (REVIEW R4 P1)

Playing must never be worse for the restaurant than a day off. The restaurant now protects itself in **sim ticks**
(sim-core `systems/station.ts`, SIM-NOTES "Round 5"); the session only talks and paces.

### What the sim does now
- **Desserts, sides and starters are their own course.** A party whose other plates are in eats its mains; the
  child's plate lands during the meal. The sim's sous chef sends one still on the rail just before the party finishes.
- **Cover by ticket age in ticks.** A main on the rail is plated by the sim `coverTicks` after it fired (commis 8,
  chef de partie 7, sous 6, head 5 — `StationLevel.coverTicks`, sent as SET_HANDS_ON `station.coverTicks`), or at
  once when its table is down to 40 patience. Covered plates are the AI cook's, 12 quality down, booked to them.
- **One main at a time on the rail** (`StationPlan.coursed` lists the station's own-course dishes; `stationTickets`
  and sim-core `stationRailTickets` apply the same rule). The second burger goes straight to the AI.
- **Station dilation.** A table the child kept waiting beyond an AI's time eats that much faster and doesn't rate the
  wait; while it waits only on the child it loses patience at half speed.
- **The commis's AI hands keep cooking** everything else, as on a day off (cook id `<staffId>~ai`).

### What the session does now
- **No session covers.** `idleCoverSecs` / `hardCoverSecs` are wall-clock **nudges only**: "Need a hand?" at 60%,
  "Your ticket's still on the rail…" at `idleCoverSecs`. `COVER_PATIENCE` and `COVER_EXECUTION` are gone, and so is
  `PLATE_COOKED.covered`.
- **Covers are noticed, not made.** A ticket on the rail (or in hand) that vanishes uncooked while its party is still
  in was sent by the sim: the session lets go of it, counts `score.covered` (`idleCovers` if the player had been idle
  ≥ 60% of `idleCoverSecs`) and says "Sam: I've sent table 3's Brownie — grab your next ticket!". A vanished ticket
  whose table walked out is nobody's fault and not counted. `HandsOnSession.railSeen` holds last frame's rail.
- **The score card.** "Sent out by the sous chef: N" (teamwork). The "work on" note mentions covers only when the player
  was away ("The sous chef covered two tickets while you were away").
- **Never binned for someone else's plate.** The fridge never offers an AI-assigned ticket; a held ticket the sim
  refused (PLAYER_CLAIMED of an AI's ticket now fails with a LOG line) or later gave to the AI is let go at no cost;
  a plate whose ticket already went out costs nothing.

### Pace to the pass (`pacing.ts`)
The sim's rules make covers and walkouts independent of the child's speed; pacing decides how many plates are hers.
- While the player holds a station ticket (or a verb is going), a tick takes `PACING.workSpt[level]` (commis 3 s,
  then 2.7 / 2.4 / 2.2) instead of the rail tempo.
- When the next tick would have the sim cover the ticket in hand (`coverDueTick`), that tick waits
  `lastTickStretch` (× 3) — as long as the player is working (a verb going, or one within `workingSecs` 8 s). A child
  who wandered off is covered as usual. Before this, 5–6 of a half-speed child's tickets a shift vanished mid-cook.

### Verified (`packages/game/src/__tests__/careerParity.test.ts`, `handsOnHarness.parityRun`)
The first career shift of seeds 1–10 played twice from the same morning — skipped and by the bot — through the real
reducer at the browser's tempo, fixed 60 Hz steps (deterministic: the same seed twice is byte-identical).

| covers / walked-out covers | day off | half speed (0.55, 0.5) | full speed (0.55) | skill 1 | idle |
|---|---|---|---|---|---|
| round 4 | 77.3 / 1.4 | 62.4 / 7.2 (6.5 own plates) | 61.2 / 9.9 (13.8) | 62.3 / 10.5 (14.0) | 64.3 / 8.1 |
| round 5 | 77.3 / 1.4 | **80.9 / 1.3** (9.2 own plates, 208 s) | 78.8 / 0.0 (17.3, 189 s) | 75.5 / 0.0 (16.8) | 79.5 / 0.4 |

Profit on the played day: half speed −£24 → +£173 (day off +£131). The test pins ≥ 95% of the day off's covers and
≤ 2 extra walked-out covers for half speed, full speed and idle, and ≥ 7 own plates at half speed; `PARITY_SEEDS=30`
widens it (30 seeds: half speed 101.5%, full speed 104.6%, idle 102.8%). Single seeds swing ±10 covers either way
(the arrival stream is chaotic), so read means. A career week (`careerHandsOn.test.ts`): full-speed bot 14–22
plates a shift, half speed 7–11, shifts 154–252 s, the rail dry < 25 s.

### Still open
- ~~"Sent out by the sous chef" is 15–25 a shift~~ **Round 5 review:** the browser playtest read "Plates cooked 7 ·
  Sent out by the sous chef 10" for a child who never stopped working. The line is now "Sous chef helped: 7 while you
  were busy, 3 while you were away" (`idleCovers` split out); only the "away" part is a note to work on.
- The cover rules are mirrored in two places (sim-core `humanTickets`/`ticketsToCover`, handson
  `stationTickets`/`coverDueTick`); a plan saved before round 5 has no `coursed`, so the view would show one ticket
  fewer than the sim reserves until the next shift (an envelope reload ends the station anyway).


## Round 6: the help on the canvas (REVIEW R5.6 next step 1)

Round 5's covers were honest but invisible: the child read "Sous chef helped: 7" on the evening card. Now she sees the
kitchen help her while she plays. **Render only**: no sim rule, timing, result or pacing changed; the session gained one
cosmetic field (`sousWalks`). The career parity and hands-on harness tests are unchanged and pass.

### What's on the canvas (career chef with a station)
- **The sous chef** (charcoal jacket, name tag — the same first name the "I've sent…" line uses) stands by the sink.
  When the sim covers a ticket off her rail he **walks to the spot under that slip**, the slip **drops off the header
  rail into his hand**, he carries the plate to the pass, puts it down and walks back — with a speech bubble: "I've got
  table 3's Chips!" (two covers in one tick: "I've got the Chips for tables 1 and 5!"). The banner line and the toast
  stay. One trip is ~4.9 s (`SOUS_WALK`); a cover noticed before he has taken the slip joins the trip, so what he says
  always matches the banner, and at most one trip waits behind the one he is walking.
- **"Course coming"**: a table eating its mains while its own course (her dessert/side/starter) is still cooking shows
  a silver **cloche** by its top-left edge with a ring that fills through the mains (from `servedTick` to the cover tick
  `eatUntil − courseLeadTicks`, the tick the sous chef would send it). Tomato ring = on her rail or in her hands (it
  pulses while she carries it); sky = the kitchen has it. It clears the frame the course lands (`courseOut` cleared).
- **Her AI hands** (`<staffId>~ai`) cooking one of *her* station's dishes (the second main, a full rail) stand at that
  dish's hob/oven/fryer (prep board for cold dishes) in light whites with a small blue **"helping"** badge, and the
  station animates as busy. Steps aside a tile if she is standing there.
- **The rail says whose each slip is**: a band down the left of each slip — **tomato = hers** (matching the station
  tag), **amber + the sous chef's name = he sends it within a tick** (its cover tick has come, or its table is at its last
  patience), **sky + "HELPER"** (or the cook's first name) = one of her station's dishes another cook is cooking (≤ 2 such
  slips, after hers). Hers that are a course already "coming" carry a small cloche. One slip per party and owner.
- My shift's "You're on today" line explains it in one sentence ("Red-edged slips on the rail are yours, blue ones a
  helper's. A silver dome on a table means they're waiting for your course.").

### Read-only helpers (`crew.ts`, `sous.ts`; exported, tested in `test/crew.test.ts`)
```ts
railView(session, state, maxHelper = 2): { ticket; owner: "hers" | "sous" | "helper"; course; cook? }[]
coverSoon(session, state, ticket)        // the sim's sous chef sends this rail ticket within a tick (station.ts coverDueTick + patience)
courseMarkers(session, state): { customerId; tableId; ticketIds; dishIds; owner: "hers" | "helper"; progress; dueTick }[]
helperAtWork(session, state): { ticket; cook; stationId: "stove" | "oven" | "fryer" | "prep" } | undefined
bookSousWalk(walks, item, slot, now) · sousPose(walks, time, railX) · sousLine(items, short)   // pure; render draws sousPose
```
All derive from the same rules as `stationTickets`/`coverDueTick` (which mirror sim-core `humanTickets`/`ticketsToCover`),
so the rail colours can't disagree with what the sim does. `sousName` is now exported from the session.
**Round 6 review:** `HELPER_SUFFIX` is now sim-core's exported `SHADOW_COOK_SUFFIX` (not a copy of `"~ai"`), and
`game/src/__tests__/round6.railAgree.test.ts` plays three whole bot shifts and checks every sim tick: hers + amber slips =
sim-core's `stationRailTickets`, every ticket `ticketsToCover` takes on the next tick was already amber, markers only on
parties eating with `courseOut`, the helper badge only on a `~ai` cook (0 disagreements in 360 ticks).

### Numbers (headless, the half-speed bot on the balanced employer "Desserts · Burgers", seeds 1–3, every frame)
The sous chef is on a trip in 32–35% of frames, a slip is amber (going within a tick) in 27–42%, a course marker shows in
56–75% and the `~ai` helper is at her station in 6–9%. Bundle: HandsOnShift chunk 75.1 → 84.1 kB (budget ~170).
Type audit: 25 screens, 0 text runs below 13 px.

### Still open
- The walk is a replay: the sim plates the cover in the tick it happens, so the slip has already left the header when he
  reaches for it (the flying slip stands in for it). Starting the walk a tick early (when `coverSoon` turns amber) would
  need the game's tick clock in render; not worth it yet.
- The sous chef walks through the player (no collision for NPCs); at the pass they can overlap for a moment.
- The "Covered by the sous chef" toast still rises from the pass and can overlap his bubble when he is there. (Round 6 review: not seen in 301 frames of three
  played shifts; his bubble shows only during the take, under the slip, while the toast rises at the pass.)
- Round 6 review: when he stands at the pass his name tag sits on the floor's "PASS" label ("Alfie" over "PASS"). P3.

## Round 7: touch, the lead-in, and reading the room (UX round, agent A)

Render-only and cosmetic session fields again: no sim rule, timing, result or pacing changed; the parity, rail-agree and
determinism tests are unchanged and pass.

### The sous chef sets off when the slip falls due (REVIEW R6 next step 2)
- `SessionOptions.sousLead` (the game turns it on for a career station). The session stamps each rail slip's
  `railSeen[].dueSince` with the session time it first fell due — `coverDueTick ≤ tick + 1`, the cover-age rule the sim
  uses, so it is sent at the next tick. No wall clock or tick timer is needed: the sim tick already in the state says it.
- Render (`sousPending`) walks him from his post to that slip from `dueSince` (or from when he is free) and he **waits
  under it**, facing the rail. The cover's trip is booked with `leadFrom` = the same start, so it carries on from the
  rail: `walkTimes` = { start, takeAt = max(cover, start + toRail), end }. A cover before he arrives: he finishes the
  walk, then takes it. She plates it first: `standDown` walks him back from the rail. Covers in one tick share the
  earliest stamp. Patience-based covers have no stamp and walk the round-6 way. Finished trips are kept while a due
  slip waits (its lead-in starts when he was free).
- The bubble ("I've got table 3's Chips!") starts at the cover, not on the lead-in (nothing to say yet).
- Verified in `game/src/__tests__/round7.careerUx.test.tsx` over three half-speed bot shifts through the reducer:
  **0 frames where he jumps more than 0.6 tiles** (with and without the lead), 8–10 of 13–17 trips set off early.

### Other canvas changes
- `avoidPlayer`: the sous chef, the helper and the floor colleagues are drawn at least 0.8 tiles from her.
- "PASS" sits at the counter's left end (his tag sat on it); a toast born on a head rises 3 tiles to the side.
- `yourStations(session)`: the appliances her station's dishes cook on get a dashed tomato outline and a **Yours** tab.
- Tables: `moodOf(patience)` face (happy > 60, flat > 30, cross), 5 px ring over a faint track. Slips: a wait bar
  (`slipTimeLeft(ageTicks)`, the head colours' 14/30-tick bands).
- `HandsOnView.keyLabel` ("USE" on touch) replaces E in prompts, widget titles and hint lines (`withKey`).

### Touch (`touch.ts`)
`stationRect`, `railSlotRect`, `railTagRect` (CSS px from `viewMetrics`), `padToMin` (44 px), `hitTest(session, view,
x, y)` → a station (padded targets, nearest centre wins) or the rail, `railTarget` (the fridge for a chef). The game's
`lib/touchControl.ts` turns taps into `HandsOnInput` through `InputSource.setTouch` (tap to walk via `steerToward`,
press to use). `input.ts` ignores keys aimed at buttons and fields (`onControl`).

`ShiftSummary.nextStarAt`: the points the next star needs (absent at three), for the score card.

## Round 8 — C (floor & kitchen art)

The owner's request: "better maps, more professional interface". Both canvas maps — the hands-on kitchen (`render.ts`)
and the owner's floor during service (`game/src/canvas/RestaurantView.ts`) — get one art direction, a shared character
sprite, cached static layers and a palette module each. **Render only**: no session/state field, sim rule, timing,
result or pacing changed; station geometry (`viewMetrics`, `stationRect`, `hitTest`) is untouched, so touch, the R7
onboarding spotlights and the sous chef's walk land where they did.

### The tile style: clean top-down with a 3/4 tilt (one rule, everywhere)
- Every solid thing shows its **top and a darker south face** (`FACE` = 0.3 of a tile on counters), **light from the
  top-left**, so every drop shadow (`C.shadow`) falls down-right by the same few px. Walls are a lit cap over a darker
  face; floors carry ambient occlusion where they meet a wall.
- One **outline weight** for characters and small props (`C.outline`, a warm near-black, `r × 0.13`); furniture is
  edged with a darker tone of its own material instead of black.
- **Kitchen**: half-tile non-slip tiles with grout and a drain; a tiled splash-back wall band on row 0; a tall
  double-door fridge whose top stands over the splash-back; steel counters with front faces; the prep board has end
  grain, a knife, a tomato and a carrot; the hob has grates and knobs (a lit burner glows, a pan sits on it, steam
  rises); the oven has a door window that glows orange when it's cooking; the fryer has two oil wells with baskets
  (bubbles when frying); the sink has water and a gooseneck tap; the pass is a steel shelf under a heat-lamp gantry;
  swing doors stand open in the partition. **Dining**: staggered oak planks with grain, warm light pools under each
  table, round tables with rim and highlight, chairs with backrests turned to the table, place settings on clean
  tables, a door mat; **bar side**: narrow dark boards, an oak bar with taps and a brass foot rail, a back-bar of
  bottles, a till with a screen; **office**: carpet, desk with monitor and papers, chair, filing cabinet, notice board;
  **front wall**: windows with mullions, an open doorway, the awning (in `--awning`'s two colours) outside.
- **Characters** (`sprites.ts → drawPerson`, shared with RestaurantView via `@full-plate/handson/sprites`): shadow,
  stepping feet, swinging hands, body with apron/shirt/neckerchief shading, head with hair that shows the facing
  (fringe facing down, back of the head facing up, profile left/right), eyes, cheeks, headwear (toque, cap, beanie,
  beret, sun hat, bows). Looks: the player (whites, tomato neckerchief), colleagues (basil neckerchief), the sous chef
  (charcoal jacket, amber), the commis's helper (pale blue), servers (dark waistcoat, white shirt, bow tie, basil cap),
  bar (plum), guests by segment (`guestLook`, same as the owner's floor). Facing comes from movement (`facingFrom`;
  standing still keeps the last facing). The walk bob is `|sin|` of the phase × 0.16 r.
- **Held items are in her hands**, not in a bubble: a wicker basket of veg (raw), a steel bowl of chopped veg
  (prepped), a pan (cooked, burnt shows), a steel tray of plates or glasses, a tub of dirty plates. Facing up, the item
  is drawn before her so her head is in front. The dish name floats over her head as before.
- **Plates read at 32 px tiles**: radius 0.26 of a tile on the pass with a dark rim line, a drop shadow and a main
  colour from the dish (`foodColour`: brown for brownies/burgers, gold for chips, red for tomato dishes, green for
  salads), plus garnish.
- Seated guests on the far side of a table are drawn before the table top, the near side after it, so they sit
  round it. Badges moved off the seats: the table number sits on the rim top-centre, the mood face bottom-centre, the
  course cloche in the middle of the table.

### Palette modules
- `handson/src/palette.ts`: `DEFAULT_PALETTE` (tokens + art colours), `TOKEN_VARS` (palette key → theme.css
  variable), `readPalette(canvas | getter)`, `readTokens`/`awningColours` (generic), live `C` swapped by
  `applyPalette` (bumps `paletteVersion`, part of the layer key). Token reads: `--ink --ink-soft --ink-faint --paper
  --cream --cream-deep --tomato --tomato-deep --basil --basil-deep --amber --amber-deep --plum --sky --sky-deep --star
  --star-edge --cheer`, and the two stripe colours parsed out of `--awning`. A variable that is missing, empty or not a
  colour keeps its default (`toHex` accepts `#rgb`, `#rrggbb[aa]`, `rgb()/rgba()`).
- `game/src/canvas/floorPalette.ts`: the same for the owner's floor (`FLOOR_DEFAULTS`, `FLOOR_TOKENS`,
  `readFloorPalette`) plus its own art colours (paving, kerb, road, night tint).
- Read **once per resize**: HandsOnShift's `resize` passes `view.palette`; `RestaurantView.resize` reads it itself.

### Static-layer cache (`layers.ts`)
- `LayerCache.draw(target, name, key, w, h, dpr, paint)`: paints a layer into an `OffscreenCanvas` (or a detached
  `<canvas>`) at `w·dpr × h·dpr` when its key changes, then `drawImage`s it each frame. Key = `layerKey(w, h, dpr,
  paletteVersion, layout)`; the layout part is a number folded from stations, props and table seats (`artKey`), so
  no per-frame strings. Where no surface can be made (node, stubbed contexts) it paints straight onto the frame — the
  same picture, uncached — so every existing text-recording test still sees the labels.
- **One opaque "scene" layer per canvas** (floor art then furniture art), blitted as an `ImageBitmap`
  (`transferToImageBitmap`) with **no clearRect**. A first cut had separate floor and furniture layers so the glows
  could sit between them; in Chrome's software raster a full-canvas blit costs ~6 ms at 2560×1600 under a 4× CPU
  throttle (more than the old 1,800 tile rects), so they were merged: station glows and mood halos are now
  translucent *bands* drawn over the scene, and the evening light pools are drawn live (`lighter`, dusk strength).
  Hands-on scene: floors, walls, rugs, light pools, counters, appliances at rest, pass gantry, bar, till, office,
  tables, chairs, fixed labels. Owner's scene: tiles, splash-back, planks, light pools, pavement, road, walls,
  windows, back counter and hobs, fridge, sink, pass, bar, tables, chairs, plants, planters, awning, name board, OPEN.
- **People are cached too** (`SpriteCache` in sprites.ts): each (look, facing, walk frame of 8, seated, carrying,
  size, dpr) is drawn once into a small offscreen canvas and blitted, snapped to device pixels; `handsYOf` gives the
  hand position without drawing. ≤ 400 entries, then it starts over.
- `layersFor(ctx)` (a WeakMap per context) is the default; `HandsOnView.layers` overrides it (tests).
- `devicePixelRatio` is capped at 2 on both canvases (`lib/perfMeter.ts canvasDpr`).
- `handson/package.json` now says `"sideEffects": false` (the module-level WeakMap made Rollup keep render.ts in the
  main chunk via gameReducer's `commisStation` import) and exports `./sprites`, `./palette`, `./layers` subpaths
  for RestaurantView (no handson index in the main chunk).

### Reduced motion
`HandsOnView.reducedMotion` / `RenderOptions.reducedMotion` (from one `matchMedia` list, `prefersReducedMotion()`):
no walk bob or stepping, no idle sway, no slip sway, steady glows (no pulse), no flame flicker or steam, no
paying-coin bob, no wobble shake (the red tray ring stays), the low-time clock is steady red, the selection brackets
don't turn. Pinned by `r8.render.test.ts` (two frames 0.25 s apart of a walking player draw identical shapes).

### `?perf=1`
`lib/perfMeter.ts`: frame JS time (sim + render) and frame interval, rolling over 120 frames in fixed typed arrays,
drawn bottom-left on the hands-on canvas and top-left on the floor; also on `window.__fpPerf.{handson,floor}`.
Off by default.

### The owner's floor (RestaurantView) — what changed
- Geometry, `pick()`, `Highlight`, the incident rings, the accessible label (Service.tsx) and the R5 draw order
  (numbers after people and staff, before highlights — `canvasOrder.test.ts`) are kept.
- Guests and staff are the shared sprite (staff 1.15× a guest, name tags; chefs wear theirs beside them, clear of the
  ticket rail). Guests face where they walk, face the door in the queue and face their table when seated; far-side
  guests sit behind the table top (occupied tops are redrawn live). Waiters carry a plate when they come via the pass
  and a bill to a paying table.
- **Readable paths** (`aislePath`): staff and guests walk along the nearest aisle (the walkway under the pass,
  between table rows, along the front wall), then straight to the spot — L-shaped routes instead of beelines through
  tables. Guests walk 1.8× the old speed, so a party isn't still walking in when its food lands.
- **Selection**: a gold ring with four dark-edged gold corner brackets that turn slowly (still under reduced motion)
  over a stronger mood band. Hover: a dashed paper ring.
- **Day/evening**: the sim's clock is `game.tick` (5 min a tick from 12:00); from 18:00 (`tick` 72) to 21:00 the street
  darkens (`night` at 0.34), the room slightly (0.16), and lamp pools come up over the street lamps, the tables, the
  door, the windows and the bar.
- A **bar** (oak counter, taps, foot rail, four stools, a back shelf of bottles) appears on the right when the tables
  leave ≥ 44 px (`Layout.bar`); otherwise a plant stands there.
- Tickets hang from a steel rail with drop shadows; plates under the heat lamps have food on them; lit burners glow
  with a pan on the left ring.

### Performance (Playwright, headless Chromium — software raster, no GPU)
Every `requestAnimationFrame` callback timed (sim + render JS, summed per frame) and the frame interval, over 5 s
with the autopilot playing (hands-on: `?autopilot=0.55,0.5`, career commis; floor: an owner's day 1 at 1× and 4×).
Before = master `7a4fe8f`'s dist, after = this branch. **4× CPU throttle** (a mid laptop
is ~2–4× slower than this container), dpr 1 unless noted. ms JS per frame / ms between frames:

| | before | after |
|---|---|---|
| hands-on 1280 (early / mid shift) | 2.51 / 16.7 · 5.13 / 17.2 | 2.11 / 16.8 · 2.15 / 16.7 |
| hands-on 1024 (early / mid) | 2.21 / 16.7 · 2.43 / 16.8 | 2.91 / 16.8 · 2.35 / 16.7 |
| hands-on 1280 dpr 2 (early / mid) | 1.55 / 19.2 · 1.18 / 22.0 | 4.21 / 32.4 · 1.25 / 20.5 |
| floor 1280 (1× / 4×) | 1.38 / 17.1 · 1.57 / 17.5 | 1.70 / 17.0 · 2.42 / 17.8 |
| floor 1024 (1× / 4×) | 1.01 / 16.7 · 1.44 / 17.2 | 1.91 / 16.7 · 2.44 / 17.9 |
| floor 1280 dpr 2 (1× / 4×) | 1.08 / 20.2 · 1.61 / 28.4 | 1.22 / 17.8 · 2.94 / 27.7 |

Unthrottled (the final playtests): hands-on 1.0–1.6 ms JS a frame at 1280 and 1024, floor 0.5–1.5 ms; every run a
steady 16.7 ms interval. Reading it: at dpr 1 both canvases hold 60 fps at both widths even throttled 4×; JS per
frame is within noise for the kitchen and ~0.5–1 ms up on the floor at 4× sim speed (more art per guest). At dpr 2 the
software rasteriser is the bottleneck before and after (the "early" dpr-2 sample includes building the scene and
sprite caches); on a GPU-rastered laptop the blits are texture copies. The intermediate two-layer build was
measurably worse at dpr 2 (46–53 ms intervals) — that's what drove the one-layer + sprite-cache design.
`?perf=1` shows the live numbers in the corner.

### Bundle
HandsOnShift chunk 96.1 → **109.9 kB** (budget 170; gzip 34.4 → 39.3). Main chunk 195.2 → 219.1 kB (RestaurantView's
art + the shared sprite, palette and layer modules).

### Tests
`handson/test/r8.render.test.ts` (10): palette fallbacks (no CSS, partial, unparseable, throwing reader, `--awning`
stripes), LayerCache builds once per key and rebuilds on resize / dpr / palette, render blits one cached scene a frame
and rebuilds on resize, the no-offscreen fallback still draws the labels, `facingFrom`, walk bob only while moving,
reduced motion draws a walking player identically 0.25 s apart, SpriteCache builds once per pose (8 walk frames) and
reports the same hands as `drawPerson`. `game/src/__tests__/round8.restaurantView.test.ts` (5): renders in jsdom with
a stubbed context, labels every table, one cached blit a frame, rebuilds on resize, dpr capped at 2, evening light
without an extra layer, aisle paths, floor palette fallbacks. All 894 tests pass.

### Playtests (`vite preview` of the built dist, scratchpad `shots/r8/c/`)
`final/kid-1280-fullshift`, `final/kid-1024-fullshift` (career commis, `?autopilot=1`, whole shifts: 172 s and 215 s,
0 errors), `final/kid-1280-reducedmotion`, `final/owner-1280`, `final/owner-1024` (floor at 1×, 4×, a selected table,
20:40 evening, then "On the pass"), `touch/` (1024×768 `hasTouch`, viewport shots: tap the fridge → USE → tap the
board → chop → "Cook it in the oven"), `iter5/` (owner "On the floor" jump-in: plates on the pass at 32 px tiles),
`perf-before/`, `perf-after/`. Type audit: 29 screens, 0 text runs below 13 px, 0 page errors.

### What a future artist would replace
- `art.ts` and RestaurantView's `paintFloor`/`paintFurniture` are the tile set: each appliance is one function on a
  tile footprint — swap it for a sprite-sheet blit at the same rectangle (the layer cache doesn't care).
- `sprites.ts → drawPerson` is the character sheet: replace it with frames keyed by (look, facing, walk frame);
  `SpriteCache` already asks for exactly that tuple.
- `foodColour`/`plate` (one colour per dish family) → real dish icons; the carried items (basket, bowl, pan, tray,
  tub) → item sprites.
- The palette's art colours (wood, steel, tiles, glass, paving) are placeholders tuned by eye; the tokens come from B.

### Seams / still open
- Token names read: `--ink --ink-soft --ink-faint --paper --cream --cream-deep --tomato --tomato-deep --basil
  --basil-deep --amber --amber-deep --plum --sky --sky-deep --star --star-edge --cheer --awning`. If B renames any,
  the canvas silently keeps its default (by design) — update `TOKEN_VARS`/`FLOOR_TOKENS`.
- `--amber-deep` (#9a5c0c) now drives the hands-on "enabled" glow stroke and money toasts (was #b97a17).
- Guests walking in still take a few seconds at 1× along the aisles; at 4× the sim can seat and serve a party before
  its sprites arrive (as before, slightly more often).
- The `drawPeople` list allocates a few closures a frame (≤ 6); everything else per frame is as before.
