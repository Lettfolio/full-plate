# EMPIRE-NOTES — `@full-plate/sim-empire` (Path A, the Empire)

The multi-site, franchising, real-estate and expansion layer. Pure TypeScript and deterministic. Money is in integer pence. The package is serialisable. It depends only on sim-core: it imports sim-core's types, calendar helpers and `rng.ts`, and takes the content pack as an argument.

```
pnpm --filter @full-plate/sim-empire typecheck   # src + demo
pnpm --filter @full-plate/sim-empire test        # 77 tests, ~30s (includes model-vs-focused 90-day runs + 5,000-site perf)
pnpm --filter @full-plate/sim-empire build       # tsc + static demo → packages/sim-empire/dist
pnpm --filter @full-plate/sim-empire demo        # http://localhost:5301  (?style=franchise|company|innout&years=10&seed=2)
pnpm --filter @full-plate/sim-empire headless [--years 10] [--seeds 5] [--style all|franchise|company|innout] [--board skip|follow|both] [--perf]
pnpm --filter @full-plate/sim-empire headless --unit [--district high_street]   # one new site's year one, line by line
```

Files:
- `src/types.ts`: the contract.
- `src/constants.ts`: every tunable value, each anchored to the brief.
- `src/model.ts`: the closed-form site model and `calibrate`. Its demand and capacity come from sim-core's `src/capacity.ts` (round 3).
- `src/engine.ts`: `newEmpire`, `forkFromGameState`, `stepEmpireDay`, `applyEmpireCommand`, `forceEvent`, `newGameFromSite`, `recalibrateFromSite`.
- `src/world.ts`: 12 invented cities, 5 regions and 4 suppliers.
- `src/strategies.ts`: the scripted styles. They are browser-safe.
- `src/unitEconomics.ts` (round 5): `probeUnitEconomics` — one new site's first year as a P&L (§3 "Unit economics"). `franchiseOutlook` (engine.ts) is its closed-form twin for the contract panel.
- `src/board.ts` (round 6): the monthly board meeting — income by source, top mover, headline risk, the decision pool and its picker.
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
| `BOARD_DECIDE {optionId}` (round 6) | Board meeting card | One of the pending meeting's option ids (applies its command) or `"skip"`. |
| `REFURBISH {siteId}` (round 6) | Board meeting | HQ pays £120k × cost index × price level; the drag's age goes back `REFURB_DAYS` (720) from where it is, or from full maturity. Only a site with some drag. +5 consistency; a franchisee +4 mood. |
| `FEE_HOLIDAY {franchiseeId, days}` (round 6) | Board meeting | No royalty for 30–180 days on their sites (ad fund and rent still due); mood +6 + 3 per month. |
| `SET_SUPPLY_MARKUP {pct}` (round 6) | Board meeting | 0–5% on franchisees' food cost, paid to HQ; −3 mood per point of rise; the association blocks a rise. |
| `REMODEL {siteId, hqPays}` (round 6) | Board meeting | HQ funds a franchisee's refit (and drive-thru lane): not forced, so the association doesn't block it; +4 mood. |

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
           × opening × effects × [fresh 1.08] × [breaks dietary rules 0.55] × [tradition 1.1] × Π site footfallMods
opening  = ramp × honeymoon (round 5, sites opened since: none on the flagship)
           ramp = 0.8 → 1 linearly over 270 days;  honeymoon = 1 + 0.3 × (1 − age/75)⁺
