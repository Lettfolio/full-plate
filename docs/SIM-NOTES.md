# sim-core notes (Milestone 1)

Notes from the simulation engineer for the UI, content and balance agents.

## Layout
```
src/
  index.ts        public API (exactly the ARCHITECTURE.md list + export * from types)
  types.ts        the contract (only optional fields / new exports added; see below)
  constants.ts    every tunable that isn't in content BalanceDef
  rng.ts          xoshiro128** with a 4-word state stored in GameState.rngState
  engine.ts       tick pipeline, open/close service, settle at close, day advance
  commands.ts     one validated handler per Command (rejects with LOG "bad"; never throws)
  newGame.ts      opening state   staff.ts  candidates + hiring   stock.ts  FIFO batches
  menu.ts         Kasavana–Smith classifyMenu   save.ts  serialize/deserialize + MIGRATIONS
  systems/        arrival seating order kitchen service payment clearing (per tick)
                  finance waste reputation staffMood eventDeck stats (evening)
  headless.ts     balance CLI (worker threads)
test/             vitest; fixtureContent.ts is a standalone minimal ContentPack
```

## Day flow
`planning` → START_SERVICE → `service` (tick 0…119) → last tick: settle (eating/paying parties pay, waiting parties walk out), then evening systems → `evening`, or `event` when the deck drew a card, or `gameover`.
- From `evening`: END_DAY → next day's `planning` (deliveries land, footfall mods tick down, 86 list and hired-candidate flags reset).
- From `event`: RESOLVE_EVENT applies the choice, then advances to the next day's `planning`. So the event modal **replaces** the END_DAY button for that evening. The UI should still show the evening P&L behind or before the modal (`state.history.at(-1)` is the DayResult).
- `SERVICE_ENDED.result` equals `state.history.at(-1)`.
- `runDay` = START_SERVICE (if in planning) + all ticks.

## Commands: phase rules
| Command | Allowed in |
|---|---|
| SET/ADD/REMOVE_MENU_ITEM, HIRE, FIRE, SET_ROTA, BUY_TABLE, START_SERVICE | planning |
| ORDER_STOCK | planning, evening, event (delivered **next morning**, so order in the evening for tomorrow) |
| EIGHTY_SIX | planning, service |
| COMP_TABLE | service (seated/ordered/eating/paying parties) |
| END_DAY | evening |
| RESOLVE_EVENT | event |
| NEW_GAME via applyCommand | always rejected; use `newGame()` |

A rejected command returns the same state plus one `LOG` event (`kind: "bad"`) with a player-facing reason. The UI can toast it.

## Things the UI needs to know
- **Menu starts empty.** The player adds dishes in planning (`ADD_MENU_ITEM` at `suggestedPrice` is a sensible default). With an empty menu nobody comes in.
- **Opening stock**: (round 2) the larder starts empty; see Round 2 below.
- **Out of stock** dishes are auto-86'd at START_SERVICE and mid-service. `state.eightySixed` lists them.
- **Candidates**: `candidates()` is stable all day. Hired ones keep their index and get `hired: true`; grey them out.
- **Rota** is indexed by weekday (0 = Monday … 6 = Sunday). Day 0 is a **Wednesday** (`START_WEEKDAY = 2`). Weekend footfall applies Fri/Sat/Sun. Use `(day + 2) % 7` for the weekday, or import `weekdayOf` (not public; ask if you want it exported). New hires default to 5 shifts, Wed–Sun.
- **Owner fallback**: with no chef on shift the owner cooks (2 tickets at a time, skill 40); with no server the owner serves (1.5 actions per tick). A restaurant with no staff limps rather than freezing.
- **Customers** stay in `state.customers` for exactly one tick after `stage === "left"` (so you can animate them leaving), then ClearingSystem removes them. `walkedOut` marks walk-outs.
- **Per-customer extras** for drawing: `stageTick`, `platesReady`/`order.length` (progress), `eatUntil`, `comped`, `rating` (after paying), `patience` (0–100, colour by this).
- **Tickets**: `chefId` is `"owner"` when the owner is cooking.
- **Live totals** during service: `state.todays.covers/revenue/tips/walkouts`, plus `state.service` (ServiceTally) for plates and dish counts.
- **DayResult extras**: `overheads` and `vat` are now P&L lines (optional fields). `profit = revenue − vat − foodCost − waste.prep − waste.spoil − labourCost − rent − overheads − loanPayment`. `waste.plate` is already inside foodCost and is shown for information only.
- **Tips** go to staff (they are not revenue). They drive front-of-house mood.
- **Game over**: `state.gameOverReason` holds the text. `distressDays` counts the 14-day window, so it can drive a warning bar.
- **Cosy**: when cash would go below zero it is clamped to 0, with a `CASH_LOW` event and a log line.
- **Save**: `serialize()` is canonical JSON (sorted keys). Saves are about 40 KB after a month and 260 KB after a year (history keeps the last 400 DayResults with their reviews); fine for localStorage.

## Things the content agent needs to know
- Content is never mutated. sim-core memoises lookups per ContentPack object, so build the pack once.
- `segment.arrivalCurve` must have `SERVICE_TICKS` (120) entries. It is normalised internally, so the scale doesn't matter.
- `segment.partySizeWeights[i]` is the weight for party size i+1. Sizes above `balance.seatsPerTable` are never generated, because every table has `seatsPerTable` seats.
- `dish.course === "main"` matters: each guest orders one main, plus starter/dessert/drink/side with chances 30/30/60/20%. A menu with no mains falls back to one dish per guest.
- `baseAppeal` per segment (0–1) drives both entry (summed over the active menu, capped at 2.5) and dish choice.
- Trait effect keys used: `skill`, `speed`, `charm` (multipliers), `moodDecay` (multiplies negative mood changes), `wageDemand` (multiplies wage), `mistakeRate`.
- Event `when` is evaluated against **tomorrow** (the morning the card shows). Any `cash/popularity/prestige/staffMood` effects apply when the choice is made, and `footfallMultDays` starts with the next service.
- Optional `ContentPack.reviewTemplates: Record<"1".."5", string[]>` with `{dish}`, `{restaurant}` and `{segment}` placeholders. Built-in fallbacks are used if it's absent.
- Ingredient `seasonality` months make that ingredient 15% cheaper and add +3 quality while in season. The calendar starts in **April** (`START_MONTH`).
- Hiring costs a £150 recruitment fee and needs cash ≥ fee + 5 shifts' wages. Wages are paid per rostered day: wage × 10 h × 1.10 on-cost.

