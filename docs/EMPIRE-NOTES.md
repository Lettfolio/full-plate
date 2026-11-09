# EMPIRE-NOTES — `@full-plate/sim-empire` (Path A, the Empire)

The multi-site, franchising, real-estate and expansion layer. Pure TypeScript and deterministic. Money is in integer pence. The package is serialisable. It depends only on sim-core: it imports sim-core's types, calendar helpers and `rng.ts`, and takes the content pack as an argument.

```
pnpm --filter @full-plate/sim-empire typecheck   # src + demo
pnpm --filter @full-plate/sim-empire test        # 48 tests, ~7s (includes runDay calibration + 5,000-site perf)
pnpm --filter @full-plate/sim-empire build       # tsc + static demo → packages/sim-empire/dist
pnpm --filter @full-plate/sim-empire demo        # http://localhost:5301  (?style=franchise|company|innout&years=10&seed=2)
pnpm --filter @full-plate/sim-empire headless [--years 10] [--seeds 5] [--style all|franchise|company|innout] [--perf]
```

Files:
- `src/types.ts`: the contract.
- `src/constants.ts`: every tunable value, each anchored to the brief.
- `src/model.ts`: the closed-form site model and `calibrate`.
- `src/engine.ts`: `newEmpire`, `forkFromGameState`, `stepEmpireDay`, `applyEmpireCommand`, `forceEvent`.
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
- Calibrates the aggregate model on `gameState.history` (`calibrate`, see §3). It needs at least 14 trading days.
- Creates HQ with `hq.day = gameState.day`, so seasons and weekdays line up with sim-core.
- Creates **site `s1` = the player's restaurant**: company-owned, in the home city Harbourton, `districtId = gameState.districtId`, `focused: true`.
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
- When the player is on the map with nothing focused, fast-forward with `stepEmpireDays(content, empire, n)`. It costs about 13 ms/day at 5,000 sites.
- `events` (`EmpireEvent[]`, each with `tone` and an optional `siteId`/`cityId`/`regionId`) feed the morning mail and the map ticker. `empire.events` keeps the last 200.

### Switching focus (promote / demote)
1. **Demote** the current site: `FOCUS_SITE {}`. The game may keep its GameState as a save, or drop it.
2. **Recalibrate (optional but recommended):** `recalibrateFromSite(content, empire, oldSiteId, gameState.history)` refits the model on everything the player just played. It normalises the fit back to the reference state so other sites keep their own factors.
3. **Promote** a site: `FOCUS_SITE { siteId }`. The game builds a GameState for it with `newGame` (`districtId = site.districtId`, `restaurantName = site.name`). It also seeds the menu from `brand.formula.menuDishIds` at `priceIndex × suggestedPrice`, hires staff in proportion to `site.staffQuality`, and sets popularity from recognition: `popularity ≈ 40 + recognition/3`. A sim-core helper `newGameFromSite` would make this exact; see open questions.

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

### Closed-form site day (`aggregateSiteDay`)
```
covers   = baseCovers × season[district][month] × weekdayProfile[weekday] × D × noise      noise ~ logN(−σ²/2, σ)
D        = location × recognition × consistency × staff × throughput × price × champion × stale
           × (1 − saturation) × permanentDemand × effects × [driveThru 1.3] × [app 1.1] × [fresh 1.08]
           × [breaks dietary rules 0.55] × [tradition 1.1] × Π footfallMods
location     = footfall[district]/footfall[calDistrict] × (population/2.5m)^0.25
recognition  = (1 + rec/100) / (1 + 15/100)
consistency  = (0.8 + 0.4·c/100) / (0.8 + 0.4·0.5)
staff        = (0.85 + 0.3·q/100) / (0.85 + 0.3·0.5)
throughput   = 1 + 0.012 × max(0, standardisation − 30)          (Speedee: assembly line serves more from one box)
price        = priceIndex^−1.2
champion     = 1 − strength × 0.35 × (1 − rec/200)
stale        = 1 until 6 years without a remodel, then −4%/yr to a floor of 0.75
revenue  = covers × spendPerCover × priceIndex × costIndex × priceLevel × [app 1.05] × effects.spend
food     = covers × foodPerCover × costIndex^0.6 × priceLevel × [fresh 1.12] × Π(1 − supplier discount)
labour   = labourPerDay × costIndex × priceLevel × (covers/coversMean)^0.85 × (1 − 2% per 10 std above 30)
overhead = overheadsFixed × costIndex × priceLevel × (covers/coversMean)^0.85 + cardFee × revenue
VAT      = vatPct × revenue;     contribution = revenue − VAT − food − labour − overhead
```
Every factor equals 1 at the **reference state**: recognition 15, consistency 50, staff 50, standardisation 30, no saturation, price ×1. The flagship starts exactly there, so with the fork's calibration the model reproduces the player's restaurant.

