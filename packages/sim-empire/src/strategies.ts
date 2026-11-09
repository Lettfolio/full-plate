/**
 * Scripted Empire strategies (pure; used by the headless CLI, the tests and the demo's autopilot).
 *
 * franchise  — franchise-fast: lock the formula, research the tech tree, sell franchises to every applicant
 *              who can pay, HQ leases (then buys) the land and sublets it (the Sonneborn engine).
 * company    — company-owned-steady: only company sites, opened when cash covers build + a year's buffer;
 *              buys the plots it can.
 * innout     — In-N-Out-slow: fresh, never frozen, company-only, a commissary per region; each commissary supplies at
 *              most one new site every two months in its region (round 5: region by region, least-known region first).
 *
 * `playStyleWeek` is one weekly decision pass; `runStyle` plays N years of it.
 */
import type { ContentPack } from "@full-plate/sim-core";
import * as K from "./constants";
import {
  applyEmpireCommand,
  avgFranchiseeMood,
  buildCost,
  cityEntryCost,
  franchiseCashNeeded,
  newEmpire,
  openSites,
  propertyPrice,
  spendable,
  stepEmpireDay,
} from "./engine";
import { menuBreaksRules } from "./model";
import type { City, EmpireCommand, EmpireEvent, EmpireState, SiteSummary } from "./types";

export type EmpireStyle = "franchise" | "company" | "innout";
/**
 * [round 6] What a scripted player does with the monthly board meeting: `skip` never answers (each meeting is skipped
 * at the next one, with its consequence), `follow` takes the board's advice the evening it is held ("board-follower").
 */
export type BoardPolicy = "skip" | "follow";

/** The board-follower's answer to the pending meeting (undefined when none is waiting). */
export function boardFollower(e: EmpireState): EmpireCommand | undefined {
  return e.boardMeeting ? { type: "BOARD_DECIDE", optionId: e.boardMeeting.decision.advice } : undefined;
}

export const FAST_FOOD_MENU = ["beef_burger", "chicken_burger", "halloumi_burger", "chunky_chips", "onion_rings", "milkshake", "soft_drink", "sundae"];

export interface EmpireRun {
  style: EmpireStyle;
  board: BoardPolicy;
  /** Board answers taken, "kind:option" → count (round 6). */
  decisions: Record<string, number>;
  seed: number;
  /** Day the run started on. */
  startDay: number;
  final: EmpireState;
  events: EmpireEvent[];
  rejected: number;
}

/** Cities in the order a scripted player would enter them: home region first, then by population. */
function cityOrder(e: EmpireState): City[] {
  const home = e.cities.find((c) => c.id === e.hq.homeCityId)!;
  return e.cities
    .filter((c) => !c.exited)
    .slice()
    .sort((a, b) => Number(b.regionId === home.regionId) - Number(a.regionId === home.regionId) || b.population * (1 - b.championStrength * 0.3) - a.population * (1 - a.championStrength * 0.3));
}

/** Best (city, district) to open in next: the one with the lowest saturation per head among entered cities. */
function pickLocation(content: ContentPack, e: EmpireState, regionFilter?: (regionId: string) => boolean): { city: City; districtId: string } | undefined {
  let best: { city: City; districtId: string; score: number } | undefined;
  for (const city of e.cities) {
    if (!city.entered || (regionFilter && !regionFilter(city.regionId))) continue;
    const mine = e.sites.filter((s) => s.status !== "closed" && s.cityId === city.id);
    const capacity = city.population / K.PEOPLE_PER_SITE;
    for (const d of city.districts) {
      const here = mine.filter((s) => s.districtId === d).length;
      const footfall = content.districts.find((x) => x.id === d)?.footfall ?? 70;
      const score = (footfall / 80) * (city.population / 2_500_000) ** 0.35 * Math.exp(-(mine.length + 1.5 * here) / capacity) * (1 - city.championStrength * 0.3);
      if (!best || score > best.score) best = { city, districtId: d, score };
    }
  }
  return best && best.score > 0.35 ? { city: best.city, districtId: best.districtId } : undefined;
}

// Policies re-read state after every command, so they are written against a mutable run object.
interface Run {
  e: EmpireState;
  events: EmpireEvent[];
  rejected: number;
}

