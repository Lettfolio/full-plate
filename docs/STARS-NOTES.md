# STARS-NOTES — `@full-plate/sim-stars` (Path B: The Stars)

Round 3, package 2. This package owns inspectors, prestige tracks, the test kitchen, sourcing, satellites, ticketing,
chef stress, stagiaires, the group cap, the Smyth arc and the endings. It is pure TypeScript over its own
`StarsState`. It reads sim-core's `DayResult`/`GameState` and hands effects back through one function. It never
edits sim-core, content or game.

```
pnpm --filter @full-plate/sim-stars typecheck | test | build | demo | headless [--years 6 --seed 3 --seeds N --refit-year Y --profile stars|bistro]
                                                                       [--fork-day 365 --year1 balanced|premium|typical]   # start Stars from a played year 1
```

## 1. How the game mounts it

### State
Keep `stars: StarsState` next to `GameState` in the game reducer and save it next to the game save
(`serializeStars` / `deserializeStars`, `version: 1`). Create it at the fork, when the player commits to the Stars
path (BRIEF: about year 2–3): `newStarsState(content, gameState)`. Its RNG comes from `hashSeed(game.seed, salt, day)`,
so a given save always meets the same inspectors on the same nights.

### Daily loop (the only wiring needed)
```ts
// MORNING (planning). Shut for a refit/relaunch? Make the forced service empty:
game = prepareService(game, stars);                  // pushes a one-day ×0 footfall mod while isClosed(stars, day)
// Cook from the signature-aware pack, so researched dishes get their appeal and ceiling bonus:
const cooking = withSignatures(content, stars);      // memoised; stable object between research completions
// … START_SERVICE / tick / runDay with `cooking` instead of `content` …

// EVENING (phase "evening" or "event", BEFORE END_DAY / RESOLVE_EVENT, while game.service still holds the tally):
const result = game.history.at(-1)!;
const r = stepStarsDay(cooking, stars, result.closed ? closedDay(result.day) : result, game);   // a 0-cover stock-out is NOT a day off
stars = r.stars;                                     // r.events → news feed / modals (section 3)
({ state: game, stars } = applyStarsEffects(game, stars));   // cash, prestige, popularity, footfall mods
for (const e of r.events) if (e.type === "HEAD_CHEF_LEFT" && e.staffId) game = applyCommand(content, game, { type: "FIRE", staffId: e.staffId }).state;
```
- `stepStarsDay` is idempotent per day: a second call for the same `result.day` changes nothing. Call
  `applyStarsEffects` **once** per evening, because each call pushes the persistent footfall multiplier again.
- Pass `game` (the evening state). Its `service` tally gives exact per-dish plate quality. Without it the proxies fall
  back to review quality (see section 4).
- The head chef is the best chef on staff that hasn't left. Hiring a chef 10 or more skill points better promotes
  them with no disruption. Firing the head chef, or losing them in the Smyth arc, hands the pass to the next best
  chef and disrupts consistency for 45 days.

### Commands (`applyStarsCommand(content, stars, cmd, { day, cash, state? })`)
Costs go into `stars.ledger.pendingCash` and are paid at the next `applyStarsEffects`. Affordability is checked
against `cash + pendingCash`. A refusal returns `{ type: "REJECTED", reason }` with a player-facing sentence.

