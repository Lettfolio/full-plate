# Round 3 — Toward the brief: paths, ladder, hands-on

Read `docs/BRIEF.md` for intent and `docs/ARCHITECTURE.md` + `packages/sim-core/src/types.ts` for the existing contract.
Round 3 adds the systems the brief promises, each in its **own package** so four agents can work in parallel
without touching `packages/sim-core`, `packages/game` or `packages/content` (a reviewer and a balance agent are
editing those right now). Integration into the game UI happens in a later pass by a lead agent; each package must
therefore ship with (a) a pure TypeScript API, (b) tests, (c) a small standalone Vite demo page under `demo/` that
proves it works visually, and (d) a `docs/<PACKAGE>-NOTES.md` saying exactly how the game should mount it.

All packages: `@full-plate/<name>`, pnpm workspace, `type: module`, vitest, zero runtime deps beyond sim-core/content
types (React only inside `demo/` and in optional `ui/` components), deterministic (use sim-core's `rng.ts` by import,
never Math.random/Date), integer pence, pure functions over state. Add the package to the root with
`pnpm install` (lockfile change is fine). Commit only your own package and your notes doc.

## Shared ideas every package must respect
- **The restaurant sim (sim-core `GameState`) is the atom.** A multi-site empire is many sites, of which at most
  one is "focused" (a full `GameState`) and the rest are **aggregate** site summaries updated by a closed-form
  model per day (see BRIEF "Technical plan": two-level simulation). The Stars path keeps every restaurant focused.
- **Reputation has two tracks** already: `popularity` and `prestige`. Paths extend these; they do not replace them.
- **A day is the unit.** Path-level systems run once per in-game day on a `DayResult` plus the state they own.
- **Money is pence.** Everything serialisable; every package exports `serialize/deserialize` for its own state.

## Package 1 — `packages/sim-empire` (Path A: the Empire)
Owns the multi-site, franchising, real-estate and expansion layer.
```ts
export interface SiteSummary { id; name; cityId; districtId; opened: day; ownership: "company"|"franchise"|"licence";
  franchisee?: FranchiseeId; brandConsistency: 0-100; covers7d; revenue7d: Pence; margin7d: Pence; rent: Pence/month;
  ownedProperty: boolean; staffQuality: 0-100; footfallMods; saturationPenalty: 0-1; lastInspected?: day }
export interface Franchisee { id; name; competence: 0-100; honesty: 0-100; mood: 0-100; cash: Pence; sites: SiteId[] }
export interface FranchiseContract { fee: Pence; royaltyPct; adFundPct; rentPctOfSales; termDays; remodelEveryDays }
export interface Brand { name; formula: { menuDishIds: DishId[]; standardisation: 0-100; driveThru: boolean; academy: boolean; appOrdering: boolean };
  recognition: Record<RegionId, 0-100>; adSpend30d: Pence }
export interface City { id; name; country; regionId; population; districts: DistrictId[]; costIndex; dietaryRules: string[]; localChampion?: string; entered: boolean }
export interface EmpireState { version; brand; contract; sites: SiteSummary[]; franchisees: Franchisee[]; cities: City[];
  property: { siteId; purchasePrice: Pence; mortgageRemaining: Pence; rentIncome: Pence }[];
  suppliers: { id; name; exclusive: boolean; discountPct; failureRisk }[]; hq: { cash: Pence; day }; mealsServedTotal: number;
  events: EmpireEventLog[] }
export type EmpireCommand = OPEN_SITE | SELL_FRANCHISE | SET_CONTRACT | BUY_PROPERTY | SET_FORMULA | RESEARCH (academy/driveThru/app)
  | SIGN_SUPPLIER | LAUNCH_CAMPAIGN | ENTER_CITY | LOCALISE_MENU | LAUNCH_PRODUCT (gamble) | CLOSE_SITE | REMODEL
export function stepEmpireDay(content, empire, focusedResult?: DayResult): { empire; events: EmpireEvent[] }
export function aggregateSiteDay(content, site, brand, city, rng): SiteDayResult   // closed-form: covers = f(footfall, price, recognition, consistency, competition, saturation)
export function calibrate(content, focusedHistory: DayResult[]): CalibrationParams   // fit aggregate to the focused sim so numbers match
```
Mechanics to include (from BRIEF Path A): ownership slider per site; contract builder with franchisee mood response;
landlord mode (buy the plot, rent as % of sales or cost markup — the real profit engine); standardisation tech tree
(formula → academy → drive-thru → app); exclusive suppliers with single-point-of-failure risk; saturation curve per
city (each new site trims neighbours); franchisee association that blocks decisions when mood < threshold; country
entry puzzle (dietary rules → localise or lose appeal; local champion competition); product-launch gamble;
scandal events (sales −20% for N quarters); win condition tracking (meals served, regions with recognition ≥ 60).
Demo: a world map of 12 cities in 5 regions with site pins, a brand panel and a 10-year fast-forward showing the empire grow or stall.
Target: 5,000 aggregate sites step in < 50 ms/day.