const step = (content: ContentPack, run: Run) => (c: EmpireCommand): boolean => {
  const r = applyEmpireCommand(content, run.e, c);
  if (r.events.some((ev) => ev.kind === "rejected")) {
    run.rejected++;
    return false;
  }
  run.e = r.empire;
  run.events.push(...r.events);
  return true;
};

type Cmd = (c: EmpireCommand) => boolean;

function techTree(run: Run, cmd: Cmd, buffer: number): void {
  if (!run.e.brand.formula.locked) cmd({ type: "SET_FORMULA", locked: true });
  if (run.e.brand.research) return;
  for (const t of ["academy", "driveThru", "appOrdering"] as const) {
    if (run.e.brand.formula[t]) continue;
    if (run.e.hq.cash > K.TECH[t].cost * run.e.hq.priceLevel + buffer) cmd({ type: "RESEARCH", tech: t });
    return;
  }
}

/** The next city worth entering, once the entered ones are filling up (undefined = keep building at home). */
function nextCity(run: Run, allow: (c: City) => boolean): City | undefined {
  const open = run.e.sites.filter((s) => s.status !== "closed");
  const entered = run.e.cities.filter((c) => c.entered);
  const fill = open.length / entered.reduce((a, c) => a + c.population / K.PEOPLE_PER_SITE, 0);
  if (fill <= 0.35 && open.length < 3 * entered.length) return undefined;
  return cityOrder(run.e).find((c) => !c.entered && allow(c));
}

/** Enters the next city once the entered ones are filling up; localises menus that break local rules. */
function expandCities(content: ContentPack, run: Run, cmd: Cmd, buffer: number, allow: (c: City) => boolean, hqBuilds = true): void {
  const next = nextCity(run, allow);
  const build = hqBuilds ? buildCost(next ?? run.e.cities[0]!, run.e.brand.formula.driveThru, run.e.hq.priceLevel) : 0;
  if (next && run.e.hq.cash > cityEntryCost(run.e, next) + build + buffer) cmd({ type: "ENTER_CITY", cityId: next.id });
  for (const c of run.e.cities) {
    if (c.entered && !c.localised && menuBreaksRules(content, run.e.brand.formula.menuDishIds, c.dietaryRules) && run.e.hq.cash > K.LOCALISE_COST * 2 + buffer)
      cmd({ type: "LOCALISE_MENU", cityId: c.id });
  }
}

function buyPlots(run: Run, cmd: Cmd, buffer: number, max: number): void {
  let n = 0;
  // Round 5: keep a reserve against the mortgages already carried (a forced exit sells plots at half their value, so a
  // landlord at zero cash with 200 mortgages can be bankrupted by one country's sanctions).
  buffer += 0.1 * run.e.property.reduce((a, p) => a + p.mortgageRemaining, 0);
  const cands = run.e.sites
    .filter((s) => s.status === "open" && s.land !== "hqOwned" && s.ownership !== "licence")
    .sort((a, b) => b.revenueYear / propertyPrice(b) - a.revenueYear / propertyPrice(a));
  for (const s of cands) {
    if (n >= max || run.e.hq.cash < propertyPrice(s) * K.PROPERTY_DEPOSIT_SHARE + buffer) break;
    if (cmd({ type: "BUY_PROPERTY", siteId: s.id })) n++;
  }
}

function weakestCompany(e: EmpireState): SiteSummary | undefined {
  return openSites(e)
    .filter((s) => s.ownership === "company" && e.hq.day - s.opened > 360 && s.margin7d < 0 && !s.focused)
    .sort((a, b) => a.margin7d - b.margin7d)[0];
}

