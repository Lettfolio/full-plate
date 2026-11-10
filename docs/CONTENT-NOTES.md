# Full Plate — Content & Economy Notes

Owner: content/economy design. Data lives in `packages/content/data/*.json` and is loaded and validated by
`packages/content/src/index.ts`. Every number below is in **pence** in the data and in **pounds** in this doc.

## What ships

| Collection | Count | Notes |
| --- | --- | --- |
| ingredients | 62 | Proteins, dairy, veg & fruit (with seasonality), dry goods, drinks. |
| dishes | 71 | 11 starters, 32 mains (incl. 2 kids' plates), 6 sides, 8 desserts, 14 drinks (7 alcoholic). |
| segments | 5 | students, families, business, foodies, tourists. |
| districts | 4 | Student Quarter, High Street, Business Park, Seaside. |
| staffArchetypes | 7 | chef_commis, chef_line, chef_experienced, server, bar, porter, manager; 22 unique names each. |
| traits | 18 | Multipliers on skill / speed / charm / moodDecay / wageDemand / mistakeRate. |
| events | 26 | 2–3 choices each; cash effects within ±£2,000, reputation ±1–9. |
| reviewTemplates | 5 × 8 | Lines for ratings "1"–"5" using `{dish}`, `{restaurant}`, `{segment}`. |
| balance | 1 | See "Starting position". |

The loader exports `content`, `validateContent(pack): string[]`, `loadContent()`, plus helpers `dishCost`,
`dishMargin`, `NATIONAL_LIVING_WAGE` and `ALCOHOLIC_DISH_IDS`.

## Design rationale

**Ingredient costs** are *portion* costs, not raw wholesale per kilo: they include trim, yield loss and
sundries (oil, seasoning), which is how a UK kitchen actually costs a plate. Anchors: scallop portion £4.00,
steak cut £6.50, cod fillet £2.80, chicken breast £1.90, potatoes 15p, onions 8p. Shelf lives: fish 1–2 days,
fresh veg 3–5 days, dairy 5–21, dry goods 60–365. 14 produce/seafood lines carry seasonality months (asparagus
Apr–Jun, strawberries Jun–Jul, mussels/scallops in the colder "R" months, roots Sep–Mar).

**Dish prices** are computed from ingredient cost at a target 69% GP (66–68% for premium proteins: steak, lamb,
duck, scallops), then lifted 6% in balance round 1, rounded to UK menu prices ending in 45 or 95. Starters and
mains now sit at 68–72% GP (tests allow 65–74%). Cheap sides and puddings
hit a course price floor (sides £3.45, desserts £4.95), so they run at 77–89% GP, as they do in real restaurants.
Drinks are priced by hand: soft drinks and coffee at 79–97% GP; wine at 2.5–3.7× cost (house £5.50 on £1.50;
good red £10.95 on £3.00; prosecco £7.50 on £2.20); pints £5.50–£5.95; spirits and cocktails at 84–90%.
Resulting menus: starters £3.95–£16.45, mains £3.95 (kids) to £23.45 (steak), desserts £4.95–£6.95.

**Appeal** is 0–1 per segment and encodes the brief's tastes:
students → cheap, filling, fried, cheesy (burgers, pizza, cheesy chips 0.9+); foodies → technique (scallops,
duck, ramen, crème brûlée 0.85–0.95) and low interest in comfort food; families → familiar plus the kids' plates
(fish fingers 1.0, tiny pasta 0.95) and sundaes; business → fast, decent, light (Caesar, salmon, flat white
0.9); tourists → "British" classics (fish & chips 0.95, full English, roast, pies, puddings 0.8–0.95).
The 7 alcoholic drinks are listed in `ALCOHOLIC_DISH_IDS` and say "(Grown-ups only.)" in their blurb, so
the sim/UI can keep them away from child customers if it ever models them.

**Skill vs ceiling**: easy dishes (skill 10–25) cap at 62–85 quality; showpieces need 55–72 skill and cap at
90–96. A commis (skill 15–35) can run a pub-classics menu well; to earn prestige you need a line or
experienced chef. Prep ticks 1–5 (ramen is the only 5).

**Segments** — budgets (after balance round 1): students £11.50, families £15/head, business £19, tourists
£21, foodies £35. These are spend per head *including* the extra courses and drinks, which the sim's price-gap
term compares against. Price sensitivity runs students 0.8 → foodies 0.25; speed weight business 0.9 → foodies 0.2; tips 5% (students) to
12% (foodies). Arrival curves are two-Gaussian mixtures over 120 ticks, normalised to sum to exactly 1:
business peak 13:00 (small 17:50 after-work bump); students 19:30 with a lunch shoulder; families 18:30;
foodies 20:00; tourists 13:15 and ~17:45. Party sizes: families skew to 3–4, foodies to couples, business to
1–2.

**Districts** (rent / month, deposit 3 months, footfall = parties passing per day before multipliers):

| District | Rent | Deposit | Footfall | Mix highlights | Season shape |
| --- | --- | --- | --- | --- | --- |
| Student Quarter | £2,200 | £6,600 | 112 | 55% students | dips Jul–Aug to 0.5–0.55, peaks Sep–Nov 1.1–1.15 |
| High Street | £3,800 | £11,400 | 74 | balanced; 30% families | 0.8 Jan, 1.3 December bump |
| Business Park | £3,200 | £9,600 | 74 | 60% business | flat ~1.0, Aug 0.85, December 0.7 |
| Seaside | £2,700 | £8,100 | 82 | 40% tourists, 32% families | 0.48 Jan → 1.9 Aug (Nov–Feb 0.48–0.62) |

**Staff** wages per hour: commis £12.71–£13.25, line £13.25–£15.00, experienced £15.50–£18.00, server
£12.71–£13.40, bar £12.71–£14.00, porter £12.71–£12.90, manager £15.00–£18.00. Every floor is the April 2026
NLW (£12.71); the validator rejects anything lower. Names are unique across all 154 samples and drawn from
British, Irish, Welsh, Scottish, South Asian, West African, East Asian and Eastern European backgrounds.

**Traits** are mostly two-sided (Perfectionist +12% skill, −12% speed, −30% mistakes; Grumpy but brilliant
+10% skill, −20% charm). Pure upsides are small (Sunny +20% charm only). Downside traits (Flaky, Butterfingers,
Nervous newbie) come with a lower wage demand so they're a real trade-off rather than a trap.

**Events** are warm and low-stakes for a 12-year-old: nothing about injury, illness, alcohol misuse or crime.
Costs cluster at £40–£450 with a few big ones (fridge £700–£1,600, landlord £900–£1,800, Christmas parties
+£500–£1,500). Seasonal cards use `when.month` (heatwave Jun–Aug, Christmas Nov–Dec, January lull, rainy
weeks). The rent-review card needs `minDay: 365`; prestige/popularity-gated cards (proposal, viral pudding,
award nomination) reward doing well. Every card has a "safe" option so a cautious player is never forced into
a big loss, but the safe option usually costs footfall or mood.

## Starting position (balance.json)

| | £ |
| --- | --- |
| Owner's savings (`startingCash`) | 15,000 |
| Bank loan (`loanPrincipal`, 1,095 days at 8% APR) | 40,000 |
| Fit-out (`fitOutCost`) | −30,000 |
| **Cash after fit-out** | **25,000** |
| Rent deposit (3 months) | −6,600 to −11,400 |
| **Working capital on day 0** | **£13,600 (High Street) to £18,400 (Student Quarter)** |

Loan: an amortised daily payment of **£41.09/day** (≈ £1,250/month; £44,996 repaid in total). If sim-core uses
straight-line `principal/term` plus simple interest it comes to £36.53 + interest; either is fine for balance.
That working capital is roughly 1–1.5 months of running costs, below the "3–6 months" advice in the brief.
That is deliberate: the first winter should feel tight. If headless survival comes out low, this is the first
knob (see below).

Other knobs: `reputationDecay` 0.2/day toward 50, `reviewRatePer10Covers` 1.5, tables 6 → 14 at 4 seats,
`wasteShares` 0.45/0.34/0.21 (WRAP), `weekendFootfallMult` 1.3, `targetYear1Survival` 0.75.

## Economy sketch (for sanity-checking the sim)

_Pre-headless sketch, kept for reference. The sim adds VAT (1/6 of takings) and £80/day overheads that this
sketch ignored, which is why the first real run came in well below it. See "Headless results" for actuals._

Back-of-envelope with these assumptions: ~35% of passing parties come in (mid popularity, sensible
menu); spend ≈ 85% of segment budget; blended GP 70% after drinks; waste ≈ 8% of food cost; a three-person
team (line chef, commis, server) at ~£13/h × 10h = **£391.50/day** in wages; seating capacity
6 tables × 4 seats × ~1-hour turns at about 55% average occupancy ≈ **132 covers/day max**. Weekend multiplier
blended over the week (×1.086).

| District | Avg party | Avg spend/head | Daily fixed (rent + loan + 3 staff) | Break-even covers | Covers/day (avg / worst month / best month) | Daily profit avg / worst / best |
| --- | --- | --- | --- | --- | --- | --- |
| Student Quarter | 2.5 | £13.00 | £506 | 57 | 75 / 41 / 95 | £158 / −£142 / £330 |
| High Street | 2.6 | £16.30 | £559 | 51 | 80 / 64 / 103 | £316 / £141 / £579 |
| Business Park | 2.4 | £16.30 | £539 | 49 | 67 / 50 / 71 | £203 / £6 / £239 |
| Seaside | 2.7 | £16.45 | £523 | 47 | 80 / 34 / 132 (capacity) | £370 / −£147 / £945 |

Reading it: a competent owner makes roughly **£55k–£115k gross operating profit in year 1** before
events, stock losses and wage creep. That sounds generous, but the sketch assumes a well-matched menu and no
walkouts. In practice we expect the sim to land nearer **half of that** for the "balanced" script, with the
risk concentrated in two places:

- **Seaside winter** (Nov–Mar at 0.4–0.6 footfall) runs at about −£150/day. Five lean months is about −£15k
  against £17k of working capital: survivable only if the summer is banked. That is the intended lesson.
- **Student Quarter summer** (Jul–Aug at 0.5) is a smaller hole (−£140/day for two months ≈ −£8.5k).
- High Street is the "safe" pick (never loss-making in the sketch) but has the thinnest day-0 runway (£13.6k)
  because of its deposit.
- Business Park is flat and dull: low variance and a low ceiling. Its December dip (0.7) coincides with
  Christmas-party events, which partly offset it.

Year-1 failure at normal should therefore come mostly from: bad menus (price gap vs segment budget), staffing
too heavily (each extra person ≈ £130/day), over-ordering perishable stock, and opening in the wrong season.

## Knobs to tune after the first headless run (pre-run plan; see results below)

In order of preference (all in content, none in sim code):

1. **`districts[].footfall`.** The main volume dial. ±10% here moves covers/day almost linearly. Sized so
   ~35% conversion gives 70–80 covers on an average day.
2. **`balance.startingCash`** (and so working capital). +£5k is the cleanest way to lift survival without
   changing the feel of a day. Keep `startingCash + loan − fitOut` documented if it moves.
3. **`seasonCurve` extremes.** Seaside Jan 0.4 and Student Quarter Aug 0.5 are the most likely bankruptcy
   causes; raise the troughs by 0.1 before touching anything global.
4. **Segment `averageBudget` / `priceSensitivity`.** If the sim's priceGap term is harsher than the sketch
   assumes, students will refuse menus averaging over £9 and Student Quarter will under-perform; lift the student
   budget to £10 or lower their sensitivity to 0.8.
5. **Dish `suggestedPrice`.** Scripted owners probably use suggested prices as-is, so a uniform ±5% shift is
   a clean revenue lever. Keep food GP inside 65–74% (the tests enforce it for starters and mains).
6. **`reviewRatePer10Covers` / `reputationDecay`.** These control how quickly popularity compounds. If good
   runs snowball too fast, raise decay to 0.3.
7. **`weekendFootfallMult`** 1.3 → 1.2 if weekends hit the table cap and cause walkouts.
8. **Event weights.** Fridge failure and the oven card are the largest negative cash shocks; drop their weight
   if early-game deaths cluster around them.

## Headless results

All runs: 100 seeds × 365 days. Seeds are spread round-robin over the 4 districts (25 each). Command:
`pnpm --filter @full-plate/sim-core headless --days 365 --seeds 100 --strategy <s> --difficulty <d> --content ../content/src/index.ts`
(per-district splits come from the same `playOne`). The official CLI reproduces the balanced/normal figure
exactly (76/100, 72.7 covers, rating 4.21).

### Before (first content pack, sim-core eb7b738)

| run | survival | covers/day | rating |
| --- | --- | --- | --- |
| balanced / normal | **44%** | 63.1 | 4.18 |
| balanced / hard | 47% | 60.6 | 4.08 |
| balanced / cosy | 100% | 82.5 | 4.23 |

| District (balanced/normal) | survived | covers | labour % of revenue | when they died |
| --- | --- | --- | --- | --- |
| High Street | 21/25 | 74 | 34% | days 293–362 |
| Business Park | 20/25 | 59 | 37% | days 296–360 |
| Seaside | 3/25 | 68 | 44% | days 268–363 (winter) |
| Student Quarter | **0/25** | 40 | **83%** | days 142–191 (first summer) |

Diagnosis: the sim's price-gap term compares *expected spend per head including extras* (main + 30% starter +
30% dessert + 60% drink + 20% side) against `averageBudget`. My budgets were "main-ish" figures, so every
segment saw the menu as overpriced. Students (sensitivity 0.9, £9) mostly refused to come in, and the Student
Quarter then sank under a fixed labour bill in its July–August dip. Seaside had a 0.4–0.55 winter that no
summer could bank enough to cover once VAT and overheads were taken.

### Changes (one tuning round, chosen from ~8 in-memory variants at 40–100 seeds each)

| Knob | Before | After | Why |
| --- | --- | --- | --- |
| students budget / sensitivity | £9.00 / 0.9 | £11.50 / 0.8 | budget is spend incl. extras; students were refusing a burger-and-chips menu |
| families / business / tourists budget | £14 / £18 / £20 | £15 / £19 / £21 | same reason, smaller gap |
| foodies budget | £35 | £35 | unchanged |
| food `suggestedPrice` | 69% target GP | +6% (GP now 68–72%) | capacity-limited sites earn more per seat; offsets the budget lift so High Street doesn't run away |
| Student Quarter footfall | 88 | 112 | volume to carry two staff through the summer dip |
| High Street footfall | 80 | 74 | was the runaway safe pick after the price lift |
| Business Park footfall | 78 | 74 | same |
| Seaside season curve (Jan, Feb, Mar, Oct, Nov, Dec) | 0.40, 0.45, 0.60, 0.75, 0.50, 0.55 | 0.48, 0.52, 0.65, 0.80, 0.58, 0.62 | soften the winter trough; summer unchanged |
| startingCash, loan, fit-out, other balance knobs | — | unchanged | not needed; £25k after fit-out still holds |