## Package 2 — `packages/sim-stars` (Path B: the Stars)
Owns critics, inspectors, prestige tracks, the test kitchen, satellites, chef stress and the group cap.
```ts
export interface StarsState { version; guides: { michelin: { stars: 0|1|2|3; inspectorVisits: InspectorVisit[]; nextGuideDay };
  fiftyBest: { rank?: number; hallOfFame: boolean }; gaultMillau: { points: 0-19.5 }; goodFood: tier; localCritic: { lastReview?: Review; nextVisit?: day } };
  headChef: { staffId?; stress: 0-100; reputation: 0-100; wantsOwnPlace: boolean };
  testKitchen: { unlocked; researched: DishId[]; inProgress?: { dishId; daysLeft } };
  sourcing: { supplierId; relationship: 0-100; seasonalBonus }[]; satellites: Satellite[]; ticketing: { unlocked; prepaid: boolean; dynamicPricing: boolean };
  stagiaires: { paid: boolean; count: number }; consistencyWindow: number[] /* last 60 days' mean quality */ }
export type StarsCommand = UNLOCK_TEST_KITCHEN | RESEARCH_DISH | OPEN_SATELLITE (bar|bistro|ticketed) | UNLOCK_TICKETING
  | SET_STAGIAIRE_POLICY | BACK_HEAD_CHEF (fund their own place → friendly satellite) | HAND_BACK_STARS | RELAUNCH_CONCEPT | CLOSE_AT_PEAK
export function stepStarsDay(content, stars, result: DayResult, state: GameState): { stars; events: StarsEvent[] }
export function inspectorModel(visits: InspectorVisit[], consistency: number[]): { predictedStars; confidence }  // hidden; UI shows only hints
```
Mechanics: anonymous inspector visits (2–5 per year, unknown nights, scored on five criteria incl. consistency across
the whole window); annual "guide day" reveal; Fat Duck rule (closed → no assessment → stars lapse); star bump
(+20–30% demand via a footfallMod and better candidates); multiple prestige tracks; chef stress rising with stars
and inspection season, options to hand back / relaunch / burn out; stagiaire dilemma; group cap (each satellite
lowers consistency unless a trained head chef runs it); the Smyth arc (head chef leaves to open a rival or is backed);
El Bulli ending as a valid win. Demo: a "year in the life" dashboard that runs a scripted restaurant for 3 years and
shows inspector visits, stress and the guide-day reveal.

## Package 3 — `packages/sim-career` (the career ladder)
Owns the "start as an employee" mode: an AI owner runs the restaurant (reuse sim-core's headless strategies through
sim-core's public API only), the player is one staff member with a role, and the game is about shifts, promotion and
eventually leaving to open their own place (which hands over to the normal owner game with carried-over skills,
relationships and savings).
```ts
export interface CareerState { version; role: StaffRole; rung: 0..N; playerStaffId: StaffId; savings: Pence; wage: Pence;
  reputation: 0-100; relationships: { staffId; bond: -100..100 }[]; mentor?: StaffId; weeklyReview: { day; score; notes }[];
  offers: Offer[]; shiftsWorked; promotionsEarned; canOpenOwn: boolean; owner: { name; strategy: "balanced"|"cheap"|"premium"; mood } }
export type CareerCommand = TAKE_SHIFT | REQUEST_PROMOTION | ACCEPT_OFFER | ASK_FOR_RAISE | MENTOR_SESSION | OPEN_OWN_PLACE
export function stepCareerDay(content, career, state: GameState, result: DayResult): { career; events: CareerEvent[]; nextOwnerCommands: Command[] }
export function handoverToOwner(content, career, state): { state: GameState /* new owner game */; perks: string[] }
```
Rungs: apprentice chef → chef de partie → sous → head chef; bar back → bar manager → GM; waiter → head waiter →
restaurant manager; manager → GM → offered equity. Each rung has visible promotion criteria (skill, shifts, reviews,
an owner mood threshold). Wages anchored to UK figures (NLW floor; tronc tips shared by law). Demo: a "career
ledger" page that fast-forwards a year as an apprentice and shows the rung climb, wages, savings and the handover
perks.

## Package 4 — `packages/handson` (first-person / Roblox-style hands-on layer)
Owns the playable shift: a top-down 2D canvas scene of the kitchen + floor where the player moves a character and
performs **discrete verbs** (grab, chop, cook, plate, carry, serve, clear, pour, take payment), each a 1–3 second
timing/sequence action with soft failure. It consumes the live sim-core `GameState` during service (tickets,
tables, customers) and emits **hands-on results** the sim can use.
```ts
export interface HandsOnInput { up/down/left/right; interact; cancel }
export interface HandsOnSession { role: StaffRole; playerPos; carrying?: Item; activeAction?: { verb; progress; quality };
  stations: Station[]; score: { plates; quality; speedBonus; drops } }
export function createSession(state: GameState, role): HandsOnSession
export function updateSession(session, state: GameState, input: HandsOnInput, dt): { session; results: HandsOnResult[] }
export type HandsOnResult = { type: "PLATE_COOKED"; ticketId; quality } | { type: "TABLE_SERVED"; customerId; speedBonus } | { type: "TABLE_CLEARED"; tableId } | { type: "DROPPED"; cost: Pence }
export function render(ctx: CanvasRenderingContext2D, session, state, view): void   // pure draw
```
Design: readable in two seconds, realistic rhythm (tickets, pass, table numbers), warm not slapstick, keyboard +
gamepad-friendly input model (abstracted), a 12-year-old can play it. The scene reuses the restaurant layout
conventions from `packages/game/src/canvas/RestaurantView.ts` (read it for the look; do not import it). Document in
HANDSON-NOTES how sim-core should consume `HandsOnResult`s (proposed optional commands `PLAYER_COOKED`,
`PLAYER_SERVED` — do not add them to types.ts; the lead will). Demo: a playable kitchen shift against a fixture state
with a 3-minute timer and a score screen.

## Later passes (not for these four agents)
- Content: fast-food cuisine set, fine-dining set, cities/countries, critics text, career dialogue.
- Integration: game UI mounts the path layers (the fork at ~year 2 per BRIEF), the career start on the title screen,
  the hands-on layer on the apprentice/bar/waiter rungs and as an optional "jump in" during owner service.
- Reviewer pass over everything.
