# Full Plate — Integration, playtest and code review (Milestone 1)

Reviewer: lead/integration. Date: 8 Nov 2026. Covers commits `db7607a` … `5db835f`.
Content was **not** edited (the balance agent committed `a6780ec` in parallel; every number below is against that pack).

Status at the end of this pass: `pnpm -r typecheck` ✓ · `pnpm -r test` ✓ (sim-core 83, content 24, game 22) · `pnpm --filter @full-plate/game build` ✓.

---

## 1. Integration changes

| Commit | What |
|---|---|
| `db7607a` integration | Deleted `src/dev/*` (stub sim, stub content, both typecheck shims), the tsconfig `paths` fallbacks and the stub fallback in `vite.config.ts`. **`VITE_USE_STUBS` is gone** (keeping a toy sim alive would only drift; the real sim is fast enough for UI work). No "stub sim" pill. Game tests now run on the real packages. |
| | sim-core `index.ts` now also exports `START_MONTH`, `START_WEEKDAY`, `WEEKEND_DAYS`, `DAYS_PER_MONTH`, `weekdayOf`, `monthOf`, `isWeekend`, `TABLE_COST`, `RECRUITMENT_FEE`, `HIRE_CASH_BUFFER_SHIFTS`, `SHIFT_HOURS`, `MAX_MENU_ITEMS`, `shiftCost` (and later `COURSE_ORDER_CHANCE`). No content or `types.ts` change. |
| | **Calendar bug fixed:** the UI used `day % 7` for the weekday; sim-core uses `(day + 2) % 7`. Every date label, "Get ready for …", rota "today" highlight, coverage grid, wage estimate and canvas staff list was two days out. |
| | Rejected commands (LOG `bad`) show as a toast (`components/Toast.tsx`, `role=status`). |
| | Table price and agency fee shown before clicking; Hire / Buy disabled using the same cash rule as the sim. Weekly wage estimates use `shiftCost` (includes the 10% on-cost the UI was missing). |
| | Uses `GameState.eightySixed`, `gameOverReason`, `Candidate.hired` directly; the reducer's event-derived fallbacks and the name+role "hired today" hack are deleted. |
| | Empty menu: "Step 1: add dishes" hint, empty-state panel and a **"Use a suggested starter menu"** button (7 dishes: 3 mains + starter, side, dessert, drink, ranked by the district's segment mix, easy recipes preferred; `lib/starterMenu.ts`). |
| | **Event days:** previously `phase === "event"` rendered Planning + modal, so the day's P&L was never seen. Now Evening renders for both `evening` and `event`; the button reads "Read the morning post →" and opens the modal. |
| | Evening P&L now lists VAT and "Bills & card fees" and drops plate waste from the waste line (it is already in food cost), so **the lines add up to the profit**. Previously the shown lines did not sum (missing ~£190/day). Checked on all 14 playtest days (`sumOk: true`). |
| | Leaving customers linger one tick and `chefId === "owner"`: checked; the canvas already handles both (leavers animate out; owner tickets are drawn without a staff sprite). |
| `26c3532` fix | Stock flow (see playtest P1): course-aware forecast, **"Restock for tomorrow"** on the evening screen, out-of-stock hint in planning, "orders arrive tomorrow" callout. |
| `04f946d` fix | Restock forecast ignored dishes 86'd today, which in the evening are exactly the ones that sold out. |
| `2ec8fe3` fix | Pricing dominance + hard difficulty (sim-core; see §4). |
| `8a269c8`, `79c658c`, `5db835f` | Save/load determinism fix, contrast fix, owner-covers canvas label, calendar tests. |

`docs/UI-NOTES.md` updated (running table, sim door, contract gaps 1–7 closed).

---

## 2. Playtest — High Street, Normal, seed 20261108, 14 days

Driven by Playwright (`play.mjs` in the scratchpad) against a frozen build. The live dev server is unusable while another agent edits content: every JSON save triggers a full page reload back to the title screen. Play pattern: starter menu, hire the first chef and server offered, "Fill what's short" on day 0, open, watch at 4×, read the evening screen, restock, next day. On events, take the first choice.

### Run A: before the stock fixes (what a new player got)
| Day | Covers / walk-outs | Profit | Notes |
|---|---|---|---|
| 1 Wed | 60 / 0 | −£438 | 5 of 7 dishes auto-86'd by 14:40. £224 of opening stock spoiled. |
| 2 Thu | **8** / 0 | −£952 | Morning order hadn't arrived; whole menu 86'd at open. £392 spoiled. |
| 3 Fri | 39 / 7 | −£891 | Event (oven) shown after evening. |
| 4 Sat | **0** | −£1,029 | Entire menu out of stock, on a Saturday. |
| 5–14 | 0 / 28 / 0 / 18 / 0 / 13 / 0 / 11 / 0 / 10 | always a loss | Strict feast/famine: every other day had zero covers. Cash £10.9k → £5.0k. |

### Run B: after the fixes (evening "Restock for tomorrow")
| Day | Covers / walk-outs | Profit | Notes |
|---|---|---|---|
| 1 Wed | 60 / 0 | −£438 | Opening stock still sells out mid-afternoon; £224 spoilage. |
| 2 Thu | 35 / 0 | −£559 | Clean opening. £331 spoilage (opening stock rotting). |
| 3 Fri | 63 / 12 | −£384 | Weekend walk-outs begin: 6 tables, 1 chef. |
| 4 Sat | 58 / 3 | −£426 | £441 spoilage (last of the opening stock). |
| 5 Sun | 62 / 5 | −£117 | |
| 6 Mon | 57 / 13 | **+£279** | Staff's day off, so no wages. Rating 2.5★ (owner cooking). |
| 7 Tue | 49 / 14 | +£170 | Rating 2.7★. |
| 8 Wed | 54 / 1 | −£33 | Staff back: 4.35★. |
| 9 Thu | 66 / 8 | +£60 | |
| 10 Fri | 71 / 8 | +£122 | |
| 11 Sat | 77 / 5 | +£193 | Popularity 64. |
| 12 Sun | 68 / 4 | +£97 | |
| 13 Mon | 48 / 22 | +£202 | Owner day again: 2.3★, 22 walk-outs, still the 2nd-best profit. |
| 14 Tue | 45 / 11 | +£84 | Cash £12,068 (from £10,917 at open). No JS errors. |

### Findings (ranked)

**P1 (fixed): stock feast/famine.** Orders arrive next morning, but the natural time to order is the morning. The old "Fill what's short" forecast came from yesterday's covers spread evenly over all dishes, including drinks. After a sell-out day it collapsed. Result: half of all days had zero customers. A 12-year-old would have no idea why. Now fixed (evening restock, demand-based forecast). Still worth a tutorial line.

**P1 (open, design): the owner covering is more profitable than staff.** Mondays and Tuesdays (no staff rostered, owner cooks and serves) made the best profits in week 2, despite 2.3–2.8★ and 14–22 walk-outs. Labour is £327/day against roughly £1,000–1,300 takings. The lesson the game teaches is "don't hire". Levers: an owner fatigue/mood cost, a bigger popularity hit from low ratings, or cheaper early staff. Needs sim and content agreement.

**P2 (open): opening stock is a £2,446 loss leader.** Sim-core gives 40 portions of *every one of 62 ingredients*. £1,867 of that is ingredients with ≤5-day shelf life, and most are not on the menu. It all spoils in days 1–4 (about £1,450 binned in run B). Suggest opening stock only for menu dishes, bought at START_SERVICE on day 0, or a smaller amount.

**P2: days 1–5 are always losses** (−£117 to −£559), even played well. Combined with the spoilage above, the first screen a new player sees is "A tough night." four times. Fixing P2 alone roughly breaks even by day 3.

**P2: weekend capacity.** 6 tables and 1 chef cause walk-outs from day 3. The obvious fix (buy a table, £600) is only on the 4th tab, with no hint linking walk-outs to it. Suggest an evening tip: "14 people walked out; another table or a second chef would help."

**P3: confusing moments for a young player.**
- "86" is industry jargon with no explanation on the service screen. Add a tooltip: "86 = take it off for today".
- The menu matrix is empty and abstract until day 2. It is also the first thing on the first screen, above the call to action.
- "Worst dish: Cheesy garlic bread" for 12 days running while it sells fine. Worst is by plate quality, which a cheap starter will always lose. Label it "Lowest quality".
- The rota default (Wed–Sun, Mon/Tue off) is never explained. Day 6 surprises you with "You'll be cooking".
- Review templates from content render correctly ("As Business, we're picky…"). A few read oddly with segment names ("We're Business and…").

**P3: the service view.** It is genuinely nice to watch at 1–2×: queue on the pavement, coin pops, eating/paying colours, the ticker. At 4× it is mostly a progress bar. The kitchen is static (the chef sprite barely moves and stoves only light up). There is no moment where the player *must* act. Comp and 86 are optional and rarely useful once stock is right. Fun to watch: yes, about twice. Fun to play: not yet.

Screenshots (scratchpad `shots/play2` = run A, `shots/play4` = run B): `01-planning-empty`, `svc-day0` (5 dishes 86'd by 14:40), `eve-day0`, `event-day2` (modal over the P&L), `svc-day10`.

---

## 3. Headless — is "premium always wins" a design problem? Yes; now fixed in sim-core.

**Before** (real pack after `a6780ec`, 40 seeds × 365 d, normal, per district):

| | High St | Business | Seaside | Student | Total |
|---|---|---|---|---|---|
| balanced | 10/10, £5.6k | 9/10, £13.8k | 5/10, −£37k | 6/10, £0.3k | 75% |
| cheap (−15%) | 7/10 | 7/10 | 6/10 | 10/10 | 75% |
| premium (+25%, skilled hires) | **10/10, £103k** | **10/10, £146k** | **10/10, £118k** | **10/10, £67k** | **100%** |

Isolating price from premium's other perks (better hires, more stock): balanced hires with +25% prices went from 20/24 to 23/24 survival and the median cash from £4k to £123k. **+25% even raised covers/day (75→83)** because fewer walk-outs meant less popularity loss. It is a design problem. The core management lesson ("pricing is a trade-off") becomes "always charge more", and the price stepper becomes a solved puzzle. It is not just numbers: entry only compares spend with a segment's *budget*. Expensive-but-within-budget costs nothing, and a capacity-limited room never notices the guests it loses.

**Fix (`2ec8fe3`, sim-core, small):** a new `MARKUP_WEIGHT = 8` term in the entry logit: `priceSensitivity × markup × 8`, where markup = Σ menu price ÷ Σ suggestedPrice − 1 (0 at or below suggested). Passers-by now compare you with the going rate as well as their budget. Pricing at suggested is unchanged, so balanced/cheap baselines and the content tuning still hold. I tried a steeper above-budget `PRICE_GAP_WEIGHT` first, but it barely moved premium and hurt balanced in pricey districts. A guard test (`test/pricing.balance.test.ts`) asserts premium does not beat balanced on cash in every district; it fails with `MARKUP_WEIGHT = 0`.

**After** (100 seeds × 365 d, real pack):

| run | survival | covers/day | rating |
|---|---|---|---|
| balanced, normal | **82%** | 73.3 | 4.23 |
| cheap, normal | 72% | 67.4 | 3.90 |
| premium, normal | **52%** | 51.2 | 4.45 |
| balanced, hard (footfall ×0.88, costs ×1.10) | **57%** | 62.0 | 4.03 |
| balanced, cosy | 100% | 93.2 | 4.16 |

Premium is now a risky bet: it still wins in Seaside (tourists, low sensitivity), loses on High Street and in the Student Quarter. Hard went from ≈ normal to 57% (brief: ~50%).
**Content follow-up (not done here, per instructions):** segment `averageBudget`s and some `suggestedPrice`s may want re-tuning now that markup bites. Balanced/normal at 82% is slightly above the 70–80% target. 8 may also be a touch strong for foodies/business; a per-segment weight would be the next step.
**Coordinator item 3:** the headless strategies never let staff go or trim rotas in slow months, so Seaside and Student Quarter winters look harsher than for a real player, who would cut shifts. Add a "cut rota when covers/day < X" rule before trusting district-level survival.

---

## 4. Code review

Overall quality is high. sim-core is clean, well commented, pure, and quick (worst tick 0.4 ms; one simulated year about 0.9 s on the real pack). The contract additions are disciplined and the UI is tidy, with a single door to the sim. No `Math.random`/`Date` in sim-core (there is a test for it), and the input state is never mutated (also tested; I spot-checked every system).

### Blocker
None remaining. Two were found and fixed:
- **Weekday off by two in the UI** (`db7607a`). See §1.
- **Save/load changes results** (`fix: save/load mid-service…`): `bestAndWorst` and `trimPrep` iterated `Object.entries` of tally maps. Reloaded saves have sorted keys, so ties broke differently: 3 of 30 real-pack seeds produced a different `worstDish` after a mid-service reload. Now iterates sorted keys; regression test added. The existing round-trip test missed it because the fixture's ids happen to be inserted in sorted order. **Other `Object.entries` uses** (`arrival.ts` segmentMix, `order.ts` COURSE_ORDER_CHANCE) iterate content/constants, never state, so they are stable. Keep that rule.

### Should fix
1. **Owner-covering beats hiring** (playtest P1, design). See §2.
2. **Opening stock of every ingredient** (`newGame.ts` `openingStock`), about £1.4k spoiled in the first 4 days. See §2.
3. **Prices shown ≠ prices charged.** The Stock tab shows base `unitCost`; the sim charges seasonal ×0.85 and difficulty ×0.9–1.1. Add `orderQuote(content, state, id, qty)` to the public API (gap 10).
4. **`ORDER_STOCK` can't be cancelled**, and duplicate clicks double-order. The planning order sheet's "Place order" has no confirmation.
5. **`foodCostOf` and `recordDishes` use base `unitCost`/`plateCost`**, while the cash actually paid used seasonal/difficulty prices. P&L food cost ≠ money spent on food. Fine for M1, but the evening P&L and the cash line drift apart over a year.
6. **Event conditions use tomorrow, effects apply before `advanceDay`.** `applyChoice` then `advanceDay` is correct today, but `RESOLVE_EVENT` with an invalid id rejects with "That isn't one of the choices". EventModal's "lost the letter" fallback sends `choiceId: ""` and gets stuck in phase `event` forever if content removes an event mid-save. Needs a sim-side "dismiss unknown event" path.
7. **Missing tests for tricky paths** (sim-core coverage is otherwise excellent):
   - a full day that ends in `event` → `RESOLVE_EVENT` → next morning's deliveries landed and 86 list cleared (currently only a hand-built `event` state is tested);
   - game over reached through real play: the evening event deck must not draw after `phase = "gameover"` (it doesn't, `eventDeck.ts` guards it, but it's untested);
   - cosy clamp across several days (the CASH_LOW event fires every evening; the UI doesn't show it at all yet);
   - spoilage boundary (`day + shelfLife ≤ tomorrow`) with multiple batches.
   I added calendar/rota tests and the key-order test only.
8. **Accessibility:** the canvas is the only way to select a table for comping (mouse only; `role="img"`). Add a keyboard list of seated tables in Manager's actions. The service keyboard shortcuts swallow Space even when a button has focus (only `HTMLInputElement` is excluded), so Space on a focused button pauses instead of activating it. Mood is conveyed by emoji plus a coloured bar (OK, has aria-label). Fixed: `--ink-faint` contrast 3.3:1 → 5.0:1. Still below AA: `--tomato`/`--basil` used as text on cream (3.5–3.9:1). Fine for large text, not for `xs`. The canvas `inkFaint` copy was not changed.
9. **`body { min-width: 1024px }`**: the brief targets Switch and the family audience, so there is no tablet layout yet.

### Nice
- Dead code: `unchanged()` in `systems/system.ts` is unused. The `AppState.lastEvents`/`ticksRun` fields only feed the canvas indirectly and are worth a comment. `runDay` is re-exported by the UI but unused there.
- `stockNeeds`/`starterMenu` duplicate the headless strategy's menu and restock heuristics. One shared helper in sim-core (`suggestMenu`, `suggestOrder`) would keep the CLI and the UI honest with each other.
- `menu.ts` `classifyMenu` takes `_content` "for API symmetry"; fine.
- `cookCache` and `coursePools` WeakMaps are keyed by array identity. They are correct because state is immutable, but a future mutating refactor would break them silently. Worth a comment at the top of each.
- Names: `todays` (Partial DayResult) vs `service` (ServiceTally) overlap (both hold covers/tips). `stats.ts` P&L comment and SIM-NOTES agree.
- Vite HMR warnings ("Could not Fast Refresh") come from screens exporting constants (`SPEEDS`, `COURSE_ICON`, `randomSeed`). Moving them to `lib/` makes dev reloads keep state.
- Integer pence: all good. Money is rounded at the end of each calculation. `round2` floats only for mood, reputation and quality.

---

## 5. Is it fun yet?

**Nearly.** The loop is complete and readable. The evening screen is good: the P&L now adds up, reviews are charming, and mood faces work. Watching a service at 1–2× has real charm. But once stock is sorted there are no decisions with tension. Prices are set once, the staff you hire are fine forever, the owner-covers trick beats hiring, and the service needs no input from you. A 12-year-old will enjoy days 1–3, then click "Next day" on repeat.

**Three changes that would most improve it next:**
1. **Make staff matter.** The owner covering should be costly (owner fatigue that hits quality and popularity), and good staff should visibly make better food and faster service. Then hiring, rotas and days off become the core planning puzzle the brief promises ("Restaurants are made of people").
2. **Give service a reason to intervene.** Small live problems the player can solve with one click: a dish running low ("86 it or rush an order?"), a queue building ("send the chef to the floor?"), an unhappy table ("comp it?"). Each needs a cost and a visible outcome. That turns watching into managing.
3. **A first-week goal path plus a gentler opening.** Fix the opening-stock waste so day 1 can be a profit. Add 4–5 guided goals ("Serve 50 guests", "Get a 4★ day", "Make a profit on a weekend", "Buy your 7th table") with a small reward. That gives the young player a reason to come back tomorrow and teaches restock, rota and capacity without a manual.

---

# Round 2: integration, playtest and code review

Reviewer: lead/integration. Date: 8 Nov 2026. Covers sim `6d2cf07`, `30bd60d`, `1570fdc`; UI `d75082e` … `722ddd2`; content `ab81fd1` (staff archetype ranges). Playtests ran on content `a6780ec`. The content commit landed after them and only changes candidate stat ranges.

**Status at the end of this pass:**
- `pnpm -r typecheck`, `pnpm -r test` and `pnpm --filter @full-plate/game build` ✓ for sim-core (138 tests), content (24) and game (52).
- `pnpm -r` also picks up round-3 packages another agent is creating (`handson`, `sim-empire`, `sim-stars`, untracked/uncommitted). `sim-empire` typecheck and `handson` test fail there; that is their work in progress, not this pass.

## R2.1 Integration changes

| Commit | What |
|---|---|
| `2e95af3` integration (sim) | **Contract polish, additive only.**<br>- `INCIDENT_RESOLVED.tone?` (`good`/`bad`/`neutral`, per option; closing time = neutral).<br>- `IncidentOption.disabled?` = a reason, refreshed every tick: no two free tables, no stock to remake, not enough cash, or the person isn't on the floor.<br>- `GOAL_COMPLETED.reward?`.<br>- The incident start LOG is kind `info` with the plain title (no "Whoops, a spill!!").<br>- New `forecastNeeds(content, state)`: the per-ingredient need behind `suggestedOrder`. |
| `36301b2` integration (game) | **The UI forecast is deleted.**<br>- The Stock tab "needed" column = `forecastNeeds`. Restock / Fill what's short = `suggestedOrder`. "Planning for N" = `expectedCovers`.<br>- A test pins that the column and the order agree (order = need − on hand − incoming, in 5s).<br>- `TRAINING_FEE`, `TRAINING_SKILL_GAIN`, `BREAK_TICKS` and `OWNER_FATIGUE_WARNING` are imported directly (no by-name probing).<br>- **Evening P&L:** a "Problems sorted" line (`incidentCosts`). A DOM test reads the rows back and checks they sum to the profit.<br>- **Morning notice** for `shortDelivery`.<br>- **Owner fatigue ≥ 60** card on Planning and Evening, with a Hire shortcut.<br>- **Day 0:** no out-of-stock or "running low" hints; an "opening stock is bought when you open (up to £600)" note; Stock rows say "opening stock".<br>- **TRAIN** is blocked at potential (training-day blocking was already there). **GIVE_BREAK** is disabled while `breakUntilTick > tick` (already there; now tested).<br>- Disabled incident options are real disabled buttons with the sim's reason (`aria-describedby`).<br>- Ticker colour comes from `tone` (the text-guessing is now only a fallback). The goal toast uses the paid reward. |

UI-NOTES contract gaps closed:
- 12: tone
- 13: disabled
- 14 and 15: constants imported
- 16: reward on the event
- 17: info, single "!"

Still open: 8–11 (who serves whom, log subjects, stock quotes, reputation by source).

## R2.2 Playtest

Frozen build served statically. Scripts: scratchpad `shots/r2review.mjs` and `shots/r2kid.mjs`. Screenshots and logs: `shots/r2-review/hs/` (`days.json`, `incidents.json`, `log.txt`, ~40 PNGs) and `shots/r2-review/kid/`. **No JS errors in either run.**

### A. High Street, normal, seed 20261108, 21 days: a first-timer following the goals

| Day | Covers / walk-outs | ★ | Profit | Owner covered | Incidents (kind: choice) |
|---|---|---|---|---|---|
| 0 Wed | 69 / 0 | 4.51 | +£76 | – | spill: mop · big party: push |
| 1 Thu | 39 / 0 | 4.72 | −£154 | – | – (bought a table for the goal) |
| 2 Fri | 78 / 4 | 4.38 | +£192 | – | spill: mop |
| 3 Sat | 62 / 0 | 4.39 | +£71 | – | big party: *ignored* |
| 4 Sun | 62 / 0 | 4.76 | +£47 | – | short delivery: shop · spill ×2: mop |
| **5 Mon** | **15 / 49** | **2.20** | **−£313** | chef + server | sent back ×3 (remake, ignored, remake) |
| **6 Tue** | **10 / 55** | **1.60** | **−£366** | chef + server | big party: decline · sent back ×2: remake |
| 7 Wed | 57 / 0 | 4.72 | +£19 | – | (hired cover chef + server for Mon/Tue/Sat) |
| 8–13 | 70–84 / 0–12 | 3.6–4.8 | −£110 … +£216 | – | rush: call-in ×3, spills, big parties |
| 14 Wed | 76 / 0 | 4.54 | +£211 | – | Train disabled: "Ruby is the only chef on today" |
| 15–20 | 64–104 / 0–11 | 3.6–4.5 | −£113 … +£239 | – | staff wobble: break, push tables, short delivery: ignored |

- **P&L:** `revenue − vat − food − prep − spoil − labour − rent − overheads − incidentCosts − loan = profit` held on all 21 days. The shown rows summed to the shown total on every evening (diff 0), including the 5 days with a £60 call-in.
- **Spoilage:** £0 on 20 of 21 days (one £3.54 day). The opening-stock fix works.
- **Cash:** £13.4k → £13.0k over three weeks.
- **Incidents:** 44 in 21 days (13 spills, 13 sent back, 10 big parties, 5 rushes, 2 short deliveries, 1 wobble).

**Do the goals guide you?** Mostly yes.
- Tier 0 is excellent. "Show me" jumps to the right tab, every step toasts, and the day-0 Stock tab reads "opening stock" with no false alarms.
- **But tier 1 (30 covers, a 4★ day, a profit day, an incident) completed entirely on day 0.** The player gets five toasts in one evening, and tier 1 teaches nothing.
- Tier 2 then asks for a profit *week* straight after the Mon/Tue owner days, which wreck it. That is right in spirit ("Days off for staff need cover!"), but it took until day 13.
- "Buy a new table" was done on day 1 because the goal said so, before any walk-outs. The goal teaches the wrong trigger.

**Are incidents meaningful and legible?** Legible: yes. The card, ring on the table, countdown, outcome in the ticker, and the evening list all agree, and auto-pause at 2× lands on the right tick. Meaningful: only partly.
- Spills (13) are a free click every time. "Grab the mop" has no downside a player can see.
- Sent-back plates appear almost only on owner-cook days (12 of 13). That's a nice signal, but "Cook it again" always wins.
- Big party "Push two tables" was disabled (no free tables) on 7 of 10. The new disabled reason makes that clear instead of a refusal toast.
- **Rush "Call in extra help" (£60) is the only real trade-off**, and it shows on the P&L as "Problems sorted".
- Ignoring had visible but small costs ("Sticky shoes all round"). No ignored incident ever changed a day's result in a way the player could see.

**Owner-only days (Mon/Tue, nobody rostered): the evening teaches the lesson.**
- "You covered the kitchen and the floor yourself today. Day 5, with a full team: 62 served, 0 walked out, 4.8★. Today: 10 served, 55 walked out, 1.6★."
- Plus "You're worn out (91/100)" with a red bar and Hire →.
- The service banner and the morning hints ("No chef on for Mon — you'll be cooking") warn beforehand.
- After hiring cover, fatigue fell 91 → 66 → 41 → 16 → 0 and the warning went away.
- This is the round-1 P1 fixed: owner days now cost −£313/−£366 instead of being the best profit of the week.

### B. Seaside, cosy, 7 days: a 12-year-old (big buttons only, ignores every other incident)

| Day | What they did | Result |
|---|---|---|
| 0 | starter menu → pressed "Open for service" with **no staff** | 8 served, 39 walked out, 1.5★, −£231 |
| 1 | goal "Hire a chef" → Show me → first green button | hired a chef ✓; 63 covers, +£251 |
| 2–6 | goal "Hire a server" → Show me → first green button | **hired a chef every day** (5 chefs, 0 servers); worn out 100/100 from day 2; owner served every day; day 5 (Mon, nobody rostered) 9 covers |

**Dead end found and fixed (`e25b8d8`).**
- "Show me" for "Hire a server" opened the Staff tab. The first green *Hire* button there was always a chef, so the kid hired chefs four days running while the goal never moved.
- The Staff tab now lists the goal's role first, with an amber "🎯 The server your goal asks for" banner.
- Opening day 0 with no staff now asks once ("Open with nobody to help?" → **Hire someone first** / Open anyway).

Other notes from the kid run:
- Ignoring every other incident cost little: cosy, and ratings stayed 3.7–4.5★ on staffed days. Cosy is forgiving as intended.
- The fatigue card stayed at 100/100 for five days. The kid can't see *why*: they did hire, but not a server. With the fix, the goal leads to a server.
- The evening copy is read-at-a-glance friendly. "A tough night." / "What a night!" plus big numbers work.

### Findings by severity

**Fixed in this pass**
- **P1:** Hire-goal dead end (above).
- **P2:** `ownerCovering` was never live (SIM-NOTES promised it updates during breaks). A lone chef's break left the banner off and the owner "not cooking" (`a4e9fa0`). Evening `ownerCovered` and fatigue now use the rota (`rosterGaps`), so a 6-tick break isn't "you ran the place yourself".
- **P2:** Corner-shop outcome read "You bought 3 stock from the corner shop" (`d0598bd`).
- **P3:** The table goal pointed at a non-existent "Tables tab" (`5168c02`).
- **P3:** Auto-pause didn't move focus to the incident (`f307c77`).

**Open, design (next round)**
- **P2: tier 1 goals complete on day 0.** Raise tier 1 (e.g. 60 covers, a 4.5★ day, a profit *weekend*) or require `daysOpen ≥ 3`. "Buy a table" should wait for walk-outs (e.g. measure "a day with ≥ 5 walk-outs, then buy").
- **P2: most incidents have a dominant free option** (mop, remake). Give each free option a real cost the player sees: mopping pulls the server off the floor (it does, −0.5 actions × 4 ticks, but that's invisible), remake uses stock and a chef. Show the cost in the description ("Shreya is busy for 20 min"). Or make "leave it" occasionally right.
- **P3:** The owner-day comparison is great but only appears after the damage. The morning hint could quote last week's owner day ("Last Monday: 10 served, 55 walked out").
- **P3:** "What happened today" lists porter-handled spills as "Your porter handled it". It's fine, but a porter isn't hireable until it appears in the candidate pool.

## R2.3 Balance (coordinator request; content agent finished)

**Changes (`7eaae07`):**
- `DIFFICULTY.hard` = footfall 0.80 / costs 1.20.
- `STRATEGIES.cheap` hires like balanced (menu 6, by value, cover at £1.5k).
- New **`typical`** headless owner, the headline "normal" number: menu of 8, overstocks (2 days), never trims the weekend rota, hires cover only after 6 owner-covered days of a role, answers only every other incident.
- **Porter:** +0.5 FOH actions/tick; mops spills before they need a decision; the free fryer fix is as fast as the engineer.

**Headless, 100 seeds × 365 days, real pack, 25 per district:**

| run | survival | covers/day | rating | month-12 p10 / median / p90 | Student / High St / Business / Seaside |
|---|---|---|---|---|---|
| **typical, normal** (headline) | **83%** | 90.3 | 4.23 | −£36.1k / £48.4k / £92.1k | 21 / **13** / 24 / 25 |
| balanced, normal | 100% | 87.5 | 4.42 | £14.2k / £18.1k / £59.8k | 25 / 25 / 25 / 25 |
| balanced, **hard** | **45%** | 66.2 | 4.42 | −£35.9k / −£21.9k / £5.0k | 14 / 7 / 16 / 8 |
| balanced, cosy | 100% | 105.6 | 4.37 | £34.1k / £92.0k / £138.2k | 25 / 25 / 25 / 25 |
| cheap (0.85×), normal | **71%** | 79.0 | 4.48 | −£31.6k / −£1.8k / £9.5k | 21 / 18 / 24 / 8 |
| premium (1.25×), normal | 98% | 62.0 | 4.56 | £11.8k / £19.3k / £47.8k | 24 / 24 / 25 / 25 |
| nohire, normal | 0% | 11.1 | 1.86 | −£10.2k / −£7.1k / −£5.8k | 0 / 0 / 0 / 0 |
| typical, hard | 0% | 50.5 | 4.20 | −£43.3k / −£35.2k / −£25.2k | 0 / 0 / 0 / 0 |

**Reading it:**
- Hard ≈ target (~50%).
- Cheap is now a real but riskier strategy. Seaside cheap is 8/25: tourists don't reward low prices.
- **Typical is 83%, 3 points over the 70–80% band**, and its failures are almost all High Street (13/25). Variants I tried (later cover hiring, more overstock, earlier weekend seconds) all stayed at 81–83%. The script's remaining strength is that it still restocks perfectly and never misprices. A truly typical player probably lands lower. I'd accept 83% for now and re-measure once a player-telemetry or "careless restock" model exists.
- **Typical on hard is 0%.** Hard is for players who play well; worth saying on the New Game screen.
- **I did not change `MARKUP_WEIGHT` to a district going rate.** It needs a new content field (or a derived per-district average) and re-tuning every price-related number. It isn't a small change, and with `typical` as the headline, balanced being the anchor no longer distorts the target.
- **Porter: still doesn't pay back.** Median 28-day Δcash from day 60 over 16 seeds: −£2.4k for 7 days (was −£3.7k), −£1.3k for weekends only. Doubling its FOH bonus to +1.0 made *no* difference: the floor isn't the bottleneck once a server is on. A porter needs a kitchen effect (e.g. +10% kitchen throughput or prep-waste reduction) or a lower wage band. That's a design call, listed below.

## R2.4 Code review

Overall: round 2 is careful work. Incidents, goals, the opening stock and the FIFO cost basis are pure, well commented, and tested from several angles. The P&L reconciliation test (cash spent on stock = food + waste + Δstock value) is exactly the right test.

**Determinism**
- Incident draws all go through the seeded `Rng` passed to the system. Detection order is fixed (`KINDS`), and option order is fixed by `optionCosts` object literals.
- Short deliveries and training use their own seed+day(+staff index) streams, so planning commands don't shift the main RNG.
- Goal evaluation iterates the stored `goals` array, which is built from the fixed `GOAL_LADDER` order. It's stable, and idempotent (re-running `updateGoals` is a no-op; tested).
- Tie-break hazards: `pushTables` sorts arrivals by `potentialParties`, then `segment` (stable); `rush` sorts by `prepTicks`, then `id` (stable).
- No `Object.entries` over state maps in the new code.

**Mutation**
- New test `purity.frozen.test.ts` deep-freezes *every* state handed to the sim over 10 real-content days with incidents (all answered), a break, a training day and restocks. Any write throws in strict mode; I verified that by injecting one.
- The existing check only serialised input before and after one `runDay`.

**Integer pence**
- Cash, costs and DayResult lines are integers. `tally.foodCost` and `incidentCosts` are floats that are rounded once in `buildDayResult` (documented).
- Batch `cost` per portion is kept to 4 dp, and the reconciliation test covers it.
- One nit: `spendCash` subtracts `cost` from cash unrounded. All option costs are integers today, so it's fine, but worth an `isInt` assert.

**The fixed-shape state (`canonicalState`)**
- It was correct but fragile: a new GameState field not listed there would be silently dropped on every service tick. It is now typed `{ [K in keyof Required<GameState>]: … }`, so forgetting one is a compile error (`2b2ff36`).
- Does it help? I measured with process CPU time, interleaved (another agent was running sims on both cores). With and without it, the times were within noise (±5%). The −20% in SIM-NOTES was probably measured before other changes or on a quieter box. It's harmless and now safe, so I kept it.

**Perf: target ≤ 30 s for 100 × 365 not met by a code fix. Honest result:**
- Same bundled bench and same content, interleaved CPU time:
  - M1 sim (`39854c4`): **1.87–2.08 s** per 3 seeds;
  - round 2: **2.54–2.71 s** (×1.35).
- 100 × 365 balanced took 64 s wall on this box during this pass. Both cores were shared with the content agent's sims, so that isn't comparable to the 35–37 s in SIM-NOTES.
- **The profile is flat.** The top self-time is GC at 11–27% (load-dependent). Then `runSystems` dispatch is 6%, and `takeStock`, kitchen, clearing, seating and order are 3–5% each. Incidents (start, respond, build) total ~7% inclusive, and the headless incident policy is another ~3%.
- I tried two candidate hotspots and **reverted both**:
  1. Consuming stock into one per-run copy of the stock array, plus a row index (removes an array copy per ingredient per plate). It cut GC scavenges ~4%, but CPU time was not distinguishable from noise.
  2. Memoising `offeredDishes` per menu identity.
  Neither is a clear win, and both add aliasing rules.
- The remaining cost is structural: ~9 immutable `{...state}` copies per tick, each now carrying 6 more fields, plus the new incident and owner systems, plus ~4% more covers.
- Real options for the next round:
  - (a) run headless with `--workers` on a 4+ core box;
  - (b) fold floor/incident upkeep into one system and skip it when nothing is live;
  - (c) give `ServiceTally` a mutable per-tick builder internal to `tickService` (copy once per tick, not per system).
  - (c) is the one that would get under 30 s, but it's a careful refactor, not a review fix.

**Missing tests (added)**
- The forecast column agrees with the order.
- DOM P&L sum.
- Day-0 hints.
- Short-delivery notice.
- Fatigue threshold.
- Disabled options (sim and UI).
- tone, reward.
- Live owner covering on a break.
- Corner-shop text.
- Porter effects.
- Hire-goal ordering and the no-staff confirm.
- Deep-frozen purity.

**Missing tests (still)**
- A VIP walking out (prestige −5) through real play.
- `equipment` ignored for 30 ticks.
- Two incidents live at once in the UI (layout).

**Accessibility of the new panels**
- **Incident cards:** `section` labelled by the title and now described by the body. The timer is a `meter`. Options are real buttons with cost text. Disabled options carry their reason via `aria-describedby`. Auto-pause now focuses the first available option (`f307c77`).
- **Still open:** the countdown isn't announced, and at 4× (no pause) the only cue is a polite toast. A `role="alert"` on the card's title when it appears would be stronger, but noisy. Leave it to a settings toggle.
- **Goals card:** good. Meters with labels, "Completed" in sr-only text, and a collapsible with `aria-expanded`.
- **Staff strip:** good. Break buttons have names ("Give Ada a break" / "Ada is on a break"). The fatigue bar has only a `title`; `Bar` passes it as `aria-label`, so it's fine.
- **Fatigue note:** `role="note"`; the bar is labelled.
- **The no-staff confirm** is an inline `alertdialog` with autofocus on the safe choice.

**Smaller observations**
- `INCIDENT.spillIgnoredDirtyTicks` is unused. Either drop it, or make an ignored spill leave the table dirty (which would give "leave it" a visible cost).
- `maybeStart` repeats its `INCIDENT_LAST_START_TICK` / max-per-service guards twice (harmless).
- The `headless` CLI runs `main()` whenever `process.argv[1]` ends at the bundled file. Bundling it into a bench re-ran the full CLI. Export-only use should guard on `isMainThread` plus an explicit flag. That cost me a stray `out/balance.csv` (gitignored); worth a line in the CLI docs.
- `smoke.test.ts` asserts a 365-day fixture run under 3 s. Under load it ran 2.7 s at HEAD and failed once. It's a flaky perf assertion in the unit suite: raise it to 6 s or move it to a bench.

## R2.5 Is it fun yet?

**Getting there. Round 2 fixed the two things that made it not a game.**
- **Staff now matter.** The owner-only Monday is the most memorable moment in the 21 days: 55 walk-outs, 1.6★, a red fatigue bar, and an evening card that tells you exactly why. Hiring cover then visibly fixes it.
- **Service has decisions.** A card pops, the game pauses, you pick, the outcome is in the ticker and in the evening's "What happened today".
- The first day is now a gentle profit with no spoilage.

**It isn't fun yet** because most decisions don't *cost* anything you can see. Mop and remake are free and always right. Spills and sent-back plates are 60% of incidents. After week one the planning screen has nothing new to ask: the rota is set, the stock is one button, and the goals are "survive 30 days". A 12-year-old will play a week happily (more with the hire-goal fix), then start pressing 4× and "Next day".

**Next three improvements**
1. **Make incident choices trade-offs with visible costs.**
   - Every option should name its cost in the player's terms ("Shreya leaves the floor for 20 min", "uses one more Burger", "−£60").
   - Ignoring should sometimes be right (an ignored spill keeps the table dirty for 3 ticks, so a full room matters; `spillIgnoredDirtyTicks` is already defined).
   - Fewer spills, more rushes and VIPs (the ones with real choices).
2. **Re-pace the goal ladder** so each tier teaches one thing over a few days:
   - tier 1: within 3 days;
   - "buy a table" only after a walk-out day;
   - a "train someone" goal;
   - a "survive a quiet week by trimming the rota" goal for month 2.
   Goals are the main reason a young player comes back tomorrow.
3. **A weekly rhythm.** A Sunday-evening "week in review": the profit week chart, best and worst day, and what the owner days cost. Ask one question for next week (raise prices / add a table / train / change the menu). Then the planning screen has a fresh decision every 7 days, and the "Make a profit over a whole week" goal has a screen that explains it.
