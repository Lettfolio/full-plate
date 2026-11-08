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