Variants I rejected: +£5k starting cash with +15% prices and a softer Seaside (100%, far too easy);
budgets +£4 alone (58%, Student Quarter still 0%); +8% prices with Student Quarter at 100 (85–86%).

### After (shipped data)

| run | survival | covers/day | rating |
| --- | --- | --- | --- |
| **balanced / normal** | **76%** | 72.7 | 4.21 |
| balanced / hard | 65% | 67.4 | 4.15 |
| balanced / cosy | 100% | 92.0 | 4.13 |
| cheap / normal (−15% prices) | 72% | 67.4 | 3.90 |
| premium / normal (+25% prices, skilled hires) | **99%** | 84.9 | 4.08 |

| District | balanced / normal | balanced / hard | balanced / cosy | cheap / normal | premium / normal |
| --- | --- | --- | --- | --- | --- |
| High Street | 25/25 (covers 79) | 24/25 | 25/25 | 19/25 | 25/25 |
| Business Park | 23/25 (65) | 21/25 | 25/25 | 16/25 | 25/25 |
| Seaside | 14/25 (75) | 9/25 | 25/25 | 12/25 | 25/25 |
| Student Quarter | 14/25 (73) | 11/25 | 25/25 | **25/25** | 24/25 |

Reading it:
- Normal sits inside the 70–80% target, and no district is below 40% at normal (worst: Seaside and Student
  Quarter at 56%). Cosy is 100%. Seaside deaths now land in winter (days 293–361) and Student Quarter deaths in
  its first summer (days 184–299): the two intended "cash-flow lesson" beats.
- Labour is still the main drain where owners die (41–43% of revenue in Seaside and Student Quarter, against
  33% elsewhere).
- **Cheap pricing wins in the Student Quarter (25/25) and loses everywhere else.** That's a nice, teachable
  "know your customers" result.
- **Premium dominates (99%).** Pricing 25% over suggested costs almost no covers, because the extra price is
  absorbed by low price sensitivity outside the student segment, and the per-dish order-weight penalty is mild.
  I did not try to fix this in content: lowering prices or raising sensitivity further just moves everyone's
  survival together. It needs a sim-side elasticity change (below).
- Hard is only about 11 points below normal, because the difficulty multipliers are small (footfall ×0.95,
  costs ×1.05).

### Issues for the reviewer (sim-side, not changed here)

1. **Premium pricing dominates.** Suggest raising `PRICE_GAP_WEIGHT` (4 → 6?) or making the price gap
   asymmetric, so being over budget hurts more than being under helps. Also make the per-dish order weight
   (`ORDER_PRICE_CLAMP`) respond more strongly to over-pricing, so that +25% costs real covers. Expect to
   re-tune budgets after that.
2. **Hard is barely harder than normal** (65% vs 76%). For the brief's ~50%, try `DIFFICULTY.hard`
   footfall ×0.88, costs ×1.1.
3. **The headless "balanced" owner never sheds staff** in slow months. It hires a second chef/server above
   £15k cash and keeps them through winter, which drives most of the Seaside and Student Quarter deaths. That
   is fair for a scripted owner but makes those districts look harsher than they are for a thinking player.
4. **The insolvency line uses the current rota's wage bill**, so an owner with more staff goes bust sooner at
   the same cash. That's sensible, but worth being aware of when reading district results.
5. Starting popularity 40 and final popularity ~81 mean popularity saturates within the year. If footfall
   then caps on tables, `reputationDecay` (content) can be raised to 0.3.

## Knobs still to tune
- After any sim elasticity fix: segment `averageBudget` (first) and food price multiplier.
- Seaside and Student Quarter at 56% are the floor; +4 footfall each lifts them about 8–10 points.
- `weekendFootfallMult` 1.3 is untouched; cosy hits ~100 covers in Seaside, close to the table cap.

## Round 2 (sim-core 6d2cf07 / 30bd60d / 1570fdc)

Round 2 made staff matter, added incidents, goals and an empty opening larder, and made the scripted owners
smarter. All runs: 100 seeds × 365 days, 25 per district, real pack.

### Before (round-1 content on round-2 sim)

| Run | Overall | High Street | Business Park | Seaside | Student Quarter |
| --- | --- | --- | --- | --- | --- |
| balanced / normal | 97% | 24/25 | 25/25 | 23/25 | 25/25 |
| balanced / hard | 89% | 20/25 | 24/25 | 21/25 | 24/25 |
| balanced / cosy | 100% | 25/25 | 25/25 | 25/25 | 25/25 |
| cheap / normal | 25% | 5/25 | 4/25 | 5/25 | 11/25 |
| premium / normal | 95% | 22/25 | 25/25 | 25/25 | 23/25 |
| nohire / normal | 0% | 0/25 | 0/25 | 0/25 | 0/25 |

### What I tried (three rounds, 60 seeds each unless noted, balanced / cheap / premium at normal)

| Round | Variant | balanced | cheap | premium | hard |
| --- | --- | --- | --- | --- | --- |
| 1 | budgets −£1 to −£2.50, better commis | 98% | 27% | — | — |
| 1 | same + startingCash £12k | 98% | 8% | — | — |
| 1 | budgets −£2, footfall −11% | 97% | 7% | 78% | — |
| 1 | budgets −£2, footfall −19% | 97% | 2% | 60% | — |
| 2 | price sensitivity +0.1–0.15, rent +£600 | 98% | 18% | 85% | — |
| 2 | same, rent +£800–900, startingCash £10k | 98% | 0% | 62% | — |
| 2 | wages +£0.50–1.50/h | 98% | 32% | 90% | — |
| 3 | food prices ×0.94 | 100% | 2% | 98% | 87% |
| 3 | food prices ×0.90 | 98% | 0% | 98% | 53% |
| 3 | ingredient costs ×1.12 | 97% | — | — | 78% |
| 3 | ingredient costs ×1.20 | 97% | — | — | 37% |

**What this shows.** No content lever moves balanced/normal below about 97%, while every lever that tightens
the economy collapses cheap and premium first. There are two reasons:

1. **Balanced is anchored to `suggestedPrice`.** The sim's markup penalty (`MARKUP_WEIGHT`) is measured from
   `suggestedPrice`, and the balanced owner prices at exactly 1.0×. Changing prices moves the anchor with them,
   so balanced always sits at "the going rate" and any other strategy is a deviation from it. The scripted
   owner set to 0.85× (cheap's prices but balanced's hiring) survives 60%. Set to 1.25×, it survives 93%.
2. **The round-2 balanced owner adapts.** It drops weekend shifts after a losing fortnight and responds to
   incidents. Its lowest month-end cash is about £10–15k (p10 £10.6k), while bust needs about −£47k (three
   months of rent plus wages, below zero for 14 days). In scratch copies of sim-core I tried tightening that
   line (`INSOLVENCY_MONTHS` 3 → 1), and also `ENTRY_BIAS` −3.45 and −3.6. Balanced/normal stayed at 98–100%
   in every case.

**Cheap's collapse is mostly its script, not its prices.** Giving cheap balanced's hiring rules
(`menuSize: 6`, `hireBy: "value"`, `coverCash: 150_000`) while keeping 0.85× prices lifts it from 25% to
**65%**. With 5 dishes and wage-first hiring it gets weak cooks and too few dishes, so ratings and covers fall
together.

**Porter and weekend second chef (28-day payback from day 60, 16 seeds, staff injected at the archetype
midpoint):**
- porter, 7 days: **−£3.7k**
- line chef, weekends only: −£1.8k
- server, weekends only: −£1.9k

Porter wages are already at the NLW floor (£12.71–£12.90), so content can't make them cheaper. Skill, speed
and charm don't affect what a porter does in the sim; its only effect is clearing tables in 1 tick instead of
3, which pays only when the room is full and there's a queue. This needs a sim-side effect (below).

### Shipped in round 2

| Knob | Before | After | Why |
| --- | --- | --- | --- |
| `chef_commis.skillRange` / `speedRange` | 15–35 / 35–60 | 28–45 / 40–65 | with round 2, plate quality is 50 + (skill − 50) × 1.4, so a skill-20 commis plated ~8. Cheap hires the cheapest chef, so this was the main reason cheap collapsed |
| `server.charmRange` | 40–85 | 48–85 | charm 50 is now neutral, so a server under 50 actively hurt patience and tips |

Nothing else changed: budgets, prices, footfall, season curves, rent and balance.json are the same as
round 1. Every content-wide squeeze I tried moved the other strategies in the wrong direction.

### After (shipped data)

| Run | Overall | High Street | Business Park | Seaside | Student Quarter |
| --- | --- | --- | --- | --- | --- |
| balanced / normal | **100%** | 25/25 | 25/25 | 25/25 | 25/25 |
| balanced / hard | 95% | 23/25 | 24/25 | 23/25 | 25/25 |
| balanced / cosy | 100% | 25/25 | 25/25 | 25/25 | 25/25 |
| cheap / normal | 39% | 8/25 | 7/25 | 6/25 | 18/25 |
| premium / normal | 98% | 24/25 | 25/25 | 25/25 | 24/25 |
| nohire / normal | 0% | 0/25 | 0/25 | 0/25 | 0/25 |

The staff change helps cheap (25% → 39%) and nudges balanced *up* (97% → 100%). It's kept because it fixes a
real content problem (candidates who were too weak to be worth hiring). It is easy to revert if the reviewer
prefers the round-1 archetypes.

### Recommended sim-side changes for the reviewer

1. **Hard: `DIFFICULTY.hard` → `{ footfallMult: 0.80, costMult: 1.20 }`** (from 0.88 / 1.10). Verified in a
   scratch copy of sim-core on the shipped content: balanced/hard **45%** (High Street 7/25, Business Park
   16/25, Seaside 8/25, Student Quarter 14/25). That's close to the ~50% target. Use 0.82 / 1.18 if you want
   it slightly kinder.
2. **Cheap: change `STRATEGIES.cheap` in headless.ts, not constants.** Use `menuSize: 6`, `hireBy: "value"`,
   `coverCash: 150_000` and keep `priceMult: 0.85`: 65% at 60 seeds. That puts it within ~15 points of a
   re-targeted balanced.
3. **Normal 70–80%: I could not find a single constant that does it.** `ENTRY_BIAS` −3.45 / −3.6 and
   `INSOLVENCY_MONTHS` 1 were each tested and left balanced at 98–100%. The scripted owner is now a
   competent player. Options:
   - accept ~95%+ for the scripted owner and judge normal by a weaker "typical" strategy (e.g. balanced
     without the weekend-shift trimming);
   - or have the markup penalty compare against a district "going rate" instead of `suggestedPrice`, so
     balanced isn't the anchor by definition.
   `MARKUP_WEIGHT` was not varied.
4. **Porter:** give it a second effect, e.g. it absorbs `spill` and `equipment` incidents, or adds +0.5 FOH
   actions/tick, so it pays back mid-game at NLW. A weekend-only second chef will keep losing money until
   kitchen throughput is the binding limit at weekends. Check that once tables can be bought earlier.

Note: during this run the working tree had an uncommitted change in `packages/sim-core/src/systems/incidents.ts`
(outcome text only) from another agent. It doesn't affect any economics.

## Round 3 (path content)

Round 3 adds the content the brief's two paths and the career ladder need, so the integration pass can wire it in.
The integration pass should not need to type any game text. `sim-core/src/types.ts` is unchanged, and **the default
`content` pack is byte-for-byte the round-2 pack**, so sim-core balance and headless results don't move.

### What was added