capacity = softmin(seats, crew) × (0.44 / peakShare)^0.3                 softmin = (a^−3 + b^−3)^(−1/3)
           seats = tables × 7.7 turns × mean party;  tables = startingTables × throughput(std), ≤ maxTables (or the site's own)
           crew  = 136 covers × chef+server pairs on shift (1 Mon–Thu, 2 Fri–Sun) × (1 + 0.5 (staffQuality − 50)/100)
covers   = softCap(demand, capacity) × offPremise × noise       softCap(d, c) = d / √(1 + (d/c)²)
offPremise = (1 + 0.02 × (std − 30)) × [drive-thru 1.3] × [app 1.1]    takeaway counter, lane and app: on top of the seats
revenue  = covers × spendScale × basket(district, brand menu) × costIndex × priceLevel × [app 1.05] × effects.spend
food     = covers × foodScale × plateCost(district, brand menu) × costIndex^0.6 × priceLevel × [fresh 1.12] × Π(1 − supplier discount)
labour   = standard crew (2 chefs + 2 servers × 5 shifts, wages at staffQuality) × costIndex × priceLevel × offPremiseLabour × speedee
           offPremiseLabour = 1 + 0.3 × (takeaway − 1) + (offPremise − takeaway)   (round 5: a counter cover costs 30% of a room cover)
           wage = £12.71 NLW + 4p per chef skill point above 30 (round 5, was 9p: QSR crews are paid near the NLW) + 2p per server point above 20
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
  - **On HQ land** (`hqLease` or `hqOwned`): the operator pays `max(rent% × reported, market rent × 1.2)` to HQ (Sonneborn's rule; round 5: a 20% markup, was 40%). On `hqLease`, HQ pays the market rent to the landlord. On `hqOwned`, HQ pays the mortgage instead. The mortgage is fixed while rent grows with sales and inflation, which is the end-game engine.
  - **Market rent** (round 5): a unit without a lane rents the founder's unit size (district rent × 1); a drive-thru plot is district rent × 1.6. A remodel that adds the lane moves the site to the bigger plot's rent, and rent reviews re-base to the site's current plot.
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
- **Franchisee mood (round 5):** drifts 3%/day toward `moodTarget` = 60 + 250 × (net margin − 6%) − 300 × (take − 19%). The net margin is the operator's own cash after royalty, ad fund, rent and the build loan, as a 90-day EMA (`margin30d`, name kept for saves), so one wet month doesn't start a revolt. The take term is symmetric: a cheaper contract buys goodwill, a dearer one costs it. A fair franchise netting 6% sits at 60; −5% heads for 32.
  - **Shocks:** −5 per point of royalty rise on everyone, −12 for a forced remodel, −4 for a scheduled one, −8 per discount campaign, −8 per scandal, −10 when caught skimming, −3 when a peer goes bust.
  - **Multi-unit growth:** operators with mood ≥ 55 can take another site at most once a year (round 5; was 180 days).
- **Association:** forms when at least 5 active franchisees average mood < 35 **and the median franchisee is losing money** (round 5); it stands down when mood is back to 50 or the median nets 2% again. While active, it blocks fee rises on existing agreements, forced remodels on franchise sites, discount campaigns and encroachment (opening where a franchisee already trades). It halves applicants. The win needs no association.
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
- **Recognition:** drifts 1/90 per day toward 100 × (1 − e^(−vis/6)), where vis = weighted sites per million people in the region + ad spend over 30 days / £50k + 0.55 in the home region. Round 5 weights a site by who runs it (`siteVisibility`): company 0.9, franchise 0.6, licence 0.4, and a fresh formula's company sites × 1.5 (word of mouth). Franchises grow the count fastest; each company site carries the brand further.
- **Win:** a billion meals served, **or** every region at recognition ≥ 60 with at least one site making money. Either way, HQ must be solvent and the association must not be active. `win.achievedDay` and `win.reason` are recorded.

## 4. Headless results

`pnpm --filter @full-plate/sim-empire headless --years 10 --seeds 5`. The run starts from one company flagship, £500k at HQ and the default contract. The styles make weekly decisions:
- **franchise:** lock the formula, research the tech tree, sell to every applicant with cash, lease then buy the land, and enter cities on the entry cost alone.
- **company:** company sites only, built on the development facility, with plots bought from profit. It saves for the next city once home fills.
- **innout:** fresh formula and a commissary per region; each commissary supplies at most one new site every 60 days in its own region (round 5), least-known region first, entering a new commissary's region before anything else. It pauses every 15 sites per commissary to save for the next region, signs non-exclusive supply deals and runs a launch campaign where it is least known.

All styles keep 10% of their outstanding mortgages in reserve before buying another plot (round 5: a forced exit sells plots at half value, and one franchise seed went bust holding 205 mortgages at zero cash).

### Round 5: unit economics (`probeUnitEconomics`, `headless --unit`)
One new site in the home city's High Street, locked formula, HQ holding the lease, default contract (fee £35k, royalty 5%, ad fund 4%, rent 10% of sales or HQ's cost + markup), a year with no random events, % of net sales (ex VAT). BRIEF anchors: food & packaging ~30%, labour ~25%, occupancy ~5%, restaurant margin ~25% ("Unit economics the sim uses"); royalty 4–5%, ad fund 4–4.5% ("Franchise contract builder"); franchisees of a proven brand net ~6–10%.

| Year 1, franchise | Round 4 | Round 5, no supply deals | Round 5, with deals | Company, with deals |
|---|---|---|---|---|
| Covers / day | 124 | 120 | 120 | 119 |
| Net sales | £570k | £549k | £549k | £546k |
| Food & packaging | 36.0% | 36.0% | 31.7% | 31.7% |
| Crew wages | 38.0% | 30.3% | 30.3% | 30.4% |
| Overheads | 9.3% | 9.3% | 9.3% | 9.3% |
| Rent | **17.9%** | 10.7% | 10.7% | 8.4% (market) |
| Royalty | 5.0% | 5.0% | 5.0% | — |
| Ad fund | 4.0% | 4.0% | 4.0% | 4.0% |
| Build loan | 3.8% | 3.9% | 3.9% | — (HQ paid) |
| **Net (cash)** | **−13.9% (−£79k)** | **+0.7% (+£4k)** | **+5.0% (+£28k)** | **+16.2% (+£88k)** |
| Remodel reserve (10-year cycle, not cash) | 4.3% | 4.4% | 4.4% | 4.4% |
| Franchisee mood at the end | 8 | 45 | 55 | — |

Where the loss came from, in order: **rent** (every new site paid the mature drive-thru plot's rent, district × 1.6, plus the 40% Sonneborn markup: 18% of a year-one unit's sales); **counter labour** (takeaway covers cost the table-service room's full labour per cover; sim-core's room runs ~39% labour on the fast-food menu); **crew wages** (a 9p-a-point chef premium from the table-service career ladder); **food** without the chain's supply deals (36% is the independent's food cost). The fee is not the problem (it is capital, paid once), and the ramp-up costs about 2 points of year one. The dining room's demand, seats and crew (sim-core `capacity.ts`) are untouched: the calibration tests read the same 87.9 / 74.1 / 106.0 covers as round 4.

