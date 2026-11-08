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
- **Opening stock**: 40 portions of every ingredient on day 0, paid from starting cash.
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
- Staff skill grows by 0.15 per shift up to the hidden `potential`; there is no promotion or training command yet.
- Tables are all `seatsPerTable`-seaters. There is no table mixing or pushing tables together for big parties.
- VAT is settled daily rather than quarterly (simpler cash flow, less of a shock).
- The headless strategies are simple. They buy a table only after sustained walk-outs, and never change prices mid-game.