| File | Count | What |
| --- | --- | --- |
| `ingredients.json` (+49) | 111 total | 20 fast-food lines: frozen fries, patties, nuggets, crumbed fillets and hash browns at 180 days; buns, muffins and wraps at 21–90 days; shake and soft-serve mix at 60–120 days; a "toy surprise" (25p, not food). 21 fine-dining lines with seasonality: turbot (Mar–Sep), venison (Oct–Feb), black truffle (Dec–Feb), Wye Valley asparagus (Apr–Jun), Scottish langoustine (May–Sep), lobster, morels, wild garlic, girolles, forced rhubarb, blood oranges. 8 wine-by-the-glass lines. |
| `dishes.json` (+54) | 125 total | **24 fast food** (`ff_*`): 13 mains (burgers, wraps, nugget box, 3 breakfast muffins, 2 kids' meals with a toy), 4 sides, 2 desserts, 5 drinks. **30 fine dining** (`fd_*`): 3 amuses, 4 starters, 4 fish courses, 5 meat courses, 2 pre-desserts, 3 desserts, a cheese trolley and 8 wines by the glass. |
| `dishTags.json` | 54 | `{ dishId: DishTag[] }`. Tags: `fast_food`, `counter_service`, `burger`, `fries`, `wrap`, `shake`, `breakfast`, `kids_meal`, `vegetarian` / `fine_dining`, `signature_candidate` (10), `seasonal`, `wine`, plus a course tag (`amuse`, `starter_course`, `fish_course`, `meat_course`, `pre_dessert`, `dessert_course`, `cheese_course`). |
| `libraryHidden.json` | 54 | Every `ff_*` and `fd_*` dish id. These are kept out of `content` (see below). |
| `formulas.json` | 3 | Presets for the Empire's "lock formula" step (fields map onto `SET_FORMULA`): **Classic Counter** (8 items, burgers, fries, shakes), **Sunrise All Day** (breakfast-led, priceIndex 0.95) and **Garden & Chicken** (no beef or pork, so it is validated `dietarySafe: ["no-beef","no-pork"]` for Vasant). All are ≤ 8 dishes, so they don't hit sim-empire's `STD_PER_EXTRA_DISH` penalty. |
| `tastingMenus.json` | 3 | **Spring in the Garden** (Apr–Jun), **Summer by the Sea** (Jun–Sep) and **Deep Winter** (Dec–Feb). Each has 6–7 courses (amuse → starter → fish → meat → pre-dessert → dessert [→ cheese]) and a 5-glass pairing. Price per head is £75–£85 (à la carte sum −15%, ~64% GP); the pairing is £45–£55. The validator checks that every seasonal ingredient is in season in at least one of the menu's months. |
| `wineList.json` | 8 | Bottles with region and a one-line note. Prices are graduated from 4.0× (£10 rosé) down to 2.7× (£26 red Burgundy), so cheap bottles carry more, as the brief says. Each bottle points to its glass dish (`glassDishId`). |
| `cities.json` | 5 regions, 12 cities, 4 suppliers | A mirror of `sim-empire/src/world.ts`: same ids, order, population, costIndex, dietaryRules, localChampion/championStrength and map x/y. It adds a one-line `blurb` to each region and city, and an `ingredientIds` list and `blurb` to each supplier. A test parses `world.ts` and fails if the two drift apart. |
| `countries.json` | 10 countries | Rules text for the country-entry puzzle (`rules[]`, `entryText`), plain-English text for each dietary rule, `puzzleLines` templates, and **`dietaryBreakers` / `kosherMeat` / `kosherDairy`**. These are a superset of sim-empire's `DIET_BREAKERS` and include the new patties, nuggets, shellfish and wines. |
| `criticText.json` | — | Invented guide names (Golden Plate Guide, World's 50 Greatest Tables, Toque Guide, Good Table Guide); 5 critic names; 4 local-critic lines per rating 1–5; 10 inspector rumours; the inspection-season line; guide-day envelope text (gained, first star, third star, kept, lost, lost all, not assessed, excluded, still none); 50 Best, Toque and Good Table lines; head-chef stress, burnout and "I want my own place" dialogue with the back/let-go choices; and three endings (closing at the top, dynasty, handed back). |
| `careerText.json` | — | Owner weekly-review lines for each personality (balanced, cheap, premium) × band (great, good, ok, poor), with score cut-offs in `bands` (4.3 / 3.6 / 2.8). Promotion copy for every rung above 0 on every track, keyed by sim-career `LADDER` rung id (a test checks the ids against `constants.ts`). Also: mentor lines for each track, rival offer pitches for each personality and an offer letter, raise outcomes (granted, small, refused, annoyed, matched offer), and the farewell, handover and perk lines for "open your own place". |
| `incidentText.json` / `goalText.json` | 8 incidents / 17 goals | Verbatim copies of sim-core's `INCIDENT_TEXT`, `INCIDENT_LINES`, `GOAL_LADDER` and `GOAL_LINES`, with the same keys. A test does a deep-equal against the sim-core modules, so any drift fails CI. The sim-core files are untouched. |

**Design numbers.** Fast food: skill 10–20, prep 1–2 ticks, ceiling 55–70. Mains are £1.99–£5.99 at 68–72% GP, and
sides, desserts and drinks are 70–92%. Appeal is 0.75–1.0 for students and families and ≤ 0.15 for foodies (the counter
coffee is the one item that leans business). Fine dining: skill 65–85, prep 3–6, ceiling 89–97, priced at 68% GP for
mains and 67–76% for other courses (mains £16.95–£40.95). Foodies 0.85–0.95, business ≥ 0.65, students ≤ 0.15. Wines by the
glass are at 2.9–4×. Tone throughout is warm and gently funny. There are no real brand or guide names, and a test scans
every string for real brands and snark words.

### Why there are two packs (the `inLibrary` flag)

With the path dishes in the general library, headless `typical`/normal **fell from 83% to 59%**. The Business Park
owner's appeal-sorted menu picked £33–£41 turbot, lobster and truffle beef, and the Student Quarter owner picked 99p
fries. So the loader exposes two packs:

- **`content`**: the full pack minus `libraryHidden` dishes and any ingredient only those dishes use. It is identical to
  round 2 (71 dishes, 62 ingredients). With it, headless typical/normal is **83/100 (unchanged; 90.3 covers, 4.23★)**.
  sim-core, headless, career and the owner game keep using this by default.
- **`fullContent`**: everything (125 dishes, 111 ingredients). Use it to cook once a path is chosen, so the Empire
  formula and Stars menus can name `ff_*`/`fd_*` dishes. It is also what `validateExtras` checks against.
- **`inLibrary(dishId)`** / `LIBRARY_HIDDEN_DISH_IDS` tell the menu editor which dishes to hide from the starter
  library if the game ever uses `fullContent` everywhere.

### Data model and exports (`src/index.ts`, `src/extras.ts`)

```ts
import { content, fullContent, extras, dishTags, formulas, tastingMenus, wineList, world, countries,
         criticText, careerText, incidentText, goalText, inLibrary, tagsOf, dishesWithTag, formulaById,
         tastingMenuById, cityById, countryByName, rulesTextForCity, dietaryRuleText, dishBreaksRule, fill,
         libraryPack, validateExtras, LIBRARY_HIDDEN_DISH_IDS } from "@full-plate/content";
```
- The `ContentPack` shape is unchanged. Tags are a parallel map (`dishTags.json`) rather than a `DishDef.tags` field.
- Types for every extra live in `src/extras.ts` (`FormulaDef`, `TastingMenuDef`, `WineDef`, `CityDef`, `RegionDef`,
  `SupplierDef`, `CountriesData`, `CriticText`, `CareerText`, …). `CityDef`/`SupplierDef` are sim-empire's `City`/`Supplier`
  without the runtime flags.
- Importing the module validates everything and throws a single error that lists every problem. The checks cover
  references to dishes, ingredients, districts and regions; known placeholders per collection (critic, career,
  countries, incident, goal); unique ids; positive margin at suggested price for every `fast_food` and `fine_dining`
  dish; the tag bands (skill, prep, ceiling); formula ≤ 8 dishes with honest `dietarySafe` claims; tasting-menu course
  coverage, cost and seasonality; wine markup 2.5–4×; and each city's dietary rules matching its country's.
- Templates use `{placeholder}`; `fill(template, vars)` behaves like sim-core's incident `fill`.
  Placeholder sets: critic `{restaurant} {dish} {critic} {chef} {stars} {starWord} {rank} {points} {tier} {city} {guide}`;
  career `{name} {owner} {restaurant} {rung} {nextRung} {wage} {raise} {mentor} {rival} {savings} {shifts} {pitch}`;
  countries `{city} {rules} {cost} {champion} {brand} {country}`.

### What integration should read from where

| Consumer | Today (hard-coded) | Swap to |
| --- | --- | --- |
| sim-empire `defaultCities`, `DEFAULT_REGIONS`, `DEFAULT_SUPPLIERS` (`world.ts`) | TS literals | `world.cities` (add `entered/localised/tradition` and filter `districts` as `defaultCities` does), `world.regions`, `world.suppliers` (add `signed:false, exclusive:false`) |
| sim-empire `DIET_BREAKERS`, `MEAT`, `DAIRY` (`model.ts`) | TS literals | `countries.dietaryBreakers`, `kosherMeat`, `kosherDairy`, or just `dishBreaksRule` |
| sim-empire `FAST_FOOD_MENU` (`strategies.ts`) and the brand screen | the 8 library burgers/chips/shakes | `formulas[*].menuDishIds` with `fullContent` |
| sim-empire city panel text | generated notes | `rulesTextForCity`, `countries.puzzleLines`, `city.blurb` |
| sim-stars `CRITIC_NAMES`, `CRITIC_TEXT` (`constants.ts`, `tracks.ts`) | 3 names, 1 line per rating | `criticText.criticNames`, `criticText.localCritic[rating]` (pick by RNG) |
| sim-stars hint strings (`step.ts`) | 2 literals | `criticText.inspectorRumours` |
| sim-stars guide reason / ending text (`inspector.ts`, `commands.ts`, `step.ts`) | literals | `criticText.guideDay.*`, `criticText.endings.*` (UI can show these beside `GuideResult.reason`) |
| sim-stars `qualityMenu` / test kitchen | library dishes with ceiling ≥ 88 | `tastingMenus` and `dishesWithTag("signature_candidate")` on `fullContent` |
| sim-career review notes, rung copy, offer pitch, raise and handover messages | generated strings | `careerText.*` (rung copy keyed by `LADDER` rung id) |
| sim-core `incidents/text.ts`, `goals/text.ts` | TS modules | `incidentText`, `goalText` (same keys; deep-equal tested) |
| game menu editor | `content.dishes` | unchanged; or `fullContent.dishes.filter(d => inLibrary(d.id))` plus a path tab |

### Notes and open questions for integration
- **Cook with `fullContent` only after the fork.** The sim must use the same pack for the whole run, because a save
  that references `ff_*` dishes needs `fullContent` to load. The simplest rule is to always pass `fullContent` to the
  sim and keep the starter menu editor and the headless owners on library dishes (`inLibrary`).
- Fast-food covers in the agent sim are still seat-capped (EMPIRE-NOTES open question 3). The low prices assume
  counter-service volume that only the aggregate model gives today.
- Fine-dining mains are £17–£41 against a foodie budget of £35/head, so à-la-carte fine dining will read as
  "over budget" to sim-core's price-gap term. Tasting menus (£75–£85) would need a sim-side "set menu" sale, or a
  segment budget override while on the Stars path.
- The `toy_surprise` ingredient is a cost line in the kids' meals. If the Empire ever models a "toy recall" scandal,
  this is the hook.
- `cities.json` duplicates sim-empire's numbers until the swap happens. The mirror test will fail if either side
  changes alone.

## Round 10 — A: the decorating catalogue (`data/decor.json`)

`ContentPack.decor` (both packs): 45 items over nine slots (floor, walls, lighting, seating, tables, signage, plants,
music, window), five per slot — one free **starter** (what the restaurant opens with: oak planks, cream paint, bare
bulbs, wooden chairs, pine tables, a plain name board, two potted plants, a quiet room, window planters) and four to
buy, from pocket money to a splash. Validated in `src/index.ts validateDecor` (shape, slots, tags, integer pence,
effect ranges, one starter per slot, 4–7 items per slot, refresh cheaper than buying, descriptions ≤ 120 characters);
`test/decor.test.ts`.

- **Prices** (pence, UK-plausible for a small restaurant, fitted): herb pots £70, kitchen radio £45, chalkboard £90,
  fairy lights £120, gingham cloths £150 … striped wallpaper £800, brass pendants £950, jukebox £1,500, terrazzo £2,200,
  leather banquettes £2,600, marble tops £3,000, a grand piano £3,200, herringbone parquet £3,800, crystal chandeliers
  £4,200, velvet armchairs £4,600. The whole lavish kit is £26,250 against ~£15–20k of starting cash.
- **Tags** cosy / smart / fun / posh (1–2 each) make the room's style; `styles` names them (Cosy café, Fun diner,
  Smart bistro, Posh dining room) with small per-segment entry nudges (±0.1: students and families like fun, foodies
  and business like posh and smart) and a critic bonus (smart 2, posh 4).
- **Effects** are small integers (prestige 0–2, popularity 0–2, comfort 0–3, stay 0–2, spend 0–5 %, upkeep pence/day);
  the room's sum is capped in sim-core (`DECOR_CAPS`). Posh items carry prestige, fun/cosy ones popularity, seats,
  lights and music comfort/stay/spend; things that need washing, watering, tuning or baking carry upkeep (gingham £1,
  white linen £3, cake display £2, flower wall £2.50 a day).
- **Wear**: `lifeDays` 60 (herbs wilt) to 600 (marble); `refreshCost` ≈ 10–25 % of the price (chalk £15, cushions £70,
  damask £300). `fitTables` 0–3: floors and banquettes are big jobs.
- **Words**: `description` is one short, dry sentence ("Put a coin in and pick a song. Someone always picks the same one."; Round 11b); `nightLine` finishes
  "Your new {name}: …" on its first night ("the jukebox got everyone singing").

## Round 10 — B: `staffQuotes.json` (ContentPack.staffText)
- `quotes`: one-line "why me" lines a candidate says on the hiring sheet, keyed by `staffArchetypes` id (a role id also works as a fallback). Five per archetype, ≤ 70 characters, friendly and dry, readable by a 12+ player (Round 11b; was "a 10-year-old"). Picked deterministically per person (`quoteFor`).
- `likes` / `dislikes`: labels for sim-core's `LIKE_IDS` / `DISLIKE_IDS`; every id must be present (the content package keeps a local copy of the id lists — `STAFF_LIKE_IDS` / `STAFF_DISLIKE_IDS` — and a test checks they equal sim-core's).
- Validation: unknown archetype/role keys, empty or over-long quotes, missing or unknown like/dislike ids. `content/test/round10.staffText.test.ts` (4).
- Traits are unchanged (18 in `traits.json`); their effects are summarised for the player in the staff room's chip tips.

## Round 11 — D: plain words and "No grown-up drinks"