| Command | Screen | Cost (pence) | Effect |
| --- | --- | --- | --- |
| `UNLOCK_TEST_KITCHEN` | Kitchen ▸ Test kitchen | 800,000 + 2,000/day | enables research |
| `RESEARCH_DISH { dishId }` | Test kitchen | 60,000, takes 20 + skillRequired/4 days | dish becomes a **signature** |
| `SIGN_SOURCING { supplierId }` / `DROP_SOURCING` | Suppliers | 1,000/day each | partner relationship 10→100 over ~3.5 open years |
| `UNLOCK_TICKETING` / `SET_TICKETING { prepaid, dynamicPricing }` | Bookings | 500,000 | prepaid: +5% footfall (no-shows) and 5% of food cost back; dynamic: +3% of revenue |
| `SET_STAGIAIRE_POLICY { paid, count ≤ 6 }` | Staff ▸ Stagiaires | paid 11,000/day each | +1 consistency each, −1 stress each; unpaid ⇒ scandal risk |
| `OPEN_SATELLITE { kind: bar\|bistro\|ticketed, name? }` | Group | 3.0m / 6.0m / 8.0m, −10% per star | earns 18k / 32k / 40k a day (+15% per star), absorbs 2/4/3 staff, never earns stars |
| `TRAIN_SATELLITE_CHEF { satelliteId }` | Group | 1,000,000, 120 days | removes that satellite's group-cap penalty |
| `CLOSE_SATELLITE { satelliteId }` | Group | — | — |
| `BACK_HEAD_CHEF` | Smyth-arc modal | 3,000,000 | chef leaves as a friend: "backed" satellite (8k/day), +5 personality for 3 years, 22-day disruption |
| `LET_HEAD_CHEF_GO` | Smyth-arc modal | — | chef opens a **rival** now (45-day disruption) |
| `CLOSE_FOR_REFIT { days ≤ 360 }` | Restaurant | — | closed (Fat Duck rule applies) |
| `HAND_BACK_STARS { retire? }` | Head chef card | — | stars → 0, out of the guide for 3 guide days, −40 stress; `retire: true` ends the run (non-winning) |
| `RELAUNCH_CONCEPT` | Head chef card | 2,500,000 | shut 30 days, consistency window reset, +10 personality for a year, −30 stress |
| `CLOSE_AT_PEAK` | Head chef card | — | needs ≥ 2 stars at your best ever: **El Bulli ending (a win)** |

### Screens the game needs
1. **Stars hub** (sidebar card): star badge, "next guide in N days", inspection-season flag, stress meter,
   steadiness meter, three-star streak `n/5`.
2. **Guide-day reveal** (modal, on `GUIDE_DAY`). Keep the badge on last year's stars until the player opens the
   envelope. Then show the stars, the reason line, and the year's visits (day, pseudonym, total, per-criterion
   scores). The demo has a working version.
3. **Prestige tracks** strip: Michelin, World's 50 Best (rank / hall of fame), Gault&Millau `x/20`, Good Food `x/10`,
   last local-critic review.
4. **Test kitchen**, **Suppliers**, **Group** (satellites with a ⚠ while untrained), **Bookings** (ticketing),
   **Stagiaires** panels, built from `starsView()` fields plus the commands above.
5. **Smyth-arc modal** on `SMYTH_ARC_STARTED`: Back (cost) or Let go, with the deadline (60 days, after which they
   leave for a rival anyway).
6. **Endings** screen on `ENDING` (`dynasty` win, `el_bulli` win, `handed_back`).

### What the UI may show, and what it must hide
The UI reads **`starsView(stars, day)`** only. It omits the hidden fields.