From a real day-365 fork (seeds 3 and 17, the review's set-up), with supply deals: High Street +4.2% / +8.1%, Student Quarter +3.4% / +7.0%, Seaside +5.1% / +9.1%, Business Park −1.7% / +3.5% (weekday trade only: a district choice that matters). Without deals: −1.0…+4.8%, Business Park −6.2% / −0.8%. Round 4: −3…−14%, mood 5–29.

**The J.** Opening weeks run above the run-rate on the honeymoon, months 2–5 are the thinnest, then the ramp carries the site to run-rate by month 9. Year two at the same site: +6.5% (mood 58).

**Mature units** (full tech tree, drive-thru plot, recognition 85, year two of trading, with deals): food 30.2%, labour 19.2%, overheads 7.9%; franchisee rent 10.0%, royalty 5%, ad 4%, loan 2% → **franchisee net 21.7%**; the same site company-owned nets **34.3%** after 4.4% market rent and the ad fund. Both are richer than the brief's ~25% margin and a real franchisee's 10–15% at maturity (labour is ~6 points lean): see open question 9.

**What the contract panel says.** `franchiseOutlook(content, e)` is a closed-form, noise-free pass over the same year (≤ 0.6 points from the probe): "Your franchisee should clear about £28,000 a year — fair." (≥ 4% of sales), "— they'll only just get by." (≥ 0), or "Your franchisee would lose about £X a year — they'll lose money.", with "Supply deals would cut their food bill." while deals are unsigned.

### Round 5: ten years, five seeds
```
style      seed  sites (co/fr)  closed  meals      HQ cash   HQ net/yr  avg site/yr  mood  regions  plots  scandals  win
franchise     1   713 (1/712)       5  493.1m    £557.3m     £147.7m        £2.0m    92      5/5    713         0  y5.4
franchise     2   603 (1/602)     115  458.4m    £484.9m     £131.5m        £2.2m    93      5/5    603         4  y5.6
franchise     3   706 (1/705)       1  447.4m    £490.0m     £140.2m        £2.0m    92      5/5    706         3  y6.3
franchise     4   718 (1/717)       0  539.6m    £630.0m     £149.0m        £2.0m    92      5/5    718         2  y4.9
franchise     5   486 (1/485)      82  347.9m    £439.7m     £123.7m        £2.4m    97      4/5    486         0    no
company       1   718 (718/0)       0  298.6m    £914.6m     £357.7m        £1.9m     —      5/5    245         0  y7.0
company       2   718 (718/0)       0  296.0m    £904.6m     £355.2m        £1.9m     —      5/5    242         0  y7.0
company       3   718 (718/0)       0  233.0m    £660.5m     £349.7m        £1.9m     —      5/5    211         1  y7.7
company       4   718 (718/0)       0  290.4m    £886.4m     £355.3m        £1.9m     —      5/5    239         0  y7.1
company       5   683 (683/0)      10  262.4m    £765.0m     £328.1m        £1.9m     —      4/5    232         1    no
innout        1   161 (161/0)       1   58.7m    £206.9m     £111.6m        £2.3m     —      5/5    161         0  y8.9
innout        2   138 (138/0)      22   57.3m    £202.5m     £106.1m        £2.5m     —      4/5    138         0  y9.0
innout        3   139 (139/0)       7   43.0m    £115.7m      £83.8m        £2.1m     —      4/5    139         1    no
innout        4   131 (131/0)       6   49.4m    £157.7m      £83.7m        £2.2m     —      4/5    131         2    no
innout        5   158 (158/0)       0   53.0m    £173.4m     £103.7m        £2.2m     —      5/5    158         3  y9.9
(83.1s)
```
| Style | Round 4 wins | Round 5 wins | How it wins |
|---|---|---|---|
| franchise | 5/5, years 4.4–4.9 | **4/5, years 4.9–6.3** | count and speed: ~700 sites, asset-light, HQ lives on royalty and rent; mood 89–97 at year 10 |
| company | 4/5, ~9.5 | **4/5, years 7.0–7.7** | control and cash: keeps the whole margin; £0.66–0.91bn at HQ by year 10 (franchise £0.44–0.63bn) |
| innout | 0/5 | **3/5, years 8.9–9.9** | fewest, richest sites (£2.2–2.5m a year each, 131–162 sites) |

The misses are forced exits (sanctions close a country: franchise seed 5 lost Saravan and its 76 sites, so the Sunrise Coast never reaches 60) and seeds where the last region arrives late. No seed goes bust.

**Where a mature site's covers come from.** A year-10 franchise site serves ~340–400 covers a day: ~140 in a 10-table dining room (the full tech tree's box) and the rest from the takeaway counter (×2.0), drive-thru (×1.3) and app (×1.1). Hands-on, the player runs the 140; the Empire adds the rest to the focused DayResult.