Red-team U7, U8 and the U12 burnout line. Text only: no id, number, price, cost, prestige or shelf life changed, so the
sim, balance and every save are untouched (`round11.words.test.ts` compares the pack's shape before and after).

### "No grown-up drinks" (`src/softDrinks.ts`)

A **content view**, not a second pack: `applySoftDrinks(roots, on)` walks the pack and extras and swaps display strings
by exact match (and back again when switched off). The game applies it at load from Settings › "No grown-up drinks"
(**on by default**, `lib/settings.ts noGrownUpDrinks`) and again when the setting changes (`game/src/sim.ts
syncSoftDrinks`). Because sim-core builds its log lines from the pack at run time, "Tall fizzy lemonade added to the
menu" follows automatically; lines already written into a save keep their old words. `ALCOHOLIC_DISH_IDS` (by id) still
keeps those drinks away from parties with children, exactly as before. `GROWN_UP_WORDS` is the list the test checks.

| Was | With the setting on | Id |
| --- | --- | --- |
| Pint of lager / Draught lager (pint) | Tall fizzy lemonade / Fizzy lemonade on tap (tall glass) | `lager` |
| Pint of local ale / Local ale (pint) | Tall local dandelion & burdock / Local dandelion & burdock (tall glass) | `local_ale`, `craft_ale` |
| Glass of house wine / House wine (175ml) | Glass of sparkling elderflower / Sparkling elderflower (175ml) | `house_wine` |
| Glass of good red / Good red wine (175ml) | Glass of blackcurrant crush / Blackcurrant crush (175ml) | `fine_red`, `fine_wine` |
| Glass of prosecco / Prosecco (125ml) | Glass of fizzy apple / Fizzy apple (125ml) | `prosecco` |
| Gin & tonic | Tonic & lime | `gin_tonic` |
| Espresso martini | Iced mocha | `espresso_martini` |
| Steak & ale pie · Duck breast, red wine jus · Beer-battered onion rings | Steak & onion pie · Duck breast, cherry jus · Crispy battered onion rings | (cooking) |
| Stars glasses: Downs sparkling, Loire white, Alsace Riesling, white Burgundy, Provence rosé, Rioja reserva, red Burgundy, Sauternes | Downs pressed apple, lemon & thyme cordial, apple blossom press, peach & vanilla nectar, pink lemonade, spiced cherry cordial, red grape juice, honey & pear nectar | `fd_wine_*`, `wine_*` |
| The Stars wine list (`wineList.json`, 8 bottles) | the drinks list: same bottles, cost, price and glass dish; names, regions and notes re-worded | `bottle_*` |
| "(Grown-ups only.)" on every blurb | dropped | |
| critic line: "asked for the wine list twice. The wine expert is now very nervous." | "asked for the drinks list twice. The drinks expert…" | |
| halal rules: "No alcohol on the menu." / "No pork, no alcohol…" | "No grown-up drinks on the menu." / "No pork, no grown-up drinks…" | |

### Plain-words pass (always on)

| Where | Was | Now |
| --- | --- | --- |
| `events.json` broken-dishwasher | "for a call-out fee" | "for a fee for coming out" |
| `events.json` tax refund | "A brown envelope from HMRC" / "you overpaid VAT last quarter" | "A brown envelope from the tax office" / "you paid too much tax last quarter" |
| `criticText.json`, `dishes.json` (fd red Burgundy), `wineList.json` | sommelier(s) | wine expert(s) |
| `criticText.json` burnout | "sat down in the walk-in fridge and wouldn't come out" (a child copying it could be shut in) | "sat down on an upturned crate and said they couldn't do one more night" |

Sim-package strings the player reads (log lines, board options, hints; text only):

| Package | Was | Now |
| --- | --- | --- |
| sim-core (`engine`, `commands`, `systems/order`) | "… — 86'd for today." / "already 86'd" | "… — taken off tonight." / "already off tonight" |
| sim-empire (`engine`, `board`) | HQ (every log line, refusal and board option) | head office / Head office |
| sim-empire | "a royalty holiday", "pays no royalty", "paying the royalty", "Royalty rises" | "a break from paying their share", "pays you no share", "paying you their share", "Your share rises" |
| sim-stars (`hints`, `commands`) | satellite(s); "the wholesaler" | sister restaurant(s); "the big supplier" |
| sim-career (`offers`, `review`) | "fair tronc", "share of the tronc" | "fair shared tips", "share of the tips" |

Kept, with a `<Term>` tip (game `lib/glossary.ts`): commis, chef de partie, sous chef (the career ladder — `RungName`),
covers (only on the Served tile and the evening's "guests"), HQ (the Empire strip's chip), royalty / franchise fee /
ad fund (Empire contract rows), footfall (lease screen, now an inline tip on "People walking past"), satellite,
tronc. The game-side screens are listed in UI-NOTES "Round 11 — D".

## Round 11b — age 14

The player is 14 (BRIEF: 12+). No id, number, price, pool size or key changed: every pool keeps its line count, so RNG
draws, saves and the headless balance are identical (typical 90.0 %, cheap 68.0 %, nohire 0 %, 200 seeds × 365 days,
row for row as R11.6). `content` 69 tests, sim-core 301.

### Trade words restored (the game tips each on screen; UI-NOTES "Round 11b")

| R11-D | Round 11b | Where |
| --- | --- | --- |
| "for a fee for coming out" | "for a call-out fee" | `events.json` broken dishwasher |
| "A brown envelope from the tax office" / "you paid too much tax" | "A brown envelope from HMRC" / "you overpaid VAT" | `events.json` tax refund |
| wine expert(s) | sommelier(s) | `criticText.json`, `dishes.json` (fd red Burgundy), `wineList.json` |
| taken off tonight / already off tonight | 86'd for today / already 86'd | sim-core engine, commands, order |
| head office / Head office | HQ | sim-empire engine, board, focus (every log line, refusal and option) |
| "a break from paying you their share" / "pays you no share" / "already has a break…" / "Your share rises" / "pays you a share of its sales" | "a royalty holiday" / "pays no royalty" / "already has a royalty holiday" / "Royalty rises" / "pays you a royalty on its sales" | sim-empire |
| sister restaurant(s) / "N sister restaurants big" / the big supplier | satellite(s) / "N satellites wide" / the wholesaler | sim-stars commands, hints |
| fair shared tips / share of the tips | fair tronc / share of the tronc | sim-career offers, review |

Kept from D: the walk-in-fridge burnout line stays "an upturned crate" (U12). `round11.words` now checks the four
content words are back and nothing outside the game's glossary (86'd, tronc, footfall, wholesaler) appears in content.

### Drinks

- **Real drinks by default** (game Settings › "Hide alcoholic drinks", off). `applySoftDrinks` is unchanged.
- "(Grown-ups only.)" on 15 drink blurbs → **"(Over-18s only.)"** (`dishes.json`; the soft view's `from` strings and
  `GROWN_UP_WORDS` follow).
- Checked as something a parent switches on: "Tall local dandelion & burdock" in a pub-ish menu is fine; the Stars list
  lost its two jokes — "Pink lemonade" → **Rhubarb & rose pressé** (region "A rose garden in Provence"), "Red grape juice"
  → **Pressed Pinot Noir grape** (dish, ingredient and bottle); halal rules say "Soft drinks only on the menu." / "No
  pork, soft drinks only, halal meat only." / "…and serve soft drinks only." instead of "grown-up drinks".

### Voices for 14 (every changed string)

From a 10-year-old's register to the dry one the game already uses. Kept on purpose: the little brother who learned to
whistle, the salt shaker, "more 'oops' than 'ooh'", Mum watching the plate, grandad's happy dance, "a medal and a nice cup
of tea", the bread basket, "Bring your granny", "cry happily into a tea towel", the jumping team and dropped whisk.
51 player lines rewritten (plus the staffQuotes `_note`, now "written for a 12+ player"); sim-core's built-in incident/goal
text mirrors the content pack (`extras.test` "match sim-core exactly"). Pools and keys unchanged. A row quoting part of
a line changed only that part.

| File | Was | Now |
| --- | --- | --- |
| `reviewTemplates.json` | The {dish} arrived cold and a bit sad. We were sad too. | The {dish} arrived cold and slightly defeated. So did we. |
| `reviewTemplates.json` | We left hungry and a little grumpy. Hope {restaurant} has a better day tomorrow. | We left hungry and quietly furious. {restaurant} owes us a better night. |
| `reviewTemplates.json` | {restaurant} has potential! The {dish} just needs a little more love. | {restaurant} has potential. The {dish} hasn't heard. |
| `reviewTemplates.json` | Our server was lovely but the kitchen seemed to be having a wobbly day. | Our server was great. The kitchen was having a separate, worse evening. |
| `reviewTemplates.json` | Two stars: one for the {dish}, one for the very cute bread basket. | Two stars: one for the {dish}, one for the bread basket, which carried the team. |
| `reviewTemplates.json` | We'd come back if the waiting time got shorter. Our tummies were rumbling. | We'd come back if the wait got shorter. We read the whole menu. Twice. |
| `reviewTemplates.json` | Friendly staff and a {dish} that hit the spot. Room to grow! | Friendly staff and a {dish} that hit the spot. Room to grow. |
| `reviewTemplates.json` | Happy enough! My dad said 'mmm' twice, which is about average for him. | Happy enough. My dad said 'mmm' twice, which is about average for him. |
| `reviewTemplates.json` | Great food, kind staff, and the {dish} came out piping hot. We'll be back! | Great food, sharp service, and the {dish} came out piping hot. We'll be back. |
| `reviewTemplates.json` | We came for a quick bite and stayed for dessert. Oops! Worth it. | We came for a quick bite and stayed for dessert. And coffee. Worth it. |
| `reviewTemplates.json` | Everything was magic: the welcome, the {dish}, the pudding, even the napkins. | Everything worked: the welcome, the {dish}, the pudding. Even the napkins were good, somehow. |
| `reviewTemplates.json` | I dreamed about the {dish} the night after. A very tasty dream. | I dreamed about the {dish} the night after. Not complaining. |
| `reviewTemplates.json` | Friendly, fast and fabulous. {restaurant}, you've got a fan for life! | Fast, friendly and properly good. {restaurant}, you've got a regular. |
| `reviewTemplates.json` | Our {dish} was lovely, but it was chaos in here tonight. Poor staff! | Our {dish} was lovely, but it was chaos in here tonight. The staff deserve a lie-down. |
| `reviewTemplates.json` | I liked my {dish}! Shame so many people left before they got theirs. | I liked my {dish}. Shame half the room left before they got theirs. |
| `reviewTemplates.json` | The {dish} was a nice surprise on a messy night. Fingers crossed it's calmer next time! | The {dish} was a nice surprise on a messy night. Calmer next time, please. |
| `criticText.json` | 'Three stars, and a happy tummy,' says {critic}. | 'Three stars, and no complaints from my stomach,' says {critic}. |
| `criticText.json` | FIVE STARS! {critic} says | Five stars. {critic} says |
| `criticText.json` | Your kitchen sang all year long. Congratulations! | Your kitchen sang all year long. Congratulations. |
| `criticText.json` | we are proud to award your very first star. Welcome to the guide! | we are proud to award your very first star. Welcome to the guide. |
| `incidentText.json` | A fresh {dish} went out to table {table}. Much better! | A fresh {dish} went out to table {table}. Much better. |
| `incidentText.json` | Whoops, a spill! | A drink goes flying |
| `incidentText.json` | Big group, big bill! | Big group, big bill. |
| `incidentText.json` | They cheered! | They cheered. Loudly. |
| `incidentText.json` | Here comes a rush! | Here comes a rush |
| `incidentText.json` | The fryer has tripped! | The fryer has tripped |
| `incidentText.json` | A food critic is here! | There's a critic in |
| `incidentText.json` | is writing in a little notebook. It's a food critic! | is writing in a small notebook between bites. That's a food critic. |
| `incidentText.json` | A free treat went out to the critic. They smiled! | A free treat went out to the critic. They smiled, then wrote something down. |
| `incidentText.json` | had a sit-down and a cup of tea. Feeling better! | had a sit-down and a cup of tea. Back on form. |
| `incidentText.json` | Your restaurant's name is getting around! | Word is getting around. |
| `goalText.json` | "Open your doors!" | "Open your doors" |
| `goalText.json` | Days off for staff need cover! | Days off for staff need cover. |
| `goalText.json` | Watch your waste! | Watch your waste. |
| `goalText.json` | "Goal done: {title}!" | "Goal done: {title}." |
| `staffQuotes.json` | I've been cooking with my gran since I was six! | I've been cooking with my gran since I was six. She's still better. |
| `staffQuotes.json` | I want to be a head chef one day. This is step one! | Head chef one day. This is step one. |
| `staffQuotes.json` | I can carry four plates without a wobble! | Four plates, one trip, no wobble. |
| `staffQuotes.json` | I make a fizzy lemonade that sparkles like magic. | My homemade lemonade has a waiting list. |
| `decor.json` | Silky wallpaper with a swirly pattern. Very posh. | Silky wallpaper with a swirly pattern. Black tie optional, but encouraged. |
| `decor.json` | Cool, shiny marble. Heavy to carry in! | Cool, shiny marble. The delivery driver is still recovering. |
| `decor.json` | the marble tables looked very posh | the marble tables made it look expensive |
| `decor.json` | You can see it from the end of the street! | You can see it from the end of the street. |
| `decor.json` | Little pots of basil and mint on the tables. They need watering! | Pots of basil and mint on the tables. Somebody has to water them. |
| `decor.json` | Put a coin in and pick a song! | Put a coin in and pick a song. Someone always picks the same one. |
| `decor.json` | A stand of fresh cakes in the window. Yum! | A stand of fresh cakes in the window. Hard to walk past. |
| `careerText.json` | The kitchen has copper pans! | The kitchen has copper pans. |
| `countries.json` | A cheeseburger breaks two rules at once! | A cheeseburger breaks two rules at once. |
| `countries.json` | The queue is out the door! | The queue is out the door. |
| `countries.json` | has become a holiday tradition! | has become a holiday tradition. |
| `goalText.json` | "Goal done: {title}! Reward: {reward}." | "Goal done: {title}. Reward: {reward}." |

## Round 12 — E: voices (gossip, rival, regulars, blogger, sharper critics)

Game-side text only: no sim package reads any of it, so RNG, saves and the headless balance are unchanged (typical
90.0 %, cheap 68.0 %, nohire 0 %). British, dry, a little rude, never cruel: no swearing, nothing about looks, weight,
race or disability; no grown-up drinks (the validator runs `GROWN_UP_WORDS` over every line, since the "Hide alcoholic
drinks" view can't swap these); no 86'd/tronc/footfall/wholesaler in content lines (the R11b test). Exclamations only
where earned.

### Files

| File | Read by | Keys |
| --- | --- | --- |
| `gossip.json` (new) | `game/src/lib/gossip.ts` | `stations` (4), `opening` (3), `patter` (40), `jokes.critic` (10, told in order), `jokes.bins` (10, in order), `reactions.*` (15 pools, 81 lines), `rival.youWon`/`theyWon` (3 + 3), `clipping` (2) — **152 lines** |
| `rival.json` (new) | `lib/rival.ts` | `firstNames` (16), `surnames` (12), `districtWords` (4), `personalities` (8 × label, bio, 2 places, 5 post pools × 2), `winningLine` (5), `clippingItem` |
| `regulars.json` (new) | `lib/regulars.ts` | 10 regulars × (name, job, segment, favourite, colour, intro, 4 beats × order / dishes / good / bad? / photo / gossip), `lines` (7) |
| `criticText.json` | sim-stars (names only), the game | `localCritic` rewritten — **same keys, 4 lines each**, same placeholders; `criticNames` unchanged; new `blogger` key (name, blog, tagline, `headlines` 1–5 × 3, `reviews` 1–5 × 2, `spotted` 3, `closed` 2, `signoff` 3 = **33 lines**) |

`@full-plate/content/voices` (`src/voices.ts`) loads the three new files, validates them (placeholders, starter-library
dish ids, 8 personalities, 8–10 regulars × 4 VIP beats, drink and trade words) and throws on a problem, like the main
pack. `extras.ts` types and validates `criticText.blogger` (optional, so an old pack still loads).

Placeholders — gossip: {restaurant} {district} {station} {dish} {staff} {rival} {rivalPlace} {blogger} {covers}
{walkouts} {weekday}; rival: {rival} {rivalFirst} {rivalPlace} {restaurant} {district} {dish} {you} {them}; regulars:
{name} {dish} {weekday} {restaurant} {district} {blogger}; blogger: {restaurant} {dish}.

### Strings written in code (not in JSON)

- Ticker: "{station} · Food Gossip", "More" / "Less", "This morning", "Yesterday", "{Mon} (day N)", list name "The last
  seven mornings". Blogger gossip: "{name} on {blog}: “{headline}” (N★)".
- Evening: "Your regulars tonight", "a new regular", "a VIP order met · photo for the book: {emoji}", "it didn't quite go
  to plan", "N out of 5, posted tonight", "Three weeks running ahead of {rivalPlace}." / "The Gazette wants a photo. A
  framed clipping goes on your Restaurant tab.", "Tomorrow on {station}".
- Restaurant tab: "Across the road", "Their posts", "Nothing yet. They're watching, though.", "You've won N week(s)
  running (3 gets you in the paper).", "Regulars", "N of 10", "Nobody yet. Open for a night or two and faces start
  coming back.", "N open VIP order(s).", "Open the Regulars book".
- Regulars book: "The Regulars book", "People who keep coming back. Meet a VIP order (their dish on the menu that day,
  and a night of 3.5★ or better) and their story moves on, with a photo for the book.", "VIP order:", "{job} · usually
  has the {dish}", "N more face(s) to come. New regulars turn up as stories finish."
