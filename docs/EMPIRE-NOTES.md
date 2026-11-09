# EMPIRE-NOTES — `@full-plate/sim-empire` (Path A, the Empire)

The multi-site, franchising, real-estate and expansion layer. Pure TypeScript and deterministic. Money is in integer pence. The package is serialisable. It depends only on sim-core: it imports sim-core's types, calendar helpers and `rng.ts`, and takes the content pack as an argument.

```
pnpm --filter @full-plate/sim-empire typecheck   # src + demo
pnpm --filter @full-plate/sim-empire test        # 58 tests, ~25s (includes model-vs-focused 90-day runs + 5,000-site perf)
pnpm --filter @full-plate/sim-empire build       # tsc + static demo → packages/sim-empire/dist
pnpm --filter @full-plate/sim-empire demo        # http://localhost:5301  (?style=franchise|company|innout&years=10&seed=2)
pnpm --filter @full-plate/sim-empire headless [--years 10] [--seeds 5] [--style all|franchise|company|innout] [--perf]
```

Files:
- `src/types.ts`: the contract.
- `src/constants.ts`: every tunable value, each anchored to the brief.
- `src/model.ts`: the closed-form site model and `calibrate`. Its demand and capacity come from sim-core's `src/capacity.ts` (round 3).
- `src/engine.ts`: `newEmpire`, `forkFromGameState`, `stepEmpireDay`, `applyEmpireCommand`, `forceEvent`, `newGameFromSite`, `recalibrateFromSite`.
- `src/world.ts`: 12 invented cities, 5 regions and 4 suppliers.
- `src/strategies.ts`: the scripted styles. They are browser-safe.
- `src/headless.ts`: the CLI.
- `src/save.ts`: versioned `serialize`/`deserialize`.
- `demo/`: the map demo.

## 1. How the game mounts it

### When the fork happens
The fork is the story beat at the end of year 2 (BRIEF "The fork"). A franchise consultant calls. The game confirms the Empire path when the player commits, for example by accepting the offer or opening a second identical unit. At that point the game calls:

```ts
import { forkFromGameState } from "@full-plate/sim-empire";
const empire = forkFromGameState(content, gameState, {
  brandName,             // the player names the brand (default: restaurant name + "Burgers"/"Kitchen")
  investment: 50_000_000,// the consultant's investors (default £500k); HQ starting cash
  transfer: 0,           // optional: cash moved from the till; the game deducts the same from gameState.cash
  calibrationDays: 90,   // the model is fitted on the last 90 trading days
});
```

`forkFromGameState`:
- Calibrates the aggregate model on `gameState.history` and the GameState itself (`calibrate`, see §3). It needs at least 14 trading days.
- Creates HQ with `hq.day = gameState.day`, so seasons and weekdays line up with sim-core.
- Creates **site `s1` = the player's restaurant**: company-owned, in the home city Harbourton, `districtId = gameState.districtId`, `focused: true`. It keeps its own room: `tables` (if the player bought any), `staffQuality` (the crew's shift-weighted skill), `popularity` and `prestige`.
- Seeds the brand formula from the restaurant's active menu. It starts unlocked at standardisation 30.

### Which sim-core state is the focused site
The game owns a `GameState` for the focused site and keeps running it exactly as it does today: planning, service, evening. `empire.focusedSiteId` names the site it represents. The empire never touches the GameState.

**Money boundary.** The focused company site's profit stays in `GameState.cash` and never reaches HQ automatically. The game moves money with `TRANSFER_FROM_FOCUSED { amount }` and subtracts the same amount from `gameState.cash`. A sweep button on the evening screen is enough. Franchise and licence sites pay HQ through royalties and rent automatically.

