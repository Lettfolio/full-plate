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

---

# Round 3: integration review, playtest and code review (paths, career, hands-on)

Reviewer: lead. Date: 9 Nov 2026. Covers `5595be2` … `92be4fb` (the four round-3 packages, content extras, the sim-core hooks and the game integration). Fixes are `e0551c6` … `5958473`, one commit per fix.

**Status at the end of this pass:**
- `pnpm -r typecheck` ✓ (7 packages).
- `pnpm -r test` ✓: sim-core 185, content 51, handson 46, sim-career 57, sim-empire 51, sim-stars 57, game 77 (524 in all; +30 this pass).
- `pnpm --filter @full-plate/game build` ✓. No chunk over 500 kB; the largest is 154 kB.

Scripts and artefacts are in the scratchpad:
- `shots/r3kid.mjs` (career), `shots/r3paths.mjs` (Empire/Stars), `shots/r3fork.mjs`
- `r3rev/*.ts`: the headless repros
- `shots/r3-review/`: screenshots, `log.json` per run, the real-play saves `fork-real`, `empire-start`/`y1`/`y2`, `stars-start`/`preguide`

## R3.1 Blockers

### 1. Stars consistency ≈ 0 (`e0551c6`): fixed

**Reproduced** in two ways:
- the integration agent's year-2 save (`guide.json`): consistency criterion 0.45, guide score 36.7;
- a fresh run: a sim-core `balanced` owner plays year 1 on seed 3 Seaside, then `newStarsState` at day 365. Steadiness was 12–26, criterion ≈ 18, and guide day 660 scored 52.3.

**What it wasn't.** The 60-day window was behaving:
- it takes open days only (`result.covers > 0 && !isClosed`);
- it is empty at the fork;
- a `CLOSE_TODAY` `DayResult` (covers 0) never enters it.

Regression tests now pin all three.

**What it was: the scoring formula, fed by a real year-1 rota.**
- A typical owner has one strong chef Wednesday to Sunday (quality ~85). On Monday and Tuesday a weak second chef or the owner cooks (~40).
- The window reads `85 85 85 85 85 38 24 …`: sd 25 and 28% off nights.
- `100 − 3·sd − 60·off − …` scores that at exactly **0**, the same as a random kitchen. No amount of quality on the other five nights could earn a star.
- The fixture's window and its weekday pattern are in `test/fork.consistency.test.ts`.

**Fix (sim-stars plus a little UI):**
- `CONSISTENCY_SD_WEIGHT` 3→2 and `CONSISTENCY_OFF_WEIGHT` 60→40. Both terms measured the same dips.
  - A two-speed week now scores ≈ 31 (still bad).
  - With a decent cover chef it scores ≈ 77.
  - A steady brigade scores ≈ 98, the same as before, so the day-0 headless is unchanged (score within 0.3 per year).
- The window now records its sim days (`consistencyDays`). `starsView().weakNights` names the weekdays that drag steadiness down.
- The Stars tab says: "Your Monday and Tuesday nights cook about 45 points worse than the rest of the week… put a stronger chef on, or close them".
- Planning has a **Close tonight** button for Stars owners. It takes everyone off today's rota, then sends `CLOSE_TODAY`.
- Sourcing relationships no longer decay on a regular day off. They decay only while shut for a refit.
- `headless --fork-day 365 --year1 balanced|premium|typical`: a sim-core owner plays year 1, then the Stars script takes the restaurant over (`ScriptedRun` `opts.from`).

**Confirmed against STARS-NOTES' claim.** 15 seeds were forked at day 365 (balanced and premium year 1; the typical seeds went bust in year 1):

| | first guide (day 660) | ★★ | ★★★ |
|---|---|---|---|
| balanced year 1, seeds 1–8 (7 survive year 1) | **★ on all 7**, scores 81.1–89.2 | seed 1: game year 3 | seed 1: game year **4** |
| premium year 1, seed 3 (printed in full) | ★, score 82.6 | year 4 | year **5** |
| all 15 surviving seeds (balanced 1–8; premium 3–10) | — | — | peak ★★★ in **15/15** |

- The first-guide row was re-run without `--quiet` for all balanced seeds. Peaks for the rest come from the 6-year `--quiet` runs. 0 dynasty wins within 6 years, by design.
- That is **slightly faster than STARS-NOTES' "★★★ by ~year 6"**, because a forked restaurant already has a skilled chef and high prestige.
- Stars is still open question 1 in STARS-NOTES (thresholds 78/85/91). I left them alone: the first star at the first guide day is what a child needs to see.

**In the game** (real reducer play, seed 2026 High Street; `stars-preguide.json`):
- Steadiness 98 at guide day, and the envelope gave **no star at 69.3**.
- Why: the scripted owner kept the bistro menu (technique 54, personality 48). The rule doing its job.
- STARS-NOTES' perfectionist path (technical dishes, partners, signatures) is what earns the star.
- The envelope reveal works. The badge keeps last year's stars until it is opened. The inspector table, per-criterion scores and the reason line all show.

### 2. Empire opening finances (`90aff28`): fixed (bank rule, not the defaults)

**Reproduced.** Balanced year 1, then fork with £500k: enter Velmont (£572k, new country) and three company builds (3 × £242k). HQ went to **−£798k on day one**.
- The *defaults* are fine. Two home-city company sites take HQ to +£60k, and HQ compounds to +£243k in two years.
- The problem was that `spendable()` allowed the full £1m development facility with one site trading.

**Fix:**
- `developmentFacility(e)` = £150k per open site, capped at half the credit line. The full £1m needs about 7 sites. `spendable` uses it.
- EmpireTab shows a **HQ can spend** KPI with the facility.
- These buttons are disabled when HQ can't pay, with an inline "Needs £X; HQ can spend £Y" and a tooltip on how to get more: Enter city, Localise, company build, buy plot, research, both campaigns and product launch.
- A warning appears when entering a city would leave too little to build there.
- The overdraft callout now gives the monthly interest and the bust line.

**Headless 10 y × 5:**
- franchise-fast is unchanged (4/5 regions wins at year 4.2–4.6);
- company-steady grows a bit slower (4/5 seeds reach 4 regions, none win);
- In-N-Out is unchanged.

**Over-expansion is still possible and visible.**
- Entering Velmont is allowed at fork (£650k spendable). It leaves £78k and a red note that you can't build there yet.
- The overdraft then costs about £6k/month on the strip.

### 3. Fork trigger with real play (`9458cb6`): tuned

**Method.** Year 1 played through `appReducer` itself: sim-core strategies issue the commands, ticks run one at a time, and the strategy answers incidents. 16 runs (typical, balanced and cheap; four districts). Script: `r3rev/forkrun.ts`.

**Before:**
- Every survivor had popularity 78–95 and 178–329 profitable days at day 364.
- So **the card appeared on day 365 for all of them**, including a typical owner with **£83 in the bank**, whom the consultant told "your numbers are good".
- Popularity ≥ 60 is cleared by month 2, so it isn't a milestone on its own.

**Change:**
- The milestone also needs the **last 28 days to be in profit**.
- `forkMilestone().missing` says what to work on. An evening card on Sundays in year 2 shows it ("People in the trade are watching… when you make a profit over the last four weeks").

**After:**
- Good owners still get the card on day 365.
- The £83 owner gets it on day 402, once back in profit.
- Loss-making cheap owners don't get it while losing money.
- Year-1 busts never see it.

**In the UI** (real-play save): the card appears on the evening of day 365, reading "Rosie's has made a name for itself (popularity 93)" (`paths/02-fork-real-evening.png`).

## R3.2 Other fixes in this pass

| Commit | Fix |
|---|---|
| `6190319` | **P1: the career hands-on chef never got a ticket.** In the playtest the rail read "No tickets" all shift: 0 plates and ☆☆☆ every day, while `perChef.player` showed **54 plates at quality 9**, because the sim was cooking for the child. Two causes. (1) sim-core's `cooksOnShift` treated the career player's rostered Staff record as an AI cook. Now the hands-on `staffId` is excluded, with an owner fallback if they were the only chef. (2) A ticket the human grabbed was still unassigned in the sim. After the 4-tick reserve fallback an AI chef plated it, and the child's plate was binned as a drop. New **`PLAYER_CLAIMED { ticketId }`** (handson emits `TICKET_CLAIMED` on a fridge grab) holds it for `HANDS_ON.claimTimeoutTicks` (16) and releases it when hands-on stops. Headless with the bot: 12–13 plates at 78–84 (★★); an idle child is fully covered. 3 tests. |
| `7968fc4` | **`HIRE_STAFF { staff }` in sim-core.** Planning only; same fee and cash buffer as HIRE; keeps who they are and starts mood, fatigue, rota and hiredDay fresh; rejects duplicates and bad records. The game's Staff tab lists **Old colleagues** (top 4 bonds) after a career handover. Candidate cards now show the game's own recruitment fee: the manager's cheaper-hiring perk was invisible. |
| `77691d9` | **The hands-on score feeds the weekly review.** `stepCareerDay(…, handsOn?)` tallies stars and quality into the week. The review adds (mean stars − 1) × 0.15, clamped −0.15…+0.3, and a note ("your plates averaged 88. Brilliant."). The game reports the running score before each sim tick and on Skip. |
| `fd22121` | **Code-split** (see R3.4). |
| `c887681` | **Reload during a hands-on shift**: the envelope dropped `meta.handsOn` but kept `GameState.handsOn`, so sim-core went on holding plates at the pass for nobody. `load` now clears it. |
| `36d0b21` | The path packages import `Rng` from sim-core's index; their relative `../../sim-core/src/rng` imports are gone (all four NOTES asked for this). |
| `22bc017` | HandsOnShift: `getBoundingClientRect` of null when a dispatch inside the rAF frame ended the service (2 page errors per week). The career evening on review day said "A day off" with £0 after a worked shift (the week tally is already reset), so it now asks the rota. The checklist showed "Average review 0.0 / 3.2" before the first review; it now says "first review in N days". `?autopilot=0–1` lets the handson bot play the canvas. |
| `5958473` | The Stars strip read "⭐ ☆☆☆", and the emoji looked like a first star; it is now "The Stars · ☆☆☆". Also "1 site" singular. |

## R3.3 Playtests (frozen build, `http-server dist-r3`)

**P&L sums.** Every evening's shown rows summed to the shown total on every owner, Empire, Stars and refit evening I saw (diff 0, 8 rows each, 7 evenings). The payslip arithmetic is right: £635.50 + £42.26 − £87.21 − £31.50 − £300 = £259.05. No page errors in any run after `22bc017`.

### A. Apprentice chef, 7 days, cosy: a 12-year-old
Played twice:
- **Kid keyboard pattern** (`kid/`, before the fix in `kid-before/`): walk, tap and hold E in turn.
- **In-game bot at skill 0.55** (`kid-bot/`, after the fix).

| Day | Worked | Hands-on (bot 0.55) | Evening |
|---|---|---|---|
| 1 Wed | ✓ | ★ · 416 pts · 5 plates · 88% | 76 covers, 4.3★, place +£69 |
| 2 Thu | ✓ | 166 pts · 2 plates | |
| 3 Fri | off | — | "A day off" |
| 4 Sat | ✓ | 84 pts · 1 plate | |
| 5 Sun | off | — | |
| 6 Mon | ✓ | 83 pts · 1 plate | |
| 7 Tue | ✓ | 83 pts · 1 plate | weekly review **3.8**: "Hands-on shifts this week: plates averaged 89. Keep practising the timing.", payslip +£259 |

**Is the loop clear?** Mostly.
- Start picker → My shift (today's status, the 4 meters, the week's toggles, the checklist, co-workers, savings) → Start my shift → Watch / **Play my shift** → evening (pay, tronc, the hands-on card with a coaching tip, meters, team) → Next day.
- The Sunday payslip and review are the best moment: real UK numbers that a child can follow line by line.

**Is the hands-on shift fun and legible?**
- Legible: yes. The rail shows the table number and dishes; the arrow and the bottom hint ("Oldest ticket: Chips for table 2 — grab it from the fridge") lead you; "Service! T6 89%" pops; stations glow.
- Fun: the first ~40 seconds are, then **the rail empties**.
  - The AI chef has 3 tickets of capacity and the human keeps only 3 reserved, so a slow child gets 1–5 plates a shift ("All caught up — wait for the next ticket").
  - After day 1 the bot only got 1–2 plates, because each shift restarts at 12:00 with the full 120-tick service and the bot runs at 1.5 s/tick, but the career AI chef and owner clear the rush.
- **P2:** a commis should *own* a station (starters and desserts, say) rather than race the head chef for the oldest ticket.

**Does the promotion checklist make sense?**
- Yes: "Cooking skill 22/36, Shifts at this rung 4/50, Average review, Owner's confidence 59/50 ✅".
- But **50 shifts ≈ 12 in-game weeks** for the first rung is long for a 12-year-old, and the checklist never moves the skill bar visibly (+0.6 a week).
- **P2:** show "+0.1 skill" chips per shift and halve `shiftsAtRung` for the first rung on cosy.

**Dead ends found:**
- **P1 (fixed `6190319`):** hands-on chef never got a ticket.
- **P2 (fixed):** "A day off" on a worked review day.
- **P3 (fixed):** "0.0 / 3.2" review.
- **P3 (open):** "Ask for a promotion" is greyed with no reason shown; it needs a tooltip ("Tick every box first").
- **P3 (open):** the Watch screen offers both "Play my shift" and speed controls; a child at 4× who then presses Play starts mid-afternoon with an empty rail.

### B. Owner → Empire, two years after the fork
**Setup.** Real reducer play: seed 2026, High Street, balanced year 1, fork on day 365, brand "Rosie's Burgers". A sensible player each week:
- lock the formula;
- sweep the till above £10k;
- company at home when affordable, otherwise franchise to applicants;
- enter Kingsbridge after ~10 months and Velmont after ~14;
- refranchise a company site.

Saves: `empire-start`, `empire-y1`, `empire-y2`.

| | sites (co/fr) | HQ cash | HQ net/month | meals | flagship till |
|---|---|---|---|---|---|
| fork | 1 (1/0) | £500k | £0 | 0 | £51k |
| +1 year | 4 (1/3), 3 building | £924k | £17.7k | 203k | £13k |
| +2 years | 7 (1/6) | £850k | £38.2k | 655k | £16k |

**Money moves make sense:**
- a franchise fee is £35k to HQ;
- a refranchise is £243k (fee + book value);
- Velmont entry is £589k (the new-country premium);
- transfers from the till are visible as news lines;
- the evening card's "Sweep £50,252 from the till to HQ" moves exactly that amount.

**Header strip:** sites with a "(+3 building)" note, meals, HQ, franchisee mood 52–54.

**Map:** pies at Harbourton · 4 and Kingsbridge · 3, the building dot, the Isles recognition bar at 33; the Velmont/Qamar city panels show their rules.

**Aggregate vs flagship: P2, plausible but generous.**
- The flagship sim does **£676k/yr** (122 covers/day). Its own aggregate site agrees (£667k): the calibration holds.
- But the franchised sites model at £0.81–1.66m/yr: **1.2–2.5× the flagship**.
- The breakdown (`r3rev/probe4.ts`):
  - standardisation 50 after locking the formula gives throughput ×1.24 (Speedee);
  - Harbourton recognition 33 gives ×1.16;
  - the Student Quarter's footfall 112 vs High Street 74 gives ×1.51.
- So the Campus site models at 2.3× the flagship's demand on day one.
- Each factor is documented in EMPIRE-NOTES and has a real-world anchor. But a player who "runs it hands-on" will see a 120-cover restaurant that the map claimed was doing 250. EMPIRE-NOTES open question 3 (seat cap) is the real issue.
- **Suggestion:** cap aggregate covers at the focused sim's seat capacity × turns until a "counter service" mode exists, or show the map's numbers as "with drive-thru/app" potential.

**Over-expansion.** Entering Velmont on day 1 is allowed and leaves £78k with a red warning, so the risk is real but visible.

### C. Owner → Stars, to the first guide day
**Setup.** Real reducer play: the same seed-2026 fork, then Stars. Saves: `stars-start` (day 366) and `stars-preguide` (day 658), played to guide day 660 in the UI.

**Day 366:**
- **Tasting menu** "Spring in the Garden" (£75, in season): Serve it → "on tonight", and the pill flips.
- **Test kitchen** "Build · £8,000" and **sourcing** "Sign · £10/day" work. The cost is paid at once, so the header cash is honest.
- The evening P&L that day was −£227 (the test kitchen's £8k is outside the P&L, as it should be: it's capital).

**Refit:**
- "Close for a 60-day refit" → the openbar reads "Closed for the refit — next day →".
- The closed evening P&L: rent −£126.67, bills −£80, loan −£41.10, spoilage −£156.04, wages £0 (rota cleared first) = −£403.81. It sums.

**Pre-guide (day 658):**
- steadiness 98, stress 28, inspection season, three rumours (decoys and real visits are indistinguishable, as designed);
- Toque 10/20, Good Table 4/10, local critic ★★★.