- Floor tag: "{name}" / "Ruth Lessley (food blogger)". Glossary: **VIP** — "Special guest: very important person: a
  guest you go out of your way for. A VIP order is the dish they've asked to find on the menu."

### Critic pool: before → after (same keys, same sizes)

| Key | Was | Now |
| --- | --- | --- |
| localCritic.1 | {critic} came, saw, and waited forty minutes for a {dish}. 'I've had warmer welcomes from a fridge,' they wrote. Ouch, but fair. | {critic} waited forty minutes for a {dish} at {restaurant}. 'I have had warmer welcomes from a fridge,' they write. Harsh. Not wrong. |
| localCritic.1 | 'The {dish} at {restaurant} tasted like it had given up halfway,' says {critic}. Tomorrow is a new day. | 'The {dish} at {restaurant} tasted like it had given up halfway,' says {critic}. 'So, eventually, did I.' |
| localCritic.1 | {critic} gives {restaurant} one star, and that star is for the comfy chairs. | {critic} gives {restaurant} one star. 'The star is for the chairs. The chairs were doing their best.' |
| localCritic.1 | 'I wanted to love it,' writes {critic}. 'The {dish} did not want to be loved.' | 'I wanted to love it,' writes {critic}. 'The {dish} had other plans, and the plans were beige.' |
| localCritic.2 | {critic} found {restaurant} 'friendly but a bit wobbly'. The {dish} needed one more minute of care. | {critic} found {restaurant} 'friendly, keen and a bit wobbly'. The {dish} needed one more minute and one more idea. |
| localCritic.2 | 'Good ideas, shaky cooking,' says {critic}. 'Come back in six months and I might be cheering.' | 'Good intentions, shaky cooking,' says {critic}. 'Come back in six months. I'll bring a cushion, just in case.' |
| localCritic.2 | Two stars from {critic}: the {dish} was nearly there, the service was nearly quick. | Two stars from {critic}: 'The {dish} was nearly there. So was the service. So, frankly, was I.' |
| localCritic.2 | 'There's a good restaurant hiding inside {restaurant},' writes {critic}. 'It just needs to come out and say hello.' | 'There is a good restaurant hiding inside {restaurant},' writes {critic}. 'It should stop hiding. It's not very good at it.' |
| localCritic.3 | {critic} calls {restaurant} 'a solid, honest night out'. The {dish} won't change your life, but it will make your Tuesday. | {critic} calls {restaurant} 'a solid, honest night out'. The {dish} won't change your life, but it might improve your Tuesday. |
| localCritic.3 | 'Three stars, and no complaints from my stomach,' says {critic}. The {dish} was the highlight. | 'Three stars, and no complaints from my stomach,' says {critic}. 'My stomach is notoriously hard to please.' |
| localCritic.3 | {critic} liked it: 'Nothing wrong, a few things very right, and a {dish} I'd order again.' | {critic} liked it: 'Nothing wrong, a few things very right, and a {dish} I would order again if nobody was watching.' |
| localCritic.3 | 'Reliable as a good umbrella,' writes {critic} of {restaurant}. That's a compliment round here. | 'Reliable as a good umbrella,' writes {critic} of {restaurant}. Round here, that's practically a love letter. |
| localCritic.4 | {critic} is impressed: 'The {dish} at {restaurant} is cooked by someone who really cares.' Bookings are already picking up. | {critic} is impressed: 'The {dish} at {restaurant} is cooked by someone who cares, slightly too much, in the best way.' |
| localCritic.4 | 'Go now, before everyone else finds out,' writes {critic}. Too late: everyone has just found out. | 'Go now, before everyone finds out,' writes {critic}. Everyone has now found out. Thanks, {critic}. |
| localCritic.4 | Four stars from {critic}, who called the {dish} 'the kind of plate you think about on the bus home'. | Four stars from {critic}, who called the {dish} 'the kind of plate you think about on the bus home, and the bus after that'. |
| localCritic.4 | 'Confident, generous and properly delicious,' says {critic}. Chef {chef} is grinning in the kitchen. | 'Confident, generous and properly delicious,' says {critic}. Chef {chef} has read it eleven times and is pretending they haven't. |
| localCritic.5 | Five stars. {critic} says {restaurant} is 'the best meal in {city} this year'. The phone has not stopped ringing. | Five stars. {critic} calls {restaurant} 'the best meal in {city} this year, and I have eaten a worrying number of meals in {city}'. Book now. |
| localCritic.5 | 'I licked the plate. Don't tell my editor,' writes {critic} about the {dish}. Five stars. | 'I finished the plate and then I wiped it with bread. My editor will be appalled,' writes {critic} of the {dish}. Five stars. |
| localCritic.5 | {critic} calls chef {chef} 'a genius with a whisk'. Five stars, and a queue down the street by lunchtime. | {critic} calls chef {chef} 'a genius with a whisk and slightly dangerous with a blowtorch'. Five stars. |
| localCritic.5 | 'Book a table. Book two. Bring your granny,' says {critic}. Five stars for {restaurant}. | 'Book a table. Book two. Bring someone you want to impress,' says {critic}. Five stars for {restaurant}. |

### Every new line

**gossip.stations**

- student_quarter: Campus 87.6
- high_street: High Street FM
- business_park: Park & Ride Radio
- seaside: Pier 104

**gossip.opening**

- New on {district} today: {restaurant}. The paint is dry, mostly. Do not lean on the door frame.
- {station} can confirm a new restaurant opens on {district} this {weekday}. The previous tenant sold phone cases. We are cautiously optimistic.
- Opening today: {restaurant}. Locals report the smell of onions and nerves.

**gossip.patter**

- Good morning, {district}. It's {weekday}, the kettle's on and somebody has parked across two spaces again.
- Traffic news: the roundabout is still a roundabout. Plan accordingly.
- A pigeon on the bus shelter has been there so long it now has its own postcode.
- Weather today: weather. Bring a coat you can blame later.
- The pound shop has put everything up to one pound twenty. The sign has not been updated. Nobody is coping.
- Lost: one umbrella, black, extremely ordinary. Answers to nothing.
- The parish noticeboard has a new notice asking people to stop putting notices on the noticeboard.
- Scientists confirm the queue at the post office is moving. Very slowly. But it is moving.
- This week's top-selling crisp flavour on {district}: 'Roast Dinner'. We have questions.
- A man on {district} has been jogging every morning for six years and has never once looked happy about it.
- The library's book of the week is about mindfulness. It is overdue.
- Reminder: the clocks don't change this week. Your oven clock is still wrong, though.
- The new bus timetable is out. It is a work of fiction and should be shelved as such.
- The charity shop has six fondue sets and no fondue. Supply and demand, everyone.
- Local dog Biscuit has learned to open the café door. Management are drawing up a staff contract.
- Today's word on {station} is 'gazump'. Use it at lunch. Watch people pretend they know what it means.
- Tip of the day: a mug of tea fixes most things, except the actual thing.
- Somebody has knitted a hat for the postbox again. It looks warmer than most of us.
- Roadworks on {district} enter their third month. The hole has been given a name: Gary.
- Gary the hole is now fenced off with four cones and a sense of purpose.
- Our phone-in topic: is a jacket potato a meal or a cry for help? Lines are open.
- A seagull stole an entire sausage roll on {district} yesterday. Witnesses describe it as 'brazen' and 'honestly quite impressive'.
- The cash machine outside the bank is working today. Make the most of it.
- Fact: the average person spends four months of their life deciding what to have for tea. {station} is here to help. Have the soup.
- The town clock is five minutes fast, so everyone is five minutes early, so nobody is ever late. It's the best thing about living here.
- Lollipop lady Doreen is back from holiday and has never looked more ready to stop traffic.
- Breaking: the vending machine at the leisure centre has returned someone's coin. The town is in shock.
- Our gardening expert says now is a good time to do nothing to your garden. Finally, advice we can follow.
- The quiz at the community hall was won by a team called 'Quiz Team Aguilera'. The puns are getting worse. Keep going.
- The leisure centre's water slide is closed for 'maintenance'. It has been closed for 'maintenance' since spring.
- Today on {district}: a sale on rugs at the shop that has had a 'closing down' sale since 2009.
- Overheard on {district}: 'I'm not hungry, I'll just have some of yours.' Every chef within a mile flinched.
- Market stall prices this morning: apples up, pears down, the man selling phone cables mysteriously everywhere.
- The ice-cream van now plays its tune in a minor key. Nobody knows why. Everyone is unsettled.
- The cinema is showing a film about a chef who shouts. Real chefs say it's a documentary.
- Fun fact: the word 'restaurant' comes from French for 'restore'. Not 'queue for forty minutes'. Just saying.
- A survey says people on {district} eat out more on {weekday}s than any other day. The survey was three people. They were very sure.
- The bakery has invented a croissant-doughnut-muffin. They call it a 'cronuffin'. We call it 'too much'.
- Lost cat Mr Whiskers has been found. He was in the next-door kitchen the whole time, eating very well.
- Thought for the day: nobody ever remembers a beige meal. Season your food, {district}.

**gossip.jokes.critic (in order)**

- Clive Halfway of the Gazette has reviewed another restaurant. He left after the starter. Four stars. Nobody knows how.
- Clive Halfway update: he ordered a three-course meal, ate one and a half courses and called it 'a complete experience'.
- Clive Halfway was spotted at the chip shop. He bought chips. He ate six. He wrote eight hundred words.
- Clive Halfway's editor has asked him to finish a meal 'just once, for the readers'. He says he'll think about it after the starter.
- Clive Halfway has started a podcast. Every episode ends halfway through.
- Clive Halfway was seen holding a pudding spoon. Witnesses say he put it down again. Experts call it 'a breakthrough'.
- Clive Halfway's new column: 'Half a Pie'. It is about half of a pie.
- Clive Halfway was asked why he never finishes. 'If you finish,' he said, 'what would you have to look forward to?' Then he left mid-sentence.
- Clive Halfway reviewed a buffet. He describes it as 'mostly unexplored'.
- Clive Halfway has finished a meal. Repeat: Clive Halfway has finished a meal. It was a single mint. He gave it two stars, 'a bit much'.

**gossip.jokes.bins (in order)**

- The council's bin lorry came at five this morning, reversing and beeping the whole way down {district}. It did not collect any bins.
- Bin lorry update: it came back. It beeped. It took one bin. Just the one. Everyone is asking why that bin.
- The council says the bin lorry is 'on a new route for efficiency'. The new route is the old route, backwards.
- The bin lorry was seen parked outside the bakery for twenty minutes. The driver was not collecting bins. He was collecting a sausage roll.
- A petition to rename the bin lorry 'Beepy McBinface' has passed four hundred signatures. The council is 'reviewing it'.
- The bin lorry now plays a jingle while reversing. It is the ice-cream van's jingle. Children are devastated.
- The council has apologised for the bin lorry. The apology letter was put in the recycling. Which was not collected.
- The bin lorry has a new driver, and he collects every single bin. {district} doesn't know how to feel. Somebody cried.
- The old bin lorry driver is back. Normal service has resumed. One bin, much beeping.
- Beepy McBinface is official. The council has painted the name on the side, spelled wrong. Somehow, this feels right.

**gossip.reactions.oneStar**

- Someone gave {restaurant} one star yesterday. In fairness, someone also gave the post office one star. Chin up.
- A one-star review for {restaurant} has gone up online. It mentions the {dish}. It uses the word 'regret'.
- One star for {restaurant} last night. Every great chef has a review they keep in a drawer. This might be yours.
- Word on {district}: one diner at {restaurant} left a single star and a very long paragraph. Read it once, learn one thing, move on.
- One star yesterday for {restaurant}. Over the road, {rival} is pretending not to have seen it. They've seen it.
- A one-star review landed at {restaurant}. Doreen the lollipop lady says she's had worse reviews and she just stands in the road.

**gossip.reactions.fiveStar**

- Five stars for {restaurant} last night, and the {dish} got a mention. Somebody's printing it out for the fridge.
- A five-star review for {restaurant} yesterday. The word used was 'unreal'. We checked. It was real.
- Someone on {district} has given {restaurant} five stars and the {dish} 'a standing ovation'. They did not actually stand. We asked.
- Five stars at {restaurant}. {rival} has been seen staring at the reviews page for a worrying length of time.
- Five-star review for {restaurant}. Clive Halfway has asked for a table. He'll probably leave after the starter, but still.
- A five-star night at {restaurant}. The {dish} is officially the talk of {district}. Well, the talk of the bus stop.

**gossip.reactions.rush**

- {restaurant} served {covers} guests yesterday. The queue went past the chemist. The chemist was thrilled.
- {covers} guests through the door at {restaurant} yesterday. Somebody check the floor's still there.
- Big night at {restaurant}: {covers} served. The washing-up is still being discussed in hushed voices.
- {covers} people ate at {restaurant} yesterday. That's more than went to the council meeting. By a lot.
- Rush hour at {restaurant} last night: {covers} guests. The bin lorry slowed down just to look.
- {restaurant} had {covers} in yesterday. {rival} over the road had an 'early night'. Sure they did.

**gossip.reactions.quiet**

- A quiet one at {restaurant} yesterday: {covers} guests. Good night for practising, bad night for the till.
- {restaurant} served {covers} yesterday. Quiet nights happen. So do busy ones. Usually after someone tells their mates.
- Only {covers} through the door at {restaurant} last night. The chairs got a rest, at least.
- Yesterday was a quiet one on {district}. {restaurant} served {covers}. Gary the hole had more visitors.
- {covers} guests at {restaurant} yesterday. Not a crowd. A gathering. A select few. You get the idea.

**gossip.reactions.walkouts**

- {walkouts} people got fed up of waiting at {restaurant} yesterday and walked out. They went to the chip shop. The chip shop says thanks.
- {walkouts} walked out of {restaurant} last night before they were served. That's {walkouts} people telling their friends about the wait.
- Spotted: {walkouts} hungry people leaving {restaurant} empty-handed yesterday. More tables? More staff? Fewer queues, anyway.
- {walkouts} walk-outs at {restaurant}. {rival} says they 'don't believe in queues'. They also don't believe in customers, judging by Tuesday.
- The queue at {restaurant} lost {walkouts} people yesterday. A queue that shrinks from the front is good. From the back, less so.
- Yesterday {walkouts} people gave up on {restaurant} and left. A busy place is good. A busy pavement, less so.