## Deviations from ARCHITECTURE.md formulas
1. **Value weight in satisfaction**: the doc says `(1 − priceSensitivity) × value`. That makes bargain-hunters *ignore* value, so value is weighted by `priceSensitivity` instead (`payment.ts`, `satisfactionOf`).
2. **Arrivals** follow the doc's formula for potential parties per day (footfall = parties), split by `segmentMix` and spread over ticks with each segment's arrival curve (Poisson). The entry logit = `ENTRY_BIAS + 1.2·min(2.5, Σappeal) − priceGap·4 + prestige pull − 0.35·queueLength`, where priceGap = clamp((expected spend/head − budget)/budget) × priceSensitivity. The doc doesn't give a bias or weights; these are in constants.ts.
3. **Finance** adds two real UK lines the doc omitted: **VAT** (1/6 of VAT-inclusive takings, settled daily) and **overheads** (£80/day utilities/rates/insurance + 1.5% card fees). Without them the fixture was trivially profitable.
4. **Waste**: prep trim is physically removed from stock, scaled by chef skill. Spoilage bins whole batches whose `day + shelfLife ≤ tomorrow`. Plate waste comes from satisfaction below 60. Content `wasteShares` scale each stream relative to the WRAP 45/34/21 split.
5. **Insolvency line** uses the *current rota's* monthly wage bill (+ rent × difficulty cost multiplier), times 3 months.
6. **Mood** also drifts toward 60, and a manager on shift gives +1/day. Staff below mood 12 have a 25% chance of quitting each evening.

## Balance observed (headless, balanced strategy, 100 seeds × 365 days)
`district.footfall` = **potential parties per day** before multipliers, matching ARCHITECTURE.md and CONTENT-NOTES.md. Entry conversion is `sigmoid(entryLogit − 0.35·queue)`, with `ENTRY_BIAS = −3.2`.

**Fixture** (test/fixtureContent.ts: 1 High Street district, footfall 40, rent £3,500/month, £20k cash + £30k loan, £35k fit-out):

| run | survival | covers/day | avg rating | month-12 cash p10 / median / p90 |
|---|---|---|---|---|
| balanced, normal | 70% | 33.4 | 3.48 | −£30.7k / −£0.3k / £11.6k |
| cheap (−15% prices), normal | 7% | 30.6 | 3.68 | −£33.8k / −£27.0k / −£21.3k |
| premium (+25%, skilled hires), normal | 88% | 29.8 | 3.76 | −£40.0k / £3.3k / £13.6k |
| balanced, hard | 36% | 29.4 | 3.50 | −£33.3k / −£25.4k / £4.6k |
| balanced, cosy | 100% | 42.9 | 3.63 | −£0.1k / £11.5k / £28.0k |

**Real content pack** (`--content ../content/src/index.ts`, seeds spread round-robin over the 4 districts):

| run | survival | covers/day | avg rating | month-12 p10 / median / p90 |
|---|---|---|---|---|
| normal | 44% | 63.1 | 4.18 | −£46.9k / −£33.1k / £3.7k |
| hard | 47% | 60.6 | 4.08 | −£43.6k / −£27.9k / £8.5k |
| cosy | 100% | 82.5 | 4.23 | −£0.3k / £3.4k / £87.9k |

By district (24 seeds, normal): High Street 4/6 survive, Business Park 5/6, Seaside 1/6 (deep Jan trough), **Student Quarter 0/6**: about 38 covers at ~£13/head can't cover ~£420/day of labour plus rent. Hard ≈ normal on the real pack is seed noise (the same seeds map to the same districts); the difficulty multipliers are small (footfall ×0.95, costs ×1.05).