function franchiseFast(content: ContentPack, run: Run): void {
  const cmd = step(content, run);
  const pl = run.e.hq.priceLevel;
  const buffer = 15_000_000 * pl;
  techTree(run, cmd, buffer);
  for (const s of run.e.suppliers) if (!s.signed) cmd({ type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: s.failureRisk < 0.05 });
  // Franchisees pay for the builds, so HQ only needs the entry cost.
  expandCities(content, run, cmd, buffer, () => true, false);
  // Sell a franchise to every applicant who can pay, while HQ can carry the head lease.
  for (let guard = 0; guard < 6; guard++) {
    const loc = pickLocation(content, run.e);
    if (!loc) break;
    const need = franchiseCashNeeded(run.e, loc.city);
    const a = run.e.applicants.filter((p) => p.cash >= need && p.competence >= 35).sort((x, y) => y.competence - x.competence)[0];
    const multi = run.e.franchisees.filter((f) => f.sites.length && f.mood >= K.MULTI_UNIT_MOOD && f.cash >= need + 5_000_000 && f.competence >= 55 && run.e.hq.day - (f.lastExpansionDay ?? -1e9) >= K.MULTI_UNIT_COOLDOWN_DAYS).sort((x, y) => y.competence - x.competence)[0];
    if (!a && !multi) break;
    const ok = cmd({ type: "OPEN_SITE", cityId: loc.city.id, districtId: loc.districtId, ownership: "franchise", land: run.e.hq.cash > buffer * 2 ? "hqLease" : "thirdParty", ...(a ? { applicantId: a.id } : { franchiseeId: multi!.id }) });
    if (!ok) break;
  }
  // Landlord mode: buy the plots under the best franchise sites, keeping enough back for the next city.
  const next = nextCity(run, () => true);
  buyPlots(run, cmd, buffer * 2 + (next ? cityEntryCost(run.e, next) : 0), 3);
  // Refranchise company sites that are old enough (keeps the flagship).
  for (const s of openSites(run.e)) {
    if (s.ownership !== "company" || s.id === "s1" || s.focused) continue;
    const a = run.e.applicants.find((p) => p.cash >= run.e.contract.fee + buildCost(run.e.cities.find((c) => c.id === s.cityId)!, s.driveThru, pl) * 0.3);
    if (a) cmd({ type: "SELL_FRANCHISE", siteId: s.id, applicantId: a.id });
  }
  // A brand campaign in the weakest region now and then.
  if (run.e.hq.day % 90 === 0 && run.e.hq.cash > 80_000_000 * pl) {
    const live = run.e.regions.filter((r) => run.e.sites.some((s) => s.status === "open" && run.e.cities.find((c) => c.id === s.cityId)!.regionId === r.id));
    const weakest = live.sort((a, b) => (run.e.brand.recognition[a.id] ?? 0) - (run.e.brand.recognition[b.id] ?? 0))[0];
    if (weakest) cmd({ type: "LAUNCH_CAMPAIGN", kind: "brand", budget: Math.round(20_000_000 * pl), regionId: weakest.id });
  }
  if (run.e.pendingIdea && run.e.hq.cash > 60_000_000 * pl) cmd({ type: "LAUNCH_PRODUCT", name: run.e.pendingIdea.name, budget: Math.round(30_000_000 * pl), fit: "franchiseeIdea" });
  // Ease the contract if franchisees are revolting.
  if (run.e.association.active && run.e.contract.royaltyPct > 0.04) cmd({ type: "SET_CONTRACT", contract: { royaltyPct: run.e.contract.royaltyPct - 0.005 }, applyTo: "all" });
}

function companySteady(content: ContentPack, run: Run): void {
  const cmd = step(content, run);
  const pl = run.e.hq.priceLevel;
  // Company growth runs on the development facility: the steady style keeps a small cushion above its limit.
  const buffer = -(K.HQ_CREDIT_LINE * K.DEVELOPMENT_FACILITY_SHARE - 20_000_000) * pl;
  techTree(run, cmd, buffer);
  for (const s of run.e.suppliers) if (!s.signed) cmd({ type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: false });
  expandCities(content, run, cmd, buffer, () => true);
  // Home is filling up and the next city is unaffordable: save rather than crowd the neighbours (every other week).
  const saving = nextCity(run, () => true) !== undefined && Math.floor(run.e.hq.day / 7) % 2 === 0;
  for (let guard = 0; guard < 3 && !saving; guard++) {
    const loc = pickLocation(content, run.e);
    if (!loc) break;
    const yearBuffer = (K.HQ_OVERHEAD_DAILY + K.HQ_OVERHEAD_PER_SITE_DAILY * openSites(run.e).length) * 60 * pl;
    if (run.e.hq.cash < buildCost(loc.city, run.e.brand.formula.driveThru, pl) + buffer + yearBuffer) break;
    if (!cmd({ type: "OPEN_SITE", cityId: loc.city.id, districtId: loc.districtId, ownership: "company", land: "hqLease" })) break;
  }
  // Plots are bought from profits, never on the development facility.
  if (!saving) buyPlots(run, cmd, 50_000_000 * pl, 1);
  const weak = weakestCompany(run.e);
  if (weak && run.e.hq.day % 30 === 0 && weak.failingDays > 180) cmd({ type: "CLOSE_SITE", siteId: weak.id });
  if (run.e.hq.day % 180 === 0 && run.e.hq.cash > 150_000_000 * pl) {
    const live = run.e.regions.filter((r) => run.e.sites.some((s) => s.status === "open" && run.e.cities.find((c) => c.id === s.cityId)!.regionId === r.id));
    const weakest = live.sort((a, b) => (run.e.brand.recognition[a.id] ?? 0) - (run.e.brand.recognition[b.id] ?? 0))[0];
    if (weakest) cmd({ type: "LAUNCH_CAMPAIGN", kind: "brand", budget: Math.round(25_000_000 * pl), regionId: weakest.id });
  }
}