**gossip.reactions.ranOut**

- {restaurant} ran out of the {dish} yesterday. A sell-out, or a shopping list problem? Only the larder knows.
- No {dish} left at {restaurant} by the end of last night. Somebody check the stock before the regulars notice.
- Overheard on {district}: 'They'd run out of the {dish}.' Said in the tone usually kept for a cancelled train.
- The {dish} at {restaurant} sold out yesterday. Supply and demand: the demand turned up, the supply did not.
- {restaurant} took the {dish} off part-way through yesterday. The menu looked a bit gappy. Like a smile missing a tooth.
- Yesterday the {dish} ran out at {restaurant}. Somewhere, a delivery van is wondering what it did wrong.

**gossip.reactions.hire**

- {staff} has joined the team at {restaurant}. First day nerves, new shoes, someone else's apron. A classic.
- New face at {restaurant}: {staff}. Early reports say they can carry three plates. The bar is high.
- {restaurant} has hired {staff}. {rival} has been seen trying to hire them back. Too late.
- Welcome to the trade, {staff}. You'll learn where everything is in a week, and why it's there in a year.
- {staff} starts at {restaurant} this week. The staff room has been tidied. Briefly.
- Hiring news: {staff} joins {restaurant}. We're told the interview went well and nobody cried. A good sign.

**gossip.reactions.decor**

- {restaurant} has had the decorators in. {district} is impressed. Gary the hole, less so.
- Something new in the window at {restaurant}. Passers-by have been seen slowing down. Two of them stopped.
- {restaurant} is looking smart this week. {rival} has started measuring their own walls. Suspicious.
- New look at {restaurant}. A new room changes the mood. It doesn't change the cooking, but it helps the photos.
- The fitters have been at {restaurant}. Locals report a new thing. They can't agree what it is. They agree they like it.
- {restaurant} has a new bit of decor. Over the road, {rival} has hung a new mirror. Nobody asked them to.

**gossip.reactions.loan**

- {restaurant} has been to the bank. The bank said yes. The bank always sounds very cheerful when it says yes.
- News from the bank: {restaurant} has a loan. Every great restaurant started by owing someone money. Nearly every.
- {restaurant} has borrowed some money to keep things going. Pay it back and nobody will remember. Except the bank.
- Bank news: a loan for {restaurant}. Spend it on things that make money: people, food, tables. Not a fountain.
- {restaurant} took a loan yesterday. {rival} says they've 'never borrowed a penny'. Their uncle owns the building.

**gossip.reactions.bigProfit**

- Word is {restaurant} had a very good day at the till yesterday. Somebody is going to ask for a pay rise.
- Good news for the till at {restaurant}: a strong day yesterday. Bank it before you buy a fountain.
- {restaurant} made proper money yesterday. {rival} has gone very quiet on the internet. Coincidence.
- The till at {restaurant} was singing yesterday. In tune, too, for once.
- Yesterday was a good day for {restaurant}'s bank balance. Remember this feeling. Frame it.

**gossip.reactions.loss**

- {restaurant} lost money yesterday. Most new places do, early on. The trick is to know why.
- A day in the red for {restaurant}. Look at the sums tonight: wages, food or rent? One of them is the culprit.
- {restaurant} came out behind yesterday. {rival} would like you to know they 'never have bad days'. They have bad days.
- Money went out faster than it came in at {restaurant} yesterday. Happens to the best. Happens to the bin lorry daily.
- Yesterday cost {restaurant} more than it made. One bad day is weather. A bad week is a pattern.

**gossip.reactions.closed**

- {restaurant} kept its doors shut yesterday. A day off for everyone, except the rent.
- The lights were off at {restaurant} yesterday. Gary the hole kept watch.
- {restaurant} was closed yesterday. {rival} put a sign up saying 'We're open!' which, to be fair, they were.
- No service at {restaurant} yesterday. The chairs were very well rested.

**gossip.reactions.bestDish**

- Dish of the day on {district}: the {dish} at {restaurant}. People were tapping their phones at it.
- The {dish} at {restaurant} was the star yesterday. Fame is fleeting. Get it while it's hot.
- If you only eat one thing on {district} this week, it's the {dish} at {restaurant}. That's not an advert. We'd tell you.
- Yesterday's top plate on {district}: {restaurant}'s {dish}. {rival} has been seen 'researching' it.
- Hot tip from {station}: the {dish} at {restaurant}. People keep saying it, so it's either very good or a cult.
- A diner described the {dish} at {restaurant} as 'like a hug'. A hug with gravy. Fine by us.

**gossip.reactions.incident**

- Bit of a drama at {restaurant} yesterday, but the doors stayed open. That's the job, really.
- Something went wrong at {restaurant} yesterday and somebody fixed it. Nobody writes songs about that. They should.
- We hear yesterday at {restaurant} had a wobble. Wobbles are normal. Wobbling and carrying on is the trick.
- A problem at {restaurant} yesterday, sorted before most diners noticed. Restaurants are mostly this, it turns out.
- Behind-the-scenes chaos at {restaurant} yesterday, apparently. Front of house, all smiles. Classic.

**gossip.reactions.critic**

- The Gazette's critic has written up {restaurant}. Read it once, out loud, in a silly voice. It helps.
- A proper review for {restaurant} in the paper this morning. Clive Halfway is furious it wasn't him.
- The critic's column on {restaurant} is out. Somebody in the kitchen has already highlighted the nice bits.
- {restaurant} is in the paper. The critic's opinion is printed below, in small, serious letters.

**gossip.rival.youWon**

- Reviews this week: {restaurant} beat {rivalPlace}. {rival} says the scores 'don't count in the first week of the month'. They do.
- {restaurant} out-scored {rivalPlace} on reviews last week. {rival} has posted a picture of a sunset. Subtle.
- The weekly reviews are in: {restaurant} ahead of {rivalPlace}. Over the road, someone is rearranging the menu angrily.

**gossip.rival.theyWon**

- Reviews last week: {rivalPlace} edged {restaurant}. {rival} has been unbearable about it since breakfast.
- {rivalPlace} beat {restaurant} on reviews last week. {rival} has bought a trophy. For themselves. From the pound shop.
- Last week's reviews went to {rivalPlace}. {rival} is doing a lap of honour round the car park.

**gossip.clipping**

- Three weeks running, {restaurant} has out-reviewed {rivalPlace}. The Gazette ran it on page six. Someone has framed it. {rival} has not commented. Loudly.
- It's official: three weeks on top of {rivalPlace}. The clipping from the Gazette is going on the wall at {restaurant}. {rival} has gone for a long walk.

**rival names**

- Gavin, Tamsin, Rocco, Bea, Declan, Marisol, Hugo, Priti, Saffron, Mick, Odette, Kwame, Lorna, Felix, Yasmin, Barnaby
- Crust, Pepperell, Fennimore, Saltash, Ladle, Brisket, Sorrell, Quince, Marrow, Thyme-Whitley, Gristle, Plumtree
- student_quarter: Quad, high_street: High Street, business_park: Park, seaside: Pier

**rival.showman**

- label: The Showman
- bio: Flames at the table, a cape on Fridays. Has never cooked anything quietly.
- places: {rivalFirst}'s Theatre of Food / The Big Top {district}
- theyLead: Another week, another standing ovation at {rivalPlace}. Not literally. Mostly literally.
- theyLead: Reviews this week: us {them}, them over the road {you}. Encore!
- youLead: Reviews don't capture SPECTACLE. You can't give a flaming pudding a star rating. Well, you can. They did. It was low.
- youLead: Congratulations to the place over the road on their reviews. We'll be setting something on fire tonight, unrelated.
- close: Neck and neck with {restaurant} this week. Tonight: the dessert that comes with a drum roll.
- close: Close race on {district}. Close races need a finale. We have sparklers.
- yourBadNight: Heard a few people walked out over the road last night. Here, nobody leaves before the encore.
- yourBadNight: Thoughts with the team at {restaurant} after a tough night. Anyway: tonight, juggling.
- yourGoodNight: Big night over the road, apparently. Lovely for them. We did a magic trick with a soufflé.
- yourGoodNight: Good night for {restaurant}, I hear. We did the flaming crêpes twice. Once on purpose.

**rival.purist**

- label: The Purist
- bio: Four ingredients, no sauces, strong opinions about spoons.
- places: Pure / Root ({district})
- theyLead: Reviews this week: {them} to {you}. Restraint wins. It always does, eventually.
- theyLead: We removed another ingredient from the menu. The reviews went up. Think about that.
- youLead: Reviews are noise. The carrot knows. (Fine, they won this week. The carrot is upset.)
- youLead: Some people over the road put cheese on everything. The public, sadly, enjoys this.
- close: Level with {restaurant} this week. The difference will be the salt. It is always the salt.
- close: Neck and neck. We are not worried. We are calm. We are a single, perfect pea.
- yourBadNight: Rough night over the road, I hear. Too many dishes, too many problems. Simplify.
- yourBadNight: Long queues at {restaurant} last night. We had one guest. They were very happy.
- yourGoodNight: The place over the road was busy. Busy is not the same as good. (It was also good. Fine.)
- yourGoodNight: Lovely night for {restaurant}. We spent ours perfecting a radish.

**rival.influencer**

- label: The Influencer
- bio: Plates the food for the camera first and the customer second. Has a ring light in the kitchen.
- places: {rivalFirst} IRL / Feed Me {district}
- theyLead: {them} average on reviews this week vs over the road's {you}. Not that we're counting. We're counting.
- theyLead: Reviews up again. Link in bio. Also, the food is in the restaurant.
- youLead: Just a reminder that reviews aren't everything. Followers are everything.
- youLead: Over the road won the week on reviews. Good for them. Our pudding has nine thousand likes.
- close: Neck and neck with {restaurant}. Time for a giveaway.
- close: Close one this week. Like and share to help us win. That's how reviews work, right?
- yourBadNight: Saw the queue walking out of {restaurant} last night. We had no queue. We had content.
- yourBadNight: Rough night over the road. Our ring light is free if they want to borrow it.
- yourGoodNight: {restaurant} had a big night, apparently. Did they post about it? No? Then did it happen?
- yourGoodNight: Good night over the road. Our {district} story got twelve views. Different metrics.

**rival.pennypincher**

- label: The Penny-Pincher
- bio: Has never paid full price for anything, including the restaurant. Proud of it.
- places: Bargain Bistro / {rivalFirst}'s Value Kitchen
- theyLead: Better reviews than over the road, AND our chips are 40p cheaper. Do the maths.
- theyLead: Reviews this week: {them} to {you}. Cost us nothing. Literally nothing. We didn't buy napkins.
- youLead: Good reviews are easy when you spend money on food. Anyone can do that.
- youLead: They won the week. They also pay full price for butter. Who's really winning?
- close: Close race with {restaurant}. We're cutting prices again. And portion sizes. Don't tell anyone.
- close: Neck and neck on reviews. We've started reusing the menus. Just the menus.
- yourBadNight: Tough night over the road, I hear. Should have been cheaper.
- yourBadNight: Walk-outs at {restaurant}. Nobody walks out of a two-for-one.
- yourGoodNight: Busy night at {restaurant}. Big takings. Big bills too, I bet.
- yourGoodNight: Lovely night for them over the road. We saved four pounds on teabags.

**rival.oldpro**

- label: The Old Pro
- bio: Thirty years at the stove, twenty-nine of them complaining about young people.
- places: {rivalFirst}'s, Est. 1994 / The Old Range
- theyLead: Reviews this week: {them} to {you}. Experience. You can't buy it. You can only get old.
- theyLead: Better reviews than the new lot again. I've got pans older than that restaurant.
- youLead: Fine. The youngsters won the week. I'll be in the office, re-reading old reviews from 2003.
- youLead: Over the road beat us on reviews. In my day you had to win for a whole year before anyone noticed.
- close: Close this week. I've seen a hundred places like {restaurant} open. Some of them were quite good, I'll admit.
- close: Level pegging. I'm making my gravy the long way tonight. Out of spite.
- yourBadNight: Saw people leaving {restaurant} last night. Happened to me in 1997. You learn. Or you shut.
- yourBadNight: Rough night over the road. Tell them from me: get the prep done by four. Always by four.
- yourGoodNight: They were busy over the road last night. Good. Somebody's got to keep me sharp.
- yourGoodNight: Big night at {restaurant}. Reminds me of the old days. Before I got a bad knee.

**rival.healthnut**

- label: The Health Nut
- bio: Everything is spiralised. Has opinions about your gut.
- places: Sprout & About / Kale Me Maybe
- theyLead: Reviews: {them} to {you}. Turns out people like feeling good. Who knew? We knew.
- theyLead: Up on the week. Our new beetroot latte is doing very well with people who've lost a bet.
- youLead: They won on reviews. Comfort food is a short-term strategy. Discuss.
- youLead: Congrats over the road. We're doing a cleanse to process our feelings.
- close: Neck and neck with {restaurant}. We're adding chia seeds to everything. Everything.
- close: Close week. Deep breaths. Organic ones.
- yourBadNight: Rough night at {restaurant}. Have they tried oat milk? It solves most things. Not that, probably.
- yourBadNight: Queue trouble over the road, I hear. Stretch while you wait, people!
- yourGoodNight: Busy night over the road. All that cheese. Our kale is quietly furious.
- yourGoodNight: Big night at {restaurant}. We had a quiet one, spiralising. It's very centring.

**rival.grill**

- label: The Grill Boss
- bio: Fire, meat, a beard you could lose a spatula in. Calls everyone 'chief'.
- places: Flame & Fortune / Smoke Signals {district}
- theyLead: Reviews: {them}. Over the road: {you}. Fire wins, chief.
- theyLead: Another week ahead. The grill doesn't lie. The grill does burn the odd sausage.
- youLead: Over the road won the week. Respect, chief. The grill and I are having a quiet word.
- youLead: Reviews down. Turning the heat up. That's the answer to most things, here.
- close: Close one with {restaurant}. Friday's going on the grill. All of it.
- close: Neck and neck, chief. Bring your appetite and a fire extinguisher.
- yourBadNight: Hear they had a rough one over the road. We've all burnt the onions, chief.
- yourBadNight: Walk-outs at {restaurant}. Should've smelled our brisket. Would've stayed.
- yourGoodNight: Good night over the road, chief. Good for them. Better for us next week.
- yourGoodNight: Big night at {restaurant}. Noted. Lighting the big grill.

**rival.fusion**