**No style reaches a billion meals in 10 years.** Franchise-fast gets about 0.5bn, so the meals win is a 15–20 year goal and the regions win is the faster route.

The round-3/4 table (franchise 5/5 at 4.4–4.9, company 4/5 at ~9.5, In-N-Out 0/5) is in git history.

**Performance** (`--perf`, Node 22, one core): 1,000 sites take 6.3 ms/day and 5,000 sites take 16 ms/day (round 2: 3.4 / 13; the market-demand lookups are cached per district, month, weekend, popularity and prestige), against a target of under 50 ms. The test asserts the 50 ms limit.

### Round 5 review: maturity drag (`maturity()`, `MATURE_*`)

10-year runs measured mature units at franchisee net ~20% and company-owned ~31% (B's probe: 22% / 34%); mood saturated in the 90s. A flat cost would sink a brand that never researched the tech tree (its mature franchisee only clears ~7%), so the drag takes a share of the margin **above a healthy level**: from year 2 (`MATURE_FROM_DAYS` 720) to year 5 (`MATURE_FULL_DAYS` 1800) of trading, a site loses `MATURE_TAKE` (80%) of its store contribution above `MATURE_FLOOR` (28% of net sales) — half booked as wage creep (labour), half as upkeep and lost trade (overheads). Non-fresh company sites also carry `MATURE_COMPANY_EXTRA` (+7% of net sales on labour: corporate pay scales, the area-manager layer); In-N-Out promotes from the crew and runs flat. Years 1–2, `franchiseOutlook` and the year-one probe are untouched; sites with no `openedTrading` (the flagship, old saves) don't age.

| | before | after |
|---|---|---|
| fully mature franchisee net (median, 3 seeds) | 19.4–21.1% | **9.3–10.1%** |
| mature company site net after market rent + ad fund | 31.0–31.2% | **17.0–19.3%** |
| no-tech brand, High Street, year 6: franchisee / company | 7.5% / 18.6% | 4.6% / > 8% (pinned by test) |
| franchisee mood at year 10 | ~89–97 | 72–76 |

Ten years × five seeds after the drag: **franchise 4/5 at y4.9–6.3**, **company 4/5 at y7.1–7.8**, **In-N-Out 3/5 at y8.9–9.8** (B: 4/5 4.9–6.3, 4/5 7.0–7.7, 3/5 8.9–9.9). `test/unitEconomics.test.ts` pins the ramp, the no-tech floor and both mature medians.

**`franchiseOutlook` vs the probe on all 34 districts** (locked, supply deals): the outlook is never the optimistic side; 0.4–1.8 points under the probe where a franchise is viable, up to 3.8 under where it loses a third of its sales (unlocalised menus in Vasant, Qamar, Seren: −20…−32%). 5 of 68 verdicts differ from the probe's, all within a point of a line.

### Round 6: the monthly board meeting (`src/board.ts`)

On the evening of each month's last day (`(day + 1) % 30 === 0`, with the monthly snapshot) `stepEmpireDay` holds a meeting and stores it in `EmpireState.boardMeeting` (event kind `boardMeeting`):
- **Income by source** (`BoardIncome`, integer pence, accumulated daily in `monthBook`): company shops (profit after occupancy and the ad fund; the focused site's till isn't HQ's), royalties, rent (landlord income net of head leases), joining fees, the food markup, and HQ's own costs (overheads, mortgages, overdraft interest — the remainder, so the lines add up exactly to the month's net). Capital (builds, plots, refurbs) is not income.
- **Top mover:** the city district whose yearly sales rose most since the last meeting.
- **One risk**, most urgent first: the association / owners' mood below 45, a shop below the collapse line, borrowing within 80% of the development facility (£150k a shop), tired shops (maturity ≥ 0.5), else none.
- **Exactly one decision** of 2–3 options. The eligible pool: royalty ±1 pt for everyone (≥ 3 franchisees), localise a foreign city whose menu breaks its rules, buy a plot (Campus/Business Park first), refurbish a tired site, a fee holiday for a struggling franchisee (net < 4% or mood < 50), a drive-thru lane (HQ pays, or the owner is made to — a forced remodel), a food markup (≥ 5 franchisees with supply deals), and a brand campaign when fewer than two others apply. The picker is `boardHash(seed, month) % pool` (not last month's kind when there's another): no rng draws, so a meeting never changes what the dice do.
- Each option is a real command (above) with a cost and a measurable effect (test/board.test.ts). `decision.advice` is what a sensible board would pick (the card's tip and the headless board-follower): spend capex only with a country entry (£520k × price level) or a tenth of the mortgages in hand; refurbish a company site only when the expected gain over the refurb's life covers its cost; raise royalty only for happy, well-paid owners (mood ≥ 70, median net ≥ 8%) and never past 6%; cut it when mood < 45 or the median nets < 3%.
- **Skipping** is allowed (`BOARD_DECIDE skip`, or no answer by the next meeting). It does nothing, except: a franchisee whose fee-holiday plea is skipped or refused loses 4 mood; owners who hoped for a royalty cut lose 2. Minutes (`boardMinutes`, last 36) record each answer.
- The game shows it as a lazy modal card on that evening (and the next morning if reloaded); Next day waits until it is answered or skipped. The Money panel lists the minutes one line a month.
- Round 6 review: when the brand's only company shop is the focused flagship (its till isn't HQ's), "Your own shops £0" gets one line under the money: "£0 because your only own shop is the one you run: its money stays in its own till (the Evening shows it)." An evening tip on a meeting night sits inline under the card; its tomorrow-commands wait in the reducer (`AppState.tomorrow`) until the board is answered and the next morning comes.

**R5 P3 fixed:** the founder's flagship now has `openedTrading` (`newEmpire`: `day − FLAGSHIP_AGE_DAYS`, a two-year-old room; the fork: day 0, the game's start), so it matures like every other site. Old saves are backfilled with 0 in `deserialize` (idempotent).

**Ten years, five seeds** (`headless --years 10 --seeds 5 --board both`; R5 = the round-5 review's final run, `4273e96`):

| Style | R5 | Round 6, skip (never answers) | Round 6, board-follower |
|---|---|---|---|
| franchise | 4/5, y4.9–6.3; HQ £0.44–0.63bn; mood 72–76 | **5/5, y5.0–5.6**; £0.39–0.60bn; mood 73–76 | **5/5, y5.3–6.2**; £0.55–0.69bn; mood 65–71 |
| company | 4/5, y7.1–7.8; £0.56–0.78bn | **5/5, y7.2–8.1**; £0.48–0.70bn | **5/5, y7.2–8.1**; £0.47–0.69bn |
| innout | 3/5, y8.9–9.8; £0.13–0.18bn | **3/5, y9.0**; £0.11–0.18bn | **5/5, y8.5–9.1**; £0.10–0.18bn |

The shape holds: franchise wins ~year 5–6, company ~7–8, In-N-Out last. Seeds move a little because the flagship now matures (its margin and HQ's cash shift the scripted styles' timing; seeds diverge through the rng after that) — franchise skip seeds 1 and 3 lose 106 / 157 sites to forced exits that R5's seeds 2 and 5 had instead. Following the board is worth something but not a cheat: franchise HQ ends ~£100m richer (5 royalty raises to 6%, a 2% food markup started in 5 seeds and kept, plots bought) at the price of ~6 points of franchisee mood; In-N-Out wins in every seed (brand campaigns where it is least known: 44 of 117 campaign questions; refurbished sites); company is unchanged (its board mostly buys plots and lanes and leaves refurbs: the expected gain rarely covers £120k). What the follower decided over all seeds — franchise: royalty keep 128 / raise 5, food markup keep 105 / start 5 / at cost 19, plots buy 56 / rent 40, lanes wait 116 / HQ pays 5, fee holidays 17, refurbs 24 / leave 74; company: plots 91 / 112, lanes 80 / 45, refurbs 31 / 167; innout: campaigns 44 / 73, plots 70 / 97, lanes 61 / 47, refurbs 26 / 180. The R5 unit-economics numbers (year-one probe, outlook, maturity drag) are untouched: no option changes them unless taken.

## 5. Open questions
1. ~~sim-core should export `Rng`~~ Done: `src/rng.ts` re-exports it from the package.
2. ~~`newGameFromSite`~~ **Done in round 3**, in sim-empire (`engine.ts`), and used by the game's FOCUS_SITE.
3. **Seats now cap the model too (round 3).** The off-premise half of a QSR (takeaway counter, drive-thru, app) is still modelled, not simulated: the hands-on player sees the dining room only, and the Empire adds the rest. A sim-core "counter service" mode (`GameState.serviceMode?: "table" | "counter"`: takeaway parties that take a counter spot for a tick instead of a table, faster eat/clear in the room, lower spend per head) would let the hands-on site show the queue at the counter too. It was out of scope for round 3; when it lands, `offPremise` should shrink by the share sim-core now serves.
4. ~~Rota artefacts in the weekday profile~~ **Done in round 3**: calibrate skips owner-covered days, and every modelled site gets the standard crew and rota.
5. **Content.** Cities, regions, suppliers, dietary rules and champions live in `src/world.ts`. The content pass should move them to `content/data/empire.json`. There should also be a fast-food dish set: `FAST_FOOD_MENU` uses the existing burgers, chips, shakes and sundae.
6. **Balance.** The franchise style's late cash pile (£400–600m) has nowhere to go. Late sinks to consider: acquisitions of rival chains, share buybacks and dividends as score, and big-ticket R&D. Mood sits at 60–65 under default terms, and the association only forms when the player squeezes. A recession event (Sonneborn 1967) would test over-expansion.
7. **Hybrid play.** The ownership mix per region is just per-site choices today. A per-region "slider" UI can be sugar over `OPEN_SITE` and `SELL_FRANCHISE`.
8. **Round 3 model follow-ups.** (a) The popularity/prestige-by-crew curves and `DEMAND_SCALE_KEEP` were fitted on two flagships; the test cases sit at −5% to +8%, with the worst probe case (crew 40, Student Quarter) at +15% covers / +8% revenue. (b) The brand pull mod is a single footfall multiplier: sim-core can't tell recognition from a bigger city. (c) ~~A locked first franchise loses money~~ **Fixed in round 5** (§4 "Round 5: unit economics"): rent by plot, a 20% Sonneborn markup, counter labour at 30% of a room cover and QSR crew wages put a locked High Street franchise at +5% in year one with supply deals (+0.7% without), mood ~55. An unlocked formula still loses its operator money (−20%, mood 0), and the warning stays. (d) A 10-table box still gets a 4-person crew; a bigger crew for a bigger box (and the same in `newGameFromSite`) is the next lever if late-game units look too lean or too rich.
9. **Round 5 follow-ups.** (a) ~~Mature units are rich~~ **Fixed in the round 5 review** (§4 "Maturity drag"). (b) ~~`franchiseOutlook` reads the home city's first district~~ **Fixed:** the contract panel names the home city's best district and every Franchise button shows its own verdict. Original note: (a) Mature units are rich: franchisee net ~22% and company ~34% at a full-tech-tree drive-thru site (brief: ~25% margin; a real franchisee nets 10–15% at maturity), mostly lean labour (19% vs ~25%) now that counter covers are cheap and crew wages flat. Mood therefore saturates at 89–97 in default play, and the association only forms when the player squeezes the contract or sells in a weak district. Honest mature levers: a delivery-platform commission on app orders (25–35% in the UK), a bigger crew for a bigger box (8d), or drive-thru covers above the room's labour rate. (b) `franchiseOutlook` reads the home city's first district on HQ land; the city panel could show it per district (Business Park is the weak one). (c) Food is 36% of sales until supply deals are signed; a brand might get some purchasing power from the locked formula alone.
