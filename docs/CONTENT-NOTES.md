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
- **Words**: `description` is one child-friendly sentence ("Put a coin in and pick a song!"); `nightLine` finishes
  "Your new {name}: …" on its first night ("the jukebox got everyone singing").

## Round 10 — B: `staffQuotes.json` (ContentPack.staffText)
- `quotes`: one-line "why me" lines a candidate says on the hiring sheet, keyed by `staffArchetypes` id (a role id also works as a fallback). Five per archetype, ≤ 70 characters, friendly, readable by a 10-year-old. Picked deterministically per person (`quoteFor`).
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