/** In-N-Out-slow: days between new sites in one commissary's region. */
const INNOUT_DAYS_PER_SITE = 60;

function inNOutSlow(content: ContentPack, run: Run): void {
  const cmd = step(content, run);
  const pl = run.e.hq.priceLevel;
  // Slow and careful: only borrows a fifth of the credit line, grows one site a month, only near a commissary.
  const buffer = -(K.HQ_CREDIT_LINE / 5) * pl;
  const f = run.e.brand.formula;
  if (!f.fresh) {
    cmd({ type: "SET_FORMULA", fresh: true, priceIndex: 1.1 });
    const home = run.e.cities.find((c) => c.id === run.e.hq.homeCityId)!;
    run.e = { ...run.e, regions: run.e.regions.map((r) => (r.id === home.regionId ? { ...r, commissary: true } : r)) }; // the flagship's kitchen is the first commissary
  }
  techTree(run, cmd, buffer);
  // Its own supply chain: the commissaries buy for every site (non-exclusive deals, so one failure can't empty the menu).
  for (const s of run.e.suppliers) if (!s.signed) cmd({ type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: false });
  const withCommissary = (rid: string) => run.e.regions.find((r) => r.id === rid)!.commissary;
  const regionsWith = run.e.regions.filter((r) => r.commissary).length;
  const open = openSites(run.e).length;
  // Every 15 sites per commissary, pause and save for the next region's commissary.
  const saving = open >= regionsWith * 15 && run.e.regions.some((r) => !r.commissary);
  if (saving && spendable(run.e) > K.COMMISSARY_COST * pl - buffer) {
    const next = cityOrder(run.e).find((c) => !withCommissary(c.regionId));
    if (next) cmd({ type: "BUILD_COMMISSARY", regionId: next.regionId });
  }
  expandCities(content, run, cmd, buffer, (c: City) => withCommissary(c.regionId));
  // Region by region (round 5): a new commissary's region gets its biggest city first, so the brand doesn't pile into
  // the one huge region it already serves.
  for (const r of run.e.regions) {
    if (!r.commissary || run.e.cities.some((c) => c.entered && c.regionId === r.id)) continue;
    const first = cityOrder(run.e).find((c) => c.regionId === r.id && !c.entered);
    if (first && run.e.hq.cash > cityEntryCost(run.e, first) + buildCost(first, f.driveThru, pl) + buffer) cmd({ type: "ENTER_CITY", cityId: first.id });
  }
  // Each commissary supplies at most one new site every two months in its own region, least-known region first.
  const regionOf = (cityId: string) => run.e.cities.find((c) => c.id === cityId)!.regionId;
  const served = run.e.regions
    .filter((r) => r.commissary && run.e.cities.some((c) => c.entered && c.regionId === r.id))
    .sort((a, b) => (run.e.brand.recognition[a.id] ?? 0) - (run.e.brand.recognition[b.id] ?? 0));
  for (const r of saving ? [] : served) {
    const lastOpen = Math.max(-1e9, ...run.e.sites.filter((x) => regionOf(x.cityId) === r.id).map((x) => x.opened - 90));
    if (run.e.hq.day - lastOpen < INNOUT_DAYS_PER_SITE) continue;
    const loc = pickLocation(content, run.e, (rid) => rid === r.id);
    if (loc && run.e.hq.cash > buildCost(loc.city, f.driveThru, pl) + buffer) cmd({ type: "OPEN_SITE", cityId: loc.city.id, districtId: loc.districtId, ownership: "company", land: "hqLease" });
  }
  if (!saving) buyPlots(run, cmd, 50_000_000 * pl, 1);
  // Little advertising, but a cash pile pays for a launch campaign where the brand is least known.
  if (run.e.hq.day % 90 === 0 && run.e.hq.cash > 100_000_000 * pl) {
    const live = run.e.regions.filter((r) => run.e.sites.some((x) => x.status === "open" && run.e.cities.find((c) => c.id === x.cityId)!.regionId === r.id));
    const weakest = live.sort((a, b) => (run.e.brand.recognition[a.id] ?? 0) - (run.e.brand.recognition[b.id] ?? 0))[0];
    if (weakest && (run.e.brand.recognition[weakest.id] ?? 0) < K.WIN_RECOGNITION + 5) cmd({ type: "LAUNCH_CAMPAIGN", kind: "brand", budget: Math.round(25_000_000 * pl), regionId: weakest.id });
  }
}