- label: The Fusion Fanatic
- bio: Will put any two cuisines in one bun. Has called a sandwich 'a journey'.
- places: Wok This Way / Fusion Confusion
- theyLead: Reviews this week: {them} vs {you}. The sushi pasty is working. We're as surprised as you.
- theyLead: Ahead on reviews. Tonight's special: tikka ramen tacos. Please don't ask what's in the dip.
- youLead: Over the road won the week with normal food. Bold. Old-fashioned, but bold.
- youLead: They beat us on reviews. We've responded by inventing a curry trifle. Nobody asked us to.
- close: Neck and neck. We're fusing harder. Kimchi crumble drops on {district} tonight.
- close: Level with {restaurant}. Two cuisines? Why not five?
- yourBadNight: Rough night over the road, I hear. Maybe add some miso? Miso fixes most things.
- yourBadNight: Queue walked out of {restaurant} last night. We'd have given them a bao. A fish-finger bao.
- yourGoodNight: Big night at {restaurant}. Their {dish} is apparently great. We're fusing it with something.
- yourGoodNight: Busy over the road last night. Inspiring. We're putting their {dish} in a dumpling.

**rival.winningLine / clippingItem**

- you: You're winning on reviews: {you} to their {them}.
- them: {rivalFirst} is winning on reviews: {them} to your {you}.
- level: Level on reviews: {you} each.
- none: No full week of reviews yet. {rivalFirst} is watching, though.
- forfeit: You were shut all last week, so {rivalFirst} wins on reviews by default ({them}).
- Framed clipping: Gazette, page six: "{restaurant} beats {rivalPlace} three weeks running." Not for sale. Not even to {rivalFirst}.

**regulars.priya**

- Priya Nair, Dental nurse (favourite chicken_katsu, business)
- intro: Priya came in alone with a paperback and ordered the katsu without looking at the menu. She'll be back. She has the look.
- beat 2 order: {name} has a first date on {weekday} and wants the {dish}: 'the one thing I can't spill down myself'. — dishes chicken_katsu, mushroom_risotto, salmon_fillet
- beat 2 good: The date went brilliantly. They split a pudding. Nobody splits a pudding on a bad date.
- beat 2 bad: The date talked about his car for an hour. Priya ate the {dish} in silence and says it was the best part of the night.
- beat 2 photo: 🍰 Two forks, one pudding
- beat 2 gossip: Love is in the air at {restaurant}: a first date on {weekday} went so well they shared a pudding. Two spoons. Disgusting. Lovely.
- beat 3 order: {name} wants a table for two on {weekday}. Second date, or a brand-new one: she won't say. Just make sure the {dish} is on. — dishes steak_frites, seafood_linguine, tikka_masala
- beat 3 good: Date number two. She's started saying 'we'. The {dish} has been named 'our dish'. Steady on.
- beat 3 bad: It turned out he hates sharing food. Priya has decided she is 'focusing on her career now'.
- beat 3 photo: 📸 A blurry selfie by the window
- beat 3 gossip: Sources at {restaurant} confirm a second date went well. The {dish} is now 'their dish'. Brace yourselves, {district}.
- beat 4 order: {name} is bringing her mum on {weekday} to 'meet the restaurant'. It's a test. The {dish} is the test. — dishes roast_chicken, shepherds_pie, fish_and_chips
- beat 4 good: Priya's mum asked for the recipe, which is the highest honour a mum can give. Priya looked very relieved.
- beat 4 photo: 👩‍👧 Priya and her mum, both pointing at the pudding menu
- beat 4 gossip: A mum at {restaurant} on {weekday} asked for a recipe. In mum terms, that's five stars.
- beat 5 order: {name} has news and wants to tell everyone over the {dish} on {weekday}. She's practising her surprised face. — dishes sticky_toffee, creme_brulee, tiramisu
- beat 5 good: She's been promoted to practice manager. The whole table cheered. A man at the next table cheered too, for no reason.
- beat 5 photo: 🎉 Priya's promotion night
- beat 5 gossip: Congratulations to Priya, newly promoted, who celebrated at {restaurant} with a {dish}. We don't know her. We're proud anyway.

**regulars.marcus**

- Marcus Webb, Fixes laptops (favourite beef_burger, students)
- intro: Marcus came in looking at his phone, sighed at his phone, and ordered a burger. His phone is the problem, we suspect.
- beat 2 order: {name} has been dumped by text. He's coming in on {weekday} to eat the {dish} and 'process'. — dishes beef_burger, cheesy_chips, mac_and_cheese
- beat 2 good: He arrived heartbroken and left with a full stomach and a plan. The plan is 'get a new phone'. Progress.
- beat 2 bad: The night was slow and so was the food. He read old messages over the {dish}. Somebody take his phone.
- beat 2 photo: 📱 Marcus's phone, face down. A brave choice.
- beat 2 gossip: Heartbreak at table four on {weekday}. Marcus, if you're listening: the {dish} believes in you.
- beat 3 order: {name}'s ex wants to 'talk' on {weekday}. He's picked {restaurant} for the moral support. And the {dish}. — dishes margherita, spag_bol, chicken_burger
- beat 3 good: They agreed to be friends. Actual friends. She even let him have the last bit of the {dish}.
- beat 3 bad: They did not agree to be friends. She took the last of the {dish}. Marcus says that's 'exactly the problem'.
- beat 3 photo: 🤝 A handshake. Awkward, but a handshake.
- beat 3 gossip: Peace talks at {restaurant} on {weekday}. A break-up has become a friendship. The {dish} brokered the deal.
- beat 4 order: {name} has started running. He's rewarding himself with the {dish} on {weekday}, which rather undoes the running. — dishes caesar_salad, salmon_fillet, house_salad
- beat 4 good: He ran five kilometres and ate one {dish}. He says it's 'balance'. We say it's lunch.
- beat 4 photo: 👟 Muddy trainers under table four
- beat 4 gossip: Marcus from table four ran his first five kilometres this week. He celebrated with the {dish}. Balance.
- beat 5 order: {name} met someone at the Saturday run. He wants to bring her on {weekday}. The {dish}, and no phones. — dishes seafood_linguine, green_curry, steak_frites
- beat 5 good: Two phones stayed in two pockets all night. They talked about running for three hours. They're perfect for each other.
- beat 5 photo: 🏃 Marcus and Jo, both in running tops, both very pleased
- beat 5 gossip: Remember Marcus, dumped by text? He's met someone. At a run. On purpose. Good lad.

**regulars.dev**

- Dev Okafor, Ex-food blogger (favourite pork_ramen, foodies)
- intro: Dev photographed his ramen from four angles, then didn't post any of them. He used to run a food blog. He doesn't talk about it.
- beat 2 order: {name} is thinking of starting his blog again. He's 'testing' himself on the {dish} on {weekday}. — dishes pork_ramen, chicken_gyoza, green_curry
- beat 2 good: He wrote three paragraphs on the {dish} on a napkin and didn't throw it away. That's the first post.
- beat 2 bad: The food was slow and he wrote 'meh' on a napkin. He crossed it out. 'Too harsh,' he said. 'I've been there.'
- beat 2 photo: 📝 A napkin with very small handwriting
- beat 2 gossip: Food blogger Dev Okafor is back! He wrote about the {dish} at {restaurant} on a napkin. It's online now. The napkin is framed.
- beat 3 order: {name} needs a 'big' post for the relaunch. He'd like the {dish} on {weekday}, lit nicely. — dishes duck_breast, lamb_shoulder, scallops_pea
- beat 3 good: The relaunch post has a hundred readers. Ninety-nine are strangers. One is his mum, who commented 'lovely'.
- beat 3 photo: 💻 Dev's blog, open on a laptop, on table six
- beat 3 gossip: Dev's blog is back with a post about {restaurant}'s {dish}. His mum says it's lovely. She's right.
- beat 4 order: {name} has heard {blogger} might be about. He wants the {dish} on {weekday} 'to see how a professional does it'. — dishes moules_frites, seafood_linguine, salmon_fishcakes
- beat 4 good: He worked out that {blogger} never writes the word 'delicious'. He's banned it from his blog too. It's harder than it sounds.
- beat 4 bad: He tried to review the {dish} like {blogger} would and made himself sad. 'She's rude,' he said, 'but she's right.'
- beat 4 photo: 🔍 Dev taking notes on someone else's notes
- beat 4 gossip: Dev Okafor has banned the word 'delicious' from his blog. Bold. Tasty. Er, flavourful.
- beat 5 order: {name} is celebrating a thousand readers with the {dish} on {weekday}. Same table as the first time. — dishes pork_ramen, chicken_katsu, tikka_masala
- beat 5 good: A thousand readers. And this morning, a follow from {blogger}. Dev hasn't stopped smiling. It's slightly worrying.
- beat 5 photo: 🍜 Same table, same ramen, a thousand readers
- beat 5 gossip: Dev Okafor's comeback is complete: a thousand readers and a follow from {blogger}. He celebrated at {restaurant}. Of course he did.

**regulars.ellie**

- Ellie Chen, Sixth-former (favourite mac_and_cheese, students)
- intro: Ellie spread revision cards over the whole table and ordered mac & cheese 'for brain power'. The science on that is unclear.
- beat 2 order: {name} has mock exams. She wants to revise over the {dish} on {weekday}. Quiet table, please. — dishes mac_and_cheese, jacket_potato, margherita
- beat 2 good: She learned the whole of the water cycle between two forkfuls. The {dish} is now officially study food.
- beat 2 bad: It was too noisy to think. She learned one fact about glaciers and dropped cheese on it.
- beat 2 photo: 📚 Revision cards, slightly cheesy
- beat 2 gossip: Exam season on {district}: a student revised the water cycle over the {dish} at {restaurant} on {weekday}. It rained. Topical.
- beat 3 order: {name}'s friends want in. Five of them, {weekday}, the {dish}, and a promise to 'actually revise'. — dishes chunky_chips, cheesy_chips, garlic_bread
- beat 3 good: They actually revised. For eleven minutes. Then they quizzed each other on the menu. Ellie won.
- beat 3 photo: 🧠 Five people, one highlighter
- beat 3 gossip: A study group at {restaurant} on {weekday} revised for eleven whole minutes. A record for {district}.
- beat 4 order: {name} has her last exam on {weekday} morning. She'd like the {dish} the night before 'for luck'. — dishes spag_bol, kids_pasta, carbonara
- beat 4 good: She ate, went home and slept nine hours. The exam had a question on glaciers. She knew it.
- beat 4 bad: Dinner ran late and she got home after ten. She says the exam was 'fine'. Teenagers say 'fine' about everything.
- beat 4 photo: 🍀 A four-leaf clover drawn on a napkin
- beat 4 gossip: Good luck to every student on {district} with exams this week. One of them prepared with the {dish}. Science.
- beat 5 order: Results day! {name} wants the {dish} on {weekday}, whatever the envelope says. — dishes sundae, brownie, milkshake
- beat 5 good: Top grades. She opened the envelope at the table and screamed. So did the people at table three, on her behalf.
- beat 5 photo: 🎓 Ellie, an envelope and a very tall {dish}
- beat 5 gossip: Results day joy at {restaurant}: one student, top grades, one {dish} the size of her head.

**regulars.arthur**

- Arthur Pembridge, Retired train driver (favourite roast_chicken, families)
- intro: Arthur sat by the window, set his watch by the clock on the wall, and told the server it was two minutes slow. It was.
- beat 2 order: {name}'s granddaughter is 'scouting' for his ninetieth. She's coming on {weekday} to try the {dish}. — dishes roast_chicken, shepherds_pie, sausage_and_mash
- beat 2 good: She's booked the long table. 'Grandad will love it,' she said. 'He'll say he doesn't. He will.'
- beat 2 photo: 🗓️ A booking, written in very large letters
- beat 2 gossip: Big birthday coming at {restaurant}: someone on {district} is about to turn ninety. Practise your singing.
- beat 3 order: {name} insists on a 'test run' of the {dish} on {weekday}. He doesn't trust anything he hasn't tested. — dishes fish_and_chips, roast_chicken, cornish_pasty
- beat 3 good: He ate every bit, checked his watch and said, 'Adequate.' His granddaughter says that's his highest mark ever.
- beat 3 bad: The {dish} took ages. He timed it. He'll mention it. For years.
- beat 3 photo: ⌚ Arthur's pocket watch, open on the table
- beat 3 gossip: A retired train driver called the {dish} at {restaurant} 'adequate' on {weekday}. Locals say that's a rave review.
- beat 4 order: The ninetieth! Fourteen of the family on {weekday}. Arthur wants the {dish}. The cake is a secret. — dishes roast_chicken, lamb_shoulder, steak_frites
- beat 4 good: Fourteen people sang. Arthur pretended to hate it and wiped his eyes 'because of the candles'.
- beat 4 bad: The cake arrived before the mains. Arthur ate it anyway. 'At ninety,' he said, 'pudding first is allowed.'
- beat 4 photo: 🎂 Ninety candles (well, a nine and a zero)
- beat 4 gossip: Happy ninetieth, Arthur! Fourteen people sang at {restaurant} on {weekday}. Arthur says he didn't cry. Arthur cried.
- beat 5 order: {name} would like 'his' table on {weekday}, the {dish}, and for nobody to make a fuss. Make a small fuss. — dishes apple_crumble, sticky_toffee, pot_of_tea
- beat 5 good: Same table, same time, a small fuss. He's booked every {weekday} for the rest of the year.
- beat 5 photo: 🚂 A model train, left 'for the window'
- beat 5 gossip: Arthur, ninety, has a standing booking at {restaurant} every {weekday}. The table has a little brass train on it now.

**regulars.sandy**