**Envelope (day 660):**
- sealed; the badge stays on last year's stars;
- Open → "No star this year, but the guide says it is 'watching with interest'. The guide holds you where you are (score 69.3)";
- two inspectors are shown with per-criterion scores. Consistency was 100 on both: blocker 1 is fixed in the real game.

**P1 open: a stock-out around guide day.**
- The evening of day 659 and day 660: **4–6 dishes 86'd at open**, 26 covers, then 0.
- Cause (`r3rev/probe5/8.ts`): stock simply ran out because nobody pressed Restock in my Playwright run. It's the same feast/famine as round 1, not a Stars bug.
- When the evening Restock is pressed, covers stay at 96–114.
- But a Stars player who stops restocking for one evening loses an *inspection-season* service with no warning that it matters more now.
- Suggest: on Stars, auto-restock (a standing order) or a louder evening nudge in inspection season.

## R3.4 Code review

**Determinism**
- `c887681` `envelope.determinism.test.ts`: in each of owner, career (owner answering incidents each tick), Empire (a site building) and Stars (sourcing signed), save 37–60 ticks into a service, decode, then continue 2–3 days through the reducer. The envelope **and** the empire's own serialisation are byte-identical to the run that never reloaded.
- The game only autosaves at tick 0, but a crash mid-shift is now covered.
- The one leak found (a stale `GameState.handsOn` after reload) is fixed.

**No `Math.random`/`Date` in sim packages**
- grep: none outside the headless CLIs and sim-empire's `benchmark()` (`performance.now`, perf only).
- Each path package now has a source-scan test (`purity.frozen.test.ts`), and the four relative `rng` imports are gone.

**Mutation**
- The round-2 deep-freeze idea is applied to every path step:
  - `stepStarsDay`, `applyStarsEffects`, `prepareService` and 11 Stars commands;
  - `forkFromGameState`, 120 days of `stepEmpireDay` with a focused `DayResult`, and 11 Empire commands;
  - a career fortnight in the game's call order (beginCareerDay → service with owner responses → stepCareerDay → finishCareerDay);
  - 20 s of bot hands-on per role.
- **No writes found.**
- sim-empire's engine uses an internal `draft()` with in-place mutation. It is correct: draft copies every nested array/map it touches, and the test now guards it.

**Bundle**
- Before: one 784 kB entry. After `fd22121`:
  - entry 152 kB, content 154, react 142, paths 121, sim-core 93;
  - HandsOnShift 64 (handson is in it);
  - each path/career screen 2–22 kB, loaded with `React.lazy`.
- The path *sims* stay eager because the reducer and the save envelope call them synchronously; splitting them would need an async reducer step.
- No warning.

**Hands-on → career link**: done (`77691d9`).

**HIRE_STAFF**: done (`7968fc4`).

**Bigger issues (not fixed; listed by severity)**

**P1**
1. **Aggregate sites model at 1.2–2.5× the flagship** (R3.3 B). Promoting a site to hands-on will look like a collapse. Needs a seat/turn cap or a counter-service mode in sim-core.

**P2**
2. **The commis competes with the head chef for the oldest ticket.** A hands-on child gets 1–5 plates a shift. Give the commis a station (starter/dessert tickets) in `reservedForHuman`.
3. **sim-empire's `calibrate` inherits the owner's rota** (EMPIRE-NOTES open question 4). Weekday profile 0.88 on Monday. Calibrate on fully staffed days.
4. **Stars: the scripted owner's bistro menu scores 69** with perfect steadiness. A real player won't know that *technique* means "cook harder dishes". The Stars tab should show which criterion holds them back, using `pastVisits` from last year (allowed) and "technique comes from ambitious dishes" copy.
5. **FOCUS_SITE builds a fresh GameState with the flagship's staff copied** (UI-NOTES "Stubbed"). `HIRE_STAFF` now exists; a `newGameFromSite` would make promotion honest.
6. **The `hire` and `hireStaff` affordability checks are duplicated** in StaffTab's CandidateCard. Expose `hireCost(state, wage)` from sim-core.