### Calibration (`calibrate(content, history, {districtId})`)
Ratio estimators keep the means exact:
- **`weekdayProfile`:** deseasonalised mean covers per weekday ÷ the overall mean, shrunk toward 1 below 4 samples. It captures the weekend uplift, capacity clipping, *and the player's rota*: the days the owner covers alone are slower.
- **`baseCovers`:** Σ covers ÷ Σ(season × weekdayProfile).
- **Per cover:** `spendPerCover`, `foodPerCover` (food + prep waste + spoilage) and `labourPerDay` are ratios.
- **Overheads:** OLS of daily overheads on revenue gives `cardFeePct` and `overheadsFixed`.
- **`noiseSd`:** the RMS of log(actual ÷ fitted).

Days with zero covers (closed by an event) are skipped.

**Accuracy:** `test/calibration.test.ts` plays sim-core's `runDay` for 60 days on the shipped content pack, using a fast-food menu, one chef and one server, and nightly `suggestedOrder`.

| District | Focused covers/day | Aggregate | Focused revenue/day | Aggregate | Error |
|---|---|---|---|---|---|
| high_street | 52.5 | 50.1 | £849 | £811 | −4.6% / −4.5% |
| student_quarter | 54.7 | 56.6 | £889 | £921 | +3.5% / +3.5% |

The test also checks that, per weekday, noise-free expected covers are within 15% of the focused mean, and that the food share is within 3 points and the labour total within 10%. Separately, stepping the empire for those 60 days through `stepEmpireDay` gives meals served within 10% of the focused total.

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

```
style      seed  sites (co/fr)  closed  meals      HQ cash   HQ net/yr  avg site/yr  mood  regions  plots  scandals  win
franchise     1   718 (1/717)       0  532.0m    £578.7m     £148.0m        £2.0m    65      5/5    718         3   yes
franchise     2   593 (1/592)      46  426.1m    £416.1m     £107.3m        £1.7m    62      3/5    593         0    no
franchise     3   548 (1/547)     170  467.8m    £366.8m      £87.0m        £1.6m    60      5/5    548         2   yes
franchise     4   603 (1/602)     115  473.5m    £473.5m     £102.8m        £1.8m    64      5/5    603         0   yes
franchise     5   700 (1/699)      18  508.5m    £528.5m     £112.8m        £1.7m    62      5/5    700         0   yes
company       1   481 (481/0)       0  106.5m    £122.1m     £166.4m        £1.7m     —      5/5    108         0   yes
company       2   437 (437/0)       0   93.6m     £87.9m     £121.1m        £1.5m     —      4/5     80         2    no
company       3   287 (287/0)      64   54.9m     £24.3m     £124.3m        £1.8m     —      3/5     55         1    no
company       4   360 (360/0)       0   73.0m     £60.5m     £141.1m        £1.8m     —      3/5     73         2    no
company       5   288 (288/0)       0   57.1m     £27.8m     £116.3m        £1.8m     —      2/5     29         1    no
innout        1    69 (69/0)       0   31.8m     £69.1m      £43.9m        £2.7m     —      2/5     69         0    no
innout        2    69 (69/0)       0   31.8m     £68.9m      £44.2m        £2.7m     —      2/5     69         0    no
innout        3    58 (58/0)       0   21.2m     £38.4m      £35.6m        £2.5m     —      2/5     58         1    no
innout        4    61 (61/0)       8   23.4m     £15.9m      £18.1m        £1.6m     —      1/5     61         1    no
innout        5    69 (69/0)       0   31.8m     £69.1m      £43.9m        £2.7m     —      2/5     69         0    no
```
"closed" counts both forced exits (geopolitics) and collapses below the £400k line.