| May show | Must hide before guide day |
| --- | --- |
| stars, peak, streak, days to guide, inspection season | `guides.michelin.scheduled` (visit days) |
| past years' revealed visits and guide history | this year's `inspectorVisits` (`revealed: false`), including their count |
| steadiness = `windowConsistency(last 60 nights)` (the player's own kitchen data) | `assessment` accumulators, `lastCriteria`, `dailyScoreEma` |
| head chef stress / reputation / wantsOwnPlace, satellites, partners, signatures, rival | `inspectorModel()` output (predicted stars, confidence) |
| rumours (`view.rumours`): real visits **and decoys**, so never proof | — |
| **Cosy only:** `view.cosyHint`, a fuzzy, never-numeric line built on `inspectorModel` | — |

`inspectorModel(visits, consistencyWindow)` is **for debug and the cosy hint only**. The demo shows it in a
collapsed "developer debug" panel to make that clear.

## 2. Formulas

All tunables live in `src/constants.ts`. Calendar: 30-day months, 360-day years, day 0 = 1 April (sim-core).

### Inspectors (hidden)
- **Assessment window**: from the day after the last guide day (or the start of the path) to the next guide day,
  **1 February** (the first one needs ≥ 180 days, so starting on day 0 gives guide day 300).
- **Visits**: `int(2..5)` distinct days drawn when the window opens. Each is in inspection season (the last 120
  days) with probability ½, otherwise uniform. None fall in the last 15 days ("at the printer"). The first window
  skips its first 21 days.
- **On a visit night**, if the restaurant is open, the inspector scores that day's five criteria, each with
  ±N(0, 3) palate noise. If it is closed, they rebook 7–30 days later, but only if that's before the cutoff.
  Otherwise the visit is lost.
- **Guide day**:
  - `yearConsistency = ½ · mean daily consistency criterion + ½ · seriesConsistency(the whole year's daily qualities)`
    ("every service of the year counts").
  - `score = mean over visits of criteriaTotal(visit, with consistency = ½ visit + ½ yearConsistency)`.
  - Target stars: score ≥ **78 / 85 / 91** for ★ / ★★ / ★★★.
  - The guide is conservative. Stars go up one per year (two if the score clears the higher bar by 3 or more over
    at least 3 visits) and down one per year at most.
  - **Fat Duck rule**: fewer than 120 open days, or fewer than 2 completed visits ⇒ *not assessed* ⇒ **stars lapse
    to 0**.
  - All of the year's visits are revealed, the next window's visits are drawn, and the three-star streak updates.
- **Win (dynasty)**: three stars on **5 consecutive guide days** with `cash ≥ 0`. From a cold start the earliest is
  year 7 (★ in Y1, ★★ Y2, ★★★ Y3, then five guides).

### Criteria proxies (`src/proxies.ts`; "food" = every course except drinks)
| Criterion | Proxy |
| --- | --- |
| harmony | ½ plate-weighted mean food quality + ½ mean of per-dish mean quality (one weak dish drags it) |
| technique | ½ harmony + ½ min(100, 1.35 × plate-weighted `skillRequired` of food sold) — ambition × execution |
| personality | 0.45 harmony + 40 × signature share of food plates + 0.25 × head-chef reputation (+10 relaunch, +5 alumni loyalty) |
| ingredients | 0.55 harmony + 5 + 25 × in-season share + 20 × partner share × relationship/100 + 100 × Σ(partner seasonalBonus × in-season share) + 5 if prepaid ticketing. Shares are over fresh-produce portions (ingredients any partner sells), weighted by plates sold |
| consistency | `windowConsistency(last 60 open days' mean quality)` − 6 per untrained satellite (**group cap**) − 15 while disrupted − 0.4 per stress point above 70 + 1 per stagiaire (max 6) |

`seriesConsistency = 100 − 2·sd − 40·offNightShare − 0.6·max(0, 80 − mean)`, shrunk toward 60 below 10 days. An
off night is more than 8 below the series mean. (Round 3 review: was 3·sd / 60·off, which scored a strong-chef-five-nights,
weak-cover-two-nights week at exactly 0. `starsView().weakNights` names the weekdays that drag it down; the window
records its sim days in `consistencyDays`.)

**Short menu (round 3 review P1).** A service where at least `SHORT_MENU_MIN_86` (3) food dishes were 86'd *for most
of the night* enters the window `SHORT_MENU_DROP_PER_DISH` (8) points lower per dish off, so it always reads as an off
night (and today's consistency criterion sees it). "For most of the night" = on the evening state's `eightySixed` and
plated under `SHORT_MENU_EARLY_SHARE` (½) of its usual night (`sold7d` / `recent.length`; with no history, plated 0).
Selling out late on a busy night is not a short menu (the scripted perfectionist does that ~40 nights a year).
- A night that ran out of everything (0 covers, not `CLOSE_TODAY`, not a refit) is a **failed service**: it enters the
  window from the window's own mean minus the drop, and the year's quality stats, but not `openDays` (Fat Duck count),
  and inspectors/critics still treat it as shut. The game and the script now pass that `DayResult` in, not `closedDay`.
- It emits `SHORT_MENU { day, dishIds, inspectionSeason, quality, text }` (and a bad `LOG`). `text` names the dishes:
  "A short menu tonight: 4 dishes were off (Duck, Ramen, Lamb and 1 more). The guide counts that as an off night, and
  your steadiness slips — in inspection season, when an inspector may have been in. Restock every evening."
- `pulledFoodDishes(content, state, day)` (proxies.ts) is the rule; it is pure and draws no RNG.

### Hints: "what's holding you back" (round 3 review P2)
`starsHints(content, stars, state): StarsHint[]` (src/hints.ts) — all five criteria, ranked by how far the player's
own last week sits below the next star's bar (`STAR_THRESHOLDS[min(stars, 2)]`), each `{ criterion, label, text,
behind }`. The estimate re-runs `dayCriteria` on `recentInputs()`: the last 7 open nights' `DayResult.perDish` (sold,
plated, quality) as one typical night, with the current steadiness window; older saves without `perDish` fall back to
the menu's `sold7d` at the window's mean quality. It never reads this year's visits, `scheduled`, `assessment`,
`lastCriteria`, `dailyScoreEma` or `inspectorModel` (a test feeds it tampered secrets and checks the output is equal),
and it returns words only. The sentences use the player's own numbers:

| Criterion (label) | Line, by case |
| --- | --- |
| consistency | weakest weekday from `weakNights` ("Your weakest night is Tuesday: it cooks about 40 against 92… (no chef on — you're cooking)"); else disruption, stress > 70, untrained satellites, or the steadiness number |
| technique | sold-weighted skill of the food you sell ("easy ones (a cook needs only about 24 skill for them)") and the simplest best-seller; "ambitious enough, cook it better" once 1.35 × ambition ≥ 90 |
| harmony ("Flavour") | the weakest dish against the rest, if ≥ 3 points below; else the plate level |
| personality | "None of your 6 dishes are your own…" ("Your only dish isn't…" for one) / signatures off the menu / research in progress |
| ingredients | no partners → sign one; < 50% in season; young relationships; unsigned suppliers |

Without signatures or partners, personality (~55) and ingredients (~56–61) are usually the first two: that is the
model being honest (the review's bistro scored personality 48, technique 54). The Stars tab shows the top two that are
behind and folds the rest under "Also worth a look".

### Chef stress, burnout, the Smyth arc
- `stress → target` at 1.5% a day. Target when open = 20 + 14/star + 10 in inspection season + 3 per year of
  three-star streak + 5 per untrained satellite − 1 per stagiaire. When closed the target is 10. Guide day adds a
  spike of 4/star (+10 if a star was lost). A warning event fires at 75.
- **Burnout**: above 85 the daily chance is 0.4% per point. It drops stress to 40, sets a 45-day disruption, costs
  −8 prestige and ×0.85 footfall for 30 days.
- Head-chef reputation grows 0.01 + 0.025/star per open day.
- **Smyth arc**: reputation ≥ 70 and tenure ≥ 3 years ⇒ 0.4%/day chance they want their own place, with a 60-day
  deadline. You back them (see commands) or they leave for a **rival**. The rival's strength starts at their
  reputation and grows 8 a year. Its stars are `starsForScore(strength − 5)`, it takes 4% of your footfall per
  rival star, and it drags the prestige target by 5 while it holds as many stars as you.

### Prestige tracks and cadence
| Track | When | Formula (EMA = daily criteria total, α = 0.02) |
| --- | --- | --- |
| Michelin 0–3 | 1 Feb | above |
| World's 50 Best | 1 Jun | worldScore = EMA + 4·stars + 0.15·prestige + N(0,2); rank = 1 + (110 − worldScore)·6, listed if ≤ 50; **No. 1 ⇒ hall of fame, never ranked again** |
| Gault&Millau | 1 Nov | half points, clamp((EMA − 40)/3 + stars, 0, **19.5**) (never 20) |
| Good Food Guide | 1 Sep | clamp(round((EMA − 55)/4 + stars), 0, 10), 0 = not listed |
| Local critic | every 45–120 days, on an open night | today's total + N(0,3): ≥85 ★5 (footfall ×1.6 for 14 d), ≥75 ★4 (×1.2/10 d), ≥62 ★3, ≥50 ★2 (×0.85), else ★1 (×0.7); prestige ±3 per star from ★3 |

**Feed into sim-core `prestige`**: each day the ledger adds `(prestigeTarget − prestige) × 0.03`, where
`prestigeTarget = 20 + 15/star + 1.2·G&M + 1·GoodFood + up to 10 for 50 Best (10 in the hall of fame) − rival drag`.
A star gained adds +10 at once; a star lost costs −6.

**Star bump** (persistent footfall multiplier): ×1.25 / 1.35 / 1.45 for 1 / 2 / 3 stars. Losing a star fades the old
bump linearly over 180 days ("it hurts less than you expect"). The multiplier is
`starBump × prepaid (1.05) × (1 + 0.02 × signatures on the active menu, max 4) × rival`, and ×0 while closed.

### Signatures (test kitchen)
`withSignatures(content, stars)`: researched dishes get ×1.15 appeal (capped at 1), +3 quality ceiling and the name
suffix "(signature)". They count toward personality (above) and footfall (+2% each).

### Stagiaires
Paid: 11,000p/day each (8 h at NLW plus on-costs). Unpaid: daily scandal chance = 0.00015 × count × (1 + 0.5 ×
years the unpaid policy has run), so the choice ages. A scandal costs −15 prestige, −10 popularity, ×0.75 footfall
for 60 days and +15 stress, and the programme is suspended.

## 3. Events (`StarsEvent`)
`INSPECTOR_HINT` (rumour; may be a decoy) · `INSPECTION_SEASON` · `GUIDE_DAY { result, visits }` · `FIFTY_BEST` ·
`GAULT_MILLAU` · `GOOD_FOOD` · `CRITIC_REVIEW` · `STRESS_WARNING` · `BURNOUT` · `STAGIAIRE_SCANDAL` · `RESEARCH_DONE` ·
`SMYTH_ARC_STARTED { deadline }` · `HEAD_CHEF_LEFT { staffId, backed, rival? }` (game must FIRE `staffId`) ·
`SHORT_MENU { dishIds, inspectionSeason, quality, text }` (round 3 review: show `text` in the evening) ·
`HEAD_CHEF_CHANGED` · `SATELLITE_OPENED` · `SATELLITE_CHEF_TRAINED` · `REFIT_STARTED` · `ENDING` · `REJECTED` · `LOG`.

## 4. Headless results (real content pack, High Street, `normal`)

The script (`src/script.ts`, `ScriptedRun`) plays a perfectionist. Menu: the three most demanding mains (duck,
ramen, lamb), scallops, crème brûlée and an espresso martini, at 1.2× suggested price. The kitchen keeps two chefs
and swaps the weaker one for any candidate 15+ points better. It handles incidents properly, signs three partners
once profitable, opens the test kitchen when thriving, researches the mains, adds ticketing at ★, one paid
stagiaire at ★★ (let go in a red month) and a bar satellite with a trained head chef, and backs the head chef in
the Smyth arc when it can afford to.

`pnpm --filter @full-plate/sim-stars headless --years 6 --seed 3` (after the short-menu rule; the script's own few bad
stock nights now count, so scores are 1–2 points lower than before and every year's stars are unchanged):
```
yr  guide  stars    score  visits (day:total)                     stress end/max  prestige  50Best  G&M   GFG  critic  quality  covers   cash
 1    300 —→★        79.8  59:82 101:78 124:77 190:79 263:84             33/33        99       —  13.5     6      ★4     95.6   15149    £14,184
 2    660 ★→★        80.1  352:81 435:79 509:80                          39/46        99       —  15.0     7      ★5     95.3   17785    £23,770
 3   1020 ★→★★       91.7  838:92 898:91 932:92                          51/51       100     #34  18.0    10      ★5     96.9   18870    £38,571
 4   1380 ★★→★★      89.5  1104:88 1297:90 1344:90                       54/63       100     HoF  19.0    10      ★5     96.6   19501   £134,546
 5   1740 ★★→★★★     92.8  1629:95 1693:91 1695:92                       65/67       100     HoF  19.5    10      ★5     96.7   18992   £282,212
 6   2100 ★★★→★★★    91.5  1791:89 1808:89 2038:92 2053:92 2068:93       74/84       100     HoF  19.5    10      ★5     97.3   19668   £449,244
three-star streak: 2   win (3★ × 5 guides): no
```
From-fork (`--fork-day 365 --year1 balanced`, seeds 1, 3, 4): ★ on the first guide day (87.8 / 79.7 / 81.3), as before.
The 10-year × 12-seed figures below predate the rule and were not re-run.
- Signatures land in year 2. The Smyth arc fires in year 4 and the chef is backed (alumni satellite).
- **The win does not trigger within 6 years, by design.** The guide climbs one star a year, so the earliest
  dynasty is year 7.
- Over 12 seeds × 10 years (`--years 10 --seeds 12 --quiet`): every seed reaches ★★★ at some point, **5/12 win the
  dynasty**, 0 go bust. Others lose a star to a burnout or a Smyth-arc disruption at the wrong moment and restart
  the streak. One seed sat at ★ for four years before breaking through. Across those runs: 4 burnouts, 24 Smyth arcs
  (11 backed, 13 lost to rivals), 0 stagiaire scandals (the script pays them).
- **Fat Duck rule** (`--refit-year 4`): a 260-day refit from day 1280 leaves 259 open days but only 1 visit. Not
  assessed, ★★ → —. Rent and rostered wages keep running while shut, and with the lost bump and prestige that run
  went bust in year 5. Brutal, but true to the lesson. See open question 3.
- **Bistro baseline** (`--profile bistro`, the popular menu at suggested prices, no Stars investments): score 51–57,
  never a star, G&M 5, Good Food not listed. Stars come from technique and steadiness, not volume.
- Speed: about 0.6 s per simulated year (sim-core dominates; the Stars step costs microseconds).

## 5. What sim-core could expose for better proxies (not edited; requests for the lead)
1. **Re-export the RNG.** `package.json` exports only `"."` and `index.ts` doesn't export `Rng`/`hashSeed`, so
   `src/rng.ts` imports `../../sim-core/src/rng` by relative path. Please add `export { Rng, hashSeed } from "./rng"` to
   index.ts (or an `"./rng"` export).
2. **Per-day dish lines in `DayResult`**: `{ dishId, sold, plated, qualitySum, freshnessSum }[]`. Today the exact
   per-dish quality only exists in `GameState.service` between close and END_DAY. Mid-day saves and later reloads
   fall back to review quality.
3. **Per-plate freshness / in-season flag** (the kitchen ticket's `freshness` is captured but not aggregated). The
   ingredients criterion currently rebuilds season shares from recipes and the calendar, not from what was actually
   plated.
4. **Which chef cooked each plate** (or per-chef plate counts and quality). It would let technique and personality
   use the head chef's own plates and make satellites drain real staff.
5. **A "closed today" command or flag** (`CLOSE_FOR_DAY`): the Stars layer currently forces an empty service with a
   ×0 footfall mod (`prepareService`), and sim-core still charges rostered wages on closed days.
6. **Persistent footfall/appeal modifiers by source** (e.g. `footfallMods[].source`) so the star bump can replace
   itself instead of being re-pushed with `daysRemaining: 2` each evening.
7. **A hook for content overrides** (signature dishes) so the game doesn't need to swap the content pack
   (`withSignatures`).
8. **Prestige pull in arrivals** is already `PRESTIGE_APPEAL_WEIGHT × qualityWeight`. A "better applicants" hook
   (candidate skill shift by prestige or stars) would complete the BRIEF's star bump.

9. **A same-day stock buy** (round 3 review). `ORDER_STOCK` arrives tomorrow, so the morning's short-menu warning
   can only order for tomorrow; tonight the choices are a shorter menu or `CLOSE_TODAY`. A planning-only
   `BUY_NOW { ingredientId, qty }` at the corner-shop markup (`INCIDENT.cornerShopMult`, delivered at once) would let
   "Order to cover tonight" exist honestly.
10. **Which 86s were stock-outs.** `eightySixed` mixes door stock-outs, mid-service sell-outs and manual pulls; the
   short-menu rule infers "off most of the night" from plates vs the usual night. A `DayResult.perDish[id].offAtTick`
   would make it exact.

## 6. Open questions
1. **Pace of stars.** A focused player with two strong chefs and the most technical dishes gets ★ in year 1. Michelin
   reality is slower, but the game's first act is 2 years. Should stars stay locked until the fork (start
   `newStarsState` at the fork, as intended), or should the thresholds rise (to 80/87/92)?
2. **The dynasty needs 7+ years.** That is 10–20 hours of real play at the BRIEF's pace, which fits, but could the
   five-year streak count guide days already held at ★★★ by *any* restaurant in the group, as the BRIEF's "across the
   group" suggests? Satellites never earn stars here, so "group" currently means "the flagship".
3. **Closed days still pay wages.** Should a refit suspend rotas (sim-core) or should the game prompt the player to
   clear the rota? As it stands a long refit can bankrupt a two-star restaurant.
4. **Rival strength** is abstract (reputation + 8 a year). Should it reuse sim-empire's aggregate site model, or the
   career package's AI owner?
5. **Unpaid stagiaires** are only a risk/benefit trade (no wage, scandal risk). The BRIEF's "choice ages" is a
   growing scandal chance. Should there also be a regulation date (e.g. a news event in year N that makes unpaid
   stages illegal)?
6. **Satellites as aggregate sites**: they're a flat cash stream now. Once sim-empire's `aggregateSiteDay` exists,
   bistros could use it with a `brandConsistency` driven by the trained-head-chef flag.