Failures cluster in months 6–12 (the season curves' winter), which is the intended "first winter" beat.
**Balance flags for the content/balance agent:**
- Pricing up beats pricing down: a capacity-limited restaurant earns more per seat. Levers: `PRICE_GAP_WEIGHT` (price elasticity), `seatsPerTable`/`maxTables`, segment budgets.
- Real pack normal is 44%, below the 70–80% target. The cheapest levers are Student Quarter footfall/budgets, +£5k `startingCash`, or `ENTRY_BIAS` in constants.ts (+0.3 ≈ +10% covers).
- The headless owner hires 1 chef + 1 server, and a second of each above £15k cash. Labour then becomes ~40–55% of revenue, the main drain.

Performance: about 0.1–0.2 s per simulated year on one core. The headless CLI spreads seeds across worker threads (`--workers N`, default = cores, max 8). 100 × 365 takes ~12 s on the fixture and ~22 s on the real pack (71 dishes) on this 2-core box.
`--content <module>` loads any module exporting `content` (or default).

## Known gaps / next steps
- No critics (prestige only moves on reviews and events); no inflation; the loan is fixed at game start.
- Staff skill grows by 0.15 per shift up to the hidden `potential`; TRAIN adds 3-6 (round 2).
- Tables are all `seatsPerTable`-seaters; only the big_party incident pushes two together.
- VAT is settled daily rather than quarterly (simpler cash flow, less of a shock).
- The headless strategies are simple. They buy a table only after sustained walk-outs, and never change prices mid-game.

---

# Round 2

## What changed

### 1. Staff matter (owner covering vs hiring)
- **`state.ownerCovering`** is set at START_SERVICE to the roles (`chef`, `server`) nobody is on the floor for. It is copied to **`DayResult.ownerCovered`** (`[]` on a fully staffed day). It is recomputed live for breaks and training: a chef on a break means the owner is cooking for those ticks.
- **The owner** is a mediocre generalist: `OWNER = { skill 40, speed 45, charm 50 }`, cooks 2 tickets at a time, and gives 1.5 FOH actions/tick.
  - **Covering both kitchen and floor** halves kitchen throughput and FOH actions (`OWNER_BOTH_SPEED_MULT`). Each plate also waits 1 extra tick at the pass, and tables take 1 extra tick to clear.
  - **`state.ownerFatigue`** (0-100, optional) rises 22 per role covered plus 1 per 10 covers. It falls 25 on an evening the team ran the place. At 100 it takes 40% off the owner's skill, speed, charm and actions, and it persists across days. Above 60 the evening log warns the player.
- **Good staff visibly pay:**
  - Plate quality = 50 + (skill − 50) × 1.4 before the ceiling (`SKILL_QUALITY_*`).
  - Cook time = prep × (1.6 − 1.2 × speed/100). Fractions are dithered per ticket, so speed helps even on 1-tick dishes.
  - FOH charm (50 = neutral) scales patience decay ×0.7-1.3, scales tips ×0.6-1.4, and gives up to a 40% chance to lift a 3★ party to 4★ (`CHARM_*`, `TIP_CHARM_*`).
  - A porter clears tables in 1 tick (3 without).
- **TRAIN** (planning) costs `TRAINING_FEE` (£120). Skill goes up `TRAINING_SKILL_GAIN` (3-6, toward potential, drawn from a seed+day+staff stream). `staff.trainingDay = day` takes them off the floor that day. They are still paid if rostered, get no fatigue and +2 mood. It is rejected if they are already trained today, already at potential, or there isn't the cash.
- **GIVE_BREAK** (service) gives fatigue −20 and sets `staff.breakUntilTick = tick + BREAK_TICKS` (6). Their tickets are handed to whoever can cook, the floor's actions and charm are recomputed, and the flag clears when they return.

**Headless check:** a single-chef + single-server owner over 16 seeds × 60 days (real pack):

| day type | before (M1) | after |
|---|---|---|
| staffed weekday | −£39 profit, 68 covers, 4.18★ | +£17, 71 covers, 4.21★ |
| owner covers both (Mon/Tue) | **+£214**, 59 covers, 3.17★ | **−£219**, 20 covers (48 walk-outs), 2.24★ |

Payback from the same day-14 state (median of 16 seeds): a good chef hired to cover the first chef's days off is **+£1.9k by day 14** (+£3.6k by day 28). The same for a server is +£1.3k by day 14. A second chef rostered only at weekends does *not* pay (−£0.7k): extra kitchen hands help less than extra tables once the kitchen is staffed. A porter on top of a full team does not pay with these wages either. Both are a content question: porter wage, or a bigger porter effect.

### 2. Incidents (`src/systems/incidents.ts`, text in `src/incidents/text.ts`)
- **Pipeline:** `floorSystem` runs first each tick (ends breaks, expires mods). `incidentSystem` runs after ServiceSystem (countdown, timeout ⇒ `ignored` effects, may start one). Close of service resolves anything still live as `ignored` with no effect.
- **Limits:** ≤ 2 live (`INCIDENT_MAX_LIVE`), never two live of the same kind, ≤ 3 per service, ≥ 10 ticks between starts, none after tick 108. `ticksLeft` is drawn from 6-12. The fixture averages 1-3 per service (tested). On the real pack the scripted owner sees **~2.5/day** (staffed) and 1.9/day (nohire).
- **Kinds, conditions and options** (option id → effect):

| kind | when | options |
|---|---|---|
| sent_back | 40% of parties whose plates average < 45 when they start eating | `remake` (best cook drops everything for 3 ticks; new plate replaces the old quality; costs stock) · `comp` (free meal, cost = their bill) · `apologise` (+0-12 satisfaction × charm). Ignored: −15 |
| spill | ≈1 per 60 seated covers | `mop` (+3 sat.; −0.5 FOH actions for 4 ticks unless a porter is on) · `leave` (−5). Ignored: −10 |
| big_party | rare per tick; party of seatsPerTable+1 … 2× | `push` (needs 2 free clean tables; seats them across both; −0.75 actions for 4 ticks) · `decline` (−0.3 popularity). Ignored: −1 popularity |
| rush | potential parties ≥ 30 and queue ≥ 4 | starts arrivals ×1.6 for 10 ticks. `callin` (£60: +1.5 actions, kitchen ×1.3) · `simplify` (86 the slowest dish, kitchen ×1.2) · `ride` |
| supplier_short | this morning's delivery was short (`state.shortDelivery`) and a dish on offer uses it | `shop` (buys the missing portions at **2.5×** unit cost; it is stock, so it reaches the P&L as food cost) · `pull` (86 every dish using it) |
| equipment | rare, kitchen busy | kitchen ×0.5 while live. `fix` (×0.6 for 5 ticks, free) · `engineer` (£120, ×0.8 for 2). Ignored: ×0.7 for 30 ticks |
| vip | popularity > 60, once per service | marks a seated party `vip`. `best` (+0-14 sat. × best charm; −0.4 actions for 10 ticks) · `freebie` (cheapest starter/dessert's cost, +8) · `normal`. **Their rating moves prestige (rating − 3) × 2.5 = ±5**; walking out is −5 |
| staff_wobble | someone on the floor has fatigue > 75 | `break` (as GIVE_BREAK) · `push` (−3 mood). Ignored: −6 mood, +5 fatigue |

- **Short deliveries:** each morning one order line of ≥4 portions comes in 30-70% short with chance 12%. The missing part is refunded. It uses its own seed+day stream, so the main RNG is untouched. `state.shortDelivery` lasts until END_DAY.
- **RESPOND_INCIDENT** (service only) applies the option, writes `resolution` and `outcome`, and emits `INCIDENT_RESOLVED` plus a LOG line. It rejects with a reason when there's not enough cash, no two free tables, no stock for a remake, or the incident is already resolved. Resolved incidents stay in `state.incidents` until the next START_SERVICE. They are summarised in **`DayResult.incidents`** as `{kind, resolution, outcome}`.
- Cash spent on options (call-in, engineer, freebie) is **`DayResult.incidentCosts`**, a P&L line. A comp shows up as lost revenue, as before.

### 3. Gentler opening and goals
- **newGame starts with an empty larder.** At the first START_SERVICE (day 0, nothing served yet) the sim spends up to `BalanceDef.openingStockBudget` (optional; default `OPENING_STOCK_BUDGET` = £600). It buys what the active menu needs for 1.3× the first-day forecast, less anything already on hand, scaled to fit the budget, delivered at once. Day-1 spoilage drops from ~£1.4k to near zero.
- **`suggestedOrder(content, state): {ingredientId, qty}[]`** and **`expectedCovers(content, state)`** are now public (`src/forecast.ts`). This is the UI's old stockNeeds heuristic moved into the sim:
  - With history, the forecast is the busiest of the last 7 days' demand (covers + walk-outs) × 1.1. Before any history it is a model estimate, capped by room capacity. The minimum is 20.
  - Plates per guest: one main, plus COURSE_ORDER_CHANCE of each other course, raised to the dish's own recent rate.
  - Result: need − on hand − on order, rounded up to 5s.
- **GoalSystem** (`src/systems/goals.ts`, ladder and text in `src/goals/text.ts`):
  - newGame seeds tier 0. A tier's goals are appended when every goal of the tier below is done.
  - `updateGoals` runs after every accepted command and as the last evening system. It is idempotent.
  - On completion: `done: true`, `GOAL_COMPLETED`, a LOG line, and the reward (cash £100-£500 / popularity +1-3), applied once.
  - Tiers:
    - **0**: 6 dishes, hire a chef, hire a server, order stock, open.
    - **1**: 30 covers in a day, a 4★ day, a profit day, resolve an incident.
    - **2**: a profit week (7 days summing > 0), buy a table, popularity 60, 30 days open.
    - **3**: 90 days open, `max(5, startingTables+2)` tables (8 on both packs), popularity 75, 10 profit days in a row (streak; can fall back).
  - `Goal.role` (optional) is set on hire goals.

### 4. Review "should fix"
- **Food cost = the stock in today's plates, at the price paid.** Stock batches now remember `cost` per portion (optional), so food cost includes seasonal, difficulty and corner-shop prices, valued FIFO. Prep trim and spoilage use the same basis. Over any period: **cash spent on stock − refunds = foodCost + waste.prep + waste.spoil + Δ(stock value)** (tested). `profit = revenue − vat − foodCost − waste.prep − waste.spoil − labour − rent − overheads − incidentCosts − loan`. `waste.plate` is still information only (it is inside foodCost).
- **Stale event:** RESOLVE_EVENT on an `activeEvent` whose id is not in content dismisses it (any choiceId, "The morning post got lost") and advances the day.
- **New tests:** a full day ending in an event, game over through real play (no event drawn after gameover), the cosy clamp over 5 days, spoilage across three batches, and save compatibility. Also `test/staffing.balance.test.ts`: balanced beats nohire on median cash at day 90 in every district (real pack).

## Contract additions (all optional)
- `BalanceDef.openingStockBudget`
- `Staff.trainingDay`, `Staff.breakUntilTick`
- `Customer.satisfactionBonus`, `Customer.vip`
- `KitchenTicket.remakeOf`
- `Incident.value`
- `Goal.role`
- `Stock.batches[].cost`
- `DayResult.incidentCosts`
- `GameState.ownerFatigue`, `shortDelivery`, `incidentsHandled`
- `ServiceTally` round-2 accumulators (`foodCost`, `frontCharm`, `mods`, `kitchenCarry`, `prestigeBonus`, `popularityBonus`, `incidentCosts`, `incidentsStarted`, `lastIncidentTick`) and `ServiceMod`
- New exports: `suggestedOrder`, `expectedCovers`, `openingStockBudget`, `TRAINING_FEE`, `TRAINING_SKILL_GAIN`, `BREAK_TICKS`, `OPENING_STOCK_BUDGET`, `OWNER`, `OWNER_FATIGUE_WARNING`

Round-1 saves load unchanged (missing fields fall back; tested on an evening save and a mid-service save).

## What the UI needs to show
- **Incident panel** (service):
  - Show `state.incidents.filter(i => !i.resolution)`, at most 2: title, body, a `ticksLeft` countdown, and one button per option (label, description, `cost` when set).
  - Clicking sends RESPOND_INCIDENT. Highlight `tableId` / `customerId` / `staffId` / `dishId` on the canvas.
  - On INCIDENT_RESOLVED show `outcome` (also in the ticker). A rejection is a normal LOG "bad" toast.
- **Evening:**
  - Show `DayResult.incidents` as "How it went" lines.
  - Add the `incidentCosts` P&L line ("Problems sorted").
  - Show `ownerCovered`: when non-empty, show e.g. "You ran the whole place yourself today" with a nudge to hire. Show `ownerFatigue` when it is ≥ 60.
- **Owner-covering banner:** during service when `state.ownerCovering.length > 0`. It is live, and changes while a lone chef or server is on a break.
- **Goals panel:** the unfinished goals of the lowest unfinished tier (`title`, `hint`, `progress/target`). Toast on GOAL_COMPLETED with the reward.
- **TRAIN** (planning, staff card): fee `TRAINING_FEE`, gain `TRAINING_SKILL_GAIN`. Grey it out when `trainingDay === day` ("on a course today") or skill ≥ potential.
- **GIVE_BREAK** (service, staff strip): grey it out while `breakUntilTick > tick`. Suggest it when an incident is `staff_wobble`, or when fatigue > 75.
- **Stock:** use `suggestedOrder` for "Restock for tomorrow" and `expectedCovers` for "planning for N guests". Show `state.shortDelivery` in the morning ("the beef delivery came 12 short").
- **First day:** the larder is empty until "Open"; say "Opening stock is bought when you open (up to £600)". Don't show an out-of-stock warning on day 0.

## Headless (100 seeds × 365 days, real pack, seeds round-robin over the 4 districts)

| run | M1 survival | round 2 survival | covers/day | rating | month-12 p10 / median / p90 |
|---|---|---|---|---|---|
| balanced, normal | 82% | **97%** | 85.1 | 4.35 | £13.2k / £16.4k / £55.1k |
| **nohire**, normal | — | **0%** | 11.1 | 1.86 | −£10.2k / −£7.1k / −£5.8k |
| cheap (−15%), normal | 72% | **25%** | 64.9 | 4.09 | −£34.8k / −£22.0k / −£0.8k |
| premium (+25%), normal | 52% | **95%** | 60.6 | 4.48 | £10.2k / £19.8k / £48.2k |
| balanced, hard | 57% | **89%** | 76.5 | 4.37 | −£18.1k / £12.2k / £15.2k |
| balanced, cosy | 100% | 100% | 104.2 | 4.31 | £41.0k / £86.3k / £139.4k |

Median year-end cash by district (6 seeds each): balanced £15.5k / £20.6k / £67.8k / £14.9k (Student / High St / Business / Seaside); nohire −£9.2k / −£14.7k / −£12.7k / −£10.9k; premium £16.5k / £16.1k / £51.6k / £44.3k; cheap −£1.3k / −£36.4k / −£30.7k / −£24.3k.

Part of the jump is the **scripted owners getting smarter**, which round 2 forced:
- With owner-alone days now ruinous, they hire a second chef and server once cash > £1.5k to cover the first pair's days off.
- They add weekend shifts only while the fortnight is profitable, and drop them after a losing one (REVIEW coordinator item 3).
- They respond to incidents (`INCIDENT_POLICY` in headless.ts).

M1 numbers came from owners who left Mon/Tue to the owner, which was then *profitable*.

**Balance flags for the content agent:**
- Normal (97%) and hard (89%) are well above target (70-80% and ~50%). The strongest levers:
  - in content: segment budgets, `startingCash`;
  - in constants: `DIFFICULTY.hard` (footfall ×0.88, costs ×1.1 is too gentle now), `ENTRY_BIAS`.
- **Cheap (−15%) now collapses (25%).** Lower prices bring more guests than one chef can turn into good plates, and margins don't cover a staffed rota. Premium has overtaken balanced on median cash again in Student/Seaside, though it doesn't win everywhere (the pricing guard test passes). Both are worth a look once survival is re-targeted.
- A porter, and a second chef used only at weekends, don't pay back with current wages.

**Performance:**
- 100 × 365 balanced/normal takes **35-37 s** on this 2-core box (M1 code: 27-28 s on the same box today; 22 s when first measured). Single-thread it is 1.75-1.95 ms per simulated day vs 1.36-1.45 ms before.
- About a third of the difference is simply 14% more covers.
- Fixes so far: one canonical GameState shape during service (`canonicalState`, −20%), and local stock tracking in OrderSystem.
- Next candidates: foldLog/LOG events per tick, and per-tick `{...tally}` copies in seating/payment.

# Round 3 hooks

These are the hooks requested in EMPIRE/STARS/CAREER/HANDSON-NOTES and CONTENT-NOTES "Round 3". Every new state field is optional, so **the save version stays 1** (the `MIGRATIONS[1]` normaliser is still the identity). When none of the hooks are used, the sim is **bit-identical** to round 2: final cash, history and RNG state match for seeds 1–4 × 120 days, typical/normal on the real pack.

## Exports (`@full-plate/sim-core`)
| Name | What |
|---|---|
| `Rng`, `hashSeed`, `seedState`, `type RngState` | The sim's xoshiro128** RNG (`Rng.fromSeed`, `new Rng(state)`, `getState`). sim-stars, handson and sim-career can drop their relative `../../sim-core/src/rng` imports. |
| `strategies` (namespace) | The scripted owners from `src/strategies.ts`, which is browser-safe (the node CLI stays in `headless.ts`): `STRATEGIES`, `runStrategyDay`, `playOne`, `playService`, `setUpMenu`, `staffing`, `rotas`, `restock`, `buyTables`, `resolveEvent`, `respondToIncidents`, `INCIDENT_POLICY`, `stepper`, types `Strategy`, `StrategyName`, `RunResult`, `Step`. |
| `runStrategyDay(content, state, strat)`, `STRATEGIES`, `Strategy`, `StrategyName` | Also exported at top level. `runStrategyDay` plays one owner day from planning (or mid-service) to the next morning's planning: menu if empty, staffing, rotas, tables, service with incident responses, restock, END_DAY/RESOLVE_EVENT. |
| `setFootfallMod(state, source, mod \| null)` | Replaces the footfall mod tagged `source`, or removes it with `null`. Untagged mods and other sources are left alone. |
| `recruitmentFeeOf(state)` | The fee HIRE charges. |
| `incidentTextOf`, `incidentLinesOf`, `goalLadderOf`, `goalLinesOf` (content) | The text in effect for a pack. |
| `HANDS_ON`, `PLAYER_COOK_ID` (`"player"`), `CLOSED_DAY_WAGE_SHARE` (0.5), `SET_MENU_SEGMENTS` (`foodies`, `business`), `SET_MENU_BUDGET_MULT` (`{ foodies: 1.6 }`), `SET_MENU_MAX_DISHES` (12) | Constants. |

## New commands (all rejected with LOG "bad" and the state unchanged when invalid)
| Command | Phase | Effect |
|---|---|---|
| `PLAYER_COOKED { ticketId, quality }` | service | The ticket is plated now with `clamp(quality, 0, 100)`. It is booked like an AI plate: `DISH_PLATED`, tally plates/quality/dish/per-cook/freshness. If hands-on holds that kind of plate (see below), it goes to the pass (`atPass`, `platedAtTick`, `ticksRemaining 0`, `chefId` = `handsOn.staffId ?? "player"`); otherwise it reaches the table now. Rejected if the ticket is unknown or already at the pass. |
| `PLAYER_SERVED { customerId, ticketId, speedBonus }` | service | A held plate reaches its party (`servedTick` is set on the last plate, so they eat next tick). `satisfactionBonus += clamp(speedBonus,0,1) × 8 / order.length`, so a party served at full speed on every plate gets +8. Rejected unless the ticket is at the pass and belongs to that live party. |
| `PLAYER_CLEARED { tableId }` | service | Sets `dirtyTicks = 0` on a free dirty table. |
| `PLAYER_TOOK_PAYMENT { customerId }` | service | Settles that `paying` party now (the same `settleParty` as PaymentSystem: rating, tip, VIP verdict, tally, cash). It costs no FOH action and uses one draw from the main RNG (charm upgrade). |
| `PLAYER_DROPPED { ticketIds, cost }` | service | Charges `cost` (integer pence, capped at `HANDS_ON.maxDropCost` = £50) to cash, `tally.plateWaste` (→ `DayResult.waste.plate`) and `tally.foodCost` (→ `DayResult.foodCost`, so it reaches profit). Each listed ticket goes back on the rail (`ticksRemaining = prepTicks`, quality/chef/pass cleared, `createdTick` kept so the wait shows); no new stock is used. A dropped held plate is taken back off the plate/quality books. |
| `SET_HANDS_ON { role \| null, staffId? }` | planning, service | Sets `GameState.handsOn = { role, since: tick (0 in planning), staffId? }`. `null` clears it, and held plates go out on the next tick. `staffId` (career) must be a staff member; the human's plates are attributed to it in `perChef`. Cleared automatically at close of service and at END_DAY. |
| `CLOSE_TODAY` | planning | Moves to evening/event without a service (see below). |
| `SET_SET_MENU { dishIds, price, active }` | planning | Stores `GameState.setMenu`: 1–12 distinct known dishes, price whole pence ≤ £1,000. `dishIds: [], active: false` removes it. Set dishes don't need to be on the à-la-carte menu. |
| `SET_OWNER_PROFILE { skill, speed, charm }` | planning, evening, event | `GameState.ownerProfile`, each value clamped 0–100. |
| `PLAYER_CLAIMED { ticketId }` (review) | service | The human picked this ticket up: `chefId` = the human, `claimedAtTick`. No AI cook takes it until `HANDS_ON.claimTimeoutTicks` (16) pass or hands-on stops. A career player's own Staff record is never an AI cook while they are hands-on (chef/bar). |
| `HIRE_STAFF { staff }` (review) | planning | Hire a known person (former colleague). Same fee and cash rule as HIRE; identity, stats, wage, traits and potential kept; mood/fatigue/rota/hiredDay fresh. |

## Hands-on fallback rules (`HANDS_ON` in constants.ts)
The sim backs off whatever the human's role covers, but a slow fallback keeps food from being stranded if the child wanders off.
- **Server (`role: "server"`)**
  - Every plate, AI- or human-cooked, waits at the pass (`atPass: true`, `platedAtTick`).
  - An AI colleague carries a held plate once `tick − platedAtTick ≥ passHoldTicks` (**4 ticks**).
  - AI front of house takes a party's payment only once it has waited `payHoldTicks` (**4**) in `paying`. The human's PLAYER_TOOK_PAYMENT is immediate. Waiting to pay costs no satisfaction (`waitTicks` ends at `servedTick`).
  - Seating, ordering and table clearing stay AI as before. PLAYER_CLEARED just makes clearing instant.
- **Bar (`role: "bar"`)**
  - Same as server, but only drink plates are held.
  - It also reserves drinks for the human (next rule, drinks only).
- **Chef (`role: "chef"`)**
  - The oldest unassigned food tickets are reserved for the human, up to `reserveTickets` (**3**) of them. AI chefs (and the owner covering) take only tickets beyond those three.
  - A reserved ticket becomes fair game once `tick − max(createdTick, handsOn.since) ≥ reserveFallbackTicks` (**4**). In practice the AI stops pulling new tickets while the human has < 3 waiting, and catches up after 4 ticks.
  - Tickets the human cooked never count down on their own. A ticket an AI already started stays with that AI.
  - Plates are delivered straight away, with no pass hold.
- **porter / manager**: accepted for the UI's sake; no back-off.
- **At close**: held plates are delivered before parties settle, so nothing is lost. `handsOn` is cleared.
- `DayResult.perChef` keys the human as `handsOn.staffId` or `"player"`, the owner as `"owner"`, and AI cooks by Staff id.

## Closed day (`CLOSE_TODAY`)
- The evening systems run on an empty tally with `todays.closed`. The DayResult has `closed: true`, 0 covers, revenue, walk-outs and reviews, and empty `ownerCovered`.
- Rent, the loan instalment and fixed overheads (no card fees) are charged as usual.
- **Wages: rostered staff are paid 50%** (`CLOSED_DAY_WAGE_SHARE`), which is notice pay for a shut day. To pay nothing, take people off the rota before closing.
- Every staff member gets a rest day (fatigue down, rest-day mood), and the owner recovers.
- Stock keeps ageing and spoils, and reputation drifts toward 50 as usual. Insolvency is still checked, and an event card can still be drawn.
- `stats.daysOpen` and the 7-day menu window are not advanced. `expectedCovers` returns **0** that evening (so `suggestedOrder` is empty), and closed days are left out of later forecasts.
- A game that closes before it ever opens still gets its opening stock at the first real START_SERVICE.
- sim-stars can replace the ×0 footfall trick in `prepareService` with `CLOSE_TODAY`.

## Set menu (`GameState.setMenu`)
- **Who takes it.** While `active`, a foodie or business party takes the set menu if the larder can plate every set dish for every guest. Each guest gets every set dish, fired as normal tickets. Otherwise they order à la carte, so a sold-out set never strands a party. Other segments always order à la carte.
- **Bill and satisfaction.** One sale: `spend = price × partySize`, `Customer.setMenu = true`. Satisfaction uses the mean plate quality as usual. The value score compares price per head with `averageBudget × SET_MENU_BUDGET_MULT[segment]`, which is **1.6× for foodies** (a tasting-menu budget) and 1× for business.
- **Arrivals.** For set segments, the entry logit adds the set dishes' appeal (capped as usual), compares the set price with the same ×1.6 budget, and uses markup = set price ÷ Σ set dishes' suggested price − 1.
- **Per-dish takings.** Set takings are split across the set's plates in proportion to suggested price. `perDish[].revenue` sums to the day's revenue.
- **Forecast.** `platesPerGuest` adds each set dish × the district's foodie+business share, so `suggestedOrder` stocks for it.
- **Off means off.** An inactive set menu changes nothing.

## Owner profile, recruitment fee, footfall sources
- `ownerStats` uses `state.ownerProfile ?? OWNER` for skill, speed and charm. Fatigue and two-places-at-once penalties still apply; `serverActions` and `chefTickets` stay at OWNER's values. The cook cache keys on it.
- HIRE charges `state.recruitmentFee ?? RECRUITMENT_FEE`, and the affordability check uses the same fee. This can replace sim-career's `applyWithPerks` rebate.
- `footfallMods[]` entries take an optional `source`. It survives the morning countdown; use `setFootfallMod` to replace your own entry.

## DayResult extras (optional; always set by this version)
- `perDish: Record<DishId, { sold, plated, qualityMean, revenue, foodCost }>` covers dishes ordered today, with ids sorted. `foodCost` is the stock price paid for the plates fired; drop costs are not included (they are in the day's `foodCost`).
- `perChef: Record<StaffId | "owner" | "player", { plates, qualityMean }>` counts plates excluding remakes. A remake swaps its quality into the cook who made it.
- `freshnessMean` is the mean freshness/season bonus (quality points) of today's plates.
- `closed` is set by CLOSE_TODAY only.

## Content packs
- `ContentPack.incidentText?` and `goalText?` are new optional fields, shaped like content's `incidentText`/`goalText` exports (`{ INCIDENT_TEXT, INCIDENT_LINES }`, `{ GOAL_LADDER, GOAL_LINES }`). Pass `{ ...fullContent, incidentText, goalText }`.
- Text is merged key by key over the built-in text, so a missing kind, option or line falls back.
- A non-empty `GOAL_LADDER` replaces the built-in one, skipping entries with an unknown kind or a malformed shape.
- With content's own JSON the game plays byte-identically to the built-in text (tested).
- Nothing in sim-core assumes the library size. The tests play `fullContent` (125 dishes) for 20 days.

## Tests and performance
- `test/round3.hooks.test.ts` has 42 tests: every command's happy path and rejections, pass hold and both fallbacks, a full service with an idle human server, closed-day costs and forecast, set-menu ordering/value/forecast/no-op, owner-profile plate quality, recruitment fee, DayResult extras consistency, setFootfallMod, content-text fallback and identity, fullContent, mid-service save round-trip with every new field (continues identically), and determinism of the hands-on commands.
- Whole suite: 180 tests pass.
- The smoke test's 3 s wall-clock assertion is now a soft benchmark: it logs `[bench] …` and fails only past 30 s. It was ~0.9 s here.
- Throughput is unchanged: 1.64–1.81 ms per simulated day for both HEAD and this change, in back-to-back runs on the 2-core box.
- The per-tick mutable tally builder (REVIEW.md (c)) was **not** done. It is a cross-cutting refactor of every service system, and today's numbers don't need it.

## Headless (100 seeds × 365 days, real pack, normal) — unchanged from round 2 / CONTENT-NOTES
| strategy | survival | covers/day | rating | final popularity |
|---|---|---|---|---|
| typical | **83%** | 90.3 | 4.23 | 80.5 |
| balanced | 100% | 87.5 | 4.42 | 87.5 |

## Round 3 (Empire calibration): closed-form demand and capacity (`src/capacity.ts`)
Additive; the tick pipeline doesn't use it. sim-empire's aggregate model is built on it (EMPIRE-NOTES §3), so a modelled site produces what this sim produces for the same district, menu, prices, tables and crew.
- `marketDemand(content, {districtId, menu, day, popularity, prestige?, difficulty?, footfallMult?, setMenu?})` and `expectedDemand(content, state)`: expected covers walking in with a free table always waiting (the arrival system without the queue penalty), plus `meanParty`, `peakShare` (share of parties in the busiest 30 ticks), and the order model's expected `spendPerCover` and `foodPerCover` (base unit costs).
- `capacityCovers({tables, seatsPerTable?, meanParty, crewUnits, crewSkill, peakShare?})` and `serviceCapacity(content, state)`: seats = tables × 7.7 turns × mean party; crew = 136 covers per chef+server pair on shift × (1 + 0.5 (skill − 50)/100); soft minimum (k = 3) × (0.44 / peakShare)^0.3. Constants in `CAPACITY`, fitted to this sim (RMS 3% at saturation).
- `softCap(demand, capacity) = d / √(1 + (d/c)²)` and its inverse `uncapped`. `crewOnShift(state)` counts the owner covering a missing role as half a pair.
- `test/capacity.test.ts` plays the real pack against the closed form (saturated and ordinary footfall, within 12%). If service physics change (eat ticks, turns, kitchen parallelism), refit `CAPACITY` there.
- No `types.ts` changes.

# Round 5: the hands-on station in sim time (`src/systems/station.ts`)
REVIEW R4 P1: a played commis shift cost ~15% of covers. A child's station ticket took 7–8 sim ticks against ~2 for an AI cook, a party ate only once every plate was in, and — the biggest single cause, found with a per-stage occupancy probe — the commis's own Staff record stopped cooking as an AI on played days, so every main queued behind one fewer chef (parties spent twice as long in `ordered`). Every rule below is in sim ticks and a function of the GameState, so it replays from the command stream like everything else; none of it runs without `GameState.handsOn.station`, so owner play is byte-identical (headless typical/balanced × normal/hard/cosy, 100 seeds, unchanged).

1. **Coursing.** Station dishes whose course is in `STATION_COURSES` (starter, side, dessert) are their party's own course when the party also ordered other food. Once every other plate is in, `startCourses` sets `servedTick` and `Customer.courseOut`: the party eats its mains and goes `eating → paying` only after the course lands (`deliverPlate` clears `courseOut`; a course that lands after the mains costs `courseEatTicks` = 1). The sim's sous chef sends a coursed plate still on the rail at `eatUntil − courseLeadTicks` (1), so it never holds the table.
2. **Cover by ticket age in ticks.** `ticketsToCover`: a rail ticket that isn't its own course is plated by the sim once it is `station.coverTicks` old (from when it fired, or hands-on began; SET_HANDS_ON validates 1–40, default `stationCoverTicks` 8; handson sends commis 8, chef de partie 7, sous 6, head 5), picked up or not, or at once when its party is down to `coverPatience` (40). The covering cook is the first AI chef (or the owner); the plate is their `plateQuality` − `coverQualityHit` (12) and is booked to them in `ServiceTally.chefs`, not to the player. `stationFallbackTicks` (40) remains only as a reservation safety net.
3. **One main on the rail.** `humanTickets` (exported as `stationRailTickets`) is the rail: the human's claimed tickets, then the oldest unassigned station tickets up to `cap`, with at most one that isn't its own course. A second main would wait for the first while its table waits too, so it goes to the AI at once. `stationRail` (the AI reservation) and handson `stationTickets` use the same rule.
4. **Station dilation.** Every plate delivered while a station is on records when an AI would have had it out: AI plates when they land, the human's (`PLAYER_COOKED`) and covered plates at `createdTick + aiTicks(dish)` (cookTicks at speed `aiReferenceSpeed` 50). `Customer.dueTick` keeps the latest. The excess `servedTick − dueTick` comes off the eating time (`eatTicksFor`, floor `dilationMinEatTicks` 3) and off the wait the party rates (payment `waitTicks`). While every ticket a party still waits for is on the human's rail, it loses patience at `stationPatienceMult` (0.5).
5. **The commis's AI hands.** With a station, `cooksOnShift` keeps the human's Staff record as an AI cook (its own skill, speed and `CHEF_PARALLEL_TICKETS`) under id `<staffId>~ai` (`SHADOW_COOK_SUFFIX`) for everything not on the rail — the capacity a day off has. Without a station (owner jump-in, bar) the round-3 rule is unchanged.
6. **Never cooking twice.** `PLAYER_CLAIMED` and `PLAYER_COOKED` of a ticket an AI cook already has are refused (one LOG "bad", state unchanged). Before, a claim took the ticket off the AI mid-cook and the session binned the child's plate when the AI's landed first.

**Contract additions (optional):** `HandsOnStation.coverTicks?`, `Customer.courseOut?`, `Customer.dueTick?`; `HANDS_ON.{stationCoverTicks, stationMaxCoverTicks, coverPatience, coverQualityHit, courseLeadTicks, courseEatTicks, dilationMinEatTicks, stationPatienceMult, aiReferenceSpeed}`; `STATION_COURSES`; exports `stationRailTickets`, `ticketsToCover`, `aiTicks`, `isCoursed`. `deliverPlate` takes an optional `dueTick`; `advanceCustomer` an optional `patienceMult`.

**Why not "tick(handsOnProgress)".** A sim-side clock dilation driven by the player's verb progress would need fractional ticks in every service system plus a PLAYER_PROGRESS command, and slowing only the player's tables' patience doesn't give the seat back to the queue. The rules above make parity independent of how fast the child is; the host decides only how many plates are the child's own (handson `PACING.workSpt`, HANDSON-NOTES round 5). Ticks are already host-driven commands, so that pacing is deterministic on replay.

**Measured** (10 seeds, the first career shift, `careerParity.test.ts` through the real reducer; covers / walked-out covers):

| | day off | half-speed bot (0.55, pace 0.5) | full speed (0.55) | skill 1 | idle |
|---|---|---|---|---|---|
| before (round 4) | 77.3 / 1.4 | 62.4 / 7.2 | 61.2 / 9.9 | 62.3 / 10.5 | 64.3 / 8.1 |
| after | 77.3 / 1.4 | **80.9 / 1.3** (104.7%) | 78.8 / 0.0 | 75.5 / 0.0 | 79.5 / 0.4 |

30 seeds: day off 77.8 / 0.9; half speed 79.0 / 1.0 (101.5%); full speed 81.4 / 0.4; idle 80.0 / 0.8. Per-seed outcomes swing ±10 covers (the arrival stream is chaotic: any change in RNG draw order changes the day), so judge on means. `test/round5.station.test.ts` (12) and `test/round5.claims.test.ts` (2) cover the rules.

## Round 5 review: the "trim the rota" tip and the `learner` owner (`src/advice.ts`)

Typical/hard survived **0/100** in year 1 — before round 5 too (checked at `edfc23c` in a worktree; identical since R2.3). Diagnosis (50 seeds, typical variants on hard): menu of 6 → 8%; stock 1.3 days → 4%; hiring/table thresholds like balanced → 28%; the typical flag off (trims the rota, notices cover, answers every incident) → **44%**. The killer is doubled-up shifts kept through losing weeks, and nothing in the game said so.

- `rotaAdvice(state, end?)`: after a losing fortnight (`ROTA_ADVICE_DAYS` = 14, mean daily profit < 0), the later hire in a role whose rota days overlap a colleague's in the same role (most expensive first), with the weekly cost of those shifts. Pure; `end` reads history up to an index.
- The game's Evening shows it (owner, Empire and Stars; not career, where the player can't set the rota) with **Change the rota →**.
- `STRATEGIES.learner` = typical + `readsTips`: trims once the tip has named that person `TYPICAL_NOTICE_DAYS` (6) evenings running. `typical` is unchanged (it models a player who ignores advice), so every published table stays comparable.
- DIFFICULTY.hard is unchanged. A sweep showed any easing moves balanced far faster than typical: (footfall, cost) 0.85/1.15 → typical 16%, balanced 90%; 0.9/1.2 → 7% / 75%; 0.8/1.1 → 23% / 94%.

| owner year 1, 100 seeds, real pack | cosy | normal | hard |
|---|---|---|---|
| typical | 100% | 83% | 0% |
| balanced | 100% | 100% | 45% |
| learner (typical + reads the tip) | 100% | 100% | 33% |

`test/round5.advice.test.ts` (4).