const STYLE_FN: Record<EmpireStyle, (content: ContentPack, run: Run) => void> = { franchise: franchiseFast, company: companySteady, innout: inNOutSlow };

export function startingEmpire(content: ContentPack, seed: number): EmpireState {
  return newEmpire(content, {
    seed,
    brandName: "Full Plate Burgers",
    flagship: { name: "The Original", districtId: "high_street" },
    hqCash: 50_000_000,
    menuDishIds: FAST_FOOD_MENU.filter((d) => content.dishes.some((x) => x.id === d)),
  });
}

/** One weekly decision pass of a scripted style (the demo's autopilot calls this every 7 days). */
export function playStyleWeek(content: ContentPack, e: EmpireState, style: EmpireStyle): { empire: EmpireState; events: EmpireEvent[] } {
  const run: Run = { e, events: [], rejected: 0 };
  STYLE_FN[style](content, run);
  return { empire: run.e, events: run.events };
}

export function runStyle(content: ContentPack, style: EmpireStyle, seed: number, years: number, start?: EmpireState, board: BoardPolicy = "skip"): EmpireRun {
  const run: Run = { e: start ?? startingEmpire(content, seed), events: [], rejected: 0 };
  const startDay = run.e.hq.day;
  const days = years * K.DAYS_PER_YEAR;
  const decisions: Record<string, number> = {};
  for (let d = 0; d < days && run.e.status === "running"; d++) {
    if (d % 7 === 0) STYLE_FN[style](content, run);
    const r = stepEmpireDay(content, run.e);
    run.e = r.empire;
    for (const ev of r.events) run.events.push(ev);
    const answer = board === "follow" ? boardFollower(run.e) : undefined;
    // A rejected answer (the advice became unaffordable) leaves the meeting to be skipped next month.
    if (answer && answer.type === "BOARD_DECIDE") {
      const key = `${run.e.boardMeeting!.decision.kind}:${answer.optionId}`;
      if (step(content, run)(answer)) decisions[key] = (decisions[key] ?? 0) + 1;
    }
  }
  return { style, board, decisions, seed, startDay, final: run.e, events: run.events, rejected: run.rejected };
}

export interface RunSummary {
  style: EmpireStyle;
  board: BoardPolicy;
  /** Board decisions taken (not skipped), by kind (round 6). */
  decisions: Record<string, number>;
  seed: number;
  sites: number;
  company: number;
  franchise: number;
  closed: number;
  mealsServed: number;
  hqCash: number;
  hqIncomeYear: number;
  systemSales: number;
  avgSiteRevenue: number;
  mood: number;
  regionsWon: number;
  propertyCount: number;
  scandals: number;
  win: boolean;
  /** Years from the start to the win (undefined: not won). */
  winYear?: number;
  bankrupt: boolean;
}

export function summariseRun(r: EmpireRun): RunSummary {
  const e = r.final;
  const open = openSites(e);
  const sales = open.reduce((a, s) => a + s.revenueYear, 0);
  return {
    style: r.style,
    board: r.board,
    decisions: r.decisions,
    seed: r.seed,
    sites: open.length,
    company: open.filter((s) => s.ownership === "company").length,
    franchise: open.filter((s) => s.ownership !== "company").length,
    closed: e.sites.filter((s) => s.status === "closed").length,
    mealsServed: e.mealsServedTotal,
    hqCash: e.hq.cash,
    hqIncomeYear: Math.round((e.hq.income30d * K.DAYS_PER_YEAR) / 30),
    systemSales: Math.round(sales),
    avgSiteRevenue: open.length ? Math.round(sales / open.length) : 0,
    mood: e.franchisees.some((f) => f.sites.length) ? Math.round(avgFranchiseeMood(e)) : NaN,
    regionsWon: e.win.regionsWon.length,
    propertyCount: e.property.length,
    scandals: r.events.filter((ev) => ev.kind === "scandal").length,
    win: e.win.achieved,
    ...(e.win.achievedDay !== undefined ? { winYear: Math.round(((e.win.achievedDay - r.startDay) / K.DAYS_PER_YEAR) * 10) / 10 } : {}),
    bankrupt: e.status === "bankrupt",
  };
}