- Sandy Okoye, Runs a food truck (favourite halloumi_fries, tourists)
- intro: Sandy parked her food truck, Wheely Good Food, outside, came in, and ordered 'whatever's your bestseller'. Checking out the competition, we reckon.
- beat 2 order: {name} wants to taste your {dish} on {weekday}. 'For research,' she says, meaning nicking ideas. — dishes halloumi_fries, sticky_chicken_bites, potato_skins
- beat 2 good: She ate it, nodded slowly, and wrote 'they're good' on her hand. Professional respect.
- beat 2 photo: 🚚 Wheely Good Food, parked a bit too close
- beat 2 gossip: The food truck parked on {district} has been 'researching' the {dish} at {restaurant}. Imitation is flattery. Or theft.
- beat 3 order: {name} is thinking of selling the truck. She'd like to think about it over the {dish} on {weekday}. — dishes fish_and_chips, beef_burger, chicken_burger
- beat 3 good: She made a list: 'sell' on one side, 'keep' on the other. 'Keep' has one word on it: 'freedom'. She's still thinking.
- beat 3 bad: A slow night at the restaurant made her miss her own slow nights. 'At least the truck has wheels,' she said.
- beat 3 photo: 📋 A list, mostly crossings-out
- beat 3 gossip: Rumour on {district}: the Wheely Good Food truck could be for sale. Sandy was seen thinking hard over a {dish}.
- beat 4 order: A buyer is meeting {name} on {weekday}. Neutral ground, she says. Your {dish} is the neutral ground. — dishes margherita, steak_frites, tikka_masala
- beat 4 good: The buyer offered a good price. Sandy shook his hand, then said she'd 'sleep on it'. She's slept on it six times.
- beat 4 bad: The buyer complained about the {dish} for ten minutes. Sandy decided she wouldn't sell him a sandwich, let alone a truck.
- beat 4 photo: 🤝 An offer, written on the back of a menu
- beat 4 gossip: Big deal over lunch at {restaurant} on {weekday}: a food truck might be changing hands. Sandy says nothing. Loudly.
- beat 5 order: {name} has decided. She'll tell you over the {dish} on {weekday}. She's grinning, which is either good or terrifying. — dishes halloumi_fries, chunky_chips, onion_rings
- beat 5 good: She's keeping the truck, and parking it outside {restaurant} on Saturdays: 'You do the sit-down, I'll do the queue.' A deal.
- beat 5 photo: 🌭 Sandy and the truck, staying put
- beat 5 gossip: Wheely Good Food is staying on {district}! Sandy will park by {restaurant} on Saturdays. The queues are going to be enormous.

**regulars.ray**

- Ray Duffy, Drives the number 42 bus (favourite full_english, families)
- intro: Ray ordered the all-day breakfast at seven in the evening. 'My day started at four,' he said. Fair.
- beat 2 order: {name} is writing a novel about a bus driver. He'd like to 'work on chapter one' over the {dish} on {weekday}. — dishes full_english, jacket_potato, sausage_and_mash
- beat 2 good: Chapter one is done. The bus driver is called Roy. Roy is definitely not Ray. Roy also loves the {dish}.
- beat 2 photo: 📖 Chapter one, page one, a gravy stain
- beat 2 gossip: A local bus driver is writing a novel at {restaurant}. The hero is a bus driver. Bold choice.
- beat 3 order: {name} is stuck on chapter seven. He wants the {dish} on {weekday} and 'no plot twists, please'. — dishes shepherds_pie, cornish_pasty, fish_and_chips
- beat 3 good: He got Roy through chapter seven by sending him down a diversion. 'Like life,' Ray said. Deep.
- beat 3 bad: The night was chaos and Ray wrote it all down. Chapter seven is now about a restaurant. Uh oh.
- beat 3 photo: 🚌 A bus ticket used as a bookmark
- beat 3 gossip: Chapter seven of the bus novel was written at {restaurant} on {weekday}. Ray says it has 'a twist'. It's a diversion.
- beat 4 order: {name} is reading chapter one to his book club on {weekday}. They're coming for the {dish}. He's terrified. — dishes roast_chicken, spag_bol, apple_crumble
- beat 4 good: The book club laughed in all the right places and none of the wrong ones. Ray had to go outside for a minute.
- beat 4 photo: 👏 Ray, reading, holding the page very tight
- beat 4 gossip: The {district} book club heard the first chapter of a bus driver's novel at {restaurant}. Reviews: 'fun', 'loud', 'more Roy'.
- beat 5 order: A publisher wrote back to {name}! He's celebrating with the {dish} on {weekday}. His treat. Very much his treat. — dishes steak_frites, full_english, sticky_toffee
- beat 5 good: They want the book. Roy goes to print next spring. There's a scene set in a restaurant that looks a lot like this one.
- beat 5 photo: 📚 A signed copy, 'for the kitchen'
- beat 5 gossip: Ray from the number 42 is getting his novel published. There's a restaurant in it. Somebody check it's a nice one.

**regulars.bola**

- Bola Adeyemi, Nurse on nights (favourite tikka_masala, business)
- intro: Bola came in still in scrubs, ate a curry in eleven minutes flat and thanked everyone like they'd saved her life. It's usually the other way round.
- beat 2 order: {name} has a promotion interview on {weekday}. She'd like the {dish} and five quiet minutes beforehand. — dishes tikka_masala, green_curry, tomato_soup
- beat 2 good: She ate, read her notes once and walked out like she owned the hospital. Fingers crossed.
- beat 2 bad: It was too busy for five quiet minutes. She went in flustered. 'I've done harder things on less sleep,' she said.
- beat 2 photo: 🩺 Interview notes, folded into a tiny square
- beat 2 gossip: Good luck to a nurse from {district} with a big interview this week. She prepared over the {dish} at {restaurant}.
- beat 3 order: {name} got the job. She's bringing her whole night shift in on {weekday}. Eight people. They want the {dish}. — dishes chicken_katsu, beef_burger, margherita
- beat 3 good: Eight nurses, one table, a lot of laughing about things we didn't understand. They left a card for the kitchen.
- beat 3 photo: 💐 A thank-you card signed by a whole ward
- beat 3 gossip: A whole night shift of nurses had dinner at {restaurant} on {weekday}. They left a thank-you card. We're not crying, you're crying.
- beat 4 order: {name} has a rare weekend off and wants to do 'absolutely nothing' with the {dish} on {weekday}. — dishes mushroom_risotto, seafood_linguine, caesar_salad
- beat 4 good: She did absolutely nothing for two hours. She says it's the best two hours of her year.
- beat 4 photo: ☕ Bola, feet up (on the chair opposite, sorry)
- beat 4 gossip: A nurse from {district} sat at {restaurant} for two hours on {weekday} doing absolutely nothing. She's earned it.
- beat 5 order: {name}'s mum is visiting from Lagos. {weekday}, the {dish}, and please be nice: she cooks better than anyone. — dishes lamb_shoulder, roast_chicken, steak_frites
- beat 5 good: Bola's mum tasted the {dish}, thought for a long time and said, 'Not bad.' Bola says that's practically a medal.
- beat 5 photo: 👩‍🍳 Bola's mum, inspecting the kitchen
- beat 5 gossip: A visiting mum said 'not bad' about the {dish} at {restaurant}. Chefs on {district} are framing the quote.

**regulars.margaret**

- Margaret Doyle, Retired teacher (favourite tomato_soup, foodies)
- intro: Margaret did the crossword in ink, in nine minutes, and corrected the spelling on the specials board. Politely. Correctly.
- beat 2 order: {name} has entered the county crossword championship. She trains over the {dish} on {weekday}. — dishes tomato_soup, ploughmans, cheese_board
- beat 2 good: Two crosswords in the time it took to eat the {dish}. She's 'cautiously confident'. That means terrifyingly good.
- beat 2 photo: ✏️ A finished crossword, in pen, no crossings-out
- beat 2 gossip: A retired teacher finished two crosswords at {restaurant} on {weekday}. In pen. Without asking anyone. Legend.
- beat 3 order: {name} is through to the regional final. She'd like the {dish} on {weekday} and, quietly, a clue for nine across. — dishes salmon_fishcakes, prawn_cocktail, asparagus_hollandaise
- beat 3 good: Nine across was 'restaurant'. She got it from looking round. She says it's the easiest clue she's ever been given.
- beat 3 bad: A noisy night put her off. She says she 'never loses her concentration'. She lost it on four down.
- beat 3 photo: 🏆 A regional finalist's badge, pinned to a cardigan
- beat 3 gossip: {restaurant} has its own crossword champion. Well, finalist. Well, she eats here. Still counts.
- beat 4 order: {name}'s old pupils have tracked her down. Six of them, {weekday}, the {dish}. She's pretending not to be thrilled. — dishes fish_and_chips, shepherds_pie, mac_and_cheese
- beat 4 good: One of them is a doctor now, one's a pilot, and one is 'in crisps'. She remembered all their spellings.
- beat 4 bad: Dinner was slow and she made them do a spelling test while they waited. They loved it, which is the worrying part.
- beat 4 photo: 🍎 An apple for the teacher, left on table two
- beat 4 gossip: Six former pupils took their old teacher out to {restaurant} on {weekday}. She marked the menu. A-minus.
- beat 5 order: The final is on {weekday}. {name} wants the {dish} afterwards, win or lose. (Win.) — dishes sticky_toffee, eton_mess, creme_brulee
- beat 5 good: County crossword champion. She'd like everyone to know she didn't use a pencil once.
- beat 5 photo: 🥇 Champion. In ink.
- beat 5 gossip: Margaret Doyle is county crossword champion and she celebrated at {restaurant}. Clue: rhymes with 'legend'. It's 'legend'.

**regulars.kai**

- Kai Thompson, Drummer in Hollow Spoons (favourite bacon_mushroom_pizza, students)
- intro: Kai tapped a rhythm on the table with two breadsticks for an hour. His band is called Hollow Spoons. Of course it is.
- beat 2 order: Hollow Spoons have their first gig on {weekday}. {name} wants the {dish} for the whole band beforehand. — dishes bacon_mushroom_pizza, margherita, chunky_chips
- beat 2 good: They ate, they played, twelve people came. Eleven were family. One was the bin lorry driver. He danced.
- beat 2 bad: Dinner ran late and they went on stage still chewing. The singer says it 'added texture'.
- beat 2 photo: 🥁 Two breadsticks, retired from drumming
- beat 2 gossip: Local band Hollow Spoons played their first gig on {weekday}. The bin lorry driver was seen dancing. Of course he was.
- beat 3 order: {name} wants to record a demo in the back room on {weekday}. Just kidding. He wants the {dish} and to talk about it a lot. — dishes halloumi_burger, beef_burger, potato_skins
- beat 3 good: They talked about the demo for three hours. They have a name for it: 'Pass the Salt'. No songs yet.
- beat 3 photo: 🎧 A set list on the back of a receipt
- beat 3 gossip: Hollow Spoons' first demo will be called 'Pass the Salt'. It was planned at {restaurant}. It doesn't exist yet.
- beat 4 order: Battle of the bands on {weekday}! {name} needs the {dish} 'for stamina'. The singer needs 'something soft for the voice'. — dishes spag_bol, carbonara, tomato_soup
- beat 4 good: Second place! The winners were a brass band of nine-year-olds. 'Fair,' said Kai. 'They were tight.'
- beat 4 bad: They came last. The judges said 'loud'. Kai says loud is the point.
- beat 4 photo: 🎸 A runner-up rosette taped to a guitar
- beat 4 gossip: Hollow Spoons came second at the battle of the bands, behind a brass band of nine-year-olds. Respect the brass.
- beat 5 order: Hollow Spoons are supporting a real band on {weekday}. {name} wants the {dish} and to stop shaking. — dishes pork_ramen, chicken_katsu, beef_burger
- beat 5 good: They played the big hall. They've written a song about {restaurant}. It's mostly about the {dish}. It slaps, apparently.
- beat 5 photo: 🎤 A gig poster: Hollow Spoons (small letters, still counts)
- beat 5 gossip: Hollow Spoons have written a song about {restaurant}. Kai says it 'slaps'. We've been told that's good.

**regulars.lines**

- open: Open order
- waiting: Waiting for a {weekday} with the {dish} on and a good night (3.5★ or better).
- notOnMenu: The {dish} isn't on your menu.
- onMenu: The {dish} is on your menu.
- tryAgain: They came on {weekday} but it wasn't a good night. They'll try again next {weekday}.
- finished: Story complete. They're one of the family now.
- newRegular: {name} is a regular now.

**criticText.blogger**

- name: Ruth Lessley
- blog: Plate Expectations
- tagline: Food blogger. Rude but fair. Mostly fair.
- headline 1★: {restaurant}: I've had better meals on a ferry
- headline 1★: Dear {restaurant}: we need to talk
- headline 1★: The {dish} that broke me
- headline 2★: {restaurant}: nice people, wobbly plates
- headline 2★: Nearly, {restaurant}. Nearly.
- headline 2★: The {dish} needs a word with itself
- headline 3★: {restaurant}: perfectly fine, and I mean that nicely
- headline 3★: Solid, honest, no fireworks: {restaurant}
- headline 3★: Would I go back to {restaurant}? Probably. On a Tuesday.
- headline 4★: {restaurant} is getting good, and it knows it
- headline 4★: I came to be rude about {restaurant}. I failed.
- headline 4★: Go for the {dish}, stay for the {dish} again
- headline 5★: {restaurant}: I have nothing rude to say and I'm furious about it
- headline 5★: Five stars. Don't tell anyone. (Tell everyone.)
- headline 5★: The {dish} at {restaurant} made me put my phone down
- review 1★: The {dish} arrived late, lukewarm and slightly apologetic. So did the bill. I'll come back when they've had a word with the kitchen. Rude but fair: one star.
- review 1★: I spent most of the evening watching the queue. The queue spent most of the evening watching me. The {dish} did not join us. One star, and it's for effort.
- review 2★: The staff are lovely and clearly trying. The {dish} is trying too, just not hard enough. Fix the timing and this place jumps a star. Two.
- review 2★: Some of it was good. Some of it was the {dish}. I'll be back, because I think they'll sort it, and because I'm nosy. Two stars.
- review 3★: Nothing went wrong, which is rarer than you'd think. Nothing blew my socks off either. My socks remain, firmly, on. The {dish} is the one to get. Three stars.
- review 3★: A dependable night. The {dish} was honest cooking: seasoned properly, served hot, no nonsense. I wanted one surprise. Three stars.
- review 4★: I arrived ready to be grumpy and left full and slightly annoyed I liked it so much. The {dish} is the real deal. Four stars.
- review 4★: Quick service, a warm room and a {dish} I'd cross town for. One more brave idea on the menu and it's five. Four stars, grudgingly.
- review 5★: I have reviewed four hundred restaurants and I usually find something to moan about. I looked very hard. Nothing. The {dish} is ridiculous. Five stars.
- review 5★: Everything on time, everything hot, everyone smiling, including me, which my readers will find alarming. Five stars for {restaurant}.
- spotted: Food blogger Ruth Lessley was seen near {restaurant} with a notebook. Somebody tell the kitchen. Calmly.
- spotted: Ruth Lessley of Plate Expectations is 'in the area'. She is never just 'in the area'.
- spotted: Rumour: Ruth Lessley has a table booked somewhere on this street tonight. She never says where. Wipe the menus.
- closed: Ruth Lessley turned up at {restaurant} for her review and found the doors locked. She has written two hundred words about the door. Three stars for the door.
- closed: Ruth Lessley came to review {restaurant} but it was shut. 'I'll be back,' she wrote. It sounded like a threat. It probably was.
- signoff: Rude but fair. — R.L.
- signoff: Until next time, eat better. — R.L.
- signoff: See you in three weeks. Behave. — R.L.

