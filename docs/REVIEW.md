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