### Daily wiring
```ts
// evening, after sim-core's SERVICE_ENDED for day d:
const { empire: next, events } = stepEmpireDay(content, empire, dayResult);   // dayResult = gameState.history.at(-1)
// next.hq.day === d + 1. The focused site's covers/revenue/meals come from dayResult; every other site from the model.
```
- Call it once per sim-core day, in the evening, with that day's `DayResult`. Without a `DayResult` (map-only fast-forward), the focused site falls back to the model.
- **Off-premise on top (round 3).** sim-core runs the dining room. The takeaway counter (standardisation), drive-thru and app are not simulated there, so `stepEmpireDay` multiplies the focused DayResult's covers, sales, VAT, food and labour by the same `offPremise(site, brand)` the model uses. The Sites panel shows the split ("~140 covers today: 100 in the dining room + 40 takeaway").
- **Brand pull.** A focused GameState carries a footfall mod tagged `BRAND_PULL_SOURCE` ("brand") equal to `siteBrandPull(content, empire, siteId)`: recognition, consistency, city size, champions, saturation, effects. The game refreshes it every evening (`pathEngine.refreshBrandPull`), so a famous brand fills the hands-on room the way it fills the model's.
- When the player is on the map with nothing focused, fast-forward with `stepEmpireDays(content, empire, n)`. It costs about 13 ms/day at 5,000 sites.
- `events` (`EmpireEvent[]`, each with `tone` and an optional `siteId`/`cityId`/`regionId`) feed the morning mail and the map ticker. `empire.events` keeps the last 200.