**P3**
7. `ForkCard` copy says "Year two · a week to remember", but `FORK_DAY = 365` is the *start* of year 2 by the game's own date label ("Year 2"). The BRIEF says end of year 2. A design call; 365 is right for session length.
8. `stepCareerDay` grew a 5th positional argument. If more inputs come, make it an options object.
9. `asCommand`/`HookCommand` in `sim.ts` is now redundant (every hook is in sim-core's union). It's harmless, but the casts hide type errors; delete it next round.

## R3.5 Is it fun yet? (per mode)

### Career (apprentice chef)
**Nearly, for one week.** The first day is a delight: your name on a staff card, a boss with a personality, a shift you can actually play, and a payslip that explains tax to a 12-year-old. After the fix the hands-on canvas gives you plates and stars. What sags is the middle of the week: the rail runs dry, the skill bar crawls, and "50 shifts" is a long way off.

Next three:
1. **A commis station.** Reserve starters and desserts for the human (not "the oldest 3") so the child always has something to cook. Make the AI head chef the mains.
2. **Visible growth per shift.** Show a "+0.2 cooking" chip on the evening and a moving skill bar. Halve the first rung's shifts on cosy.
3. **One small story beat a week.** The mentor offers a lesson, a rival takes your Saturday, the boss tastes your dish. `careerText` already has the lines.

### Empire
**Yes, as a map game; not yet as a business game.** Watching pins appear, franchise applicants with names and cash, and a meals counter ticking towards a billion is the "make it bigger everywhere" instinct the brief promised. Money moves are legible now that the buttons say what HQ can afford. But two years in, every decision is "open another franchise". There's no trade-off yet: no applicant picker, no contract tension (mood sits at 52–54), and the sites' numbers are generous.

Next three:
1. **Make the aggregate honest** (P1 above), so "Run it hands-on" feels like visiting a real branch.
2. **An applicant picker** (competence, honesty, cash shown) plus one franchisee story per quarter (a skimmer caught, a great operator wanting a second site). That is the people side of the brief.
3. **A monthly "board meeting" card** with HQ income by source (royalty, rent, company profit), plus one question ("Raise royalty?", "Buy the Campus plot?", "Enter a new country?"). It gives the late game a rhythm.

### Stars
**Yes: the most game-like mode.** Hidden inspectors, rumours you can't trust, a sealed envelope and a score broken down by criterion form a perfect loop for a perfectionist. With blocker 1 fixed, steadiness now rewards a steady kitchen, and weak nights are named. The weakness: what earns a star is invisible until the envelope opens. A player with a 98-steadiness bistro gets "no star, 69" and doesn't know why.

Next three:
1. **"What the guide looks for" card** on the Stars tab. After the first guide day, show last year's per-criterion averages with a one-line fix each ("Technique 54: put two more ambitious dishes on"). Before it, show generic copy.
2. **A standing order in inspection season.** Auto-restock to the forecast, or a red "inspection season: don't run out" nudge. One stock-out on a visit night shouldn't cost a year.
3. **Make the test kitchen a moment.** A 20-day research ends with a tasting (a one-click hands-on plate, or a choice of three twists), so signatures feel earned rather than bought.

# Round 4: integration review, balance and playtest (capacity model, Stars hints, commis station)

Reviewer: lead. Date: 9 Nov 2026. Covers `d26ab5f` … `3ca1ba0` (three parallel streams: A Empire, B Stars, C Career). Fixes are `7853bc8` … `cf5c11f`, one commit per fix.

**Status at the end of this pass:**
- `pnpm -r typecheck` ✓ (7 packages). `pnpm -r test` ✓: sim-core 194, content 51, handson 58, sim-career 61, sim-empire 59, sim-stars 67, game 109 (**599**; +75 since round 3, of which +14 this pass).
- `pnpm --filter @full-plate/game build` ✓, largest chunk 159 kB.
- The three streams landed together cleanly: typecheck, tests and build were green before any fix. No merge damage in App.tsx, pathEngine.ts, gameReducer.ts, paths.ts or sim-core constants/kitchen.

Artefacts (scratchpad): `shots/r4/r4kid.cjs`, `r4idle.cjs`, `r4paths.cjs`; screenshots in `shots/r4/{kid,kid-after,idle,paths}/` with a `log.json` per run; headless probes in `r4rev/` (`stationCost.test.ts`, `stationLatency.test.ts`, `bistroHints.ts`).

## R4.1 What landed
- **A (Empire):** `sim-core/src/capacity.ts` (closed-form demand, seat × turn and crew capacity); sim-empire's aggregate site is the sim-core dining room plus a takeaway counter; `calibrate()` fits on fully staffed days; `newGameFromSite` for "Run it hands-on"; the Sites panel splits dining room and takeaway. Round 3's P1 (aggregate 1.2–2.5× the flagship) is fixed: the flagship's own aggregate now reads ~93 covers in the dining room against the sim's ~88–93.
- **B (Stars):** a stock warning strip with one-tap "Order to cover tomorrow"; a red alert in inspection season; the `SHORT_MENU` rule (≥ 3 food dishes off most of the night → off night, −8 a dish; a 0-cover night that wasn't closed is a failed service); `starsHints` and the "What's holding you back" card; `hireCheck`.
- **C (Career):** the commis station (the player owns sides/starters/desserts plus the easiest main, ~30% of plates; the AI never takes the rail; the sous chef covers after 30 s idle / 80 s); pacing that follows the player; first promotion at cooking 30 + 10 shifts; hands-on skill growth; the end-of-shift score card; `?autopilot=skill,pace`.

## R4.2 Integration seams (code review)
- **Station × stock / 86 rule.** Stock is consumed when a ticket fires (OrderSystem), so a player-claimed or rail ticket already holds its ingredients; a drop re-cooks without new stock. A station dish that runs out is 86'd like any other and simply stops producing tickets; the short-menu rule reads `eightySixed` and plated share, so it is unaffected by who cooks. No interaction bug.
- **Sous-chef-covered plates** go to sim-core as `PLAYER_COOKED` at 0.6 × the dish ceiling and are booked to the player in `perChef` (deliberate and tested). They are *not* in the session's `plates`, so career skill growth (`HANDS_ON_GROWTH`) and stars only count the child's own plates. Fine.
- **Station × capacity model.** `crewOnShift` / `capacityCovers` are only used by sim-empire and `newGameFromSite`; the career station never runs under the Empire. No seam.
- **sim-core `stationRail` vs handson `stationTickets`** apply the same rule (claimed first, then the oldest unassigned, up to `cap`); the sim's 40-tick fallback is only a safety net.
- **Save/reload mid-service** (`7853bc8`): a career commis mid-shift (bot at a child's pace, 45 ticks, plates already booked) round-trips `handsOn.station` through sim-core `serialize` and continues byte-identically for 3 days; an envelope reload ends the station exactly as `handsOnStop` does. The four round-3 mode tests still pass.
- **Purity** (`74bb475`): a whole station shift (with an idle stretch so the sous chef covers), the capacity functions, `starsHints`, a short-menu Stars evening, `calibrate` and Empire `focusSite`/`newGameFromSite` all run on deep-frozen inputs with no writes. No `Math.random`/`Date` in the new sim code (grep; the per-package source-scan tests still pass).
- **`hireCheck`** (`42d44a8`): property test over 8 seeds × 3 districts × 3 difficulties × 4 fee perks × every candidate × cash at the edge (0, needed−1, needed, needed+1, 3×, £10k): `canAfford` matches sim-core `HIRE` accept/reject every time, and the charged fee matches.

## R4.3 Fixes in this pass
| Commit | Fix |
|---|---|
| `da10021` | **P1: playing hands-on cost the employer money.** A party eats only when every plate is in. Station tickets waited 7–8 ticks on a child's rail against ~2 for an AI cook, tables turned slower and the queue walked out. 10 seeds, first shift: skipped 77 covers / 1.4 walked-out covers / +£131; half-speed child 58 / 12.6 / −£95; even a perfect bot 58 / 10.9 / −£79 (no-reservation control ≈ parity, so it is latency, not lost AI capacity — a reduced AI "cover cook" made no difference). The sous chef now plates any rail ticket whose party's patience is ≤ 40 (`COVER_PATIENCE`): child 62 / 7.2 / −£24, own plates 7.8 → 6.5. Partial; see R4.6. |
| `c9290f3` | Empire: **"Lock your formula first — franchisees of an unstandardised brand lose money."** on the contract panel, above a city's franchise buttons and above Sell franchise, until the formula is locked. A sim-empire test pins the claim. |
| `427d9d3` | Stars hint copy: "None of your 1 dish is your own" → "Your only dish isn't your own"; "cautious (they need about 24 skill on average)" → "easy ones (a cook needs only about 24 skill for them)". |
| `14ab3f0` | My shift showed "Your cooking skill 23" beside "Cooking skill 22 / 30": one number, rounded down, on My shift, the checklist and the evening. |
| `d6cd5a1` | The hands-on HUD said "Your shift · On the pass" for a commis: now "Commis station: Sides · Desserts". |
| `a8c4553` | The inspection-season alert says closing is safe; it now has a **Close tonight instead** button right there. |
| `cf5c11f` | Empire Sites: "crew 50" → "crew skill 50"; no doubled "first" in the warning. |

## R4.4 Balance
**(a) Owner year 1 (100 seeds, real pack) — unchanged by round 4:** typical/normal **83%** (90.3 covers/day, rating 4.23), typical/cosy **100%**, balanced/hard **45%**, typical/hard 0% — identical to R2.3/SIM-NOTES. (The headless defaults to the fixture pack; pass `--content ../content/src/index.ts`.)

**(b) Empire (10 y × 5 seeds):** reproduces A's numbers exactly: franchise wins 5/5 at year 4.4–4.9 (0.49–0.55bn meals), company 4/5 at ~9.5, In-N-Out 0/5. **Verdict: the macro shape is acceptable design** — franchising is the real fast, asset-light route, company-owned still wins, the purist route is slow. **The early bleed is not acceptable for a child and is worse than reported:** it is not only unlocked formulas. From a real day-365 fork, a *locked* first franchise runs an operator margin of −3…−14% over its first year and mood sinks to 5–29 (unlocked −15…−32%, mood 0–3). The headless franchise style hides it because the tech tree and recognition arrive before the association threshold (5 franchisees < 35). I added the warning (honest copy: "even then a new franchisee only just gets by…") and left the model to A: changing the rent floor or crew size invalidates A's calibration tests and the headless table. EMPIRE-NOTES 8(c) has the numbers.

**(c) Stars:** from-fork balanced year 1, seeds 1–8 (seed 2 bust in year 1): **★ on the first guide day 7/7**, scores 79.6–87.8 (round 3: 81.1–89.2; seeds 3 and 5 now sit 1.6 above the 78 line — the short-menu rule costs a point or two), ★★ by year 3 on 4/7. Bistro profile (seeds 1, 3, 6): no star (57.2–69.6); the hints name **Ingredients** (no partner), **Personality** (no signatures) and **Technique** (easy dishes, "Chunky chips is the simplest") — the "why" is there.

## R4.5 Playtests (`vite preview` of the built dist, Chromium via Playwright; 0 page errors and 0 console errors on every screen)

**A. Apprentice chef, cosy, `?autopilot=0.55,0.5`, 3 worked shifts** (`kid/`, after fixes `kid-after/`). Each shift 140–175 s; 5–8 own plates, 88–89% quality, ★★★ every shift; "+0.8 cooking skill tonight (playing helped!)"; Shifts 1/10 → 3/10; skill 22 → 24. The score card is the best screen in the game: big stars, "Great shift, Mia!", three ticked notes, a progress bar and chips. The rail (`d1-14-handson-45s.png`) reads clearly: "COMMIS STATION · Sides · Desserts", one card per table. Idle child (`idle/`, `kid/sous-nudge.png`, `sous-cover-*.png`): nudge at ~18 s ("Orla: Need a hand? Your ticket's on the rail…"), cover at 30 s, and the new "Table 3 can't wait any longer — I've sent their Brownie!".

**B. Owner Planning, short larder** (`paths/01–03`). Out of season: a calm note, one-tap order ≈ £766, then "✓ Ordered — it arrives tomorrow morning" (the dishes stay listed: honest, tonight is still short). In inspection season: red alert, the stakes, the 3-dish rule, and now the Close button.

**C. Stars tab** (`paths/04–05`): two plain hints + "Also worth a look (2)" + "marks stay secret". Good.

**D. Empire** (`paths/10–14`): Sites reads "~93 covers today: 93 in the dining room (6 tables, crew skill 50)", after locking "141: 101 in the dining room (7 tables) + 40 takeaway"; the warning shows until the lock.

| Sev | Finding | State |
|---|---|---|
| **P1** | Hands-on commis shifts cost the employer covers and money (browser after fix: 67–71 covers, 7–18 walkouts, −£152…+£22 vs a day off at 99 / 0). | Mitigated (`da10021`), **open** |
| **P1** | A locked first franchise still loses money; mood heads for the association line. | Warned (`c9290f3`), **open** (A) |
| P2 | Two different cooking-skill numbers on My shift. | Fixed |
| P2 | HUD "On the pass" for a commis. | Fixed |
| P2 | Inspection alert says "closing doesn't count" with no button. | Fixed |
| P2 | Stars hints: "None of your 1 dish", "cautious (… skill on average)". | Fixed |
| P3 | Empire side panel is 12 px text with "margin 7d", "consistency 50", "Buy the plot · £651,429" — a lot for a 10-year-old. | Open |
| P3 | Rail ticket cards on the canvas are ~10 px ("TABLE 1 · Chips"). | Open |
| P3 | "crew 50" jargon on Sites. | Fixed |
| P3 | Covered plates are booked to the player in `perChef` (cosmetic; nothing reads it). | Open, by design |

## R4.6 Is it fun yet?
**Career: yes for the first week** — the station, the steady flow, the score card and visible growth answer all three round-3 asks. The sour note is that the restaurant does visibly worse on the days the child plays.
**Stars: yes** — the hints close the "why no star?" gap and the inspection alert protects the year.
**Empire: as a map game yes; as a business, the first franchise is a trap until a later round fixes its economics.**

Top three next steps:
1. **Station in sim-time.** Cover a rail ticket by its age in *ticks* (≈ prepTicks + a few) and slow the tempo while the child has work, or serve desserts as a second course so a late dessert never holds a table. Target: a half-speed child's shift within 5% of a skipped shift's covers.
2. **Early franchise economics.** A royalty holiday or a cost-only rent floor for the first units (or a crew sized to covers) so a locked first franchise clears ~+5–8%; re-run the 10-year table.
3. **Kid-size the Empire panel.** Bigger type, plain words ("profit this week", "how alike your sites are"), and one suggested next move.

# Round 5: integration review, balance and playtest (station in sim time, franchise economics, kid-size UI)

Reviewer: lead. Date: 9 Nov 2026. Covers `b2d4c6d` … `1655e8a` (three parallel streams: A station in sim time, B franchise economics, C kid-size UI). Fixes are `2476d29` … `d5ad373`, one commit per fix.

**Status at the end of this pass:**
- `pnpm -r typecheck` ✓ (7 packages). `pnpm -r test` ✓: sim-core 211, content 51, handson 62, sim-career 61, sim-stars 67, sim-empire 82, game 194 (**728**; the streams landed at 702, +26 this pass).
- `pnpm --filter @full-plate/game build` ✓. Type audit (`node packages/game/scripts/type-audit.mjs`): 25 screens, **0** text runs below 13 px, 0 page errors.
- The tree was already clean (no `zz*.test.ts` probes left) and typecheck/tests/build were green before any fix; no merge damage in App.tsx, pathEngine.ts, EmpireTab.tsx or render.ts.
- **Perf test:** the 5,000-site/50 ms check in `sim-empire/test/core.test.ts` is now a **soft benchmark**: it warns over 50 ms/day and fails only at 5× (an algorithmic regression); `STRICT_PERF=1` restores the hard budget.

Artefacts (scratchpad): `shots/r5/r5kid.cjs`, `r5paths.cjs`; screenshots in `shots/r5/{kid,kid-after,paths,paths-after}/` with a `log.json` per run; probes in `r5rev/` (`sweep.ts`, `diag.ts`, `own.ts`, `outlook.txt`, `bal-final.txt`; a round-4 worktree at `r5rev/wt-r4`).

## R5.1 What landed
- **A (station in sim time):** coursing (station starters/sides/desserts are their own course: `Customer.courseOut`), cover by ticket age in ticks (commis 8 → head chef 5) or at patience ≤ 40, station dilation (`Customer.dueTick`), the commis's AI hands keep cooking as `<staffId>~ai`, host pacing 3 s/tick while the child holds a ticket, `PLAYER_CLAIMED` on an AI-held ticket fails with a LOG. Half-speed child: 104.7% of a day off's covers.
- **B (franchise economics):** rent by plot with a 20% markup, counter labour at 30% of a room cover, QSR crew wages, a 9-month ramp with a 75-day honeymoon, mood from the franchisee's own net, `franchiseOutlook` on the contract panel. Locked year-1 franchise +5% with supply deals.
- **C (kid-size UI):** 13 px floor and the audit, the Empire side panel as My shops / The brand / Money, `<Term>` + glossary, WCAG AA tokens, hands-on header 80 px.

## R5.2 Integration seams (code review, with tests)
- **(a) `~ai`** (`1d14ada`): it is a derived `Cook` in `cooksOnShift`, never a Staff record. Over a whole played shift it never enters `state.staff` or an envelope's staff, payroll (`labourCost`) equals a day off's to the penny, staff mood/fatigue run over `state.staff` only, and it appears only as a `perChef` key (nothing reads that). The tick after `handsOnStop` or an envelope reload no ticket holds a `~ai` chefId (orphans re-home to a present cook) and the shift runs out to the evening. The "slight buff" is real and accepted: the commis's day-off capacity plus her station.
- **(b) Coursing × 86** (`1d14ada`): `EIGHTY_SIX` doesn't cancel fired tickets, so a coursed dessert 86'd while its party eats the mains still goes out once, the party pays (an 86 never strands a `courseOut` party), the dish is on the 86 list once and `plated ≤ tickets`. The short-menu rule reads a set of pulled dish ids, so it can't count one twice. 3 seeds.
- **(c) `franchiseOutlook` vs the probe on every district** (`e21e322`): 34 districts, with and without deals. The outlook is never optimistic; 0.4–1.8 points under where viable, up to 3.8 under in the cities that lose a third of their sales (unlocalised menus). But the panel read only Harbourton High Street (+4.4%) while home districts range −4…+7% and foreign ones to −32%. Fixed: the sentence names the home city's best spot and each Franchise button carries "they'd do fine / only just get by / lose money".
- **(d) Save/reload** (`1d14ada`): a mid-shift state with both `courseOut` and `dueTick` set round-trips through `serialize` and the envelope byte-identically and continues identically to the evening; the four round-3 mode tests still pass.
- **(e) Purity** (`d16db54`): `franchiseOutlook`, `probeUnitEconomics` (incl. `skipDays`) and `openingFactor` on a deep-frozen empire; the round-4 frozen station shift (now coursing) still passes; no `Math.random`/`Date` in any sim package (source-scan tests).
- **(f) `<Term>`** (`66c52bd`, `d5ad373`): the explanation was a `title` (never shown on focus; the block form wasn't focusable). Both forms are now `tabIndex=0` + `aria-describedby` → `role="tooltip"`, shown on hover and focus; verified by keyboard in Chromium (`paths-after/19-term-focus-y2.png`).

## R5.3 Fixes in this pass
| Commit | Fix |
|---|---|
| `2476d29` | 5,000-site perf test → soft benchmark (warn > 50 ms, fail at 5×; `STRICT_PERF=1`). |
| `1d14ada` | Tests: `~ai` seams, coursing × 86, mid-shift save with the new Customer fields. |
| `e21e322` | Contract sentence names its district; per-district verdict beside every Franchise button; "collapse below £400k" → "a shop below £X is in trouble" (today's pounds; "no shops yet"). Outlook-vs-probe test over 34 districts. |
| `d16db54` | Round-5 Empire functions on a deep-frozen empire. |
| `66c52bd`, `d5ad373` | Keyboard-accessible `<Term>` tooltips. |
| `43ce28b` | **Balance:** Evening "trim the rota" tip (`rotaAdvice`) and the `learner` owner. See R5.4. |
| `9624661` | **Balance:** sim-empire maturity drag. See R5.4. |
| `f2b2b91` | Shift card: "Sent out by the sous chef 10" → "Sous chef helped: 7 while you were busy, 3 while you were away". |
| `ad6244c` | Service canvas: table numbers on top of the guests (a full room hid 7 of 11). |
| `bb759d1` | Menu matrix: labels avoid titles/axis/dots, stay inside the chart, cut at 22 characters. |

## R5.4 Balance
**(a) Owner year 1 (100 seeds, real pack):**

| | cosy | normal | hard |
|---|---|---|---|
| typical | 100% | 83% | **0%** |
| balanced | 100% | 100% | 45% |
| learner (typical + acts on the rota tip) | 100% | 100% | 33% |

Typical/hard was **0% before round 5** (round-4 docs commit in a worktree: 0 / 83 / 100, balanced/hard 45%) — pre-existing, not A's doing (A's owner headless is byte-identical). Diagnosis over 50 seeds: restoring the rota trimming/noticing alone → 44%; balanced's hiring thresholds → 28%; a leaner menu or stock → 4–8%. **Decision:** don't tune DIFFICULTY.hard — every easing moved balanced far faster than typical (0.85/1.15: 16% vs 90%; 0.8/1.1: 23% vs 94%), so hard would stop being hard. The real defect was that the game never told a player where the money went: the Evening now says "Two weeks of losing money (about £X a day). Bo works Friday, Saturday and Sunday, when another chef is already on. Those shifts cost £Y a week. Take them off the rota until things pick up?" A typical owner who acts on it after six evenings survives hard **33%** — the 30–50% band — while `typical` stays the advice-ignoring baseline so normal keeps its 83%.

**(b) Empire mature units.** Confirmed rich: 10-year runs put fully mature franchisees at 19–21% net and mature company sites at ~31%. Added a maturity drag (years 2→5: 80% of store margin above 28% of net sales, as wage creep + upkeep/lost trade; +7% corporate labour on non-fresh company sites). Margin-proportional so a no-tech brand isn't sunk (its year-6 franchisee still nets ~5%).

| | before | after |
|---|---|---|
| mature franchisee net (median, 3 seeds) | 19.4–21.1% | **9.3–10.1%** |
| mature company site net | 31.0–31.2% | **17.0–19.3%** |
| franchisee mood at year 10 | ~89–97 | 72–76 |

**Empire 10 years × 5 seeds (after):** franchise **4/5 at y4.9–6.3**; company **4/5 at y7.1–7.8**; In-N-Out **3/5 at y8.9–9.8** — the same shape as B's (4/5 4.9–6.3; 4/5 7.0–7.7; 3/5 8.9–9.9).

## R5.5 Playtests (`vite preview` of the built dist, Chromium via Playwright; 0 page errors and 0 console errors on every screen)

**A. Apprentice chef, cosy, `?autopilot=0.55,0.5`, 3 worked shifts** (`kid/`, after the fix `kid-after/`). 197–216 s a shift; 7–9 own plates, 87–88% quality; 2–3 stars; +0.8–0.9 skill a shift; skill 22 → 24, Shifts 3/10. The rail reads "COMMIS STATION · Sides · Desserts" with one slip ("TABLE 1 · Brownie"); `d1-h28-112s.png` shows a coursed Brownie on the burner while table 1 eats its mains — the course works as intended. The sous chef's toast ("I've sent table 1's Chips — grab your next ticket!") is friendly. But the evening line read **"Plates cooked 7 · … · Sent out by the sous chef 10"** (13 on day 4) for a bot that never stopped working: it reads as her failing. Now "Sous chef helped 13 while you were busy" (`kid-after/`).

**B. Empire** (`paths/10–19`, start and the year-2 save): three tabs render; contract sentence "Your franchisee should clear about £47,000 a year in your best spot (Seaside, Harbourton) — fair. Other places differ…"; the Lock warning shows until the lock; at year 2 the four Harbourton districts read "do fine / do fine / only just get by (Business Park) / do fine"; the city card reads "£1,073,476 (a shop below £420,250 is in trouble)".

**C. Stars and Planning** (`paths/01–05`): Planning short-larder warning and the inspection-season alert with **Close tonight instead** render; the Stars hints card ("PERSONALITY … INGREDIENTS … Also worth a look (2)") renders after C's type changes.

| Sev | Finding | State |
|---|---|---|
| **P1** | Typical owner on hard: 0% survival, and nothing in the game says the doubled-up rota is the leak (pre-existing since round 2). | Fixed in-game (`43ce28b`); typical script deliberately unchanged |
| **P1** | Mature Empire units 20% / 31% net; franchisee mood saturates, so the association never threatens. | Fixed (`9624661`) |
| P2 | Contract panel's year-one line read one arbitrary district; foreign cities can lose −20…−32%. | Fixed (`e21e322`) |
| P2 | "Sent out by the sous chef 10" beside "Plates cooked 7". | Fixed (`f2b2b91`) |
| P2 | `<Term>` explanations unreachable by keyboard. | Fixed (`66c52bd`) |
| P3 | Guest sprites covered most table numbers on the Service canvas. | Fixed (`ad6244c`) |
| P3 | Menu-matrix labels over "Stars ★" and off both edges. | Fixed (`bb759d1`) |
| P3 | "(collapse below £400k)" ignored inflation and showed with no shops. | Fixed (`e21e322`) |
| P3 | The outlook sits 0.4–1.8 points under the probe (pessimistic); 5/68 verdicts differ near a line. | Open, acceptable |
| P3 | The top-right Star on the matrix can lose its label when both spots collide (hover shows it). | Open |
| P3 | The flagship (no `openedTrading`) never matures, so it stays the richest site. | Open, by design for old saves |

## R5.6 Is it fun yet?
**Career: yes.** Playing no longer costs the restaurant, the course rhythm (mains out, her dessert lands during the meal) feels like a real kitchen, and the card now credits her rather than the sous chef. **Stars: yes**, unchanged. **Empire: closer** — a first franchise pays, mature units are believable, and the per-district verdict turns "where do I open next?" into a readable choice; the mid-game still lacks a rhythm.

Top three next steps:
1. **Show the course on the canvas.** A small "dessert coming" marker on a table eating its mains and a sous-chef sprite taking a ticket off the rail, so the child sees the help instead of reading a number.
2. **An Empire monthly "board meeting" card** (income by source, one question: raise royalty? localise Vasant? buy the Campus plot?) — with maturity drag the late game now has real trade-offs to put on it.
3. **Teach the owner levers in-game the way the rota tip does:** the same evening-tip pattern for over-stock (spoilage), a dog on the menu, and an idle second chef, each measured by a `learner` variant in the headless table.

# Round 6: integration review, balance and playtest (help on the canvas, board meeting, evening tips)

Reviewer: lead. Date: 9 Nov 2026. Covers `c7c7d96` … `336c377` (three streams: A help on the canvas, B Empire board meeting + flagship maturity, C evening tips). C's branch `r6c` had been rebased onto master before B landed; it rebased again onto B with no conflicts (C and B touched different lines of App.tsx, glossary.ts and theme.css) and master fast-forwarded to it. Fixes are `e2cf6c2` … `6c32353`, one commit per fix, then this docs commit.

**Status at the end of this pass:**
- `pnpm -r typecheck` ✓ (7 packages). `pnpm -r test` ✓: sim-core 243, content 54, handson 70, sim-career 61, sim-stars 67, sim-empire 96, game 216 (**807**; the merged streams were 786, +21 this pass).
- `pnpm --filter @full-plate/game build` ✓ from the final commit. Type audit (`FP_AUDIT_URL=http://localhost:4733`): **27 screens, 0 text runs below 13 px, 0 page errors** (before and after the fixes).
- Worktrees `fp-r6c` and `wt-r6b` removed, branches `r6c`/`r6-board` deleted; seven orphaned `vite preview` servers (4173 ×2, 4181, 4196, 4627 …) killed. Tree clean.

Artefacts (scratchpad): `r6rev/sweep.sh`, `r6rev/owner-final.txt`, `r6rev/empire.txt`; playtests `shots/r6/review/{kid.cjs,tips.cjs}` with screenshots in `shots/r6/review/{kid,tips,empire}/` and `log.json` / `tips-*.json`; saves `shots/r6/review/saves/` (an over-stock evening with 120 cod on order; B's year-4 board save with a tip due the same night).

## R6.1 What landed
- **A (help on the canvas):** the sous chef walks a covered slip to the pass with a speech bubble, a cloche "course coming" marker on tables eating their mains, her `~ai` hands at her station with a "helping" badge, rail owner bands (tomato hers / amber the sous chef's within a tick / sky helper). Render only.
- **B (board meeting):** a monthly meeting on the last evening of each month (income by source, top mover, one risk, one 2–3-option decision with the board's tip; skip allowed), a modal that holds Next day, minutes on the Money panel; the founder's flagship now matures.
- **C (evening tips):** `eveningAdvice` — one tip an evening from rota / idle chef / over-stock / under-pricing / dud dish, cooldowns, `adviceLog` recorded at END_DAY, `DayResult.spoiled`; the tip card first on the Evening with Why? and a one-tap action; `learner` and `learner-<kind>` owners.

## R6.2 Integration seams (with tests)
- **(a) Tip action × board modal** (`6c32353`). The tip's tomorrow-commands lived in an App `useEffect` (untestable) and App's Next day returned silently while the board was open, so the reducer's "The board is waiting" toast never showed. Now `actTomorrow` queues them in `AppState.tomorrow` and `appReducer` applies them on the first planning morning after that evening (after the morning post, after the board); `actNow` for tonight-commands; a game over drops the queue; a refused command keeps its own toast. Tested both orders: tip first → Next day held with the toast, the meeting object unchanged (the card still shows), the action waits, then lands the morning after the board is skipped; board first → tip → applied. The over-stock trim applies under an open meeting and leaves it up. **`adviceLog` + `boardMeeting` round-trip together** through `encodeSave`/`decodeSave` byte-identically (END_DAY-recorded log, unanswered meeting).
- **(b) Tip card + board card on one evening.** No stacked modals: the tip is inline (first card on the Evening), the board is the only dialog; the fork card hides the board, and the event modal can only open after Next day, which the board holds. Order: board → tip → Next day (→ morning post). Test renders both: one `role=dialog`, the tip outside it and first. Browser: the tip's button sits under the board's backdrop (`elementFromPoint` = backdrop), then is live once the board is answered.
- **(c) Rail bands vs the sim** (`e2cf6c2`). sim-core now exports `SHADOW_COOK_SUFFIX`; handson's `HELPER_SUFFIX` is it, not a copy. `round6.railAgree.test.ts` plays three whole bot shifts (seeds 5–7, 360 ticks) and checks every tick: hers + amber slips = sim-core `stationRailTickets`; every ticket `ticketsToCover` takes on the next tick was already amber (51 covers); 198 course-marker frames all on parties eating with `courseOut`; 19 helper frames all on a `~ai` cook. **0 disagreements.**
- **(d) "Your own shops £0"** (`8e00090`). When the only company shop is the focused flagship (its till isn't HQ's) the card adds: "£0 because your only own shop is the one you run: its money stays in its own till (the Evening shows it)." Not shown when HQ has another company shop. Tested; seen in the browser on B's year-4 save.
- **(e) The rota tip never rests** (`f7bbef7`). `rules.rotaRestAfter` = 2: after two showings in a row it steps aside for one evening when another tip is due (else it shows anyway; never two rests running). Condition met — hard: **learner-rota 33%** (≥ 33), **learner 50%** (≥ 50) — so it ships. It also lifts the single-tip learners (table below).
- **(f) Over-stock one-tap fix** (`f7bbef7`, `6c32353`). New `CANCEL_ORDER { ingredientId, qty }` (ORDER_STOCK's shape): takes portions off tomorrow's pending order, newest line first, refunded pro rata to the penny (cash + money on order unchanged), planning/evening/event, refused with nothing on order. The tip carries it (`now: true`, words `fix`) when more is on order than tomorrow's forecast (`suggestedOrder` without that ingredient) needs, and applies **tonight** — a morning command would be too late, the order arrives at dawn. With nothing to trim it stays "Check the larder →". Tests: refund arithmetic, refusals, frozen-input purity, serialize round-trip; learners never issue it, so the headless table is untouched by it.
- **(g) Purity** (`f7bbef7`, `6b13b2a`). sim-core had only a run-time Math.random/Date trap; it now has a recursive source scan (every src file but the headless CLI, `advice.ts`, `strategies.ts`, `systems/*` asserted present; also `performance.now`). sim-empire's scan asserts `board.ts` is in it. `eveningAdvice` and the trim on deep-frozen real states; `buildBoardMeeting` already had a frozen test.

## R6.3 Fixes in this pass
| Commit | Fix |
|---|---|
| `e2cf6c2` | sim-core exports `SHADOW_COOK_SUFFIX`; handson imports it; rail/marker/helper-vs-sim probe test. |
| `f7bbef7` | `CANCEL_ORDER`, the over-stock trim (`overOrdered`, `now`, `fix` words, content pack + validation); `rotaRestAfter`; sim-core source scan. |
| `6b13b2a` | sim-empire purity scan asserts `board.ts`. |
| `8e00090` | Board card: the "Your own shops £0" line. |
| `6c32353` | Tip actions in the reducer (`actTomorrow`/`actNow`, `AppState.tomorrow`); Next day toasts while the board waits; seams (a)(b)(d) tests; empire fixture shared. |

## R6.4 Balance
**(a) Owner year 1, 100 seeds, real pack (final code):**

| | cosy | normal | hard | C's table (rota never rests) |
|---|---|---|---|---|
| typical | 100% | 83% | **0%** | 100 / 83 / 0 |
| balanced | 100% | 100% | 45% | 100 / 100 / 45 |
| learner (every tip) | 100% | 100% | **50%** | 100 / 100 / 50 |
| learner-rota (= R5 learner) | 100% | 100% | **33%** | 100 / 100 / 33 |
| learner-overstock | 100% | 92% | 3% | 100 / 88 / 3 |
| learner-dog | 100% | 83% | 0% | 100 / 83 / 0 |
| learner-idleChef | 100% | 95% | 0% | 100 / 85 / 0 |
| learner-underpriced | 100% | 88% | 10% | 100 / 85 / 5 |

C's table confirmed exactly before the rest; with it, the headline rows are unchanged and the single-tip learners gain (their tips now get evenings on losing streaks). Typical/hard stays 0% by design (the advice-ignoring baseline).

**(b) Empire 10 years × 5 seeds, `--board both`:** identical to B's table in EMPIRE-NOTES, seed for seed.

| Style | skip | board-follower |
|---|---|---|
| franchise | 5/5, y5.0–5.6; HQ £0.39–0.60bn; mood 73–76 | 5/5, y5.3–6.2; £0.55–0.69bn; mood 65–71 |
| company | 5/5, y7.2–8.1; £0.48–0.70bn | 5/5, y7.2–8.1; £0.47–0.69bn |
| innout | 3/5, y9.0; £0.11–0.18bn | 5/5, y8.5–9.1; £0.10–0.18bn |

## R6.5 Playtests (`vite preview` of the built dist on :4733, Chromium via Playwright; 0 page errors and 0 console errors on every screen)

**A. Apprentice chef, cosy, `?autopilot=0.55,0.5`, 3 worked shifts** (`kid/`, 301 canvas frames). 196–206 s a shift; 8–9 plates, 88% quality, 3 stars each; +0.8–0.9 skill a shift; Shifts 3/10. The sous chef works as A describes: at 56 s he stands under the table-2 slip with "I've got table 2!" while "Covered by the sous chef" rises at the pass (`d1-h28-56s.png`); two seconds later he is at the pass (`d1-h29`). The cloche with its tomato ring sits on table 1 while it eats (`d1-h50-100s.png`), and the slip carries the small dome. The helper in light whites with the blue "helping" badge cooks table 5's brownie at the oven while the rail's slip says HELPER (`d1-h47-94s.png`; 4 frames of 301 by colour scan). **Toast/bubble overlap (A's open item): not seen** — the bubble shows during the take, under the slip; the toast rises at the pass at that moment. New nit: at the pass his name tag sits on the floor's "PASS" label.

**B. Owner Evening tips** (`tips/`, C's five saves + one with 120 cod on order). Every tip is the first card; every button does what it says: rota → "Give Kofi Brennan Friday, Saturday and Sunday off" → Staff tab, toast "Done: …"; idle chef → Staff; under-pricing → Menu "Raise prices 10%"; dud → Menu, dish gone; over-stock with nothing on order → "Check the larder →" (Stock); **over-stock with cod on order → "Take 110 cod fillet off tomorrow's order"**: stays on the Evening, toast "Done: …", the card goes back to "Check the larder →", the Restock card doesn't re-order it.

**C. Empire year 4** (`empire/`, B's `empire-board` save with a tip due the same night). One dialog (the board) over the Evening; the tip card underneath, its button covered by the backdrop; "Your own shops £0" carries the new line; answering with the board's tip (buy the Campus plot) closes it, then the trim ("Take 175 beef mince off tomorrow's order") applies with its toast. Then 27 days played at 4× (cap 20 min; one more over-stock tip on day 6 after its cooldown), and from a morning save of the month's last day (generated by the reducer): Open → the evening shows the May board card (drive-thru question, the £0 line again), Escape doesn't dismiss it, Skip closes it, Next day → 1 June, the Money panel minutes read "May · Year 4 · Skipped · HQ made £329,947 / Apr · Year 4 · Skipped · HQ made £272,602 / …".

| Sev | Finding | State |
|---|---|---|
| **P2** | Evening tip's action held in an App effect; while the board held Next day the tap did nothing visible (no "board is waiting" toast) and the path was untested. | Fixed (`6c32353`) |
| **P2** | Over-stock tip had no one-tap fix, and a morning command could never trim an order that arrives at dawn. | Fixed (`f7bbef7`): `CANCEL_ORDER`, applied tonight |
| **P2** | The rota tip never rested, so on a losing streak no other tip ever showed (single-tip learners 0–5% on hard). | Fixed (`f7bbef7`): rests every third losing evening; learner-rota 33%, learner 50% unchanged |
| P3 | "Your own shops £0" every month when the only company shop is the flagship. | Fixed (`8e00090`) |
| P3 | handson mirrored sim-core's `"~ai"`; sim-core had no source scan. | Fixed (`e2cf6c2`, `f7bbef7`, `6b13b2a`) |
| P3 | Sous chef's name tag over the "PASS" floor label while he stands at the pass. | Open |
| P3 | "Covered by the sous chef" toast vs his bubble (A's item). | Open, not reproduced in 301 frames |
| P3 | The year-4 audit save's flagship is the founder alone (10 served, 57 walk-outs a night, "A tough night." for 27 nights) — the Empire's own focused shop reads as failing while HQ makes £300k a month. | Open (fixture/design: a hire prompt exists; the board could raise it) |
| P3 | The walk is a replay (the slip has left the rail before he reaches it); NPCs walk through the player. | Open (A's notes) |

## R6.6 Is it fun yet?
**Career: yes, and now visible.** The help the round-5 card only counted is on the canvas: a named sous chef walking her slip to the pass, a dome on the table waiting for her dessert, a helper at her oven. A child can see why a slip left her rail. **Owner: better.** One tip a night, in her words, with a button that does it; the over-stock tip finally has a real fix, and other tips now get a turn on a bad run. **Empire: closer still.** The monthly board card gives the mid-game the rhythm R5 lacked (one money summary, one worry, one question); the tip and the board share an evening without fighting. What it lacks is consequence on the focused shop: HQ booms while the shop she runs struggles every night, and nothing connects the two.

Top three next steps:
1. **Connect the flagship to the board.** When the shop she runs loses money for a month, make that the board's worry and offer the fix (hire a manager / a cook for the flagship, paid by HQ), so the Empire screen and the Evening tell one story.
2. **Start the sous chef's walk a tick early.** Begin the trip when the slip turns amber (`coverSoon`), so he takes the slip off the rail instead of replaying it, and keep NPCs from walking through her (the name-tag and pass-label nit goes with it).
3. **Measure the tips with a child, not just bots.** Log which tips were shown, read (Why? opened) and acted on in a real session (a local, opt-in record on the save), and check that the learner's 50% on hard is reachable by a person; if hard stays out of reach, a "cosy-hard" middle setting is cheaper than retuning hard.

# Round 7: integration review and playtest (UI/UX: career & hands-on, the owner's day, shell & paths)

Reviewer: lead. Date: 9 Nov 2026. Covers `941e317` … `e516ec6` and this docs commit. Three streams merged onto master with merge commits in the order asked: `r7-a` (`4d7512d`, clean), `r7-b` (`e987bfc`: add/add in `UX-AUDIT-R7.md`, `UI-NOTES.md` and `theme.css`, all keep-both), `r7-c` (`87bed8b`: the same three files; `UI-NOTES.md` had interleaved B and C hunks under shared "What changed" headings and was rebuilt by hand as A, B, C; App.tsx's StatusBar line merged cleanly to C's `onQuit`/`onNewGame` with A's `Loading` → `Skeleton`). Fixes are `0f0f195` … `e516ec6`, then this docs commit.

**Status at the end of this pass:**
- `pnpm -r typecheck` ✓ (7 packages). `pnpm -r test` ✓: sim-core 243, content 54, handson 81, sim-career 61, sim-stars 67, sim-empire 96, game 277 (**879**; the merged streams were 869, +10 this pass in `round7.review.test.tsx`).
- `pnpm --filter @full-plate/game build` ✓ from the final commit (main JS 195.2 kB, CSS 109.8 kB; HandsOnShift 95.9 kB lazy). Type audit on a private port (`FP_AUDIT_URL=http://localhost:4801/`): **29 screens, 0 text runs below 13 px, 0 page errors**, both normal and `FP_AUDIT_TEXT=large`.
- Worktrees `fp-r7a`/`fp-r7b`/`fp-r7c` removed, branches `r7-a`/`r7-b`/`r7-c` deleted; orphaned `vite preview` servers killed (B's 4792, A's 4791, round 6's 4733 and their esbuild children). The temporary `r7rev-base` worktree (master `941e317`, for the "before" probe) removed. Tree clean.

Artefacts (scratchpad): `r7rev/probe.mjs` (every screen × 1280/1024 × normal/Bigger: targets, text, contrast, sideways scroll, covered controls, Term tips on focus), `r7rev/toast.mjs` (seam a), `r7rev/picker.mjs`, `r7rev/bar.mjs`, `r7rev/loadall.mjs` (33 old saves in the browser), `r7rev/play.mjs` (playtests), `r7rev/touchplay.cjs` (A's touch run, re-pointed); results `r7rev/probe-{before,after}/probe.json`, screenshots `shots/r7/review/{kid,owner,paths,win,touch,toast}/` with `log-*.json`.

## R7.1 What landed
- **A (career & hands-on):** touch play (tap a station to walk, press to use, USE/Drop column), a three-step first-shift onboarding (once per save and role, Skip, replay on **?**, the shift waits), a one-row 44 px shift bar at 1024, "Yours" station outline, mood faces and slip wait bars, the sous chef sets off when a slip falls due, NPCs step aside, a full-width score card with "Next shift, try this", My shift says why buttons are grey, `Skeleton` for lazy chunks, Enter/Space press buttons during a shift.
- **B (owner's day):** `DayRhythm` (Get ready → Service → Evening), one primary button pinned bottom-right (`.actiondock`), Menu opens on today's list with the matrix as a lazy expert view (remembered in `localStorage`), Stock forecast sentences in whole numbers, the `RotaWeek` grid with doubled-up shifts priced, the Service live summary with trends and a play-control speed deck, Evening "Tonight's money" with seven nights of bars, the GameOver cause, `MoneyText countUp`.
- **C (shell & paths):** shopfront title, "How do I win?" explainer, start cards and big difficulty toggles, the Settings sheet (text size Normal/Bigger via `data-text="large"`, sound, speed, pause, save-and-quit, new game with confirm), tab icons, toast badge, Stars hero + 60-night strip, Empire heroes + CSS charts + verdict badges, the board card as an event, the win screen (confetti, journey, PNG).

## R7.2 Integration seams (with tests or probes)
- **(a) Pinned bar vs header/tabs/sheet/toast/shift bar** (`738142a`). Probe at 1280×800 and 1024×768, normal and Bigger: B's `.actiondock` never overlaps the header, tabs, settings button or the shift bar. **The toast covered the queue at 4× (and the speed deck at 1280)**: during service it now sits under the PAUSED badge at the top of the floor (`toastPlacement` from the stage rect); elsewhere it stays bottom-centre, 16 px above the dock. After: 16/16 toast samples (2 evening tip actions + 2 service toasts × 4 sizes) overlap nothing — not the primary button, the queue strip, the speed deck, the header or the tabs. Found on the way: **B's day strip squeezed by C's icon tabs** (two lines at 1280 with four tabs, a column beside a two-line heading with the Empire/Stars fifth tab) → B's ≤ 1180 px layout at every width (`924b338`, bar 97 px, was 116–137).
- **(b) `.term__tip` display:none vs the new screens** (`738142a`). The round-5 a11y test passes unchanged; the probe focuses every Term on every screen (71–75 on Menu, 16 on the Empire, 3 on the Evening, 4 on the lease, 1 on Service/Stars/My shift/watch): **0 tips hidden on focus**. But C only fixed *hidden* tips: a tip *shown* near the right edge still widened the page by 106–137 px (Menu "margin", Empire "Land owned"; 117 instances per size). `placeTip` flips it leftwards before it shows: **0 after**. No sideways scroll on any screen at 1024 (was 4–5 screens, up to 137 px; the merged build also had a new 27 px one on Stock — fixed, below).
- **(c) C's `.menu-layout` large-text rule vs B's Menu** (`2733d51`). The rule (`minmax(0,300px) minmax(0,1fr)`, specificity 0,3,0) beat B's `.menu-layout--list` single column, so with Bigger text at ≤ 1180 px **B's list view was squeezed into a 300 px column**. And in the matrix view at 1024 the chart labels were 12.4 px and the price steppers 24 px wide (C22). The Menu is now one column at ≤ 1180 px (matrix ≤ 460 px above the list), which needs no large-text rule: C's rule is dropped. Smallest matrix label at 1024: **17.9 px**.
- **(d) Keys and focus** (`0f0f195`). Dialog's Escape (capture + stopPropagation) never reached Service's or the cook's window listeners — no double-firing there. But: the Settings sheet over service **left the clock running** (and over a hands-on shift), and Space / 1 / 2 / 4 typed in the sheet reached Service's shortcuts, WASD the cook; after closing, focus went back to the header's Settings so **Space re-opened Settings instead of using a station**, and after a mouse press on Pause, Space toggled Pause. Now an open `aria-modal` sheet holds both clocks and owns the keys (`lib/modal.ts`, `shortcutsBlocked`, handson `onControl`), and the canvas gets focus back when the sheet closes or a bar button is pressed with a pointer (keyboard presses keep focus). In the browser: clock 16:30 → 16:30 for 2.5 s with the sheet open, Space in the sheet doesn't pause. B's inline Remove focused **Remove** (Enter twice removed a dish): it now focuses **Keep**, like C's `ConfirmDialog`, and Keep returns focus to the ✕.
- **(e) Onboarding vs the watch view** (`0f0f195`, `fdecf73`). The onboarding lives only on the hands-on stage (`aria-modal="false"`, so it doesn't trip the sheet hold, which has its own); DayRhythm is not on the career watch view. A11: the read-only watch view offered **Break** buttons — `StaffStrip readOnly` shows who's on and who's resting with no buttons; "Play my shift" is a 52 px primary (B's `.service__side .btn` 44 px rule was out-ranking it: 47 px until `fdecf73`).
- **(f) Save compatibility.** No sim package or `state/` file changed in round 7 (only `sim.ts` re-exports three sim-core selectors). UI prefs live outside the save: `full-plate:settings:v1` (C's `sound`/`textSize`, old settings load with defaults — C's test), `full-plate:menuView:v1` (B), `full-plate:onboard:v1:<role>:<seed>` (A). All **33 old saves** (r6/review 3, r6/c 5, r7c 9, the type-audit 8, r7/b 8) decode → encode with the same game keys and equal game objects, re-encoding is byte-stable, and each loads in the browser with **0 errors** under pre-R7 settings. A test asserts a save carries none of the UI keys.
- **(g) Determinism.** No `Math.random`/`Date` in any sim package (sim-core's and handson's source scans pass; handson's new `touch.ts`, `sous.ts` changes included). Confetti is a fixed seed-free scatter and `display:none` under reduced motion (browser: not visible with `reducedMotion: "reduce"`); `MoneyText countUp` is off under reduced motion and without `matchMedia`; the title steam stops under reduced motion. Sound effects are gated by Settings › Sound (not by reduced motion — they are not motion) and never touch the sim.
- **(h) Handovers** (`2733d51`). **A17**: the start button is pinned in an action dock (B's) with "Apprentice chef · Cosy · Student Quarter" beside it; it was 1,230 px (1,392 with Bigger text) from the top at 1024×768, now 692–725 px at every size. **C22** as (c). **Header**: Settings 44 px, Save & quit is in the sheet; no header target under 44 on any screen. **C18**: the district wraps as a whole name. **C21**: the lease shows the picked difficulty with **Change**. Also: Stock at 1024 scrolled 27 px sideways (B's forecast sentences + C's type) → Keeps and Unit cost fold under the ingredient at ≤ 1180 px; rota day toggles 38–40 px wide at 1024 → the team stacks above the job hunt and person cards are ≥ 340 px (44 px days); Settings segments 40 → 44 px.
- **Playtest harness** (`e516ec6`): A's autopilot onboarding effect had no deps, so the 500 ms HUD re-render reset its 2.5 s timer forever — an `?autopilot` first shift sat on step 1 with the clock held (0 plates after 330 s) and the overlay came back next shift. Keyed on the step now. A child pressing Next was never affected.

## R7.3 Fixes in this pass
| Commit | Fix |
|---|---|
| `0f0f195` | `lib/modal.ts`: a sheet holds service and the shift and owns the keys; canvas focus after a sheet or a pointer press on Pause; Remove asks with Keep focused, focus back to ✕; `StaffStrip readOnly` on the watch view; Play my shift primary. |
| `738142a` | `toastPlacement` (service toasts on the floor's top edge); `placeTip` (Term tips flip at the right edge). |
| `2733d51` | 1024 px: Stock columns fold, Menu one column (C's large-text rule dropped), staff stack + 340 px cards, 44 px segments; start-picker action dock (A17); lease difficulty reminder (C21); district nowrap (C18); `round7.review.test.tsx` (10 tests, seams a b d e f h). |
| `924b338` | Day strip on its own row above the tabs at every width. |
| `fdecf73` | Watch view's Play my shift 52 px (specificity). |
| `e516ec6` | Autopilot onboarding paging keyed on the step. |

## R7.4 Probe: every screen, before (master `941e317`) vs after
`r7rev/probe.mjs` on the built dists (`941e317` rebuilt in a temporary worktree on :4802; the final commit on :4801). 25 screens before (no explainer, onboarding or confirm existed), 28 after. "Bigger" before = normal (the setting didn't exist).

| | 1280 normal | 1024 normal | 1280 Bigger | 1024 Bigger |
|---|---|---|---|---|
| Targets < 44 px | 461 → **1** | 457 → **1** | 461 → **1** | 457 → **1** |
| Text < 13 px | 0 → 0 | 7 → **0** | 0 → 0 | 7 → **0** |
| Contrast < 4.5:1 (unique runs) | 6 → 9 | 9 → 9 | 6 → 9 | 9 → 9 |
| Screens with sideways scroll (max) | 4 (137 px) → **0** | 5 (115 px) → **0** | 4 → **0** | 5 → **0** |
| Term tips widening the page on focus | 117 → **0** | 117 → **0** | 117 → **0** | 117 → **0** |
| Page / console errors | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

The one target left is the Settings sheet's pause checkbox (26 px) inside a 44 px label row — the row is the target. The contrast runs after are all decorative glyphs or transients: the 🍽️/🌙 emoji in the day strip (colour emoji measured against their CSS colour), the matrix legend's coloured ●, empty ☆ outlines (C15, accepted), and the watch-view ticker's newest line mid-fade. The before set included the Restaurant table chips at 2.53:1 (B fixed them). "Covered" controls after are only rows scrolled under the sticky dock or past the top of the scrolling screen (by design; they scroll into view).

## R7.5 Playtests (`vite preview` of the built dist on :4801, Chromium via Playwright; 0 page errors and 0 console errors on every screen)

**(i) A brand-new player** (`kid/`, 1280×800, `?autopilot=0.55,0.5`). Title (shopfront, Continue/New game/How do I win?) → the explainer (two pictures; Escape returns focus to "How do I win?") → New game → "Who do you want to be?" → Apprentice chef, Cosy, "Mia" → the pinned "Start as apprentice chef →" → My shift → Start my shift → watch view (Play my shift 398×52, no Break buttons) → the onboarding (three steps paged by the autopilot, the clock held meanwhile) → **shift 1**: 223 s, 9 plates, 88% quality, 2 stars, "Next shift, try this: … about one more plate would have earned a third star", +0.9 cooking skill → Next day → **shift 2**: no onboarding (seen once per save and role), 197 s, 8 plates, 88%. (Before `e516ec6` the same run sat on onboarding step 1 for 330 s with 0 plates.) **Touch-only** (`touch/`, 1024×768 `hasTouch`, viewport shots, A's script re-pointed): the touch pad shows, the onboarding pages by tap, tap the fridge → "Grab Brownie (T1)", USE → "Chop the Brownie on the prep board", tap the board → "CHOP — tap USE on each mark", taps → "Cook it in the oven". 0 errors.

**(ii) Owner, normal** (`owner/`, 1024×768). Start picker (Owner, Normal) → lease: "How tricky? 🙂 Normal · Change" (not asked again) → three days: Menu list (starter menu), matrix toggle (labels ≥ 17.9 px, one column), Staff (hire a chef and a server; the week grid; "Goal complete: Hire a server" toast above the dock, clear of Open), Stock (Fill what's short + Place order; folded columns, no sideways scroll), Open → 4× → Evening ("Tonight you lost ▼ £98 · 41 guests", then ▲ £71 "£169 better than last night", then ▼ £168 "£239 worse"; the bars for the three nights). Day 2: Settings during service holds the clock (16:30 → 16:30 → 17:30 after closing), 4 and Space typed in the sheet do nothing. No tip on days 1–3 (the first tips need a losing run or a dud dish), so the tip actions were played on round 6's saves in `toast.mjs`: rota → "Done: Give Kofi Brennan Friday, Saturday and Sunday off" (Staff tab; the chef row loses KB Fri–Sun) and over-stock → the trim, both toasts clear of the dock at every size. Settings › Bigger: `data-text="large"`, survives a reload; Escape returns focus to Settings.

**(iii) Paths** (`paths/`, 1280×800). Empire year 4 (`empire-board`): the board card as an event, answered with "💡 The board's pick" → Evening → Next day → Empire › My shops: 5 city rows, tap Vasant → "0 your own, 13 franchise, 0 licence" and its shops; Money: a bar per month from the minutes (May £304,346 … Apr £272,602); the brand panel. The planning bar with five tabs: strip and heading on one row, tabs below (was a squeezed column). Stars (C's `stars-nights`): hero "54 days to guide day · inspection season", "Your last 60 nights · Steadiness 86 · 50 steady 2 wobbly 8 bad" at 1280 and 1024.

**(iv) Win** (`win/`). "A dynasty", confetti, the journey; **Save a picture** → `full-plate-rosie-s.png`, 69,636 bytes, PNG signature ok; button turns "Picture saved". Under reduced motion: no confetti.

| Sev | Finding | State |
|---|---|---|
| **P2** | Service toast sat over the pavement queue (and the speed deck at 1280) at 4× (B's handover). | Fixed (`738142a`) |
| **P2** | A Term tip shown near the right edge widened the page 106–137 px (C fixed only hidden tips). | Fixed (`738142a`) |
| **P2** | C's large-text `.menu-layout` rule squeezed B's list into 300 px; 1024 matrix labels 12.4 px, steppers 24 px (C22). | Fixed (`2733d51`) |
| **P2** | Stock order sheet scrolled 27 px sideways at 1024 (new in the merge). | Fixed (`2733d51`) |
| **P2** | Settings over service / a shift: the clock ran; Space/1/2/4 and WASD reached the game; after closing, Space re-opened Settings; after a mouse Pause, Space toggled Pause. | Fixed (`0f0f195`) |
| **P2** | B's inline Remove focused the destructive answer (Enter twice removed a dish). | Fixed (`0f0f195`) |
| **P2** | B's day strip squeezed by C's icon tabs (two lines at 1280; a column with five tabs). | Fixed (`924b338`) |
| **P2** | A11: Break buttons on the read-only watch view; Play my shift 34 px. | Fixed (`0f0f195`, `fdecf73`) |
| **P2** | A17: the career start button 1,230–1,392 px down the picker at 1024. | Fixed (`2733d51`) |
| **P2** | Autopilot never paged the onboarding (playtest harness: 0 plates, clock held). | Fixed (`e516ec6`) |
| P3 | Rota toggles 38–40 px wide at 1024; Settings segments 40 px. | Fixed (`2733d51`) |
| P3 | C18 district wraps mid-name; C21 difficulty asked twice. | Fixed (`2733d51`) |
| P3 | RotaWeek initials collide: "KB" is Kofi Brennan (chef) and another server on the same grid. | Open (show first names on a collision) |
| P3 | The evening tip's "Done" toast lands over the rota strip it just changed (1024). | Open |
| P3 | Hands-on kicker truncates ("YOUR SHIFT · SIDES · DESSE…") at 1024 with Bigger text. | Open |
| P3 | Settings pause checkbox 26 px (the 44 px row is the target); decorative glyph contrast (☆, ●, emoji). | Accepted |
| P3 | The career evening keeps "Next day" top-right while the owner's Evening pins it bottom-right (B's dock). | Open (A/B convention) |
| P3 | No evening tip in the first three days of a normal game, so a new owner meets the tip card late. | Open (design: a first-week "starter tip") |

## R7.6 Is it fun yet?
**Career: yes, and now on a tablet.** A child can play the shift with her finger, the first shift shows the loop before the clock runs, her station says "Yours", and the evening tells her what to try next in a sentence from her own night. **Owner: the day finally reads as a day.** Get ready → Service → Evening is on every screen, the one button that moves on is always bottom-right, and the money is a big number with yesterday beside it instead of a tax table. The doubled-up shift that loses hard mode is visible on the Staff tab before the tip has to say it. **Shell and paths: it looks like a game.** The shopfront, the explainer, the Stars countdown and night strip, the Empire's heroes and the win journey give the long game a shape a child can point at. What is still missing is the first week's coaching for the owner (tips arrive only after a losing run) and a reason to come back to a finished game (the win picture is the first keepsake).

Top three next steps:
1. **A first-week coach for the owner.** The same tip card from day 1 with "starter" tips (stock for tomorrow, put your best dish on, give a tired cook a day off), each measured by a learner variant, so the tip habit forms before the first losing fortnight.
2. **Play-test with a child on an iPad**, using the onboarding and touch play as the script: log taps that miss (the touch controller already knows the hit test), Skips of the onboarding, and how long the first slip takes; tune the USE/Drop column and tile size from that, not from bots.
3. **Tidy the last shared-shell seams:** a single place for toast anchoring per screen (the "Done" toast over the rota), first names on rota collisions, and an Empire KPI row of four with the hero tabs doing the rest (C19), so every screen has one hero and one primary button.

# Round 8: integration review and playtest (looks: maps, interface system, floor & kitchen art)

Reviewer: lead. Date: 9 Nov 2026. Covers `7a4fe8f` … `365b59a` and this docs commit. Three streams merged onto master with merge commits in the order asked: `r8-a` (`95046e2`, clean), `r8-b` (`c3d1b31`), `r8-c` (`868e1df`). Fixes are `adb71fa` … `365b59a`, then this docs commit.

**Status at the end of this pass:**
- `pnpm -r typecheck` ✓ (7 packages). `pnpm -r test` ✓: sim-core 243, content 54, handson 91, sim-career 61, sim-stars 67, sim-empire 96, game 320 (**932**; the merged streams were 925 = 879 + A 14 + B 17 + C 15, +7 this pass in `round8.review.test.ts` (6) and `round8.review.dialog.test.tsx` (1)).
- `pnpm --filter @full-plate/game build` ✓ from the final commit. Type audit on a private port (`FP_AUDIT_URL=http://localhost:5050/`): **31 screens, 0 text runs below 13 px, 0 page errors**, normal and `FP_AUDIT_TEXT=large` — now including the canvas labels painted into C's cached layers (see R8.2 b).
- Worktrees `fp-r8a`/`fp-r8b`/`fp-r8c` removed, branches `r8-a`/`r8-b`/`r8-c` deleted; A's orphaned `vite preview` on :4917 and its esbuild child killed. The temporary "before" worktree (master `7a4fe8f`, scratchpad `r8rev/before`, :5051) removed. Tree clean.

Artefacts (scratchpad): `r8rev/probe.mjs` (R7's probe + a maps step: zoomed, tooltip, city map, Open here, a city not entered), `r8rev/summ.cjs`, `r8rev/play.mjs` (playtests: kid, owner, jump, paths, maps, win), `r8rev/trap.mjs` (focus trap + drag), `r8rev/extra.mjs`, `r8rev/loadall.mjs` (33 old saves in the browser), `r8rev/perf.sh` (C's `r8c/play.mjs` frame timing, 4× CPU throttle); results `r8rev/probe-{before,after}/probe.json`, `r8rev/audit-{normal,large}/`; screenshots `shots/r8/review/{kid,owner,jump,paths,maps,win,touch,kid-1024-full,kid-rm,perf}/`.

## R8.1 What landed and how it merged
- **A (maps):** a drawn world map (seeded coastlines, terrain, halos for recognition, supply routes, HTML pins in the tab order with a tooltip, wheel/drag/pinch/± zoom, minimap, map key), a city district map with **+ Open here**, a Stars map of the home city. All styles in `map.css`; city x/y moved in content and `sim-empire/world.ts` (ids unchanged).
- **B (interface system):** a token block, a 50-icon set, Panel/StatTile, the dark ink HUD header, 44/52/56 px buttons, tables, charts, `.switch`; emoji out of chrome.
- **C (floor & kitchen art):** one art direction for both canvases, a cached opaque scene layer + cached sprites, palette modules that read theme tokens, `?perf=1`, dpr cap 2, reduced motion.
- **Merge resolutions.** `EmpireTab.tsx` auto-merged cleanly (A's rewrite only touched the map card and the side panel's ref/handlers; B's hunk was the side-tab icon line) — checked by hand: A's structure (`WorldMap`/`CityMap`, `mapView`, `openHere`, `data-opensite`, `data-enter-city`) with B's `<Icon name={TAB_ICONS[p]}>`; `PANEL_LABEL` keeps its emoji prefix and the label strips it, as on B's branch. `Service.tsx` auto-merged cleanly: B's `SPEED_ICON` and live-tile icons, C's `canvasDpr`, perf meter and reduced-motion option. `docs/UI-NOTES.md` was the only textual conflict (both appended at the end): **both kept, A then B**. `theme.css` did not conflict (A never touched it). Nothing was dropped from any side.

## R8.2 Integration seams
- **(a) Dark header vs the map; map controls under B's buttons.** Nothing inside `.status` inherits cream: B scoped header rules to `.status__stat` / `.status__end >` and kept `.modal { color: var(--ink) }`; the probe's contrast check finds no header or map run under 4.5:1. A's `.mapbtn` (44 px, its own class) is untouched by `.btn` heights; the district tiles' Open here (`.btn--sm.btn--tap`) are 44 px. **B's `.pill { text-transform: capitalize }` produced Title Case** ("You Run This One", "In Season", "Out Of Season") — `none` now and the eight lower-case pill strings written in sentence case (`de35ec2`). The city map's "←" and "+" text glyphs became `back`/`plus` icons so icon weight matches the rest of the chrome.
- **(b) Tokens.** Every token C's `palette.ts`/`floorPalette.ts` and A's `map.css` read resolves to a literal hex in theme.css (or a `var()` alias of one — `--own/--franchise/--licence`); `round8.review.test.ts` resolves the list. `--awning` is still the two-colour stripe C parses. A's ownership colours now use **`--own/--franchise/--licence`** (`OWN_COLOUR`), so map pins, the key, the My shops bars and site dots share B's tokens. **The type audit missed C's cached labels**: canvas text drawn into an `OffscreenCanvas`/detached canvas was skipped (`isConnected`), and the layers were painted before each screen's reset. The audit now patches `OffscreenCanvasRenderingContext2D`, divides by the layer dpr and nudges the viewport 1 px so the scenes repaint (`de35ec2`, `365b59a`): KITCHEN, PASS, WASH-UP, BAR, TILL, OFFICE, OPEN measure **13.0 px** — exactly at the floor.
- **(c) Dead rules.** `.empire__map svg*`, `.empire__map .pin-hit`, `.empire__legend` (theme.css) were unused by A's HTML map; removed with map.css's ten-line block that undid them (`de35ec2`). Visual check: pins, crown, legend, minimap, shop icons unchanged.
- **(d) Service.** SPEED_ICON deck and live tiles render with C's canvas (`owner/`, `perf/owner-*`). `?perf=1` meter is live (`window.__fpPerf.floor`) at the floor canvas's top-left; R7's service toast anchors under PAUSED at the top-centre of the floor — no overlap in the samples (`jump/01-service-perf1.png`). "Jump in" **On the pass / On the floor / Behind the bar** each mount the hands-on canvas (1232×605) with C's art. The evening light comes up after 18:00 (shots at 18:50 and 20:55: darker pavement, lamp pools). After the lazy split (R8.6) the floor appears one chunk-load after the first frame; the clock is unaffected.
- **(e) Hands-on.** R7 onboarding spotlights land on C's redrawn rail (36,188 298×60), fryer (636,295 80×46) and pass (296,431 318×46) — geometry is unchanged. Touch at 1024×768 (`touch/`): tap fridge → USE → tap board → chop marks; "Yours" outlines, mood faces, PASS label, the course cloche and the named colleagues visible (the helper badge and sous walk were not specifically caught in a shot — judged from C's tests). Autopilot shifts complete at 1280 (208 s and 198 s, 9 plates each, 3 stars; no onboarding on shift 2) and 1024 (204 s), 0 errors. Reduced motion (`kid-rm/`): C's test pins identical frames 0.25 s apart; shots show no bob artefacts. The hands-on kicker was the last all-caps label ("YOUR SHIFT · SIDES · DESSERTS") — sentence case now (`deda4d6`).
- **(f) Maps.** Wheel zoom about the cursor: the pin under the cursor moved **0.8 px** at 1.93×. Drag (60, 30) moved the map (60, 30) (a drag started on the part of the map under the action dock hits the dock — expected). Pinch 80 → 240 px (CDP touch) → 3.00×. + / − / reset: 1 → 1.6 → 4 (+ disabled) → 2.5 → 1; minimap only while zoomed. Focusing an off-frame pin (Kingsbridge at 4×) re-centres it; the map tooltip shows on hover and focus. All 12 pins are in the tab order. Escape on the world map or the city map changes nothing. City map **+ Open here** scrolls to and focuses the district's row (`high_street`, "Company · £357,801", in view); **← World map** returns. Stars map: every restaurant pinned (flagship, satellites, rival), "Inspectors are about" in season; hidden visits stay hidden (A's test). **The Settings sheet over the map holds the keys (+, −, arrows, Space: zoom 1.6 → 1.6) but Tab walked out of it** onto the tabs and pins behind (16/25 presses; the R7 build does the same — pre-existing). Dialog now traps Tab/Shift+Tab (`faf377a`, test).
- **(g) Saves.** All **33 old saves** (r6/review 3, r6/c 5, r7c 9, the R7 audit 8, r7/b 8) decode → encode with the same game keys and equal game objects, re-encoding byte-stable, and each loads in the browser with **0 errors**. City positions come from content (`cityPos` reads `extras.world.cities`; the save's own x/y is only a fallback), so old saves show the new map.
- **(h) Determinism.** Purity/determinism scans pass in every sim package. A's coastline noise is mulberry32 with fixed seeds in `worldGeo.ts` (no `Math.random`); C's `performance.now` is render-only (`RestaurantView`'s sprite positions are view-local; `perfMeter` reads timings only). `"sideEffects": false` in handson dropped nothing: handson's 91 tests and four built autopilot/jump-in shifts run with 0 errors.
- **(i) Open items handed over.** B: career eyebrows (My shift, career evening) now `.panel__eyebrow`, `.caps` removed; the Empire six-number row is **three columns at ≤ 1180 px** (four-line "Shop owners' mood" at 1024 before). A: the Map key under the dock until scrolled — accepted (the dock is the pinned primary; the page scrolls).

## R8.3 Fixes in this pass
| Commit | Fix |
|---|---|
| `adb71fa` | Main chunk over budget (228.7 kB): `RestaurantView` + `floorPalette` + handson sprites/layers/palette are a lazy chunk, prefetched in idle time; the frame loop (sim clock) starts at once and draws once the view lands. |
| `de35ec2` | Pills sentence case; career eyebrows; ownership tokens on the map; dead map rules out of theme.css and map.css; Empire totals 3 columns ≤ 1180 px; city-map icons; audit measures offscreen canvas text; `round8.review.test.ts`. |
| `deda4d6` | Hands-on kicker sentence case, `.caps` removed; UI-NOTES "Round 8 — review". |
| `faf377a` | Dialog traps Tab / Shift+Tab (pre-existing; found with the map open). |
| `365b59a` | Type audit repaints cached layers before measuring. |

## R8.4 Bundle
| Chunk | master `7a4fe8f` | merged, before split | final |
|---|---|---|---|
| main JS (`index`) | 195.9 kB | 228.7 kB | **183.2 kB** (gzip 59.7) |
| main CSS | 110.0 kB | 129.2 kB | 128.7 kB |
| EmpireTab | 33.4 kB | 47.3 kB | 47.3 kB |
| StarsTab | 19.0 kB | 23.9 kB | 23.9 kB |
| mapParts (shared by both paths) | — | 9.9 kB JS + 15.5 kB CSS | 9.9 kB JS + 14.9 kB CSS |
| HandsOnShift | 96.3 kB | 109.9 kB | 109.9 kB |
| RestaurantView (new lazy) | — | — | 36.5 kB |
| sprites (shared by both canvases) | — | — | 10.6 kB |

## R8.5 Probe: every screen, before (master `7a4fe8f`) vs after
`r8rev/probe.mjs` on the built dists (`7a4fe8f` in a temporary worktree on :5051; the final build on :5050), old R7 audit saves for both. 28 screens before, 33 after (+ map zoomed, map tooltip, city map, Open here, a city not entered).

| | 1280 normal | 1024 normal | 1280 Bigger | 1024 Bigger |
|---|---|---|---|---|
| Targets < 44 px | 1 → **0** | 1 → **0** | 1 → **0** | 1 → **0** |
| Text < 13 px | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Contrast < 4.5:1 (unique runs, all screens) | 13 → **4** | 11 → **4** | 12 → **4** | 9 → **4** (+2 transient) |
| Screens with sideways scroll | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Term tips widening the page | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Covered controls (not the dock/strip) on the 28 shared screens | 3 → 2 | 4 → 5 | 1 → 3 | 4 → 4 |
| Page / console errors | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

The last target (Settings' 26 px pause checkbox) is B's 72×44 `.switch`. The four contrast runs left are decorative and unchanged since R7: the matrix legend's ●, empty ☆ on Stars, the scorecard and the career evening; the 1024 Bigger watch view caught the ticker's newest line mid-fade (a different line each run; before had 2–4 of these too). The 🍽️/🌙 day-strip emoji are icons now. The "covered" differences are rows scrolled under the pinned primary button (`.btn--xl` in the dock — Stock steppers at Bigger text, an Empire pin at 1024): scroll position, by design. On the new map screens the only "covered" hits are pins the zoom pushed off the frame (transparent, unclickable, focusable — focusing re-centres them) and rows under the sticky header after Open here scrolls.

## R8.6 Frame times (C's method: every rAF callback timed over 5 s, autopilot, 4× CPU throttle, dpr 1, headless Chromium software raster)
ms of JS per frame (avg) / ms between frames (avg, p95):

| | early / 1× | mid / 4× |
|---|---|---|
| hands-on 1280 | 3.10 / 17.1 (p95 16.8) | 2.23 / 16.8 (16.8) |
| hands-on 1024 | 2.67 / 16.7 (16.7) | 2.21 / 16.7 (16.8) |
| floor 1280 (1× / 4×) | 1.59 / 16.9 (16.8) | 1.93 / 17.1 (16.8) |
| floor 1024 (1× / 4×) | 1.22 / 16.7 (16.8) | 2.16 / **17.9 (33.3)** |
| jump-in hands-on (owner, 1280) | 1.03 / 16.8 (16.7) | — |

JS per frame is 1–3 ms everywhere — the lazy split changed nothing here. Flagged over 16.7 ms between frames: **floor 1024 at 4×** (avg 17.9, p95 33 — about one dropped frame in twelve) and hands-on 1280 "early" (17.1: the window includes building the scene and sprite caches). C measured the same floor case at 17.9 on its branch and 17.2 on master, so it is not new to the merge; the cost is raster in the software renderer (JS is 2.2 ms), which a GPU-rastered laptop does as a texture copy. Watch it on a real tablet.

## R8.7 Playtests (`vite preview` of the built dist on :5050, Chromium via Playwright; 0 page errors and 0 console errors in every run)
**(1) A new player** (`kid/`, 1280×800, `?autopilot=0.55,0.5`): title → How do I win? → New game → Apprentice chef, Cosy, "Mia" → My shift → watch → onboarding (three steps, spotlights on the rail, the fryer, the pass) → **shift 1** 208 s, 9 plates, 88%, ★★★ → Next day → **shift 2** no onboarding, 198 s, 9 plates, 89%. **Full shift at 1024** (`kid-1024-full/`, `?autopilot=1`): 204 s. **Touch only** (`touch/`, 1024×768 `hasTouch`, viewport shots): tap fridge → USE → tap board → CHOP → taps. **Reduced motion** (`kid-rm/`).
**(2) Owner, normal** (`owner/`, 1280×800): lease → three days: Menu list and matrix, hire a chef and a server, the rota grid, Stock fill + order, Service at 1× with table 1 selected (gold brackets), 4×, after 18:00 (18:50, evening light), Evening each night, day 4 morning. Day 2: Settings over service holds the clock (16:05 → 16:05). Jump in (`jump/`): pass, floor, bar from an owner save with `?perf=1`.
**(3) Paths** (`paths/`, `maps/`): Empire year 4 (`empire-board`, day 1,109, 59 shops + 13 building): board card answered → world map (routes, halos, donuts, crown), wheel-zoomed, hover tooltip, Harbourton's district map (24 shops, "+2" overflow), Open here → the row focused, ← World map, Money (12 month bars), The brand; at 1024 with Bigger text the map and tooltip fit and the totals sit three to a row. Stars (A's `stars-season`, C's `stars-nights`): 40 / 54 days to guide day, inspection season, the night strip (63 cells), the Harbourton map with Rosie's, Chef's Table, The Little Bar, Bistro Rosie and the rival Maison Lune, "Inspectors are about".
**(4) Win** (`win/`): "A dynasty"; Save a picture → `full-plate-rosie-s.png`, 69,636 bytes, PNG signature ok; reduced motion → no confetti.

**Looks, judged from the shots.** One icon weight across header, tabs, speed deck, live tiles and the map controls; labels sentence case everywhere except cartographic region names on the map and canvas signage (KITCHEN, PASS, BAR — painted signs, deliberately caps). The dark HUD band sits above the map card and the canvases with the cream page between, so it frames rather than fights them; the map's sea/land palette is lighter than the band and the awning stripe ties both. Nothing muddy: the floor's evening tint is subtle (night 0.34 on the street, 0.16 in the room).

| Sev | Finding | State |
|---|---|---|
| **P2** | Main chunk 228.7 kB after the merge (budget 225). | Fixed (`adb71fa`, 183.2 kB) |
| **P2** | Type audit never measured C's cached canvas labels (offscreen, painted before the reset). | Fixed (`de35ec2`, `365b59a`; all 13.0 px) |
| **P2** | Tab walked out of the Settings sheet (and every Dialog) onto the page behind — pre-existing, found over the map. | Fixed (`faf377a`) |
| P3 | `.pill` capitalize → Title Case ("You Run This One", "Out Of Season"). | Fixed (`de35ec2`) |
| P3 | Map ownership colours on raw accents, not B's `--own/--franchise/--licence`. | Fixed (`de35ec2`) |
| P3 | Dead `.empire__map svg*`, `.pin-hit`, `.empire__legend` (+ map.css's undo block). | Fixed (`de35ec2`) |
| P3 | Empire six-number row cramped at 1024 (B). | Fixed (`de35ec2`) |
| P3 | All-caps eyebrows: career screens (B), hands-on kicker. | Fixed (`de35ec2`, `deda4d6`) |
| P3 | City map "←"/"+" text glyphs beside drawn icons. | Fixed (`de35ec2`) |
| P3 | Floor at 4× on 1024 drops ~1 frame in 12 under a 4× throttle (raster, not JS). | Open (measure on a real tablet) |
| P3 | Map key (and the map's bottom edge) under the dock until scrolled (A). | Accepted |
| P3 | Canvas signage labels sit exactly at 13.0 px. | Accepted (at the floor; don't shrink them) |
| P3 | Menu matrix on day 1: "No sales yet" overlaps the "Dogs" quadrant label. | Open (pre-existing) |
| P3 | "📚 Train" keeps an emoji in a button (no book icon in the set). | Open (add a `book` icon) |
| P3 | Goal toasts can land over the button they're about (Staff "Let go…"); R7's toast-anchoring item. | Open |

## R8.8 Next round
1. **Play-test on a real tablet** with the `?perf=1` counter on: the floor at 4× and the kitchen at dpr 2 are the two places the software-raster numbers are marginal; if a GPU tablet holds 60 fps, close it; if not, drop the floor's live light pools at 4×.
2. **One toast anchor per screen** (R7's open item, still visible over the Staff tab) and the day-1 matrix label collision — both small, both in the first five minutes of an owner's game.
3. **Finish the icon set** (`book`, and any remaining emoji in buttons) and add a lint-style test that no `<button>` text starts with an emoji, so B's rule holds without a reviewer.

# Round 10: integration review and playtest (decorating × staff with personality)

Master `2dc8a00` = r10-a (decorating) and r10-b (staff with personality) merged onto `f14f861`. This pass: `abc6ea5`, `fa128d0`, `3224719` (+ this doc). Before/after comparisons use a worktree at `f14f861`.

## R10.1 What landed and how it merged

- **r10-a** merged clean. **r10-b** had four hand-resolved conflicts, all "keep both": `content/src/index.ts` (decor.json + staffQuotes.json, both validators, `assembleFull` ships `decor` and `staffText`), `Icon.tsx` (A's 8 icons then B's 5), sim-core `commands.ts` imports, and the three notes files (A's section, then B's). Auto-merges checked: `Planning.tsx` (Decorate after Restaurant; Staff lazy), `Evening.tsx` (decor rows, level-up lines, portraits/mood reasons), `type-audit.mjs` (11b hiring sheet, 13b Decorate), `types.ts`, sim-core `index.ts`. Read through; nothing lost from either side.

## R10.2 Fixes in this pass

| Commit | What |
|---|---|
| `abc6ea5` | **(f) Sous-chef snap** (r10-b's flag; latent since R7). `sousPose` drew the newest walk under way from his post, so a walk that took over while he was out jumped him across the kitchen (master `f14f861` jumped on seeds 4, 8, 10, 11, 14; r10-b on 5, 6, 7). Now a walk that takes over sets off from where he is (`SousWalk.from` + a bounded `poseAt` recursion over the walks booked before it); a cover booked late goes to the slip he was waiting under (the group's first-due one); the lead-in follows the slip that fell due first, not the first due slip in rail order, and slides with it when it moves along the rail (`shownSlot`, 0.4 s). Still a pure function of (walks, time, pending). Tests: `handson/test/round10.sousSnap.test.ts` (5) and game `round7.careerUx` — the full lead-in check back on seeds 1, 4, 5, 6, 8, 9, 13, and a no-jump check on 2, 3, 7, 10, 11, 12, 14, 15, 16 (all 16 seeds: 0 jumps). |
| `abc6ea5` | **(a) One rule for a person's colours.** `RestaurantView.staffLook` and the hands-on colleague/sous sprites take skin and hair from sim-core `avatarFor` keyed by staff id (they used `hashKey` on the id in one place and on the first name in another). The career player's picked look now dresses their sprite on the hands-on floor and in the dining room. Test: 50 staff, portrait = sprite. |
| `abc6ea5` | **(e) Cover the pass → the hands-on sous chef.** The hands-on floor named "the first other chef on"; the sim's `passCover` picks the highest pass level. Now both pick the same person (`sousStaff`/`sousId`). Test: a level-1 chef who isn't first in the list is named and drawn; level 3 plates better than level 1 on an idle shift. |
| `fa128d0` | **Combined balance** (R10.3): `PERSONALITY_MOOD.dislike` −2 → −1; decor `stay` only with no queue **and** at least half the tables free. |
| `3224719` | **(d) Fitting night, hands-on:** "Jump in" drew the fitters' tables laid and empty; now under a dust sheet like the dining room (the sim already never seated them). Test in `round10.sousSnap`. |
| `3224719` | **Decorate preview crash on unmount:** `RoomCanvas`'s ResizeObserver read `wrap.current` after React had cleared it → `TypeError: reading 'clientWidth' of null` (1 page error in the cloud playtest, leaving the Decorate tab). Holds the element now; the rerun has 0 errors. |

## R10.3 Combined balance (headless, real pack, 200 seeds × 365 days, normal)

| strategy | before `f14f861` | merged `2dc8a00` | **after** |
|---|---|---|---|
| typical | 86.5% | 88.5% | **90.0%** |
| balanced | 99.5% | 98.0% | **98.5%** |
| cheap | 69.5% | 63.0% ✗ | **68.0%** |
| premium | 97.0% | 98.5% | **99.0%** |
| nohire | 0% | 0% | **0%** |
| learner | 98.5% | 96.0% | **98.0%** |
| decorator | (= typical) | 86.0% | **88.0%** (2.0 under typical) |

Covers/day, rating, popularity and month-12 cash per strategy are in SIM-NOTES "Round 10 — review". As merged, `cheap` was 6.5 points down (400 seeds: 7.2 — real): zeroing the like/dislike nudges restored master exactly, and halving the dislike alone brings it to −1.5. That lifted typical to 90.0% (400 seeds 90.5%) and left decorator 5 under it (400 seeds 85.8%, paired seeds 11:1); halving upkeep changed nothing, the cause was lingering that started on a quiet floor and held tables into the rush. Stay now needs half the tables free: decorator 88.0% (400 seeds 88.8%), +1.2 covers/day and +2.7 popularity over typical. **Empire** 5 seeds × 10 years `--board follow`: identical to `f14f861` row for row (franchise and company win 5/5). **Stars** script seed: trajectory moved with personalities (ends year 6 at ★★★, streak 2; was ★★, streak 0), still no 5-guide win in 6 years.

## R10.4 Seams

- **(b) Tab row** at 1024, normal and Bigger text: one row (Menu · Staff · Stock · Restaurant · Decorate; + Empire on that path), every tab 48 px tall, 17 px labels, no overflow — no scroller or regrouping needed.
- **(c) A busy evening** (3 new decor items + the fitters + a level-up + goal toasts): "What happened today" lists the decor's first night and the fitters first, then incidents; "How the team feels" puts level-ups first, then mood reasons. The toast region shows one toast at a time; sampled every 0.6 s for 6 s on four evenings, no toast overlapped the pinned dock.
- **(d) Fitting night** with the hiring sheet open at opening time → service starts (no soft lock); event cards answered at 4×; "Jump in" on the pass and on the floor work with tables closed (0 errors); now drawn under dust sheets.
- **(e)** see R10.2. **(f)** see R10.2.
- **(g) Saves.** All 33 old saves decode → encode with the same game keys and deep-equal games, byte-stable re-encoding, and load in the browser with 0 errors (11 that open on planning show 9 portraits in the staff room and the "Plain and simple" starter room). `round9.saves` tests pass. Cloud round-trip with the fake `window.claude` (R9's harness): a decorated (Cosy café), staffed (3 hires) day-2 game saved to the account from device A and Continued on device B — same staff, portraits and room; the save is one chunk, **4,657 chars packed (12,620 bytes raw)**, header 325 chars, 7 writes; 0 errors after the RoomCanvas fix.
- **(h) Purity.** New sim code (`personality.ts`, `decor.ts`, `sous.ts` changes) reads no clock or `Math.random`; per-package source-scan and frozen-input tests pass; `sousPose` on frozen walks returns equal poses.
- **(i)** Career look → My shift, hands-on sprite and score-card portrait (playtest). Legacy `TRAIN { staffId }` accepted in a career game (test).
- **(j)** `?autopilot=0.6,1` completes two career shifts at 1280 (179 s, 188 s) and two at 1024 (200 s, 182 s) with 0 errors.

## R10.5 Bundle (vite kB)

| chunk | before `f14f861` | after |
|---|---|---|
| main `index` | 193.2 | **195.9** (≤ 200) |
| sim-core | 113.1 | 129.9 |
| content | 159.3 | 178.2 |
| RestaurantView | 36.5 | 38.5 |
| decorArt (lazy) | — | 18.8 |
| DecorateTab (lazy) | — | 7.5 |
| StaffTab (lazy) | — | 14.0 |
| HandsOnShift | 110.1 | 112.5 |

Main has 4 kB of headroom left; the next feature that adds to the shell should move something out (the evening's decor/level-up rows or the StartPicker look picker are candidates).

## R10.6 Probe: every screen, before (`f14f861`) vs after (R7/R8 probe + Decorate; the hiring sheet opens by itself on the probe's save, so it is inside "Staff")

| viewport | screens | targets < 44 | text < 13 | low contrast | sideways scroll | covered | errors |
|---|---|---|---|---|---|---|---|
| 1280 normal | 33 → 34 | 0 → 0 | 0 → 0 | 4 → 6 | 0 → 0 | 4 → 3 | 0 → 0 |
| 1024 normal | 33 → 34 | 0 → 0 | 0 → 0 | 4 → 4 | 0 → 0 | 8 → 8 | 0 → 0 |
| 1280 large | 33 → 34 | 0 → 0 | 0 → 0 | 4 → 4 | 0 → 0 | 11 → 11 | 0 → 0 |
| 1024 large | 33 → 34 | 0 → 0 | 0 → 0 | 4 → 4 | 0 → 0 | 10 → 10 | 0 → 0 |

The new Decorate screen is clean at all four. Per-screen "worse" entries are all of known kinds: the extra Decorate tab scrolled under the sticky header on the map screens (one more tab, same as its neighbours); the start picker's boss list sits one row further under its pinned Start dock at 1280 Bigger (the look picker made the card taller; it scrolls); and an incident card caught mid-fade on the career watch screen (contrast 1.20 — timing). Type audit: 37 screens, **0** text runs < 13 px, 0 page errors, normal and Bigger.

## R10.7 Playtests (`vite preview` of the built dist on :5251, Chromium via Playwright; 0 page errors and 0 console errors in every run after `3224719`)

Screenshots: `scratchpad/shots/r10/review/` (owner, fitting, aged, career, autopilot-1280/1024, cloud, cloud-deviceB, empire-y4, stars, stars-nights, win, tabs-normal/large).

- **Owner, 7 days (Cosy, 1280).** Hired 3 from the sheet (it opens by itself on day 1 with "the chef your goal asks for" first). Bought the chalkboard, the radio and the rugs on day 1 — the rugs make day 2 a fitting night (1 table closed). Day 2: Knife skills on one chef; "Cover the pass" was correctly refused for the others ("is training today", "the only chef on today — you'd have to cover") and taken on day 3. Day-2 evening: the three decor lines and the fitters first, the level-up under the team. From day 2 the header shows the **Cosy café** style badge. Mood reasons on day 8: "had Tuesday off" for all three (true — the default rota gives everyone Monday and Tuesday; the owner covers, and their fatigue tip says so).
- **Aged save:** the day-8 save with every item's fitting day moved back 200 days opens with a "!" on Decorate and "3 things in your room look tired" in the dock; refreshing one clears its button and keeps the badge for the other two.
- **Fitting night** (1024): stripes bought (2 tables), next day the hiring sheet left open at "Open for service" — service starts; "Jump in · On the pass" shows tables 5 and 6 under dust sheets; reaches the evening ("The fitters were in · 2 tables were closed tonight").
- **Career with a chosen look** (Look 3: glasses, long hair): the picker, My shift and the score card ("Superstar shift, Mia!", 18 plates) all show that face; the hands-on sprite wears the same skin and hair (test-verified; too small to judge by eye at 1280).
- **Empire y4, Stars (both saves) and the win screen** render with 0 errors; the Empire tab row at 1024 still fits one row with six tabs.
- **Cloud round trip:** see R10.4 (g).

## R10.8 Findings

Fixed: the sous-chef snap (latent since R7); three different staff-colour rules; hands-on sous ≠ "Cover the pass" chef; the career look missing from sprites; `cheap` −6.5 and decorator −5 vs typical (balance); fitting-night tables laid on the hands-on floor; a `clientWidth of null` page error leaving the Decorate tab.

Open (small):
1. The game `round7.careerUx` lead-in **ratio** (≥ half of covers set off before the slip is due) misses on seeds 7 and 12 (0.50, 0.46) — no jumps; a fast bot leaves few due slips. A ratio over 16 seeds would be a sturdier test.
2. The cloud harness's header showed day 1 four seconds after the day-2 morning while the mark read "Saved to your account"; Save & quit then wrote day 2 and device B continued on day 2. Probably the header lags the debounced chunk write; worth a look in R11.
3. At 1280 Bigger the start picker's boss list sits under the pinned Start dock until scrolled (the new look picker made the card taller).
4. Main chunk 195.9 kB of 200.
5. The default rota gives every hire Monday and Tuesday off, so a new owner covers two days a week and is "worn out" by day 8 — pre-existing, but it now shows as every person's mood reason ("had Tuesday off"). A starter rota that staggers days off would read better.

## R10.9 Next round

- Stagger the starter rota (finding 5) and let the hiring sheet suggest who'd cover the gaps.
- Move 5–10 kB out of main before adding anything to the shell.
- Decor × Stars: decor prestige is capped at 8 and end-of-year prestige saturates near 91, so posh rooms matter mainly early and on the Stars path; consider a Stars-only reason to keep a smart room fresh.
- A child playtest of the staff room: do they read the likes/dislikes and rota around them, or only hire by skill bars?

# Round 11: integration review of the red-team fixes (r11-a … r11-e)

Master `9c9061e` + five merges in order a → b → c → d → e (one `--no-ff` merge commit each, the builders' 21 commits kept), then one review commit (`35a5496`: bundle + seam tests) and this doc. Before/after comparisons are against `9c9061e` (= `95c5ab0` code). Scratch work: `scratchpad/r11rev/`; screenshots: `scratchpad/shots/r11/review/`.

## R11.1 What merged

| Branch | Commits | What | Merge |
|---|---|---|---|
| r11-a | 2 | Save schemas per state (`sim-*/validate`, `game/state/saveCheck.ts`), CrashGuard, size/gzip caps, per-slot stall, account-keyed device cache, backup cap, own-key dispatch, NaN guards, fork guard, duplicate-id HIRE, autosave can't throw | clean |
| r11-b | 2 | Bank countdown (chip, evening card, last-days banner), archive lost games, spend guard, visible "Needs £X", greyed advice, Cosy hire into the overdraft, starter loan, starter chef wired **off**, toast clearing, Star/Dog after 7 days, rough-night reviews | 2 conflicts |
| r11-c | 5 | HQ backs the hands-on till, float + larder from HQ, franchises not hands-on, `ParkedSite`, bankruptcy screen + checkpoint retry, debt question, Stars keep-margin 2, head-chef pay rise, El Bulli only at the top, "Golden Plate" | 2 conflicts |
| r11-d | 4 | Portrait layout, plain-words pass, "No grown-up drinks" (on by default), terms out of Tab order, skip links, "?" words sheet, Skip to evening, remembered speed, mid-shift resume, Tap/Click, Stock filter, one pounds formatter, dev-gated playtest switches | 10 conflicts |
| r11-e | 8 | CI permissions + SHA pins + Dependabot + `.nvmrc`, vite 6.4 / vitest 4.1, no `--host`, OFL.txt, probe/audit in the repo with a baseline, aggregate lead-in/parity tests, 29-save corpus, README/ARCHITECTURE, RestaurantView split | 3 conflicts |

## R11.2 Collisions and how they were resolved

1. **"Over" vs "lost" (B × C).** One rule, no deletion: `saveStore.isOver` is always false and `saveCore.save` no longer removes a slot under any condition (the `remove` call is gone, not just bypassed). `isLost` (→ `SlotSummary.archived`) follows C's `runIsOver`: a career is never lost; an Empire is lost only when `status === "bankrupt"`; otherwise a game over. It is inlined in saveStore (C's import of `pathEngine` into saveStore would have pulled the path engine into the main chunk). So a bankrupt Empire shows EmpireEnd and its slot is archived ("Lost — day N", Continue skips it); "Try again from the last board meeting" restores a running Empire, whose next autosave writes the slot back **un-archived**; a running Empire with a bust shop is never archived (C's top-up / move-on). Test: `round11.review` "B × C". `state/save.ts`'s legacy-key removal was left alone (it doesn't touch slots). Save-file import of a finished game is now accepted (it arrives archived) — the old "already finished" refusal can't fire.
2. **A's schemas vs B/C/D fields** — A drops unknown top-level keys, and four things would have been silently lost: B's `GameState.starterLoan` (the loan could be taken twice after a reload), C's `ParkedSite` objects in `meta.parked` (A's schema only took strings: every Empire save with a parked site would have been refused as damaged after its first evening), the header's `archived` (an archived slot would have come back from the account un-archived), and D's `meta.handsOnResume` (mid-shift resume would never have fired). All four added; `ParkedSite` has its own schema (`sim-empire/validate validateParkedSite`, built from `sim-core/validate gameStateParts`); old string entries are still checked as GameStates. Also added: the board's `debt` decision kind and the Stars head chef's `staysUntil`. Commands (`TRANSFER_TO_FOCUSED`, `STARTER_LOAN`) are not stored in typed form (ownerCommands are `{type}` + JSON), CASH_LOW is an event (never saved), `reviewTemplates.rough` is content; settings go through `normalize` (keeps `noGrownUpDrinks`/`speedPicked`). E's 29 corpus saves all load (corpus.test 31/31); 14,000 reducer-fuzz states and 30 × 3,000 sim-core fuzz steps pass.
3. **Text-level merges:** HIRE keeps A's duplicate-id check and B's `hireNeed`; appReducer runs B's stale-toast clear and C's board checkpoint; A's robustness guards in sim-empire/stars keep D's words; StarsMap key = C's "Golden Plate" + D's "Sister restaurants"; the hire card keeps B's visible "Needs £X" (no tooltip) through D's formatter; reducer imports A's `FORK_DAY` and D's `clockLabel`; theme.css keeps B's bank block before D's portrait block (D's media query wins where they meet; the bank card spans the one column). Settings: D's drinks switch above E's About line (still last). Service: B's single toast line ("— choose what to do on its card.") with D's Tap/Skip. App: CrashGuard (main.tsx) + B's restartSlot/Continue-skips-archived + C's EmpireEnd routing before GameOver + D's skip links/lazy ForkCard/resumeHandsOn — all present, no edits needed.
4. **RestaurantView:** E's split taken whole; D's only change to it (the "+£X" floaty through `formatPence`) re-applied in the new `RestaurantView.ts`.
5. **type-audit.mjs:** E's rewrite on `scripts/lib/harness.mjs`; B's and D's changes ported into the harness: the lost game reached through Your games (`32a-lost-slot`, then "What happened" → `32-game-over`), `speedPicked` + the dev flag at boot, the canvas repaint nudge on the height, and 768×1024 (with touch) added to the audit's default sizes (`FP_AUDIT_VIEWPORT` kept as an alias).
6. **Words (D × B, C):** D's word list applied to C's new lines — "Head office topped up the till / paid … to open / paid off … 's till / can only spend / can't open the till / is sinking / owes the bank / gets / keeps borrowing / keeps sinking", EmpireEnd and the Empire tab's sinking card; and D's formatter to C's `focus.ts` and B's "Save £X to hire". B's new strings had no trade words. D's key-screen check is extended over EmpireEnd and the bank card/banner, and the formatter scan over B's and C's new files (`round11.review`).
7. **Lockfile:** E's; `pnpm install` leaves it byte-identical. `pnpm audit`: no known vulnerabilities.

## R11.3 Fixes in this pass (`35a5496`)

- **Bundle:** main was 207.2 kB after the five merges (budget 200). The start picker, the lease screen and the game-over screen are now lazy chunks (the title prefetches the first two on idle, so "New game" doesn't wait): **194.9 kB**. No feature removed.
- **`round11.review.test.tsx`** (7): the four save fields above round-trip byte-identically through `checkedDecode` (and a damaged ParkedSite is refused); the archive rule end to end through the store; D's trade-word and formatter checks on B's/C's screens and files.
- Everything else from the merges themselves (R11.2).

## R11.4 Tests

`pnpm -r typecheck` clean. `pnpm -r test`: **1,231 passed** (sim-core 301, content 68, handson 97, sim-career 61, sim-stars 72, sim-empire 106, game 526), 0 failed; `round7.dayLoop`'s 8 s Menu-matrix timeout kept. E's aggregate bars re-measured on the merged sim (C/D didn't touch the sous chef or pacing): lead-in seeds 1–16 = 1.00 .53 .54 .64 .69 .63 .50 .71 .63 .60 .55 .46 .60 .60 .60 .69, mean 0.623 (bar ≥ 0.5, each ≥ 0.4); parity pooled half speed 95.4 % ± 2.4, full 96.1 % ± 2.6, idle 99.3 % ± 3.0 — identical to E's measurement on master, so the bars stay where E set them from that data.

## R11.5 Red-team reproductions re-run (merged master)

**Security kit** (`redteam/sec` harness + A's pointed copy, `e2e.mjs` on the built dist): the 10 assertions that proved a hole now fail (the hole is gone) and the 5 "held up" ones pass — same as A's branch. obj-name / staff-obj / day-string files: "That save file is damaged.", nothing stored, title renders after reload; gzip bomb: "That file is too big…" in **0.29–0.32 s**, JS heap 6 MiB (was 13.6 s / 3.7 GB); 300 kB name: cut to 40, account stays **on**, next game reaches the account; XSS name: plain text, `document.title` unchanged, 0 injected `<img>`; padded save: 1 chunk, raw text not kept; backups ≤ 2 per game (3 slots after 10 conflicts, was 11); 0 orphan chunks; forged `chunkCount`: 1 read (was 400k); shared browser: account B got **0** of A's games and A's synced game stayed on the device. (The harness's `cashInf` case doesn't actually inject 1e999 — its regex misses the escaped envelope; A's own test covers Infinity.)

**Sim kit:** `micro.ts` — `toString`/`__proto__`/… rejected; HIRE after HIRE_STAFF with the same id refused; decor 0p gain; CANCEL_ORDER 0p; SET_OWNER_PROFILE still accepted **by the sim API** (the reducer gate is what stops it). `fuzz-core` 30 × 3,000 steps (2,141 days): 0 invariant breaks, 0 determinism / save-mid-run divergences. Reducer fuzz 14 × 1,000 actions: 0 issues, 0 soft-locks. `empire-exploits`: every NaN/Infinity argument refused; 0.4p campaign refused (min £500); sell→buy-back still loses HQ £221k–£1.35m. C's repros: F2 first visit — till £3,720 from HQ (was £20,000 free), sweeping it returns what HQ paid; F1 franchise — focus refused (the script's old wording still prints, but the franchisee's numbers match the model's); F3 hire-everyone — plays to day 961, Empire running; master's own `empire-f3-3.json` bust save loads to the evening with "Head office topped up the till £128,430.", then 120 days: 44 top-ups (£37,563), distress never above 0. `empire-bust` — HQ never hits the −£2m line in 1,260 days (−£846k) but the sinking card shows from day 465 with one-tap "Sell …" / "Close …", and the board asks the debt question. `savesize-r11`: 10 visited sites 16.50 → 0.58 MB raw (2.02 → 0.10 MB packed). `cosy-lock` 8 seeds: a Cosy player who never hired can still hire on day 199 (was day 54–135), and switching to typical play hires on every seed.

**Stars dynasty** (`stars-sum`, scripted `stars` profile, 12 years) — row-for-row identical to C's branch:

| run | dynasty by year 10 | by year 12 | stars lost on guide days |
|---|---|---|---|
| cold, 20 seeds, master | 3/20 | 3/20 | 22 |
| cold, 20 seeds, merged | **12/20** | 16/20 | 0 |
| fork (day 365, balanced year 1), 10 seeds, master | 1/10 | 1/10 | 15 |
| fork, 10 seeds, merged | **7/10** | 8/10 | 1 |

## R11.6 Combined balance (headless, real pack, 200 seeds × 365 days, normal)

| strategy | `95c5ab0` | merged | covers/day · ★ | bank chip ever / last-days banner |
|---|---|---|---|---|
| typical | 90.0 % | **90.0 %** | 91.0 · 4.26 | 23 / 21 |
| balanced | 98.5 % | **98.5 %** | 86.9 · 4.40 | 3 / 3 |
| cheap | 68.0 % | **68.0 %** | 78.0 · 4.45 | 74 / 68 |
| premium | 99.0 % | **99.0 %** | 61.3 · 4.55 | 2 / 2 |
| nohire | 0 % | **0 %** | 11.1 · 1.86 | 200 (median day 101) / 200 |
| learner | 98.0 % | **98.0 %** | 88.3 · 4.26 | 6 / 4 |
| decorator | 88.0 % | **88.0 %** | 92.2 · 4.31 | 27 / 24 |

Identical row for row (nothing the scripted owners do touches B's Cosy rule, the loan or the words). **Empire** 10 years × 5 seeds, `--board both`: franchise skip 5/5 (y5.0–5.6) / follow 5/5 (y5.3–6.2); company 5/5 (y7.2–8.1) / 5/5; In-N-Out skip 3/5 / follow **5/5** (y8.5–9.1) — follower 15/15, wins and years as master (one In-N-Out follow seed's HQ cash differs by £0.1m). **Stars** see R11.5.

## R11.7 Bundle (vite kB, minified; master built by E on `9c9061e` with vite 5)

| chunk | `9c9061e` | merged | | chunk | `9c9061e` | merged |
|---|---|---|---|---|---|---|
| **index (main)** | 195.85 | **194.92** | | SlotPicker | 8.49 | 9.37 |
| react | 141.67 | 142.12 | | StaffTab | 13.95 | 14.29 |
| content | 178.18 | 186.25 | | DecorateTab | 7.47 | 7.83 |
| sim-core | 129.89 | 133.58 | | StarsTab | 23.92 | 24.51 |
| paths (sim-empire/stars/career) | 154.19 | 165.20 | | BoardMeeting | 5.65 | 5.71 |
| saveCheck (new, lazy) | — | 16.32 | | CareerEvening | 11.50 | 11.53 |
| saveCore | 5.89 | 9.28 | | MyShift | 13.74 | 13.79 |
| saveCloud | 7.17 | 9.50 | | WinScreen | 6.23 | 6.27 |
| saveFiles | 3.49 | 3.87 | | GuideEnvelope / HandoverModal | 3.01 / 1.69 | 3.02 / 1.69 |
| saveCodec | 1.17 | 1.48 | | MenuMatrixPanel | 4.15 | 4.16 |
| SaveSheet | 1.78 | 2.16 | | mapParts | 9.95 | 9.93 |
| HandsOnShift | 112.54 | 112.66 | | decorArt / sprites / device | 18.79 / 10.56 / 0.18 | 18.78 / 10.56 / 0.18 |
| RestaurantView | 38.48 | 38.57 | | BankCards (new) | — | 3.74 |
| EmpireTab | 47.33 | 48.66 | | EmpireEnd (new) | — | 2.95 |
| NewGame (new, was in main) | — | 6.28 | | ForkCard (new, was in main) | — | 3.55 |
| StartPicker (new, was in main) | — | 5.85 | | GoalExplainer (new) | — | 4.21 |
| GameOver (new, was in main) | — | 2.05 | | WordsDialog (new) | — | 0.74 |

`content` +8 kB is D's soft-drinks view; `paths` +11 kB is C's focus/board code plus A's command guards.

## R11.8 Probe and type audit (built dist, `vite preview` :5701; baseline `scripts/probe-baseline.json` rewritten)

| run | screens | targets < 44 (all glossary terms) | overflow screens | covered | text < 13 | errors |
|---|---|---|---|---|---|---|
| 1280×800 normal | 38 → 39 | 283 → 288 | 0 → 0 | 5 → 7 | 0 → 0 | 0 → 0 |
| 1024×768 normal | 38 → 39 | 291 → 312 | 0 → 0 | 12 → 12 | 0 → 0 | 0 → 0 |
| **768×1024 normal** | 38 → 39 | 291 → 288 | **38 → 0** | 20 → 33 | 0 → 0 | 0 → 0 |
| 1280×800 Bigger | 38 → 39 | 269 → 275 | 0 → 0 | 8 → 8 | 0 → 0 | 0 → 0 |
| 1024×768 Bigger | 38 → 39 | 290 → 311 | 0 → 0 | 13 → 13 | 0 → 0 | 0 → 0 |
| **768×1024 Bigger** | 38 → 39 | 290 → 287 | **38 → 0** | 19 → 31 | 0 → 0 | 0 → 0 |

Non-term targets (disabled, switch, handler-only) stay 0 everywhere; contrast 4 (the empty ★ glyphs) as before. **Sideways scroll at 768 is gone on every screen.** **Glossary targets did not fall:** D's `tabIndex=-1` takes terms out of the Tab order (keyboard), but they are still tappable 17–30 px words, which is what E's probe counts — and D's own rule ("a trade word on screen is either gone or inside a Term") adds terms: the lease's "People walking past", Service's "Take off tonight" header, the Empire strip's HQ chip, the career rung names (+1–4 per screen; day-1 Menu's 71 unchanged). Portrait "covered" hits are content scrolled under the pinned dock and tabs under the edge fade (D's design). Type audit (now 1280, 1024 and 768-touch): **117 screens per text size, 0 DOM and 0 canvas text runs < 13 px, 0 page errors**, normal and Bigger.

## R11.9 Playtests (built dist on :5701, Playwright Chromium, touch unless noted; 0 page errors in every run)

- **New player to day 3** at 1024×768 and 768×1024: no sideways scroll (scrollWidth = viewport); with the default settings **no drink word** on the menu, the full stock list or any button (control run with the setting off: ale, wine, beer, prosecco, lager present); Open for service on screen every morning; Skip to evening each day.
- **Owner 7 days** (Normal, 1024): decor on day 1, restock, morning post; day 8 Star/Dog pills appear only after 7 days of sales. **Decor spree** (B's p11, Hard): four buys, then "This leaves you with £630 — are you sure?" at each further item; kept **£1,130**, a chef affordable. **No-hire** (real saves): day 31 "Save £68 to hire a chef" + loan tip → Borrow £1,000 → hired; day 81 "Bank: 13 days left" and the evening card; day 92 the last-days banner; the loss kept as "Lost — day 93"; **Start over with the same restaurant** → day 1, same name.
- **Empire bust at the flagship** (C's save of master's `empire-f3-3.json`) at both sizes: opens on the evening, "Head office topped up the till £128,430", no game-over screen, the pending board meeting opens. **Broke HQ**: "R3 has run out of money" card → Close this shop and move on → Harbourton Business Park, day 661.
- **Stars** save at both sizes: "Golden Plate", no "Michelin", no "satellite", no drink words; no sideways scroll at 768.
- **Win** (dynasty save): the win screen. **Crafted imports**: obj-name and staff-obj "damaged", bomb "too big", XSS name loaded as plain text.
- **Mid-shift reload** (Normal, On the pass, 1×): clock 12:15 → 14:25, reload, Continue → straight back in hands-on with "Back on your shift from 14:00 — the game saves every hour of service."
- **Keyboard** (1280, no touch): from the top of a planning screen Tab → "Skip to main action", Enter → focus on Open for service, Enter → service; "?" opens What the words mean. (Tabbing straight through the menu without the skip link is still ~77 stops — the menu's Add/price buttons — but no glossary terms.)
- The red-team's own `s7` stops at B's new confirm dialog (it doesn't answer it), `s13` shows no sideways scroll at 768 on every tab, `s14` no glossary terms in the Tab order.

Screenshots: `shots/r11/review/` (newplayer-*, owner7-*, p11/, empirebust-*, empirebroke-*, stars-*, win-*, import-*, resume-*, keyboard-*, ux-s13-*, audit-normal/, audit-large/).

## R11.10 Findings

| id | status | evidence |
|---|---|---|
| S1 | CLOSED | e2e + brick test: refused "damaged", title/Your games render; CrashGuard |
| S2 | CLOSED | harness hugeName: account stays on, name 40 chars |
| S3 | CLOSED | day-string, staff object, 1e5 staff, bogus phase refused; schema on every load path |
| G1 | CLOSED | f3-load (top-up, 120 days no game over), empirebust/empirebroke playtests, archive rule test |
| G2 | CLOSED | cosy-lock: hire possible on day 199 on all seeds; starter loan playtest |
| G3 | CLOSED | dynasty 12/20 cold, 7/10 fork by year 10 (≥ 50 %) |
| U1 | CLOSED | probe 768: 0 overflow screens; playtests at 768 |
| U2 | CLOSED | p11 spree keeps £1,130, chef affordable; "Needs £X" visible |
| U3 | CLOSED | chip/card/banner playtest; nohire bank-warnings line; archived "Lost — day 93" |
| S4 | CLOSED | bomb refused in 0.3 s, 6 MiB heap |
| S5 | CLOSED | harness sharedDevice: B got 0 of A's games, A's kept |
| S6 | CLOSED | 1 chunk for a padded save; ≤ 2 backups; 0 orphans |
| S7 | CLOSED | pages.yml permissions `{}` + per job; pipeline test |
| G4 | CLOSED | sim-stars round11.dynasty test (El Bulli win only with ★★★ on 2 guides) |
| G5 | CLOSED | switchSite refuses a franchise; hands-on button only on company shops |
| G6 | CLOSED | F2: float £3,720 from HQ, no free £20k |
| G7 | CLOSED | 10 sites 16.50 → 0.58 MB raw |
| G8 | CLOSED | EmpireEnd + checkpoint test; sinking card from day 465 in empire-bust |
| U4 | CLOSED | B's reducer test; one toast at a time in playtests |
| U5 | CLOSED | pills only from day 8 (owner7) |
| U6 | CLOSED | round11.losing tests (greyed tip/choice) |
| U7 | CLOSED | D's key-screen test + review extension; "HQ" gone from sentences |
| U8 | CLOSED | default hides every drink word (playtest, control with it off) |
| U9 | CLOSED | Tab → skip link → Open for service; terms out of Tab order |
| U10 | PARTIAL | Skip to evening, remembered speed, Cosy 4×; the year is still ≈ 4.7–6 h of play |
| U11 | CLOSED | reload at 14:25 resumes hands-on from 14:00 |
| T1 | CLOSED | probe/audit in the repo, baseline re-set (R11.8) |
| T2 | CLOSED | aggregates re-measured after the merge, unchanged |
| T3 | CLOSED | corpus.test 31/31 on the merged validators |
| T4 | CLOSED | README, ARCHITECTURE, `.nvmrc`, engines |
| S8 | CLOSED | SHA pins, Dependabot |
| S9 | CLOSED | `pnpm audit`: no known vulnerabilities; no `--host` (only `dev:lan`) |
| S10 | CLOSED | forged chunkCount → 1 read |
| S11 | CLOSED (by design, not reproduced) | a failed header write re-reads the header before the next push (A) |
| S12 | PARTIAL | bidi/zero-width stripped, `?autopilot`/`?perf` dev-gated, prefs capped at 50; still no CSP, and GitHub Pages' shared origin is inherent |
| S13 | CLOSED | `fonts-licence/OFL.txt`, Settings About line |
| G9 | CLOSED | micro.ts: Object.prototype names rejected in all dispatchers |
| G10 | CLOSED | empire-exploits D lines: every NaN/Infinity refused; autosave catch |
| G11 | CLOSED | A's tests (kinds, NaN, MAX_SATELLITES) |
| G12 | CLOSED | fork once, from day 365, owner only (A's test; reducer fuzz 0 issues) |
| G13 | CLOSED | micro.ts 2: duplicate id refused |
| G14 | PARTIAL | campaign min/stacking, transfer cap, rounding fixed; SET_OWNER_PROFILE gated in the reducer but still accepted by the sim API |
| U12 | CLOSED | "Your career", Tap, mood sign, rough-night reviews, Golden Plate, Stock filter, burnout line, one formatter, RestaurantView split |

## R11.11 Still open

1. **Glossary words as touch targets:** 288–312 inline terms under 44 px per run; they're out of the Tab order now but a finger still hits 17 px words. A taller invisible hit area (or fewer inline terms on day-1 Menu) would bring the probe's count down.
2. **U10 length:** the fork is still ≈ 4.7 h even skipping every service; a Cosy "quick year" was in the red-team's list and isn't done.
3. **S12:** no Content-Security-Policy meta; Pages origin shared across the owner's project pages (localStorage readable by sibling repos).
4. **G14:** `SET_OWNER_PROFILE` remains a public sim command (only the reducer refuses it).
5. Starter chef stays **off** (`STARTER_CHEF = false`): B's experiment cost typical −2 and cheap −3 points; it rescues the never-hire child (0 → 73.5 %), so it's one flag away if a child playtest says the loan isn't enough.
6. Probe/audit aren't in CI (Playwright's Chromium on the runner); the baseline only guards when someone runs them.
7. Main chunk 194.9 kB of 200: the next shell feature should move something else out (Settings' sheet body or the Evening's bank/decor rows are the next candidates).
