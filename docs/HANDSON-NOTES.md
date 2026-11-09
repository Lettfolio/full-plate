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