const m = (p: number) => `£${(p / 100 / 1e6).toFixed(1)}m`;

export function formatTable(rows: RunSummary[]): string {
  const head = "style      board   seed  sites (co/fr)  closed  meals      HQ cash   HQ net/yr  avg site/yr  mood  regions  plots  scandals  win";
  const lines = rows.map((r) =>
    [
      r.style.padEnd(10),
      r.board.padEnd(6),
      String(r.seed).padStart(4),
      `${r.sites} (${r.company}/${r.franchise})`.padStart(13),
      String(r.closed).padStart(7),
      `${(r.mealsServed / 1e6).toFixed(1)}m`.padStart(7),
      m(r.hqCash).padStart(10),
      m(r.hqIncomeYear).padStart(11),
      m(r.avgSiteRevenue).padStart(12),
      (Number.isNaN(r.mood) ? "—" : String(r.mood)).padStart(5),
      `${r.regionsWon}/5`.padStart(8),
      String(r.propertyCount).padStart(6),
      String(r.scandals).padStart(9),
      (r.bankrupt ? "BUST" : r.win ? `y${r.winYear?.toFixed(1) ?? ""}` : "no").padStart(5),
    ].join(" "),
  );
  return [head, ...lines].join("\n");
}

/** Builds a world with n open aggregate sites spread over every city (perf benchmark). */
export function bigEmpire(content: ContentPack, n: number, seed = 1): EmpireState {
  let e = startingEmpire(content, seed);
  e = { ...e, hq: { ...e.hq, cash: 1e13 }, cities: e.cities.map((c) => ({ ...c, entered: true })) };
  e = applyEmpireCommand(content, e, { type: "SET_FORMULA", locked: true }).empire;
  const sites: SiteSummary[] = [];
  const franchisees = [];
  for (let i = 0; i < n; i++) {
    const city = e.cities[i % e.cities.length]!;
    const districtId = city.districts[i % city.districts.length]!;
    const fid = `f${i}`;
    const franchise = i % 5 !== 0;
    sites.push({
      ...e.sites[0]!,
      id: `b${i}`,
      name: `${city.name} #${i}`,
      cityId: city.id,
      districtId,
      ownership: franchise ? "franchise" : "company",
      land: i % 3 === 0 ? "hqOwned" : "hqLease",
      ...(franchise
        ? { franchisee: fid, contract: { royaltyPct: 0.05, adFundPct: 0.04, rentPctOfSales: 0.1, signedDay: 0, termDays: 7200, remodelEveryDays: 3600 } }
        : {}),
      rent: Math.round(300_000 * city.costIndex),
    });
    if (franchise) franchisees.push({ id: fid, name: `Op ${i}`, competence: 60, honesty: 80, mood: 60, cash: 50_000_000, sites: [`b${i}`], joinedDay: 0, margin30d: 0.06 });
  }
  const property = sites.filter((s) => s.land === "hqOwned").map((s) => ({ siteId: s.id, purchasePrice: 50_000_000, priceLevelAtPurchase: 1, mortgageRemaining: 30_000_000, mortgageDaily: 10_000, rentIncome: 0 }));
  return { ...e, sites, franchisees, property };
}

export function benchmark(content: ContentPack, n: number, days: number): { msPerDay: number; sites: number } {
  let e = bigEmpire(content, n);
  for (let i = 0; i < 5; i++) e = stepEmpireDay(content, e, undefined, { noEvents: true }).empire; // warm up
  const t0 = performance.now();
  for (let i = 0; i < days; i++) e = stepEmpireDay(content, e).empire;
  return { msPerDay: (performance.now() - t0) / days, sites: openSites(e).length };
}