**Win timing.** Franchise-fast wins on regions in 4 of 5 seeds, at year 4.2–4.6. Company-steady wins in 1 of 5 (year 9.6). In-N-Out-slow wins in none within 10 years. This is the intended shape: franchising is fast and asset-light, company-owned is capital-hungry but keeps every pound, and fresh-and-slow has the best units (£2.5–2.7m per site) and a cult brand but takes decades.

**No style reaches a billion meals in 10 years.** Franchise-fast gets about 0.4–0.5bn, so the meals win is a 15–20 year goal and the regions win is the faster route. That seems right for a "late game".

**Unit economics** at year 10 (mature sites, model, % of net sales):

| Style | Food | Labour | Overheads | Occupancy (market rent) | Site margin after occupancy |
|---|---|---|---|---|---|
| Franchise | 32.5% | 24.7% | 7.9% | 3.1% | 31.8% |
| Company | 34.0% | 24.9% | 7.9% | 3.2% | 30.0% |
| In-N-Out | 38.1% | 21.4% | 7.1% | 1.7% | 31.8% |

These sit near the brief's QSR anchors (food ~30%, labour ~25%, occupancy ~5%, margin ~25%). Occupancy runs low and margin high because mature drive-thru sites trade at about £1.7m on a rent set when they opened.

**Performance** (`--perf`, Node 22, one core): 1,000 sites take 3.4 ms/day and 5,000 sites take 13 ms/day, against a target of under 50 ms. The test asserts the 50 ms limit. A save with about 500 sites is about 320 KB.

## 5. Open questions
1. **sim-core should export `Rng`.** `src/rng.ts` re-exports `../../sim-core/src/rng` by path because sim-core's index doesn't export it. That is a one-line change in sim-core, after which this file should import from the package.
2. **`newGameFromSite` in sim-core** would let a promoted site start a GameState that matches the model: `newGame` plus a district override, menu, staff skill from `staffQuality`, popularity from recognition and footfall multipliers from `D`. Until then, a promoted site's first few weeks will differ from its aggregate numbers by the ~5% calibration error plus the staffing guess.
3. **Seats cap the focused restaurant, but not the model.** sim-core caps covers at about 14 tables. A QSR box serves several hundred covers a day only because standardisation, drive-thru and app multiply the calibrated base. If the lead wants a promoted QSR site to look busy in the agent sim, sim-core needs a "counter service" mode: higher table turnover and takeaway covers without a seat.
4. **Rota artefacts in the weekday profile.** The fork calibration inherits the player's staffing pattern, for example slow Mondays when the owner covers alone, so every aggregate site copies it. That is faithful to "keep its numbers" but odd for a chain. An option is to calibrate `weekdayProfile` only on fully staffed days.
5. **Content.** Cities, regions, suppliers, dietary rules and champions live in `src/world.ts`. The content pass should move them to `content/data/empire.json`. There should also be a fast-food dish set: `FAST_FOOD_MENU` uses the existing burgers, chips, shakes and sundae.
6. **Balance.** The franchise style's late cash pile (£400–600m) has nowhere to go. Late sinks to consider: acquisitions of rival chains, share buybacks and dividends as score, and big-ticket R&D. Mood sits at 60–65 under default terms, and the association only forms when the player squeezes. A recession event (Sonneborn 1967) would test over-expansion.
7. **Hybrid play.** The ownership mix per region is just per-site choices today. A per-region "slider" UI can be sugar over `OPEN_SITE` and `SELL_FRANCHISE`.