### Switching focus (promote / demote)
1. **Demote** the current site: `FOCUS_SITE {}`. The game may keep its GameState as a save, or drop it.
2. **Recalibrate (optional but recommended):** `recalibrateFromSite(content, empire, oldSiteId, gameState.history, gameState)` refits the model on everything the player just played. With the GameState it sees that room's tables, rota, popularity and brand pull, so `demandScale` stays a property of the sim; costs are normalised back to the reference (cost index, price level), and the site keeps its own `tables`/`staffQuality`/`popularity`/`prestige`.
3. **Promote** a site: `FOCUS_SITE { siteId }`, then `newGameFromSite(content, empire, site, rng, { difficulty })` (round 3; it used to copy the flagship's staff). It builds exactly what the model assumes for that site:
   - the site's district and name, `day = hq.day`, no loan, £20k in the till, no goals;
   - the brand menu at `round(suggestedPrice × priceIndex)` (`brandMenu`);
   - the brand's box: `startingTables × throughput(standardisation)`, capped at `maxTables` (`boxTables`), or the site's own `tables`;
   - a **local crew**: two chefs and two servers on rotas A (Wed–Sun) and B (Mon, Tue, Fri–Sun), skill ≈ `staffQuality` ± 4, speed ≈ 60, wages from the content archetypes (`crewWage`);
   - popularity and prestige from `sitePopularity`/`sitePrestige` (the site's own if it was run before);
   - a stocked larder (1.5 services of the forecast) and the brand pull footfall mod.
   The game seeds the rng from `game.seed ^ hash(site.name)`, so promotion is deterministic.

### Commands the UI needs (`applyEmpireCommand`)
Invalid commands return the empire unchanged plus one `{kind:"rejected", text}` event. The text is player-facing, so show it as a toast. `associationBlocks(empire, cmd)` tells the UI in advance which buttons the franchisee association has disabled.

| Command | Where in the UI | Notes |
|---|---|---|
| `OPEN_SITE {cityId, districtId, ownership, land, applicantId?/franchiseeId?}` | City panel "Open a site" wizard | ownership: `company`, `franchise` or `licence`. land: `thirdParty`, `hqLease` (sublet with markup) or `hqOwned` (buy the plot now). The site opens after 90 days of building. |
| `SELL_FRANCHISE {siteId, applicantId/franchiseeId}` | Site panel | Refranchising. HQ gets the fee plus book value. |
| `BUY_BACK {siteId}` | Site panel | Costs 2.5× the operator's annual profit plus their loan. |
| `SET_CONTRACT {contract, applyTo: "new"/"all"}` | Contract builder | Sliders: fee £0–150k, royalty 0–12%, ad fund 0–8%, rent 5–16%, term, remodel cycle. `"all"` shocks mood by 5 per point of royalty rise. |
| `BUY_PROPERTY {siteId}` | Site panel, "Landlord" tab | 40% deposit, 25-year mortgage at 6%. |
| `SET_FORMULA {menuDishIds?, locked?, fresh?, priceIndex?}` | Brand screen | Locking is the first tech node. A menu change on a locked formula costs consistency. |
| `RESEARCH {tech}` | Brand screen tech tree | academy (£250k, 90d) → drive-thru (£400k, 120d) → app (£600k, 180d). One at a time. |
| `SIGN_SUPPLIER {supplierId, exclusive}` | Suppliers screen | Exclusive gives the full discount and the full outage hit. |
| `LAUNCH_CAMPAIGN {kind: brand/discount, budget, regionId?}` | Marketing | A brand campaign feeds recognition. A discount lifts demand 12%, cuts spend 10% and costs mood. |
| `ENTER_CITY {cityId}` / `LOCALISE_MENU {cityId}` | Map → city | The first city in a country costs £400k extra. Localising has a 15% chance of an invented tradition. |
| `LAUNCH_PRODUCT {name, budget, fit}` | Marketing | fit: `core` 55%, `stretch` 25%, `franchiseeIdea` 70% (when `pendingIdea` is set). |
| `CLOSE_SITE`, `REMODEL`, `BUILD_COMMISSARY`, `SET_INSPECTIONS` | Site / region panels | |
| `TRANSFER_FROM_FOCUSED {amount}`, `FOCUS_SITE {siteId?}` | Evening screen / map | Game-side glue. |

`forceEvent(content, empire, {kind: "scandal"|"supplier_failure"|"forced_exit", ...})` fires a risk event on demand for story beats and tutorials.

### What the map screen shows
The demo (`demo/main.tsx`) is the proof. The real screen should show:
- **World map:** stylised SVG nodes, not streets. The regions are landmasses whose saturation follows recognition. A region with an active scandal gets a red outline. Each city pin is a pie of company, franchise and licence sites sized by √count, with a dot while sites are building. Cities not yet entered are hollow; cities the brand was forced out of are dashed.
- **Header stats:** sites open (company/franchise), meals served (out of 1bn), HQ cash, HQ net per month, franchisee mood, plots owned.
- **Region bars:** recognition 0–100, green at 60 or above. The win needs every region green and profitable.
- **City panel:** population, cost index, sites, average takings per year against the £400k collapse line, saturation %, dietary rules, local champion, and open-site buttons with their build cost.
- **Site panel** (not in the demo): `revenueYear`, `margin7d`, consistency, staff quality, ownership/land, contract terms, operator mood and cash, failing days, last inspected, remodel due. Buttons: focus, remodel, buy plot, sell or buy back, close.
- **Brand panel:** standardisation, the tech tree, suppliers (`*` marks exclusive), product idea waiting.
- **Contract panel:** sliders with live "total take %" and "applicant attractiveness" (`contractAttractiveness`), and rent income per month.
- **Alerts:** a franchisee association banner (what it blocks), a win banner, and a bankruptcy warning when `hq.cash < 0`. The overdraft limit is `spendable(empire)`.
- **Charts:** monthly snapshots from `empire.history` (sites, HQ cash, HQ income, system sales, mood, recognition).

## 2. State shape

`EmpireState` (see `src/types.ts`) follows the ROUND3 sketch, with these refinements:
- **Sites:** `SiteSummary` adds `status` (building/open/closed), `land` (`thirdParty`/`hqLease`/`hqOwned`), a frozen per-site `contract`, `revenueYear`, `operatorLoan`, `unreported` (skimming), `failingDays`, `mealsServed` and `driveThru`. `covers7d`, `revenue7d` and `margin7d` are exponential 7-day sums.
- **People and places:** adds `applicants`, `Region` (with `commissary`), and `City.x/y`, `localised`, `tradition`, `exited`, `championStrength`.
- **Brand:** adds `brand.research`, `brand.permanentDemand` (product hits) and `formula.fresh` / `formula.priceIndex`.
- **Effects:** `effects[]` holds scandal, campaign, discount, product and supplier-outage windows.
- **Bookkeeping:** adds `association`, `inspectionEveryDays`, `pendingIdea`, `history` (monthly snapshots), `win` and `status`.
- **Calibration:** `CalibrationParams` is stored in the state, so saves keep the fitted model.

## 3. The model

### Closed-form site day (`aggregateSiteDay`) — round 3
A modelled site is the same dining room the focused sim runs, in closed form. Demand and capacity are sim-core's own formulas (`sim-core/src/capacity.ts`), so a modelled site and the GameState `newGameFromSite` builds for it agree on district, menu, prices, tables and crew.
```
demand   = demandScale × marketDemand(district, brand menu, popularity, prestige, day) × pull
           marketDemand = footfall × season × (0.5 + pop/100) × weekend × Σ segment share × sigmoid(entryLogit) × E[party]
           (sim-core's arrival system in expectation; price response comes from the entry logit on the real menu prices)
pull     = (population/2.5m)^0.25 × recognition × consistency × champion × stale × (1 − saturation) × permanentDemand
           × effects × [fresh 1.08] × [breaks dietary rules 0.55] × [tradition 1.1] × Π site footfallMods
capacity = softmin(seats, crew) × (0.44 / peakShare)^0.3                 softmin = (a^−3 + b^−3)^(−1/3)
           seats = tables × 7.7 turns × mean party;  tables = startingTables × throughput(std), ≤ maxTables (or the site's own)
           crew  = 136 covers × chef+server pairs on shift (1 Mon–Thu, 2 Fri–Sun) × (1 + 0.5 (staffQuality − 50)/100)
covers   = softCap(demand, capacity) × offPremise × noise       softCap(d, c) = d / √(1 + (d/c)²)
offPremise = (1 + 0.02 × (std − 30)) × [drive-thru 1.3] × [app 1.1]    takeaway counter, lane and app: on top of the seats
revenue  = covers × spendScale × basket(district, brand menu) × costIndex × priceLevel × [app 1.05] × effects.spend
food     = covers × foodScale × plateCost(district, brand menu) × costIndex^0.6 × priceLevel × [fresh 1.12] × Π(1 − supplier discount)
labour   = standard crew (2 chefs + 2 servers × 5 shifts, wages at staffQuality) × costIndex × priceLevel × offPremise × speedee
overhead = overheadsFixed × costIndex × priceLevel × (covers/coversMean)^0.85 + cardFee × revenue
VAT      = vatPct × revenue;     contribution = revenue − VAT − food − labour − overhead
```
- **Popularity and prestige** of a modelled site follow its crew (fitted on `newGameFromSite` runs): popularity ≈ 79 + 0.6 (q − 50), prestige ≈ 45 + 3 (q − 50), clamped. A site that has been run hands-on keeps its own.
- **Standardisation** (Speedee) no longer multiplies demand. It buys tables in the box (+1 at a locked formula, 10 at the full tree) and the takeaway counter (+40% / +100% of the dining room).
- **Recognition** is now part of `pull`: it fills the room (and the queue) rather than adding covers without limit. A full room barely grows when demand does; a quiet one tracks it.
- The capacity constants were fitted to the sim (4-person crew, 6–10 tables, all four districts, saturated demand; RMS 3%). `sim-core/test/capacity.test.ts` replays the sim to keep them honest.

### Calibration (`calibrate(content, history, {districtId, state, lastDays})`)
- Days with zero covers or `closed` are skipped, and so are **days the owner covered a role** (`ownerCovered`; P2, round 3), when at least 14 fully staffed days remain. Modelled sites have their own crew; the owner's slow Mondays no longer leak into every site.
- For each remaining day: `marketDemand` with the restaurant's menu, popularity, prestige and difficulty, and `capacityCovers` with its tables and the crew rostered that weekday (from the GameState; without one the standard box and crew).
- **`demandScale`** is solved (bisection) so that Σ softCap(scale × demand, capacity) = Σ actual covers, then shrunk halfway to 1 (`DEMAND_SCALE_KEEP`): one restaurant's quarter can't separate a model-wide error from its own quirks (a chef of 100, prestige 100), and the closed form is already fitted to the sim.
- **`spendScale` / `foodScale`:** actual sales (food + waste) ÷ the order model's expected basket (ingredient cost) for those covers. Other districts get their own basket on the brand menu.
- **Overheads:** OLS of daily overheads on revenue gives `cardFeePct` and `overheadsFixed`. **`noiseSd`:** RMS of log(actual ÷ fitted).
- `baseCovers`, `weekdayProfile` and `weekendMult` are now informational (the reference site's fitted covers and weekly shape). Pre-round-3 saves have no `demandScale`/`spendScale`: they read as 1 and fall back to the flat `spendPerCover × priceIndex`.

**Accuracy** (round 3). Diagnosis with the headless (seed 2026, High Street flagship on the fast-food menu, balanced owner, fork at day 365, then 90 days): a modelled site against the same site built with `newGameFromSite` and played by a steady operator.

| Site (90 days) | Before: model | Focused | After: model dining room | Focused | Error covers / revenue |
|---|---|---|---|---|---|
| Campus (Student Quarter), locked, recognition 33, crew 40 | 193 | 84 | 88 | 82 | +7.6% / −0.2% |
| Business Park, reference state, crew 50 | 100 | 77 | 74 | 73 | +1.6% / +1.8% |
| Seaside, academy (std 70), crew 65 | 187* | 101* | 106 | 107 | −1.3% / −4.5% |
| The flagship itself, demoted | 100 | 91 | 92 | 91 | ≤ 10% (test) |

\* before = the locked + recognition 33 case in that district; the old model had no academy crew to compare. Before the fix, the model's footfall ratio (112 vs 74 = ×1.51), Speedee throughput (×1.24) and recognition (×1.16) multiplied demand with no seat limit, while sim-core's 6-table room saturates near 110 covers and its entry logit turns little extra footfall into covers: **1.4–2.3×** for the same site. `test/calibration.test.ts` asserts ±15% (covers, revenue and labour) on three cases and ±10% for the demoted flagship.

### Money flows (per open site per day)
- **Company site:** HQ gets `contribution − market rent (unless HQ owns the plot) − 4% ad fund`. The focused company site sends nothing until it transfers.
- **Franchise or licence:** reported sales = net sales × (1 − skim), where skim = max(0, (60 − honesty)/100) × 15%.
  - **Royalty and ad fund:** HQ gets `royalty% × reported` and `adFund% × reported`. The ad fund feeds regional recognition.
  - **On HQ land** (`hqLease` or `hqOwned`): the operator pays `max(rent% × reported, market rent × 1.4)` to HQ (Sonneborn's rule). On `hqLease`, HQ pays the market rent to the landlord. On `hqOwned`, HQ pays the mortgage instead. The mortgage is fixed while rent grows with sales and inflation, which is the end-game engine.
  - **Operator:** net = contribution − royalty − ad fund − rent − bank-loan instalment. The operator put 30% of the build down in equity, and the bank lends the rest over 10 years at 7%.
- **HQ costs:** overhead of £60/day plus £30/day per site, mortgages, inspections (£800 each), and overdraft interest at 8% APR below zero. HQ is bankrupt below −£2m × priceLevel. Capital spending may draw on a development facility of £150k per open site, capped at half the credit line (`developmentFacility`, `spendable`; round 3 review — the full £1m used to be available with one site).
- **Inflation:** 2.5% a year on prices, wages, rents and costs. Mortgages and loans are nominal.

### Other mechanics (each has a test in `test/mechanics.test.ts`)
- **Ownership slider:**
  - **Company:** HQ pays the £220k × costIndex build, gets control and gets all the profit.
  - **Franchise:** the operator pays £35k fee + 30% equity, and HQ gets royalty, ad fund and rent.
  - **Licence:** HQ pays £25k setup, gets a 10% royalty, carries no land, and consistency runs 20 points lower.
  - **Refranchise / buy back:** move a site between the two.
- **Contract builder:** applicants arrive at about 2.5/month × attractiveness × (0.4 + recognition/50), halved during an association. Attractiveness = 1 − 8 × (take − 19%) − 0.3 × (fee − £35k)/£35k.
- **Franchisee mood:** drifts 3%/day toward 55 + 200 × (operator margin − 8%) − penalties for royalty above 5%, ad fund above 4% and rent above 10%.
  - **Shocks:** −5 per point of royalty rise on everyone, −12 for a forced remodel, −4 for a scheduled one, −8 per discount campaign, −8 per scandal, −10 when caught skimming, −3 when a peer goes bust.
  - **Multi-unit growth:** operators with mood ≥ 55 can take another site at most every 180 days.
- **Association:** forms when at least 5 active franchisees average mood < 35 and stands down at ≥ 50. While active, it blocks fee rises on existing agreements, forced remodels on franchise sites, discount campaigns and encroachment (opening where a franchisee already trades). It halves applicants. The win needs no association.
- **Landlord mode:** the purchase price is the annual market rent ÷ 7% yield. The test checks that owning beats leasing over 6 years.
- **Tech tree:** standardisation = 30 + 20 for a locked formula + 20 academy + 5 drive-thru + 5 app − 3 per menu item over 8. Consistency drifts toward std + 20 (company), std + 10 + (competence − 50) × 0.2 (franchise) or std (licence). The academy adds 15 to staff quality, and drive-thru reaches sites at their next remodel.
- **Suppliers:** discounts are 3–6% each, capped at 18% total, and non-exclusive deals give half. An outage lasts 30–60 days and pulls items: −15% demand if exclusive, −5% if not. 40% of exclusive outages (20% of non-exclusive) become a scandal.
- **Saturation:** with city capacity cap = population / 60k, total demand = cap × (1 − e^(−n/cap)), split evenly. A same-district neighbour counts 2.5×. The penalty is capped at 85%.
- **Subway collapse:** a site older than 180 days with annualised takings below £400k × priceLevel starts counting failing days. After 270 days the franchisee hands back the keys. HQ takes the site over if it is still near the line and HQ has cash; otherwise it closes, and HQ eats the lease exit on HQ-held leases.
- **Country entry:** a city costs £120k plus £400k for a new country, × max(0.6, costIndex).
  - **Dietary rules:** no-beef, no-pork, halal (pork + alcohol) and kosher (pork, shellfish, meat with dairy) are checked against the dish ingredients. A menu that breaks them keeps 55% of demand until `LOCALISE_MENU` (£150k, −5 consistency in that city).
  - **Local champions:** they take up to 35% × strength.
  - **Forced exit:** 1.5% per foreign country per year. All sites in the country are sold at 50% and the country is closed.
- **Product gamble:** the success chance is the base plus up to +15% for budget.
  - **Hit:** +10% demand for a year and a lasting +3% (capped at +15% total).
  - **Flop:** −3% demand for 6 months and −3 recognition everywhere.
  - **Franchisee ideas:** they appear at 1 − e^(−0.03 × franchisees) per year (Filet-O-Fish).
- **Scandals:** base rate 12%/yr, scaled by low consistency and empire size. Each one:
  - cuts demand 15–25% in the region, recovering linearly over 4–12 quarters (slower when consistency is low);
  - spills 40% of that depth into other regions;
  - costs £250k in legal fees, −8 recognition and −8 mood.
- **Recognition:** drifts 1/90 per day toward 100 × (1 − e^(−vis/6)), where vis = sites per million people in the region + ad spend over 30 days / £50k + 0.55 in the home region.
- **Win:** a billion meals served, **or** every region at recognition ≥ 60 with at least one site making money. Either way, HQ must be solvent and the association must not be active. `win.achievedDay` and `win.reason` are recorded.

## 4. Headless results

`pnpm --filter @full-plate/sim-empire headless --years 10 --seeds 5`. The run starts from one company flagship, £500k at HQ and the default contract. The styles make weekly decisions:
- **franchise:** lock the formula, research the tech tree, sell to every applicant with cash, lease then buy the land, and enter cities on the entry cost alone.
- **company:** company sites only, built on the development facility, with plots bought from profit. It saves for the next city once home fills.
- **innout:** fresh formula and a commissary per region, at most one site a month, and it pauses every 15 sites per commissary to save for the next region.

Round 3 (honest dining room + takeaway counter; the round-2 table is in git history):
```
style      seed  sites (co/fr)  closed  meals      HQ cash   HQ net/yr  avg site/yr  mood  regions  plots  scandals  win
franchise     1   682 (1/681)      36  521.7m    £572.8m     £137.4m        £2.0m    59      4/5    682         3   yes
franchise     2   627 (1/626)      91  485.2m    £394.5m     £111.5m        £2.0m    63      4/5    627         3   yes
franchise     3   561 (1/560)     157  490.6m    £442.2m     £104.1m        £1.8m    58      5/5    561         1   yes
franchise     4   718 (1/717)       0  548.0m    £636.3m     £148.6m        £2.0m    61      5/5    718         2   yes
franchise     5   718 (1/717)       0  544.9m    £627.2m     £151.5m        £2.1m    62      5/5    718         0   yes
company       1   503 (503/0)       0  113.6m    £138.9m     £189.7m        £1.8m     —      5/5    112         0   yes
company       2   497 (497/0)       0  111.3m    £132.3m     £186.5m        £1.8m     —      5/5    110         0   yes
company       3   305 (305/0)       0   51.5m     £23.5m     £114.3m        £1.7m     —      3/5     47         1    no
company       4   370 (370/0)      98   89.5m     £91.1m     £168.1m        £2.0m     —      5/5     66         1   yes
company       5   497 (497/0)       0  109.5m    £118.8m     £177.6m        £1.8m     —      5/5    106         2   yes
innout        1    56 (56/0)       0   18.6m     £17.0m      £22.8m        £2.0m     —      1/5     56         0    no
innout        2    56 (56/0)       0   18.4m     £16.7m      £23.0m        £2.0m     —      1/5     56         0    no
innout        3    37 (37/0)       0    9.3m      £1.0m      £13.9m        £1.9m     —      1/5     25         1    no
innout        4    52 (52/0)       1   16.7m     £11.2m      £21.1m        £2.0m     —      1/5     52         1    no
innout        5    56 (56/0)       0   18.0m     £12.5m      £22.5m        £2.0m     —      1/5     56         2    no
```
"closed" counts both forced exits (geopolitics) and collapses below the £400k line.

**Win timing.** Franchise-fast wins on regions in 5 of 5 seeds, at year 4.4–4.9 (round 2: 4 of 5, 4.2–4.6). Company-steady wins in 4 of 5 at year 9.4–9.6 (round 2: 1 of 5). In-N-Out-slow wins in none within 10 years. The intended shape holds: franchising is fast and asset-light, company-owned is capital-hungry, fresh-and-slow takes decades. In-N-Out is weaker than in round 2 (37–56 sites, £2.0m units, was 58–69 and £2.5–2.7m): its fresh formula no longer multiplies covers past the seat cap, only demand.

**Where a mature site's covers come from.** A year-10 franchise site serves ~400 covers a day: ~140 in a 10-table dining room (the full tech tree's box) and the rest from the takeaway counter (×2.0), drive-thru (×1.3) and app (×1.1). Hands-on, the player runs the 140; the Empire adds the rest to the focused DayResult.

**No style reaches a billion meals in 10 years.** Franchise-fast gets about 0.5bn, so the meals win is a 15–20 year goal and the regions win is the faster route.

**Early franchising is thin.** An unlocked formula's dining room (~85 covers, £1.3k/day) barely covers a franchisee's rent, royalty, ad fund and bank loan, so mood falls toward the association line; locking the formula (+1 table, +40% takeaway) makes the unit work. That is the honest sim-core economics of a 6-table room, and a lesson worth keeping, but the UI should say it before the first sale (see open question 8).

**Unit economics** at year 10 (mature sites, model, % of net sales):

| Style | Food | Labour | Overheads | Occupancy (market rent) | Site margin after occupancy |
|---|---|---|---|---|---|
| Franchise | 32.4% | 22.6% | 7.8% | 2.7% | 34.5% |
| Company | 33.7% | 22.9% | 7.8% | 2.4% | 33.1% |
| In-N-Out | 36.5% | 22.2% | 7.3% | 2.3% | 31.7% |

These sit near the brief's QSR anchors (food ~30%, labour ~25%, occupancy ~5%, margin ~25%) and within 3 points of round 2. Labour is now the standard crew's wages (content archetypes), scaled with the off-premise covers.

**Performance** (`--perf`, Node 22, one core): 1,000 sites take 6.3 ms/day and 5,000 sites take 16 ms/day (round 2: 3.4 / 13; the market-demand lookups are cached per district, month, weekend, popularity and prestige), against a target of under 50 ms. The test asserts the 50 ms limit.

## 5. Open questions
1. ~~sim-core should export `Rng`~~ Done: `src/rng.ts` re-exports it from the package.
2. ~~`newGameFromSite`~~ **Done in round 3**, in sim-empire (`engine.ts`), and used by the game's FOCUS_SITE.
3. **Seats now cap the model too (round 3).** The off-premise half of a QSR (takeaway counter, drive-thru, app) is still modelled, not simulated: the hands-on player sees the dining room only, and the Empire adds the rest. A sim-core "counter service" mode (`GameState.serviceMode?: "table" | "counter"`: takeaway parties that take a counter spot for a tick instead of a table, faster eat/clear in the room, lower spend per head) would let the hands-on site show the queue at the counter too. It was out of scope for round 3; when it lands, `offPremise` should shrink by the share sim-core now serves.
4. ~~Rota artefacts in the weekday profile~~ **Done in round 3**: calibrate skips owner-covered days, and every modelled site gets the standard crew and rota.
5. **Content.** Cities, regions, suppliers, dietary rules and champions live in `src/world.ts`. The content pass should move them to `content/data/empire.json`. There should also be a fast-food dish set: `FAST_FOOD_MENU` uses the existing burgers, chips, shakes and sundae.
6. **Balance.** The franchise style's late cash pile (£400–600m) has nowhere to go. Late sinks to consider: acquisitions of rival chains, share buybacks and dividends as score, and big-ticket R&D. Mood sits at 60–65 under default terms, and the association only forms when the player squeezes. A recession event (Sonneborn 1967) would test over-expansion.
7. **Hybrid play.** The ownership mix per region is just per-site choices today. A per-region "slider" UI can be sugar over `OPEN_SITE` and `SELL_FRANCHISE`.
8. **Round 3 model follow-ups.** (a) The popularity/prestige-by-crew curves and `DEMAND_SCALE_KEEP` were fitted on two flagships; the test cases sit at −5% to +8%, with the worst probe case (crew 40, Student Quarter) at +15% covers / +8% revenue. (b) The brand pull mod is a single footfall multiplier: sim-core can't tell recognition from a bigger city. (c) A franchise sale before the formula is locked loses the operator money. **Round 4 review:** the warning is in (contract panel, above a city's franchise buttons and above Sell franchise, until the formula is locked). But a locked first franchise loses money too: from a real day-365 fork (seeds 3 and 17, Harbourton, hqLease, default contract, no events) the operator's margin is −3…−14% (High Street), −6…−13% (Student Quarter), +5 → −13% (Seaside) over the first year, and mood falls to 5–29 (unlocked: −15…−32%, mood 0–3). The flagship sim itself only clears ~£28/day in winter, so a 19% take plus the build loan can't be paid from a 7-table room until drive-thru/app arrive. Next lever: a lower Sonneborn floor or royalty holiday for early units, or a crew sized to covers (d). (d) A 10-table box still gets a 4-person crew; a bigger crew for a bigger box (and the same in `newGameFromSite`) is the next lever if late-game units look too lean or too rich.
